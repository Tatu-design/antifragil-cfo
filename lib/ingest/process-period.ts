import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPeriodLedger } from "../finance/ledger";
import { reprocessPending } from "../finance/reprocess";
import type { PeriodLedger } from "../finance/types";
import { outputsRoot } from "../paths";
import { loadPeriodLedger } from "../period-store";
import { buildPeriodInputFromUploads, MOVEMENT_KINDS } from "./build-period";
import { loadPeriodDocuments, type PeriodDocuments } from "./registry";
import { createDocumentStorage } from "./storage";

/**
 * Procesa un periodo a partir de lo que el usuario ha subido.
 *
 * Dos modos, y el sistema elige solo:
 *
 *   - **completo**: no hay ledger previo, o han cambiado las fuentes de
 *     movimientos (un extracto nuevo). Se construye el mes entero.
 *   - **incremental**: ya hay ledger y lo que ha llegado son documentos
 *     justificativos. Se intenta resolver ÚNICAMENTE las incidencias abiertas,
 *     sin tocar lo ya conciliado ni lo revisado por una persona.
 *
 * El usuario no elige el modo ni sabe que existe: arrastra y pulsa procesar.
 */

export interface ProcessResult {
  period: string;
  mode: "full" | "incremental";
  ledger: PeriodLedger;
  /** Movimientos resueltos en esta pasada (solo en incremental). */
  resolvedCount: number;
  /** Fuentes que no se han podido incorporar. */
  skipped: Array<{ file: string; reason: string }>;
  problemCount: number;
}

export async function processPeriod(period: string): Promise<ProcessResult> {
  const storage = createDocumentStorage();
  const registry = await loadPeriodDocuments(period);
  const built = await buildPeriodInputFromUploads(registry, storage);

  const previous = await loadPeriodLedger(period);
  const currentSources = movementSourceHashes(registry);
  const previousSources = await loadProcessedSources(period);
  const movementSourcesChanged = !sameSources(previousSources, currentSources);

  if (previous && !movementSourcesChanged) {
    // Solo han llegado justificantes: se reprocesa lo pendiente y nada más.
    const result = reprocessPending(previous, built.input.documents);
    await persist(period, result.ledger, currentSources);
    return {
      period,
      mode: "incremental",
      ledger: result.ledger,
      resolvedCount: result.resolvedEntryIds.length,
      skipped: built.skipped,
      problemCount: built.problems.length,
    };
  }

  const ledger = buildPeriodLedger(built.input);
  await persist(period, ledger, currentSources);
  return {
    period,
    mode: "full",
    ledger,
    resolvedCount: 0,
    skipped: built.skipped,
    problemCount: built.problems.length,
  };
}

/**
 * Fuentes de movimientos usadas en un procesado.
 *
 * Se identifican por su huella de contenido, no por su nombre: renombrar un
 * extracto no lo convierte en un extracto distinto.
 */
function movementSourceHashes(registry: PeriodDocuments): string[] {
  return registry.documents
    .filter((d) => MOVEMENT_KINDS.has(d.kind))
    .map((d) => d.hash)
    .sort();
}

function sameSources(previous: string[] | null, current: string[]): boolean {
  if (previous === null) return false;
  if (previous.length !== current.length) return false;
  return previous.every((hash, index) => hash === current[index]);
}

async function loadProcessedSources(period: string): Promise<string[] | null> {
  try {
    const content = await readFile(path.join(outputsRoot(period), 'sources.json'), 'utf8');
    const parsed = JSON.parse(content) as { sourceHashes?: string[] };
    return parsed.sourceHashes ?? null;
  } catch {
    return null;
  }
}

/**
 * Guarda el resultado del periodo.
 *
 * Hoy escribe el ledger en la zona local, que es lo que lee la interfaz. Cuando
 * Supabase esté conectado, aquí irá el upsert idempotente sobre los ids
 * deterministas, y la interfaz leerá de la base de datos sin cambiar.
 */
async function persist(period: string, ledger: PeriodLedger, sourceHashes: string[]): Promise<void> {
  const dir = outputsRoot(period);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "ledger.json"), JSON.stringify(ledger, null, 2), "utf8");
  // Qué fuentes de movimientos produjeron este ledger: decide si la próxima
  // pasada puede ser incremental o hay que reconstruir el mes.
  await writeFile(
    path.join(dir, "sources.json"),
    JSON.stringify({ sourceHashes }, null, 2),
    "utf8",
  );
}
