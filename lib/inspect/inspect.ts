/**
 * Fase INSPECT: mirar sin tocar.
 *
 * Antes de construir un mes hay que entender qué hay en las fuentes. Esta fase
 * NO escribe en ningún documento del negocio, no clasifica y no concilia:
 * abre cada archivo, dice cómo lo ha interpretado y avisa de lo que no entiende.
 *
 * Su salida es el punto de partida de la conversación con quien revisa el mes.
 */

import { formatCents, sumCents } from "../finance/money";
import { isValidPeriod, periodLabel } from "../finance/period";
import type { SourceKind } from "../finance/types";
import { discoverPeriodFiles, type DiscoveryResult, type SourceFile } from "../sources/discover";
import { detectTable, parseRows, type ColumnMap, type ParsedRow } from "../sources/table";
import { readWorkbook } from "../sources/workbook";

export interface SheetInspection {
  sheetName: string;
  rowCount: number;
  /** Cabecera detectada y columnas mapeadas. */
  columnMap: ColumnMap;
  dataRowCount: number;
  /** Filas con algún problema de interpretación. */
  problemRowCount: number;
  problems: string[];
  dateRange: { from: string; to: string } | null;
  totalCents: number | null;
  positiveTotalCents: number | null;
  negativeTotalCents: number | null;
  /** Todas las filas interpretadas de la hoja. */
  rows: ParsedRow[];
  /** Muestra de filas interpretadas, para verificación humana. */
  sample: ParsedRow[];
}

export interface FileInspection {
  file: SourceFile;
  readable: boolean;
  error?: string;
  sheets: SheetInspection[];
}

export interface InspectionResult {
  period: string;
  generatedAt: string;
  discovery: DiscoveryResult;
  files: FileInspection[];
  warnings: string[];
}

/** Ejecuta la inspección completa de un periodo. No modifica nada. */
export async function inspectPeriod(periodRoot: string, period: string): Promise<InspectionResult> {
  if (!isValidPeriod(period)) {
    throw new Error(`Periodo inválido: "${period}". Formato esperado YYYY-MM.`);
  }

  const discovery = await discoverPeriodFiles(periodRoot, period);
  const files: FileInspection[] = [];
  const warnings: string[] = [];

  for (const file of discovery.files) {
    if (!file.tabular) {
      // PDFs e imágenes: se registran como documentos, sin lectura de contenido.
      files.push({ file, readable: true, sheets: [] });
      continue;
    }
    try {
      const workbook = await readWorkbook(file.absolutePath);
      const sheets = workbook.sheets.map((sheet) => inspectSheet(sheet.name, sheet.rows.length, sheet));
      files.push({ file, readable: true, sheets });

      for (const sheet of sheets) {
        if (sheet.columnMap.confidence === 0 && sheet.rowCount > 1) {
          warnings.push(
            `No se ha reconocido la cabecera de "${file.relativePath}" (hoja "${sheet.sheetName}"). Requiere ampliar los sinónimos de columna.`,
          );
        }
        if (sheet.problemRowCount > 0) {
          warnings.push(
            `${sheet.problemRowCount} fila(s) con problemas en "${file.relativePath}" (hoja "${sheet.sheetName}").`,
          );
        }
      }
    } catch (error) {
      files.push({
        file,
        readable: false,
        error: error instanceof Error ? error.message : String(error),
        sheets: [],
      });
      warnings.push(`No se ha podido leer "${file.relativePath}": ${String(error)}`);
    }
  }

  for (const folder of discovery.missingFolders) {
    warnings.push(`Carpeta sin archivos: ${folder}/`);
  }
  for (const file of discovery.unclassified) {
    warnings.push(`Archivo sin tipo deducible: ${file.relativePath}`);
  }

  return {
    period,
    generatedAt: new Date().toISOString(),
    discovery,
    files,
    warnings,
  };
}

function inspectSheet(
  sheetName: string,
  rowCount: number,
  sheet: { name: string; rows: unknown[][] },
): SheetInspection {
  const typedSheet = sheet as Parameters<typeof detectTable>[0];
  const columnMap = detectTable(typedSheet);
  const rows = columnMap.headerRowIndex >= 0 ? parseRows(typedSheet, columnMap) : [];

  const problemRows = rows.filter((r) => r.problems.length > 0);
  const problems = [...new Set(problemRows.flatMap((r) => r.problems))];

  const dates = rows.map((r) => r.date).filter((d): d is string => d !== null).sort();
  const amounts = rows.map((r) => r.amountCents).filter((a): a is number => a !== null);

  return {
    sheetName,
    rowCount,
    columnMap,
    dataRowCount: rows.length,
    problemRowCount: problemRows.length,
    problems,
    rows,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    totalCents: amounts.length > 0 ? sumCents(amounts) : null,
    positiveTotalCents: amounts.length > 0 ? sumCents(amounts.filter((a) => a > 0)) : null,
    negativeTotalCents: amounts.length > 0 ? sumCents(amounts.filter((a) => a < 0)) : null,
    sample: rows.slice(0, 5),
  };
}

const KIND_LABELS: Record<SourceKind | "unknown", string> = {
  bank_statement: "Extracto bancario",
  cash_account: "Cuenta de cash",
  clinic_bank_sales: "Ventas clínica — banco/datáfono",
  clinic_cash_sales: "Ventas clínica — efectivo",
  expense_invoice: "Factura de gasto",
  income_document: "Documento de ingreso",
  manual: "Entrada manual",
  unknown: "Sin clasificar",
};

/** Informe de inspección en Markdown, legible por una persona. */
export function renderInspectionReport(result: InspectionResult): string {
  const out: string[] = [];
  out.push(`# Informe de inspección — ${periodLabel(result.period)}`, "");
  out.push(`- Periodo: \`${result.period}\``);
  out.push(`- Generado: ${result.generatedAt}`);
  out.push(`- Carpeta inspeccionada: \`${result.discovery.root}\``);
  out.push(`- Archivos encontrados: **${result.discovery.files.length}**`);
  out.push("");
  out.push("> Esta fase no modifica ningún documento. Solo lee e informa.");
  out.push("");

  if (result.warnings.length > 0) {
    out.push("## Avisos", "");
    for (const warning of result.warnings) out.push(`- ⚠️ ${warning}`);
    out.push("");
  }

  out.push("## Archivos por tipo", "");
  const byKind = new Map<string, SourceFile[]>();
  for (const file of result.discovery.files) {
    const list = byKind.get(file.kind) ?? [];
    list.push(file);
    byKind.set(file.kind, list);
  }
  if (byKind.size === 0) {
    out.push("_No se ha encontrado ningún archivo. Revisa la ruta de entrada._", "");
  }
  for (const [kind, list] of byKind) {
    out.push(`### ${KIND_LABELS[kind as SourceKind | "unknown"] ?? kind} (${list.length})`, "");
    for (const file of list) {
      out.push(`- \`${file.relativePath}\` — ${formatBytes(file.sizeBytes)} — detectado por ${file.kindReason}`);
    }
    out.push("");
  }

  out.push("## Interpretación de cada archivo tabular", "");
  const tabular = result.files.filter((f) => f.file.tabular);
  if (tabular.length === 0) {
    out.push("_No hay archivos tabulares (.xlsx / .csv) que interpretar._", "");
  }

  for (const inspection of tabular) {
    out.push(`### \`${inspection.file.relativePath}\``, "");
    if (!inspection.readable) {
      out.push(`❌ No legible: ${inspection.error}`, "");
      continue;
    }
    for (const sheet of inspection.sheets) {
      out.push(`**Hoja "${sheet.sheetName}"** — ${sheet.rowCount} filas en bruto`, "");
      if (sheet.columnMap.headerRowIndex < 0 || sheet.columnMap.confidence === 0) {
        out.push("- ❌ No se ha reconocido ninguna cabecera conocida en esta hoja.", "");
        continue;
      }
      out.push(
        `- Cabecera detectada en la fila ${sheet.columnMap.headerRowIndex + 1} (confianza ${sheet.columnMap.confidence.toFixed(2)})`,
      );
      const mapped = Object.entries(sheet.columnMap.byRole)
        .map(([role, index]) => `${role} → "${sheet.columnMap.headers[index as number]}"`)
        .join(", ");
      out.push(`- Columnas reconocidas: ${mapped || "ninguna"}`);
      if (sheet.columnMap.unmapped.length > 0) {
        out.push(`- Columnas sin mapear: ${sheet.columnMap.unmapped.map((h) => `"${h}"`).join(", ")}`);
      }
      out.push(`- Filas de datos interpretadas: ${sheet.dataRowCount}`);
      if (sheet.dateRange) out.push(`- Rango de fechas: ${sheet.dateRange.from} → ${sheet.dateRange.to}`);
      if (sheet.totalCents !== null) {
        out.push(
          `- Suma de importes: ${formatCents(sheet.totalCents)} (positivos ${formatCents(
            sheet.positiveTotalCents ?? 0,
          )} · negativos ${formatCents(sheet.negativeTotalCents ?? 0)})`,
        );
      }
      if (sheet.problemRowCount > 0) {
        out.push(`- ⚠️ Filas con problemas: ${sheet.problemRowCount} (${sheet.problems.join("; ")})`);
      }
      if (sheet.sample.length > 0) {
        out.push("", "Muestra de filas interpretadas:", "");
        out.push("| Fila | Fecha | Concepto | Importe |");
        out.push("|------|-------|----------|---------|");
        for (const row of sheet.sample) {
          out.push(
            `| ${row.rowNumber} | ${row.date ?? "—"} | ${(row.concept ?? "—").replace(/\|/g, "\\|").slice(0, 60)} | ${
              row.amountCents === null ? "—" : formatCents(row.amountCents)
            } |`,
          );
        }
      }
      out.push("");
    }
  }

  const documents = result.files.filter((f) => !f.file.tabular);
  if (documents.length > 0) {
    out.push("## Documentos no tabulares (PDF, imágenes)", "");
    out.push("_Registrados como documentos. Su contenido no se ha leído en esta fase._", "");
    for (const doc of documents) {
      out.push(`- \`${doc.file.relativePath}\` — ${formatBytes(doc.file.sizeBytes)}`);
    }
    out.push("");
  }

  out.push("## Siguiente paso", "");
  out.push(
    "Revisa que la interpretación de cada archivo es correcta (columnas, fechas y totales).",
    "Si algo no encaja, se ajustan los sinónimos de columna antes de construir el mes.",
    "Ninguna cifra se ha incorporado todavía a ningún ledger ni documento.",
  );

  return out.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
