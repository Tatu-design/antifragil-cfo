/**
 * Adaptadores: de archivos inspeccionados a entrada del motor financiero.
 *
 * Esta capa es deliberadamente fina y sustituible. Cuando conozcamos la
 * estructura real de cada documento, los ajustes se harán aquí y en los
 * sinónimos de `table.ts`, sin tocar las reglas financieras.
 */

import { DEFAULT_ACCOUNTS } from "../finance/accounts";
import { periodLabel } from "../finance/period";
import { normalizeText } from "../finance/text";
import type {
  BankMovement,
  CashMovement,
  ClinicSale,
  DocumentType,
  Period,
  PeriodInput,
  SourceKind,
  SourceRef,
  SupportingDocument,
  TreasuryAccount,
} from "../finance/types";
import type { FileInspection, InspectionResult, SheetInspection } from "../inspect/inspect";
import type { ParsedRow } from "./table";

export interface AdaptationResult {
  input: PeriodInput;
  /** Documentos que no se han podido convertir en datos estructurados. */
  pendingDocuments: Array<{ file: string; reason: string }>;
  /** Problemas encontrados al convertir filas. Alimentan SOURCE_ERROR. */
  problems: Array<{ file: string; sheet: string; row: number; problems: string[] }>;
}

export interface AdaptOptions {
  accounts?: TreasuryAccount[];
  /** Documentos ya indexados desde Drive, si los hay. */
  driveDocuments?: SupportingDocument[];
}

export function buildPeriodInput(
  inspection: InspectionResult,
  options: AdaptOptions = {},
): AdaptationResult {
  const period = inspection.period;
  const accounts = options.accounts ?? DEFAULT_ACCOUNTS;

  const bankMovements: BankMovement[] = [];
  const cashMovements: CashMovement[] = [];
  const clinicBankSales: ClinicSale[] = [];
  const clinicCashSales: ClinicSale[] = [];
  const documents: SupportingDocument[] = [...(options.driveDocuments ?? [])];
  const pendingDocuments: AdaptationResult["pendingDocuments"] = [];
  const problems: AdaptationResult["problems"] = [];

  for (const file of inspection.files) {
    if (!file.readable) {
      pendingDocuments.push({ file: file.file.relativePath, reason: file.error ?? "no legible" });
      continue;
    }

    // Documento no tabular (PDF, imagen): se registra como justificante local.
    // Sin importe extraído solo podrá conciliarse por referencia, así que se
    // deja constancia en lugar de inventarle cifras.
    if (!file.file.tabular) {
      documents.push(localDocument(file.file.relativePath, file.file.fileName));
      pendingDocuments.push({
        file: file.file.relativePath,
        reason:
          "documento no tabular: indexado como justificante, pero sin importe extraído solo puede conciliarse por referencia",
      });
      continue;
    }

    const sheets = selectSheets(file, period);
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        if (row.problems.length > 0) {
          problems.push({
            file: file.file.relativePath,
            sheet: sheet.sheetName,
            row: row.rowNumber,
            problems: row.problems,
          });
        }

        // Un índice de documentos se identifica por emisor, no por concepto:
        // exigirle una columna "Concepto" descartaría todas sus filas.
        const isDocumentIndex = file.file.kind === "supporting_document";
        const label = isDocumentIndex ? (row.supplier ?? row.concept) : row.concept;
        if (row.date === null || row.amountCents === null || !label) continue;

        const source: SourceRef = {
          kind: file.file.kind === "unknown" ? "manual" : (file.file.kind as SourceKind),
          file: file.file.relativePath,
          accountId: file.file.accountId,
          sheet: sheet.sheetName,
          row: row.rowNumber,
          raw: row.raw,
        };

        switch (file.file.kind) {
          case "bank_statement":
            bankMovements.push({
              date: row.date,
              valueDate: row.valueDate,
              concept: label,
              observations: row.observations,
              amountCents: row.amountCents,
              accountId: file.file.accountId ?? accounts[0]?.id ?? "sl_bank",
              source,
            });
            break;
          case "cash_account":
            cashMovements.push({
              date: row.date,
              concept: label,
              amountCents: row.amountCents,
              accountId: file.file.accountId ?? "cash",
              category: row.category,
              pnl: row.pnl,
              source,
            });
            break;
          case "clinic_bank_sales":
            clinicBankSales.push({
              date: row.date,
              concept: label,
              amountCents: Math.abs(row.amountCents),
              source,
            });
            break;
          case "clinic_cash_sales":
            clinicCashSales.push({
              date: row.date,
              concept: label,
              amountCents: Math.abs(row.amountCents),
              source,
            });
            break;
          case "supporting_document":
            documents.push(toSupportingDocument(row, source, file.file.relativePath));
            break;
          case "manual":
            // Cierre manual previo: es material de contraste, no una fuente de
            // movimientos. Lo consume el comando `compare`.
            break;
          default:
            pendingDocuments.push({
              file: file.file.relativePath,
              reason: "tipo de fuente sin determinar; no se ha incorporado",
            });
            break;
        }
      }
    }
  }

  return {
    input: {
      period,
      accounts,
      bankMovements,
      cashMovements,
      clinicBankSales,
      clinicCashSales,
      documents,
    },
    pendingDocuments,
    problems,
  };
}

function toSupportingDocument(
  row: ParsedRow,
  source: SourceRef,
  fileName: string,
): SupportingDocument {
  const docType = inferDocTypeFromText(`${row.supplier ?? ""} ${row.concept ?? ""} ${fileName}`);
  return {
    id: `${fileName}#${source.sheet ?? ""}#${row.rowNumber}`,
    docType,
    issuer: row.supplier ?? row.concept ?? "(sin emisor)",
    reference: row.invoiceNumber,
    date: row.date ?? "",
    amountCents: row.amountCents === null ? null : Math.abs(row.amountCents),
    document: {
      name: row.invoiceNumber ? `${row.supplier ?? "documento"} ${row.invoiceNumber}` : fileName,
      docType,
      driveFileId: null,
      url: null,
      localPath: fileName,
      issuer: row.supplier,
      reference: row.invoiceNumber,
      date: row.date,
      amountCents: row.amountCents,
    },
    source,
  };
}

/** Documento local no tabular (PDF, imagen): se indexa sin inventar importe. */
function localDocument(relativePath: string, fileName: string): SupportingDocument {
  const docType = inferDocTypeFromText(fileName);
  return {
    id: relativePath,
    docType,
    issuer: fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/^[GI][_\s-]+/i, ""),
    reference: null,
    date: "",
    amountCents: null,
    document: {
      name: fileName,
      docType,
      driveFileId: null,
      url: null,
      localPath: relativePath,
    },
    source: { kind: "supporting_document", file: relativePath },
  };
}

/** Tipo documental deducido del texto disponible. "other" si no hay señal. */
export function inferDocTypeFromText(text: string): DocumentType {
  const normalized = normalizeText(text);
  if (normalized.includes("nomina")) return "payroll";
  if (normalized.includes("seguridad social") || normalized.includes("rnt") || normalized.includes("rlc")) {
    return "social_security";
  }
  if (normalized.includes("modelo") || normalized.includes("impuesto") || normalized.includes("aeat")) {
    return "tax";
  }
  if (normalized.includes("ventas")) return "sales_sheet";
  if (normalized.includes("recibo")) return "receipt";
  if (normalized.includes("contrato")) return "contract";
  if (normalized.includes("factura") || normalized.includes("fra")) return "invoice";
  return "other";
}

/**
 * Elige qué hojas de un libro corresponden al periodo.
 *
 * La `Cuenta de cash Antifrágil` tiene una pestaña por mes ("AGOSTO 26"). Si
 * alguna hoja coincide con el periodo se usa solo esa: leer todas mezclaría
 * meses. Si ninguna coincide por nombre, se usan todas las hojas legibles y se
 * confía en el filtro por fecha del motor.
 */
function selectSheets(file: FileInspection, period: Period): SheetInspection[] {
  const usable = file.sheets.filter(
    (s) => s.columnMap.headerRowIndex >= 0 && s.columnMap.confidence > 0,
  );
  const matching = usable.filter((s) => sheetMatchesPeriod(s.sheetName, period));
  return matching.length > 0 ? matching : usable;
}

/** True si el nombre de la hoja se refiere al periodo (p. ej. "AGOSTO 26" ↔ 2026-08). */
export function sheetMatchesPeriod(sheetName: string, period: Period): boolean {
  const normalized = normalizeText(sheetName);
  if (normalized === "") return false;

  const [year, month] = period.split("-");
  const label = normalizeText(periodLabel(period)); // "agosto 2026"
  const monthName = label.split(" ")[0];
  const shortYear = year.slice(2);

  if (normalized === label) return true;
  if (normalized.includes(monthName) && (normalized.includes(year) || normalized.includes(shortYear))) {
    return true;
  }
  if (normalized === `${year} ${month}` || normalized === `${year}${month}` || normalized === period) {
    return true;
  }
  return false;
}
