import "server-only";
import { buildPeriodLedger } from "../finance/ledger";
import { reprocessPending } from "../finance/reprocess";
import type { PeriodLedger } from "../finance/types";
import { ledgerRepository, loadPeriodDocuments } from "../repositories";
import { buildPeriodInputFromUploads, MOVEMENT_KINDS } from "./build-period";
import type { PeriodDocuments } from "./registry";
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
  const repository = ledgerRepository();
  const registry = await loadPeriodDocuments(period);
  const built = await buildPeriodInputFromUploads(registry, storage);

  const previous = await repository.loadLedger(period);
  const currentSources = movementSourceHashes(registry);
  const previousSources = await repository.loadProcessedSources(period);
  const movementSourcesChanged = !sameSources(previousSources, currentSources);

  if (previous && !movementSourcesChanged) {
    // Solo han llegado justificantes: se reprocesa lo pendiente y nada más.
    const result = reprocessPending(previous, built.input.documents);
    await repository.saveLedger(period, result.ledger, currentSources);
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
  await repository.saveLedger(period, ledger, currentSources);
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
