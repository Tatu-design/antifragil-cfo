/**
 * Orquestación de la conciliación documental de un periodo.
 *
 * Es el corazón de la misión actual: cruzar cada movimiento real de tesorería
 * con su documentación justificativa y dejar clasificadas las excepciones.
 *
 * Orden de intento, del más fiable al menos:
 *   1. ¿Requiere documento?           → si no, estado final `not_document_required`
 *   2. 1 movimiento ↔ 1 documento
 *   3. 1 movimiento ↔ N documentos    (un pago que liquida varias facturas)
 *   4. N movimientos ↔ 1 documento    (una nómina o impuesto en varios cargos)
 *
 * Un documento solo puede justificar un movimiento (o un grupo): así una misma
 * factura no respalda dos pagos distintos, que es una vía clásica de descuadre.
 */

import { stableHash } from "./dedupe";
import { documentRequirement } from "./document-requirements";
import {
  DEFAULT_MATCH_CONFIG,
  findAggregateMatch,
  findMultiDocumentMatch,
  matchEntryToDocuments,
  type Candidate,
  type MatchConfig,
} from "./matching";
import type { AttachedDocument, LedgerEntry, SupportingDocument } from "./types";

export interface ReconciliationResult {
  entries: LedgerEntry[];
  /** Documentos que no han podido asociarse a ningún movimiento. */
  unmatchedDocuments: SupportingDocument[];
  /** Movimientos con más de un candidato plausible. */
  ambiguous: Array<{ entry: LedgerEntry; candidates: Candidate[] }>;
}

export function reconcilePeriod(
  entries: LedgerEntry[],
  documents: SupportingDocument[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): ReconciliationResult {
  const byId = new Map(entries.map((entry) => [entry.id, { ...entry }]));
  const usedDocumentIds = new Set<string>();
  const ambiguous: ReconciliationResult["ambiguous"] = [];

  // ── 1 · Movimientos que no requieren documento ────────────────────────────
  const needDocument: LedgerEntry[] = [];
  for (const entry of byId.values()) {
    // Los apuntes que ya llegan conciliados (datáfono, ventas cash) no se tocan.
    if (entry.reconciliation === "reconciled" || entry.documents.length > 0) continue;

    const requirement = documentRequirement(entry.rawDescription, {
      isInternal: entry.direction === "internal",
    });

    if (!requirement.required) {
      entry.reconciliation = "not_document_required";
      entry.reconciliationReason = requirement.reason ?? null;
      continue;
    }
    needDocument.push(entry);
  }

  // ── 2 · 1 ↔ 1, empezando por los matches más nítidos ──────────────────────
  // Se ordena por confianza del mejor candidato para que un match claro no se
  // quede sin documento porque otro dudoso se lo llevó antes.
  const previewed = needDocument.map((entry) => {
    const outcome = matchEntryToDocuments(entry, documents, config);
    return { entry, score: outcome.status === "matched" ? outcome.candidate.score : 0 };
  });
  previewed.sort((a, b) => b.score - a.score);

  for (const { entry } of previewed) {
    const available = documents.filter((d) => !usedDocumentIds.has(d.id));
    const outcome = matchEntryToDocuments(entry, available, config);

    if (outcome.status === "matched") {
      usedDocumentIds.add(outcome.candidate.document.id);
      attach(entry, [toAttachment(outcome.candidate)]);
      continue;
    }

    if (outcome.status === "ambiguous") {
      ambiguous.push({ entry, candidates: outcome.candidates });
      entry.reconciliation = "ambiguous";
      entry.reviewStatus = "needs_review";
      entry.notes = [
        ...(entry.notes ?? []),
        `${outcome.candidates.length} documentos posibles con el mismo importe. Sin asociar automáticamente.`,
      ];
    }
  }

  // ── 3 · 1 movimiento ↔ N documentos ───────────────────────────────────────
  for (const entry of needDocument) {
    if (entry.documents.length > 0 || entry.reconciliation === "ambiguous") continue;

    const available = documents.filter((d) => !usedDocumentIds.has(d.id));
    const multi = findMultiDocumentMatch(entry, available, config);
    if (!multi) continue;

    const groupId = stableHash(["multi", entry.id]);
    for (const document of multi.documents) usedDocumentIds.add(document.id);
    attach(
      entry,
      multi.documents.map((document) => ({
        ref: document.document,
        method: "aggregate_sum" as const,
        score: multi.score,
        reasons: multi.reasons,
        groupId,
      })),
    );
  }

  // ── 4 · N movimientos ↔ 1 documento ───────────────────────────────────────
  const stillUnmatched = () =>
    needDocument.filter((e) => e.documents.length === 0 && e.reconciliation !== "ambiguous");

  for (const document of documents) {
    if (usedDocumentIds.has(document.id)) continue;

    const aggregate = findAggregateMatch(stillUnmatched(), document, config);
    if (!aggregate) continue;

    usedDocumentIds.add(document.id);
    const groupId = stableHash(["aggregate", document.id]);
    for (const entry of aggregate.entries) {
      attach(entry, [
        {
          ref: document.document,
          method: "aggregate_sum",
          score: aggregate.score,
          reasons: aggregate.reasons,
          groupId,
        },
      ]);
      entry.notes = [
        ...(entry.notes ?? []),
        `Justificado junto a otros ${aggregate.entries.length - 1} movimiento(s) por un mismo documento.`,
      ];
    }
  }

  // ── 5 · Lo que queda sin documento ────────────────────────────────────────
  for (const entry of needDocument) {
    if (entry.documents.length > 0) {
      entry.reconciliation = "reconciled";
      continue;
    }
    if (entry.reconciliation === "ambiguous") continue;
    entry.reconciliation = "missing_document";
    entry.reviewStatus = "needs_review";
  }

  return {
    entries: entries.map((entry) => byId.get(entry.id) ?? entry),
    unmatchedDocuments: documents.filter((d) => !usedDocumentIds.has(d.id)),
    ambiguous,
  };
}

function attach(entry: LedgerEntry, attachments: AttachedDocument[]): void {
  entry.documents = [...entry.documents, ...attachments];
  entry.reconciliation = "reconciled";
}

function toAttachment(candidate: Candidate): AttachedDocument {
  return {
    ref: candidate.document.document,
    method: candidate.method,
    score: candidate.score,
    reasons: candidate.reasons,
  };
}

/**
 * Documentos sin movimiento localizado.
 *
 * Un documento sin pago NO se convierte en movimiento: puede estar pendiente,
 * pagado en otro mes o por otra vía. Solo se reporta.
 */
export function documentsWithoutMovement(
  unmatched: SupportingDocument[],
): SupportingDocument[] {
  return unmatched;
}
