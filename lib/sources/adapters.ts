/**
 * Adaptadores: de archivos inspeccionados a entrada del motor financiero.
 *
 * Esta capa es deliberadamente fina y sustituible. Cuando conozcamos la
 * estructura real de cada documento, los ajustes se harán aquí y en los
 * sinónimos de `table.ts`, sin tocar las reglas financieras.
 */

import { periodLabel } from "../finance/period";
import { normalizeText } from "../finance/text";
import type {
  BankMovement,
  CashMovement,
  ClinicSale,
  Invoice,
  Period,
  PeriodInput,
  SourceKind,
  SourceRef,
} from "../finance/types";
import type { FileInspection, InspectionResult, SheetInspection } from "../inspect/inspect";
import type { ParsedRow } from "./table";

export interface AdaptationResult {
  input: PeriodInput;
  /** Documentos que no se han podido convertir en datos (PDF, sin importe...). */
  pendingDocuments: Array<{ file: string; reason: string }>;
  /** Problemas encontrados al convertir filas. Alimentan SOURCE_ERROR. */
  problems: Array<{ file: string; sheet: string; row: number; problems: string[] }>;
}

export function buildPeriodInput(inspection: InspectionResult): AdaptationResult {
  const period = inspection.period;
  const bankMovements: BankMovement[] = [];
  const cashMovements: CashMovement[] = [];
  const clinicBankSales: ClinicSale[] = [];
  const clinicCashSales: ClinicSale[] = [];
  const invoices: Invoice[] = [];
  const incomeDocuments: Invoice[] = [];
  const pendingDocuments: AdaptationResult["pendingDocuments"] = [];
  const problems: AdaptationResult["problems"] = [];

  for (const file of inspection.files) {
    if (!file.readable) {
      pendingDocuments.push({ file: file.file.relativePath, reason: file.error ?? "no legible" });
      continue;
    }

    if (!file.file.tabular) {
      // Un PDF de factura sin importe legible no puede conciliarse por importe.
      // Se registra como documento pendiente en lugar de inventar cifras.
      pendingDocuments.push({
        file: file.file.relativePath,
        reason:
          "documento no tabular: se registra como justificante, pero sin importe extraído no puede conciliarse automáticamente",
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
        // Un índice de facturas se identifica por proveedor, no por concepto:
        // exigirle una columna "Concepto" descartaría todas sus filas.
        const isDocumentIndex =
          file.file.kind === "expense_invoice" || file.file.kind === "income_document";
        const label = isDocumentIndex ? (row.supplier ?? row.concept) : row.concept;
        if (row.date === null || row.amountCents === null || !label) continue;

        const source: SourceRef = {
          kind: file.file.kind === "unknown" ? "manual" : (file.file.kind as SourceKind),
          file: file.file.relativePath,
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
              source,
            });
            break;
          case "cash_account":
            cashMovements.push({
              date: row.date,
              concept: label,
              amountCents: row.amountCents,
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
          case "expense_invoice":
            invoices.push(toInvoice(row, source, file.file.relativePath));
            break;
          case "income_document":
            incomeDocuments.push(toInvoice(row, source, file.file.relativePath));
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
      bankMovements,
      cashMovements,
      clinicBankSales,
      clinicCashSales,
      invoices,
      incomeDocuments,
    },
    pendingDocuments,
    problems,
  };
}

function toInvoice(row: ParsedRow, source: SourceRef, fileName: string): Invoice {
  return {
    id: `${fileName}#${source.sheet ?? ""}#${row.rowNumber}`,
    supplier: row.supplier ?? row.concept ?? "(sin proveedor)",
    invoiceNumber: row.invoiceNumber,
    date: row.date ?? "",
    amountCents: Math.abs(row.amountCents ?? 0),
    document: {
      name: row.invoiceNumber ? `${row.supplier ?? "factura"} ${row.invoiceNumber}` : fileName,
      driveFileId: null,
      url: null,
      localPath: fileName,
      supplier: row.supplier,
      invoiceNumber: row.invoiceNumber,
      date: row.date,
      amountCents: row.amountCents,
    },
    source,
  };
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
  const usable = file.sheets.filter((s) => s.columnMap.headerRowIndex >= 0 && s.columnMap.confidence > 0);
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
