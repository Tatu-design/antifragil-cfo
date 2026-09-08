#!/usr/bin/env node
/**
 * CLI del motor financiero de Antifrágil CFO.
 *
 *   npm run cfo -- inspect 2026-09    Lee las fuentes y explica cómo las entiende.
 *   npm run cfo -- analyze 2026-09    Construye el ledger, concilia y genera informes.
 *   npm run cfo -- compare 2026-08    Compara el mes reconstruido con el cierre manual.
 *   npm run cfo -- demo               Ejecuta el motor sobre datos sintéticos.
 *
 * NINGÚN comando modifica los documentos originales del negocio. La escritura en
 * Supabase y la aprobación del mes llegarán como paso explícito y separado.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareWithManualClose, renderComparisonReport, type ManualLine } from "../lib/finance/compare";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { formatCents } from "../lib/finance/money";
import { isValidPeriod, periodLabel } from "../lib/finance/period";
import { buildPeriodView, renderPeriodMarkdown } from "../lib/finance/period-view";
import { QUEUE_LABELS } from "../lib/finance/review-queue";
import { inspectPeriod, renderInspectionReport, type InspectionResult } from "../lib/inspect/inspect";
import { renderReconciliationReport, renderRunSummary } from "../lib/inspect/reports";
import { INPUT_FOLDERS, inputsRoot, outputsRoot } from "../lib/paths";
import { buildPeriodInput } from "../lib/sources/adapters";

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "inspect":
      return runInspect(args[0]);
    case "analyze":
      return runAnalyze(args[0]);
    case "compare":
      return runCompare(args[0]);
    case "demo":
      return runDemo();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`Comando desconocido: "${command}"\n`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`Antifrágil CFO — motor de conciliación

Uso:
  npm run cfo -- inspect <YYYY-MM>   Inspecciona las fuentes del mes y genera el informe.
  npm run cfo -- analyze <YYYY-MM>   Construye el ledger, concilia y genera los informes.
  npm run cfo -- compare <YYYY-MM>   Compara el mes reconstruido con el cierre manual.
  npm run cfo -- demo                Ejecuta el motor sobre datos sintéticos de ejemplo.

Entradas:   local-data/inputs/<YYYY-MM>/{${INPUT_FOLDERS.join(",")}}
Salidas:    local-data/outputs/<YYYY-MM>/

Ningún comando escribe sobre los documentos originales.`);
}

function requirePeriod(period: string | undefined): string {
  if (!period || !isValidPeriod(period)) {
    throw new Error("Falta el periodo o es inválido. Formato esperado: YYYY-MM (por ejemplo 2026-09).");
  }
  return period;
}

async function runInspect(periodArg: string | undefined): Promise<number> {
  const period = requirePeriod(periodArg);
  const root = inputsRoot(period);
  console.log(`\n🔍 Inspeccionando ${periodLabel(period)}`);
  console.log(`   Entradas: ${root}\n`);

  await ensureInputFolders(period);
  const result = await inspectPeriod(root, period);
  const outDir = await ensureOutputDir(period);

  await writeFile(path.join(outDir, "inspection_report.md"), renderInspectionReport(result), "utf8");
  await writeFile(
    path.join(outDir, "inspection.json"),
    JSON.stringify(stripRows(result), null, 2),
    "utf8",
  );

  console.log(`   Archivos encontrados: ${result.discovery.files.length}`);
  console.log(`   Avisos: ${result.warnings.length}`);
  for (const warning of result.warnings.slice(0, 10)) console.log(`     ⚠️  ${warning}`);
  if (result.warnings.length > 10) console.log(`     … y ${result.warnings.length - 10} más.`);
  console.log(`\n📄 Informe: ${path.join(outDir, "inspection_report.md")}\n`);
  return 0;
}

async function runAnalyze(periodArg: string | undefined): Promise<number> {
  const period = requirePeriod(periodArg);
  const root = inputsRoot(period);
  console.log(`\n⚙️  Analizando ${periodLabel(period)}`);
  console.log(`   Entradas: ${root}\n`);

  const inspection = await inspectPeriod(root, period);
  const adaptation = buildPeriodInput(inspection);
  const ledger = buildPeriodLedger(adaptation.input);
  const view = buildPeriodView(ledger);

  const outDir = await ensureOutputDir(period);
  await writeFile(path.join(outDir, "inspection_report.md"), renderInspectionReport(inspection), "utf8");
  await writeFile(
    path.join(outDir, "reconciliation_report.md"),
    renderReconciliationReport(ledger, adaptation),
    "utf8",
  );
  await writeFile(path.join(outDir, "incidents.json"), JSON.stringify(ledger.incidents, null, 2), "utf8");
  await writeFile(path.join(outDir, "review_queue.json"), JSON.stringify(view.queue, null, 2), "utf8");
  await writeFile(path.join(outDir, "run_summary.md"), renderRunSummary(ledger, view), "utf8");
  // La interfaz operativa lee este archivo mientras Supabase no esté conectado.
  await writeFile(path.join(outDir, "ledger.json"), JSON.stringify(ledger, null, 2), "utf8");

  const m = view.metrics;
  console.log(`   Movimientos: ${ledger.summary.entryCount}`);
  for (const account of m.byAccount) {
    if (account.movementCount === 0) continue;
    console.log(
      `     · ${account.label}: ${account.movementCount} mov · neto ${formatCents(account.netCents)}`,
    );
  }
  console.log(`   Ingresos: ${formatCents(m.incomeCents)}`);
  console.log(`   Gastos: ${formatCents(m.expenseCents)}`);
  console.log(`   Flujo neto: ${formatCents(m.netCashFlowCents)}`);
  console.log(`   Conciliado: ${m.reconciledPct}%`);
  console.log(`   Pendiente de justificar: ${formatCents(m.unjustifiedAmountCents)}`);
  console.log(`   Cola de revisión: ${view.queue.items.length}`);
  for (const [reason, count] of Object.entries(view.queue.counts)) {
    if (count === 0) continue;
    console.log(`     · ${QUEUE_LABELS[reason as keyof typeof QUEUE_LABELS]}: ${count}`);
  }
  console.log(`\n📄 Informes en: ${outDir}\n`);

  return ledger.incidents.some((i) => i.severity === "error") ? 2 : 0;
}

/**
 * Compara el mes reconstruido con el cierre manual previo.
 *
 * El cierre manual se lee de local-data/inputs/<periodo>/manual_close/ y NO se
 * presume correcto: el informe solo aísla las diferencias.
 */
async function runCompare(periodArg: string | undefined): Promise<number> {
  const period = requirePeriod(periodArg);
  const root = inputsRoot(period);
  console.log(`\n⚖️  Comparando ${periodLabel(period)} contra el cierre manual\n`);

  const inspection = await inspectPeriod(root, period);
  const adaptation = buildPeriodInput(inspection);
  const ledger = buildPeriodLedger(adaptation.input);

  const manualLines = extractManualLines(inspection);
  if (manualLines.length === 0) {
    console.log(
      "   No se han encontrado líneas del cierre manual.\n" +
        `   Deja el Cash Flow del mes en: ${path.join(root, "manual_close")}\n`,
    );
    return 1;
  }

  const comparison = compareWithManualClose(ledger, manualLines);
  const outDir = await ensureOutputDir(period);
  await writeFile(
    path.join(outDir, "comparison_report.md"),
    renderComparisonReport(comparison),
    "utf8",
  );
  await writeFile(path.join(outDir, "comparison.json"), JSON.stringify(comparison, null, 2), "utf8");

  console.log(`   Líneas del cierre manual: ${manualLines.length}`);
  console.log(`   Emparejadas sin diferencia: ${comparison.matchedCount}`);
  console.log(`   Diferencias a investigar: ${comparison.differences.length}`);
  console.log(
    `   Delta ingresos: ${formatCents(comparison.totals.incomeDeltaCents)} · delta gastos: ${formatCents(
      comparison.totals.expenseDeltaCents,
    )}`,
  );
  console.log("\n   Ninguna versión se presume correcta: cada diferencia queda como 'pending'.");
  console.log(`\n📄 Informe: ${path.join(outDir, "comparison_report.md")}\n`);
  return 0;
}

/** Extrae las líneas del cierre manual de los archivos de manual_close/. */
function extractManualLines(inspection: InspectionResult): ManualLine[] {
  const lines: ManualLine[] = [];
  for (const file of inspection.files) {
    if (!file.file.relativePath.startsWith("manual_close/")) continue;
    for (const sheet of file.sheets) {
      for (const row of sheet.rows) {
        if (row.date === null || row.amountCents === null || !row.concept) continue;
        lines.push({
          date: row.date,
          description: row.concept,
          amountCents: row.amountCents,
          category: row.category,
          pnl: row.pnl,
          sourceRow: row.rowNumber,
        });
      }
    }
  }
  return lines;
}

async function runDemo(): Promise<number> {
  const { syntheticPeriod } = await import("../tests/fixtures/synthetic-period");
  const ledger = buildPeriodLedger(syntheticPeriod());
  const view = buildPeriodView(ledger);

  console.log("\n🧪 Motor ejecutado sobre datos sintéticos (ninguna cifra real)\n");
  console.log(renderPeriodMarkdown(view));
  console.log("\nIncidencias:");
  for (const incident of ledger.incidents) {
    console.log(`  [${incident.severity}] ${incident.type} — ${incident.message}`);
  }
  console.log("");
  return 0;
}

/**
 * Crea la estructura de entrada del periodo si no existe.
 * `local-data/` no se versiona, así que las carpetas tienen que nacer aquí.
 */
async function ensureInputFolders(period: string): Promise<void> {
  const root = inputsRoot(period);
  for (const folder of INPUT_FOLDERS) {
    await mkdir(path.join(root, folder), { recursive: true });
  }
}

async function ensureOutputDir(period: string): Promise<string> {
  const dir = outputsRoot(period);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** El JSON de inspección no lleva todas las filas: sería enorme y redundante. */
function stripRows(result: InspectionResult): unknown {
  return {
    ...result,
    files: result.files.map((file) => ({
      ...file,
      sheets: file.sheets.map((sheet) => ({ ...sheet, rows: undefined })),
    })),
  };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
