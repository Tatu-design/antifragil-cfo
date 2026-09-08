import "server-only";
import { isSupabaseConfigured } from "../auth/guard";
import type { PeriodLedger } from "../finance/types";
import type { IngestSummary } from "../ingest/ingest";
import type { PeriodDocuments } from "../ingest/registry";
import { createLocalDocumentRepository, createLocalLedgerRepository } from "./local";
import { createSupabaseDocumentRepository, createSupabaseLedgerRepository } from "./supabase";
import type { DocumentRepository, LedgerRepository } from "./types";

/**
 * Punto único donde se decide dónde vive el estado.
 *
 * Con Supabase configurado, TODO se persiste en PostgreSQL: es la fuente de
 * verdad y sobrevive a reinicios, redeploys y cambios de navegador. Sin
 * Supabase, se cae al disco local, que solo sirve para desarrollo y tests.
 *
 * Ningún otro módulo elige: todos piden el repositorio aquí.
 */

export function documentRepository(): DocumentRepository {
  return isSupabaseConfigured()
    ? createSupabaseDocumentRepository()
    : createLocalDocumentRepository();
}

export function ledgerRepository(): LedgerRepository {
  return isSupabaseConfigured() ? createSupabaseLedgerRepository() : createLocalLedgerRepository();
}

// ── Fachada de conveniencia ─────────────────────────────────────────────────
// Las rutas y páginas usan estas funciones y no se enteran del backend.

export function loadPeriodDocuments(period: string): Promise<PeriodDocuments> {
  return documentRepository().loadPeriodDocuments(period);
}

export function knownHashes(period: string): Promise<Set<string>> {
  return documentRepository().knownHashes(period);
}

export function registerIngest(
  summary: IngestSummary,
  uploadedBy: string | null,
): Promise<PeriodDocuments> {
  return documentRepository().registerIngest(summary, uploadedBy);
}

export function resolveDocument(
  period: string,
  hash: string,
  resolution: { kind?: string; accountId?: string | null; docType?: string },
): Promise<PeriodDocuments> {
  return documentRepository().resolveDocument(period, hash, resolution);
}

export function loadPeriodLedger(period: string): Promise<PeriodLedger | null> {
  return ledgerRepository().loadLedger(period);
}

export async function listAnalyzedPeriods(): Promise<string[]> {
  return ledgerRepository().listProcessedPeriods();
}

export async function listPeriodsWithDocuments(): Promise<string[]> {
  return documentRepository().listPeriodsWithDocuments();
}

export type { DocumentRepository, LedgerRepository };
