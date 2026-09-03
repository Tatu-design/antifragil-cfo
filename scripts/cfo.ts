#!/usr/bin/env node
/**
 * CLI del motor financiero de Antifrágil CFO.
 *
 *   npm run cfo -- inspect 2026-08    Lee las fuentes y explica cómo las entiende.
 *   npm run cfo -- analyze 2026-08    Construye el ledger, concilia y genera informes.
 *   npm run cfo -- demo               Ejecuta el motor sobre datos sintéticos.
 *
 * NINGÚN comando modifica los documentos originales del negocio. La escritura en
 * Supabase y la aprobación del mes llegarán como paso explícito y separado.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCashFlowView, renderCashFlowMarkdown } from "../lib/finance/cashflow";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { formatCents } from "../lib/finance/money";
import { isValidPeriod, periodLabel } from "../lib/finance/period";
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
  console.log(`Antifrágil CFO — motor financiero

Uso:
  npm run cfo -- inspect <YYYY-MM>   Inspecciona las fuentes del mes y genera el informe.
  npm run cfo -- analyze <YYYY-MM>   Construye el ledger, concilia y genera los informes.
  npm run cfo -- demo                Ejecuta el motor sobre datos sintéticos de ejemplo.

Entradas:   local-data/inputs/<YYYY-MM>/{${INPUT_FOLDERS.join(",")}}
Salidas:    local-data/outputs/<YYYY-MM>/

Ningún comando escribe sobre los documentos originales.`);
}

function requirePeriod(period: string | undefined): string {
  if (!period || !isValidPeriod(period)) {
    throw new Error(`Falta el periodo o es inválido. Formato esperado: YYYY-MM (por ejemplo 2026-08).`);
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

  const report = renderInspectionReport(result);
  await writeFile(path.join(outDir, "inspection_report.md"), report, "utf8");
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
  const view = buildCashFlowView(ledger);

  const outDir = await ensureOutputDir(period);
  await writeFile(
    path.join(outDir, "inspection_report.md"),
    renderInspectionReport(inspection),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "reconciliation_report.md"),
    renderReconciliationReport(ledger, adaptation),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "incidents.json"),
    JSON.stringify(ledger.incidents, null, 2),
    "utf8",
  );
  await writeFile(path.join(outDir, "run_summary.md"), renderRunSummary(ledger, view), "utf8");
  await writeFile(path.join(outDir, "ledger.json"), JSON.stringify(ledger.entries, null, 2), "utf8");

  console.log(`   Apuntes: ${ledger.summary.entryCount}`);
  console.log(`   Ingresos: ${formatCents(ledger.summary.incomeCents)}`);
  console.log(`   Gastos: ${formatCents(ledger.summary.expenseCents)}`);
  console.log(`   Resultado: ${formatCents(ledger.summary.netCents)}`);
  console.log(`   Pendientes de clasificar: ${ledger.summary.pendingClassificationCount}`);
  console.log(`   Incidencias: ${ledger.incidents.length}`);
  for (const [type, count] of Object.entries(ledger.summary.incidentCountByType)) {
    console.log(`     · ${type}: ${count}`);
  }
  console.log(`\n📄 Informes en: ${outDir}\n`);

  const blocking = ledger.incidents.filter((i) => i.severity === "error").length;
  return blocking > 0 ? 2 : 0;
}

async function runDemo(): Promise<number> {
  const { syntheticAugust } = await import("../tests/fixtures/synthetic-period");
  const ledger = buildPeriodLedger(syntheticAugust());
  const view = buildCashFlowView(ledger);

  console.log("\n🧪 Motor ejecutado sobre datos sintéticos (ninguna cifra real)\n");
  console.log(renderCashFlowMarkdown(view));
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
