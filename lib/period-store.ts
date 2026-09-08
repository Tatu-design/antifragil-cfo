import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PeriodLedger } from "./finance/types";
import { dataRoot, outputsRoot } from "./paths";

/**
 * Lectura de los periodos ya analizados.
 *
 * Fuente provisional: los `ledger.json` que escribe `npm run cfo -- analyze`.
 * Cuando Supabase esté conectado, esta capa pasará a consultarlo y la interfaz
 * no cambiará: solo cambia de dónde vienen los mismos datos.
 *
 * Es server-only porque lee del disco local, donde viven los datos reales.
 */

export async function listAnalyzedPeriods(): Promise<string[]> {
  return listPeriodFolders("outputs");
}

/** Periodos que tienen documentos subidos, aunque todavía no se hayan procesado. */
export async function listPeriodsWithDocuments(): Promise<string[]> {
  return listPeriodFolders("documents");
}

async function listPeriodFolders(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(dataRoot(), folder), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function loadPeriodLedger(period: string): Promise<PeriodLedger | null> {
  try {
    const content = await readFile(path.join(outputsRoot(period), "ledger.json"), "utf8");
    return JSON.parse(content) as PeriodLedger;
  } catch {
    return null;
  }
}
