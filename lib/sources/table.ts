/**
 * Interpretación de tablas de origen desconocido.
 *
 * Los documentos reales (extracto BBVA, cuenta de cash, Excels de ventas) tienen
 * cabeceras en filas distintas, columnas en orden distinto y nombres distintos.
 * En lugar de fijar posiciones de celda, aquí se detecta la cabecera y se mapean
 * las columnas por sinónimos. Cuando conozcamos los formatos reales bastará con
 * ampliar los sinónimos, no con reescribir los lectores.
 */

import { parseAmountToCents } from "../finance/money";
import { parseDateToISO } from "../finance/period";
import { normalizeText } from "../finance/text";
import type { CellValue, SheetData } from "./workbook";

/** Roles de columna que el motor sabe reconocer. */
export type ColumnRole =
  | "date"
  | "valueDate"
  | "concept"
  | "observations"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "category"
  | "pnl"
  | "supplier"
  | "invoiceNumber"
  | "treasury";

const SYNONYMS: Record<ColumnRole, string[]> = {
  date: ["fecha", "fecha operacion", "f operacion", "fecha de operacion", "dia", "date"],
  valueDate: ["fecha valor", "f valor", "valor", "value date"],
  concept: ["concepto", "descripcion", "detalle", "movimiento", "operacion", "texto", "description"],
  observations: ["observaciones", "mas datos", "informacion adicional", "notas", "referencia"],
  amount: ["importe", "importe eur", "cantidad", "monto", "euros", "total", "amount", "precio"],
  debit: ["debe", "cargo", "salida", "gasto", "pagos"],
  credit: ["haber", "abono", "entrada", "ingreso", "cobros"],
  balance: ["saldo", "saldo posterior", "balance"],
  category: ["categoria", "tipo de gasto", "concepto contable"],
  pnl: ["p l", "pl", "pyg", "cuenta de resultados", "clasificacion"],
  supplier: ["proveedor", "razon social", "emisor", "beneficiario", "cliente", "nombre"],
  invoiceNumber: ["n factura", "num factura", "numero factura", "n fra", "factura n", "num fra"],
  treasury: ["tesoreria", "forma de pago", "medio de pago", "banco cash"],
};

export interface ColumnMap {
  /** Índice de columna por rol detectado. */
  byRole: Partial<Record<ColumnRole, number>>;
  /** Cabeceras originales, por índice. */
  headers: string[];
  /** Fila (0-indexada dentro de la hoja) donde está la cabecera. */
  headerRowIndex: number;
  /** Confianza de la detección en [0, 1]. */
  confidence: number;
  /** Cabeceras que no se han podido mapear a ningún rol conocido. */
  unmapped: string[];
}

/**
 * Localiza la fila de cabecera de una hoja.
 *
 * Estrategia: se prueban las primeras filas y gana la que mapea más roles
 * conocidos. Si ninguna mapea nada, se devuelve confianza 0 y el llamante
 * reporta SOURCE_ERROR en lugar de adivinar.
 */
export function detectTable(sheet: SheetData, maxHeaderScan = 25): ColumnMap {
  let best: ColumnMap = {
    byRole: {},
    headers: [],
    headerRowIndex: -1,
    confidence: 0,
    unmapped: [],
  };

  const limit = Math.min(maxHeaderScan, sheet.rows.length);
  for (let i = 0; i < limit; i += 1) {
    const candidate = mapHeaderRow(sheet.rows[i], i);
    if (candidate.confidence > best.confidence) best = candidate;
  }

  return best;
}

function mapHeaderRow(row: CellValue[] | undefined, rowIndex: number): ColumnMap {
  const headers = (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell)));
  const byRole: Partial<Record<ColumnRole, number>> = {};
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const normalized = normalizeText(header);
    if (normalized === "") return;

    let matchedRole: ColumnRole | null = null;
    let matchedLength = 0;

    for (const [role, synonyms] of Object.entries(SYNONYMS) as Array<[ColumnRole, string[]]>) {
      for (const synonym of synonyms) {
        // Coincidencia exacta o cabecera que empieza por el sinónimo: evita que
        // "fecha valor" se mapee como "fecha" por accidente, porque se queda
        // con el sinónimo más largo que encaja.
        const isMatch = normalized === synonym || normalized.startsWith(`${synonym} `);
        if (isMatch && synonym.length > matchedLength) {
          matchedRole = role;
          matchedLength = synonym.length;
        }
      }
    }

    if (matchedRole && byRole[matchedRole] === undefined) {
      byRole[matchedRole] = index;
    } else if (!matchedRole) {
      unmapped.push(header);
    }
  });

  const roleCount = Object.keys(byRole).length;
  const nonEmptyHeaders = headers.filter((h) => h.trim() !== "").length;
  const confidence =
    nonEmptyHeaders === 0 ? 0 : Math.min(1, (roleCount / Math.max(3, nonEmptyHeaders)) * (roleCount >= 2 ? 1 : 0.4));

  return { byRole, headers, headerRowIndex: rowIndex, confidence, unmapped };
}

export interface ParsedRow {
  /** Fila 1-indexada tal y como se ve en el documento. */
  rowNumber: number;
  date: string | null;
  valueDate: string | null;
  concept: string | null;
  observations: string | null;
  amountCents: number | null;
  category: string | null;
  pnl: string | null;
  supplier: string | null;
  invoiceNumber: string | null;
  /** Texto original de la fila, para trazabilidad. */
  raw: string;
  /** Motivos por los que la fila no ha podido interpretarse. */
  problems: string[];
}

/**
 * Convierte las filas de datos de una hoja en filas del dominio.
 *
 * No descarta filas problemáticas en silencio: las devuelve con `problems`
 * relleno para que el llamante decida (normalmente, generar SOURCE_ERROR).
 */
export function parseRows(sheet: SheetData, map: ColumnMap): ParsedRow[] {
  if (map.headerRowIndex < 0) return [];

  const result: ParsedRow[] = [];

  for (let i = map.headerRowIndex + 1; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    const raw = row.map((c) => (c === null || c === undefined ? "" : String(c))).join(" | ").trim();
    if (raw.replace(/\|/g, "").trim() === "") continue;

    const problems: string[] = [];
    const cell = (role: ColumnRole): CellValue => {
      const index = map.byRole[role];
      return index === undefined ? null : (row[index] ?? null);
    };

    const date = parseDateToISO(cell("date"));
    const amountCents = resolveAmount(cell("amount"), cell("debit"), cell("credit"));
    const conceptRaw = cell("concept");
    const concept = conceptRaw === null ? null : String(conceptRaw).trim();

    // Fila de totales o subtotal: no es un movimiento. Se ignora sin ruido.
    // La palabra puede estar en cualquier columna (es habitual verla bajo la
    // columna de fecha), así que se busca en toda la fila. Una fila con fecha
    // válida nunca se descarta: sería tirar un movimiento real.
    const looksLikeTotal =
      date === null &&
      row.some(
        (cell) =>
          typeof cell === "string" && /^(total|totales|suma|subtotal)\b/.test(normalizeText(cell)),
      );
    if (looksLikeTotal) continue;

    if (date === null && map.byRole.date !== undefined) problems.push("fecha ilegible");
    if (amountCents === null) problems.push("importe ilegible");
    if (!concept) problems.push("concepto vacío");

    // Errores de fórmula heredados del documento original.
    if (/#(REF|VALUE|DIV\/0|N\/A|NAME|NUM|NULL)!?/i.test(raw)) {
      problems.push("la fila contiene errores de fórmula del documento original");
    }

    result.push({
      rowNumber: i + 1,
      date,
      valueDate: parseDateToISO(cell("valueDate")),
      concept,
      observations: textOrNull(cell("observations")),
      amountCents,
      category: textOrNull(cell("category")),
      pnl: textOrNull(cell("pnl")),
      supplier: textOrNull(cell("supplier")),
      invoiceNumber: textOrNull(cell("invoiceNumber")),
      raw,
      problems,
    });
  }

  return result;
}

/**
 * Resuelve el importe con signo.
 * Formato de columna única (importe con signo) o de columnas debe/haber.
 */
function resolveAmount(amount: CellValue, debit: CellValue, credit: CellValue): number | null {
  const single = parseAmountToCents(amount);
  if (single !== null) return single;

  const debitCents = parseAmountToCents(debit);
  const creditCents = parseAmountToCents(credit);
  if (debitCents !== null && debitCents !== 0) return -Math.abs(debitCents);
  if (creditCents !== null && creditCents !== 0) return Math.abs(creditCents);
  if (debitCents === 0 || creditCents === 0) return 0;
  return null;
}

function textOrNull(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}
