import type { PeriodLedger } from "../finance/types";
import type { IngestSummary } from "../ingest/ingest";
import type { PeriodDocuments } from "../ingest/registry";

/**
 * Persistencia del estado del sistema.
 *
 * Dos implementaciones intercambiables:
 *
 *   - **Supabase** (producción): PostgreSQL con RLS. Es la fuente de verdad.
 *     Sobrevive a reinicios, redeploys y funciona desde cualquier navegador.
 *   - **Local** (desarrollo y tests): ficheros JSON en la zona de trabajo. NO
 *     sirve en producción: el disco de Vercel es efímero y no se comparte entre
 *     instancias.
 *
 * La aplicación elige según haya Supabase configurado, y el resto del código
 * no sabe cuál está activa.
 */

export interface DocumentRepository {
  readonly name: "supabase" | "local";
  /** Documentos registrados de un periodo. */
  loadPeriodDocuments(period: string): Promise<PeriodDocuments>;
  /** Huellas ya conocidas: base de la detección de duplicados entre cargas. */
  knownHashes(period: string): Promise<Set<string>>;
  /** Incorpora el resultado de una carga. Idempotente por (periodo, hash). */
  registerIngest(summary: IngestSummary, uploadedBy: string | null): Promise<PeriodDocuments>;
  /** Resuelve la duda pendiente sobre un documento (cuenta o tipo). */
  resolveDocument(
    period: string,
    hash: string,
    resolution: { kind?: string; accountId?: string | null; docType?: string },
  ): Promise<PeriodDocuments>;
  /** Periodos que tienen documentos subidos. */
  listPeriodsWithDocuments(): Promise<string[]>;
}

export interface LedgerRepository {
  readonly name: "supabase" | "local";
  /** Ledger completo de un periodo, o null si aún no se ha procesado. */
  loadLedger(period: string): Promise<PeriodLedger | null>;
  /**
   * Guarda el ledger completo del periodo.
   *
   * Idempotente: se hace upsert sobre los ids deterministas del motor, así que
   * reprocesar el mismo mes actualiza las mismas filas y nunca duplica.
   */
  saveLedger(period: string, ledger: PeriodLedger, sourceHashes: string[]): Promise<void>;
  /** Huellas de las fuentes de movimientos usadas en el último procesado. */
  loadProcessedSources(period: string): Promise<string[] | null>;
  /** Periodos ya procesados. */
  listProcessedPeriods(): Promise<string[]>;
}
