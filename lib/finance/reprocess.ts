/**
 * Reprocesado incremental de un periodo.
 *
 * Caso real: septiembre tiene 5 movimientos sin justificar; mañana aparecen 3
 * facturas. Se arrastran sobre septiembre y el sistema intenta resolver
 * únicamente esas incidencias.
 *
 * NO se reconstruye el periodo entero:
 *   - los movimientos ya conciliados no se tocan,
 *   - los revisados o aprobados por una persona no se tocan,
 *   - los movimientos que no requieren documento no se tocan,
 *   - los documentos ya usados siguen usados.
 *
 * Solo se reevalúa lo que está `missing_document` o `ambiguous`, que es
 * exactamente lo que un documento nuevo puede resolver.
 */

import { countByType, createIncident, dedupeIncidents } from "./incidents";
import { formatCents } from "./money";
import { reconcilePeriod } from "./reconciliation";
import { DEFAULT_MATCH_CONFIG, type MatchConfig } from "./matching";
import type { Incident, LedgerEntry, PeriodLedger, SupportingDocument } from "./types";

export interface ReprocessResult {
  ledger: PeriodLedger;
  /** Movimientos que han pasado a estar justificados en esta pasada. */
  resolvedEntryIds: string[];
  /** Movimientos que siguen sin documento. */
  stillUnresolvedEntryIds: string[];
  /** Documentos nuevos que no han encajado con nada. */
  unusedDocumentIds: string[];
  /** Cuántos movimientos se han dejado intactos. Prueba de que fue incremental. */
  untouchedCount: number;
}

export function reprocessPending(
  ledger: PeriodLedger,
  allDocuments: SupportingDocument[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): ReprocessResult {
  const isOpen = (entry: LedgerEntry) =>
    (entry.reconciliation === "missing_document" || entry.reconciliation === "ambiguous") &&
    entry.reviewStatus !== "reviewed" &&
    entry.reviewStatus !== "approved";

  const open = ledger.entries.filter(isOpen);
  const untouched = ledger.entries.filter((e) => !isOpen(e));

  if (open.length === 0) {
    return {
      ledger,
      resolvedEntryIds: [],
      stillUnresolvedEntryIds: [],
      unusedDocumentIds: allDocuments.map((d) => d.id),
      untouchedCount: ledger.entries.length,
    };
  }

  // Los documentos ya asociados a un movimiento intocado no vuelven al bombo:
  // un documento justifica una cosa, no dos.
  const usedNames = new Set(
    untouched.flatMap((entry) => entry.documents.map((d) => d.ref.name)),
  );
  const available = allDocuments.filter((d) => !usedNames.has(d.document.name));

  // Se reevalúan SOLO los movimientos abiertos. Se limpia su estado previo para
  // que la conciliación parta de cero en ellos, y solo en ellos.
  const reset = open.map((entry) => ({
    ...entry,
    reconciliation: "pending" as const,
    documents: [],
  }));

  const reconciled = reconcilePeriod(reset, available, config);
  const byId = new Map(reconciled.entries.map((e) => [e.id, e]));

  const entries = ledger.entries.map((entry) => byId.get(entry.id) ?? entry);
  const resolvedEntryIds = reconciled.entries
    .filter((e) => e.reconciliation === "reconciled" || e.reconciliation === "not_document_required")
    .map((e) => e.id);
  const stillUnresolvedEntryIds = reconciled.entries
    .filter((e) => e.reconciliation === "missing_document" || e.reconciliation === "ambiguous")
    .map((e) => e.id);

  const incidents = rebuildIncidents(ledger, entries, reconciled.unmatchedDocuments);

  return {
    ledger: {
      ...ledger,
      entries,
      incidents,
      unmatchedDocuments: reconciled.unmatchedDocuments,
      summary: {
        ...ledger.summary,
        reconciledPct: reconciledPercentage(entries),
        pendingReviewCount: entries.filter((e) => e.reviewStatus === "needs_review").length,
        unjustifiedAmountCents: entries
          .filter((e) => e.reconciliation === "missing_document" || e.reconciliation === "ambiguous")
          .reduce((acc, e) => acc + Math.abs(e.amountCents), 0),
        incidentCountByType: countByType(incidents),
      },
    },
    resolvedEntryIds,
    stillUnresolvedEntryIds,
    unusedDocumentIds: reconciled.unmatchedDocuments.map((d) => d.id),
    untouchedCount: untouched.length,
  };
}

/**
 * Rehace las incidencias documentales tras el reprocesado.
 *
 * Las incidencias que no tienen que ver con documentación (datáfono, duplicados,
 * fuentes) se conservan tal cual: nada de lo que ha pasado aquí las afecta.
 */
function rebuildIncidents(
  ledger: PeriodLedger,
  entries: LedgerEntry[],
  unmatchedDocuments: SupportingDocument[],
): Incident[] {
  const documentTypes = new Set([
    "MOVEMENT_WITHOUT_DOCUMENT",
    "INCOME_WITHOUT_DOCUMENT",
    "DOCUMENT_WITHOUT_MOVEMENT",
    "AMBIGUOUS_MATCH",
  ]);

  const kept = ledger.incidents.filter((i) => !documentTypes.has(i.type));
  const rebuilt: Incident[] = [...kept];

  for (const entry of entries) {
    if (entry.reconciliation !== "missing_document") continue;
    const isIncome = entry.direction === "income";
    rebuilt.push(
      createIncident({
        type: isIncome ? "INCOME_WITHOUT_DOCUMENT" : "MOVEMENT_WITHOUT_DOCUMENT",
        severity: entry.treasury === "cash" && !isIncome ? "info" : "warning",
        period: ledger.period,
        message: `${isIncome ? "Ingreso" : "Movimiento"} sin documento justificativo: "${
          entry.description
        }" (${formatCents(entry.amountCents)}).`,
        entryIds: [entry.id],
        details: { importe: entry.amountCents, fecha: entry.date, cuenta: entry.accountId },
        source: entry.source,
      }),
    );
  }

  for (const entry of entries) {
    if (entry.reconciliation !== "ambiguous") continue;
    rebuilt.push(
      createIncident({
        type: "AMBIGUOUS_MATCH",
        period: ledger.period,
        message: `Varios documentos encajan con "${entry.description}" (${formatCents(
          entry.amountCents,
        )}). No se ha asociado ninguno.`,
        entryIds: [entry.id],
        source: entry.source,
      }),
    );
  }

  for (const document of unmatchedDocuments) {
    rebuilt.push(
      createIncident({
        type: "DOCUMENT_WITHOUT_MOVEMENT",
        period: ledger.period,
        message: `Documento sin movimiento localizado: ${document.issuer} ${
          document.amountCents === null ? "(importe no extraído)" : formatCents(document.amountCents)
        }. No se ha creado ningún movimiento.`,
        details: { emisor: document.issuer, documento: document.document.name },
        source: document.source,
        key: document.id,
      }),
    );
  }

  return dedupeIncidents(rebuilt);
}

function reconciledPercentage(entries: LedgerEntry[]): number {
  if (entries.length === 0) return 0;
  const settled = entries.filter(
    (e) => e.reconciliation === "reconciled" || e.reconciliation === "not_document_required",
  ).length;
  return Math.round((settled / entries.length) * 1000) / 10;
}
