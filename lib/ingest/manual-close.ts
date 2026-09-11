import "server-only";
import type { ManualLine } from "../finance/compare";
import { sheetMatchesPeriod } from "../sources/adapters";
import { detectTable, parseRows } from "../sources/table";
import { readWorkbookFromBytes, type SheetData } from "../sources/workbook";
import type { PeriodDocuments } from "./registry";
import type { DocumentStorage } from "./storage";

/**
 * Lectura del cierre manual de un mes.
 *
 * El `Cash Flow GEA 2026` es un libro con una pestaña por mes y bloques de
 * gastos e ingresos dentro de cada una. De aquí solo se extraen las LÍNEAS, que
 * es lo que se compara: fecha, concepto e importe.
 *
 * No se toca ese documento ni se importa como fuente de movimientos: es
 * material de contraste, y su cierre NO se presume correcto.
 *
 * El signo es la parte delicada. En un Cash Flow los gastos suelen escribirse
 * en positivo dentro de un bloque titulado "gastos", mientras que el motor los
 * guarda en negativo. Aquí se normaliza al criterio del motor usando el bloque
 * en el que aparece cada línea, y si no hay bloque reconocible se conserva el
 * signo tal cual venga.
 */

export interface ManualCloseExtraction {
  lines: ManualLine[];
  /** De qué archivo y hoja salieron, para la trazabilidad del informe. */
  source: { file: string; sheet: string } | null;
  /** Avisos sobre la lectura: hojas descartadas, bloques no reconocidos… */
  warnings: string[];
}

const EXPENSE_HEADINGS = ["gasto", "gastos", "pagos", "salidas"];
const INCOME_HEADINGS = ["ingreso", "ingresos", "cobros", "entradas", "ventas"];

export async function extractManualClose(
  registry: PeriodDocuments,
  storage: DocumentStorage,
): Promise<ManualCloseExtraction> {
  const warnings: string[] = [];
  const document = registry.documents.find((d) => d.kind === "manual");

  if (!document) {
    return { lines: [], source: null, warnings: ["No se ha subido ningún cierre manual."] };
  }

  let sheets: SheetData[];
  try {
    const bytes = await storage.read(document.storagePath);
    if (!bytes) {
      return {
        lines: [],
        source: null,
        warnings: [`El cierre manual "${document.fileName}" no está en el almacén.`],
      };
    }
    sheets = (await readWorkbookFromBytes(bytes, document.fileName)).sheets;
  } catch (error) {
    return {
      lines: [],
      source: null,
      warnings: [
        `No se ha podido leer "${document.fileName}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  // La pestaña del periodo. Si el libro tiene doce meses, mezclarlos sería
  // comparar agosto contra el año entero.
  const matching = sheets.filter((sheet) => sheetMatchesPeriod(sheet.name, registry.period));
  if (matching.length === 0) {
    return {
      lines: [],
      source: null,
      warnings: [
        `El cierre manual no tiene ninguna pestaña para ${registry.period}. ` +
          `Pestañas encontradas: ${sheets.map((s) => s.name).join(", ")}.`,
      ],
    };
  }
  if (matching.length > 1) {
    warnings.push(
      `Varias pestañas coinciden con el periodo: ${matching.map((s) => s.name).join(", ")}. Se usa la primera.`,
    );
  }

  const sheet = matching[0];
  const map = detectTable(sheet);
  if (map.headerRowIndex < 0 || map.confidence === 0) {
    return {
      lines: [],
      source: { file: document.fileName, sheet: sheet.name },
      warnings: [
        ...warnings,
        `No se ha reconocido ninguna tabla en la pestaña "${sheet.name}". ` +
          "Habrá que ampliar los sinónimos de columna con el archivo real delante.",
      ],
    };
  }

  const blocks = detectBlocks(sheet);
  const lines: ManualLine[] = [];

  for (const row of parseRows(sheet, map)) {
    if (row.date === null || row.amountCents === null || !row.concept) continue;

    const block = blockFor(blocks, row.rowNumber);
    const amountCents = normalizeSign(row.amountCents, block);

    lines.push({
      date: row.date,
      description: row.concept,
      amountCents,
      category: row.category,
      pnl: row.pnl,
      sourceRow: row.rowNumber,
    });
  }

  if (lines.length === 0) {
    warnings.push(`La pestaña "${sheet.name}" no ha dado ninguna línea interpretable.`);
  }

  return { lines, source: { file: document.fileName, sheet: sheet.name }, warnings };
}

interface Block {
  fromRow: number;
  kind: "expense" | "income";
}

/**
 * Localiza los encabezados de bloque ("GASTOS", "INGRESOS") dentro de la hoja.
 *
 * Es lo que permite saber si un importe positivo es un gasto escrito sin signo
 * o un ingreso de verdad.
 */
function detectBlocks(sheet: SheetData): Block[] {
  const blocks: Block[] = [];

  sheet.rows.forEach((row, index) => {
    const text = row
      .map((cell) => (typeof cell === "string" ? cell.toLowerCase().trim() : ""))
      .filter(Boolean);

    for (const value of text) {
      // Solo encabezados: una celda corta cuyo texto ES la palabra, no una
      // descripción que la contenga ("pago de gastos de viaje" no es un bloque).
      if (value.length > 20) continue;
      if (EXPENSE_HEADINGS.includes(value)) {
        blocks.push({ fromRow: index + 1, kind: "expense" });
        return;
      }
      if (INCOME_HEADINGS.includes(value)) {
        blocks.push({ fromRow: index + 1, kind: "income" });
        return;
      }
    }
  });

  return blocks;
}

function blockFor(blocks: Block[], rowNumber: number): Block["kind"] | null {
  let current: Block["kind"] | null = null;
  for (const block of blocks) {
    if (block.fromRow <= rowNumber) current = block.kind;
    else break;
  }
  return current;
}

/**
 * Lleva el importe al criterio del motor: negativo = salida de dinero.
 *
 * Si la línea está en un bloque de gastos y viene en positivo, se invierte. Si
 * ya viene con signo, se respeta: quien lo escribió sabía lo que hacía.
 */
function normalizeSign(amountCents: number, block: Block["kind"] | null): number {
  if (block === "expense" && amountCents > 0) return -amountCents;
  if (block === "income" && amountCents < 0) return amountCents; // se respeta
  return amountCents;
}
