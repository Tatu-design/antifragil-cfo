import "server-only";
import { DEFAULT_ACCOUNTS } from "../finance/accounts";
import type {
  BankMovement,
  CashMovement,
  ClinicSale,
  PeriodInput,
  SourceRef,
  SupportingDocument,
} from "../finance/types";
import { detectTable, parseRows, type ParsedRow } from "../sources/table";
import { readWorkbookFromBytes, type SheetData } from "../sources/workbook";
import { issuerFromFileName, toSupportingDocuments, type PeriodDocuments, type RegisteredDocument } from "./registry";
import type { DocumentStorage } from "./storage";
import { sheetMatchesPeriod } from "../sources/adapters";

/**
 * Construye la entrada del motor a partir de los documentos subidos.
 *
 * Es el puente entre la carga por interfaz y el motor financiero: coge lo que el
 * usuario arrastró, separa fuentes de movimientos (extractos, cuenta de cash,
 * ventas de clínica) de documentos justificativos, y lee las tablas.
 *
 * El motor no cambia: recibe exactamente la misma forma de datos que cuando las
 * fuentes venían de carpetas locales.
 */

export interface BuildFromUploadsResult {
  input: PeriodInput;
  /** Problemas de lectura, para el informe y la interfaz. */
  problems: Array<{ file: string; sheet: string; row: number; problems: string[] }>;
  /** Documentos que no se han podido leer o interpretar. */
  skipped: Array<{ file: string; reason: string }>;
}

/** Tipos de documento que son fuentes de movimientos, no justificantes. */
export const MOVEMENT_KINDS = new Set([
  "bank_statement",
  "cash_account",
  "clinic_bank_sales",
  "clinic_cash_sales",
]);

export async function buildPeriodInputFromUploads(
  registry: PeriodDocuments,
  storage: DocumentStorage,
): Promise<BuildFromUploadsResult> {
  const period = registry.period;
  const bankMovements: BankMovement[] = [];
  const cashMovements: CashMovement[] = [];
  const clinicBankSales: ClinicSale[] = [];
  const clinicCashSales: ClinicSale[] = [];
  const problems: BuildFromUploadsResult["problems"] = [];
  const skipped: BuildFromUploadsResult["skipped"] = [];

  for (const document of registry.documents) {
    if (!MOVEMENT_KINDS.has(document.kind)) continue;

    // Un extracto sin cuenta asignada no entra: metería movimientos en la
    // tesorería equivocada, que es peor que no incorporarlos todavía.
    if (document.kind === "bank_statement" && !document.accountId) {
      skipped.push({
        file: document.fileName,
        reason: "extracto sin cuenta asignada; indícala en los documentos pendientes de revisión",
      });
      continue;
    }

    let sheets: SheetData[];
    try {
      const bytes = await storage.read(document.storagePath);
      if (!bytes) {
        skipped.push({ file: document.fileName, reason: "no se ha encontrado en el almacén" });
        continue;
      }
      sheets = (await readWorkbookFromBytes(bytes, document.fileName)).sheets;
    } catch (error) {
      skipped.push({
        file: document.fileName,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const sheet of selectSheets(sheets, period)) {
      const map = detectTable(sheet);
      if (map.headerRowIndex < 0 || map.confidence === 0) {
        skipped.push({
          file: document.fileName,
          reason: `no se ha reconocido la cabecera de la hoja "${sheet.name}"`,
        });
        continue;
      }

      for (const row of parseRows(sheet, map)) {
        if (row.problems.length > 0) {
          problems.push({
            file: document.fileName,
            sheet: sheet.name,
            row: row.rowNumber,
            problems: row.problems,
          });
        }
        if (row.date === null || row.amountCents === null || !row.concept) continue;

        const source: SourceRef = {
          kind: document.kind as SourceRef["kind"],
          file: document.fileName,
          accountId: document.accountId,
          sheet: sheet.name,
          row: row.rowNumber,
          raw: row.raw,
        };

        pushRow(document, row, source, {
          bankMovements,
          cashMovements,
          clinicBankSales,
          clinicCashSales,
        });
      }
    }
  }

  return {
    input: {
      period,
      accounts: DEFAULT_ACCOUNTS,
      bankMovements,
      cashMovements,
      clinicBankSales,
      clinicCashSales,
      documents: supportingDocuments(registry),
    },
    problems,
    skipped,
  };
}

function pushRow(
  document: RegisteredDocument,
  row: ParsedRow,
  source: SourceRef,
  buckets: {
    bankMovements: BankMovement[];
    cashMovements: CashMovement[];
    clinicBankSales: ClinicSale[];
    clinicCashSales: ClinicSale[];
  },
): void {
  const date = row.date as string;
  const amountCents = row.amountCents as number;
  const concept = row.concept as string;

  switch (document.kind) {
    case "bank_statement":
      buckets.bankMovements.push({
        date,
        valueDate: row.valueDate,
        concept,
        observations: row.observations,
        amountCents,
        accountId: document.accountId as string,
        source,
      });
      break;
    case "cash_account":
      buckets.cashMovements.push({
        date,
        concept,
        amountCents,
        accountId: document.accountId ?? "cash",
        category: row.category,
        pnl: row.pnl,
        source,
      });
      break;
    case "clinic_bank_sales":
      buckets.clinicBankSales.push({ date, concept, amountCents: Math.abs(amountCents), source });
      break;
    case "clinic_cash_sales":
      buckets.clinicCashSales.push({ date, concept, amountCents: Math.abs(amountCents), source });
      break;
  }
}

/**
 * Documentos justificativos, con su enlace de visualización.
 *
 * La URL apunta a la ruta de la aplicación, no al almacén: el bucket es privado
 * y el acceso pasa siempre por el servidor.
 */
function supportingDocuments(registry: PeriodDocuments): SupportingDocument[] {
  return toSupportingDocuments(registry).map((document) => {
    const registered = registry.documents.find((d) => d.hash === document.id);
    if (!registered) return document;
    return {
      ...document,
      issuer: issuerFromFileName(registered.fileName),
      document: {
        ...document.document,
        url: `/api/documentos/${registered.storagePath}`,
        localPath: registered.storagePath,
      },
    };
  });
}

/** Si el libro tiene pestañas mensuales, se usa solo la del periodo. */
function selectSheets(sheets: SheetData[], period: string): SheetData[] {
  const matching = sheets.filter((sheet) => sheetMatchesPeriod(sheet.name, period));
  return matching.length > 0 ? matching : sheets;
}
