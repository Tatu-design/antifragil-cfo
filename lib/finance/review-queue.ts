/**
 * Cola de revisión: lo único que una persona tiene que mirar cada mes.
 *
 * El objetivo operativo del MVP es que el trabajo mensual se reduzca a vaciar
 * esta cola. Todo lo que el motor resuelve con evidencia suficiente no aparece
 * aquí; todo lo que no, sí, con su motivo.
 */

import { formatCents } from "./money";
import type { LedgerEntry, PeriodLedger, SupportingDocument } from "./types";

export type QueueReason =
  | "missing_document"
  | "ambiguous_match"
  | "unclassified"
  | "document_without_movement"
  | "card_settlement_mismatch"
  | "duplicate_suspect";

export interface QueueItem {
  reason: QueueReason;
  /** Prioridad: 1 lo más urgente. Ordena la cola. */
  priority: number;
  entryId?: string;
  date: string;
  accountId?: string;
  description: string;
  amountCents: number | null;
  detail: string;
}

export interface ReviewQueue {
  period: string;
  items: QueueItem[];
  counts: Record<QueueReason, number>;
}

const PRIORITY: Record<QueueReason, number> = {
  card_settlement_mismatch: 1,
  missing_document: 2,
  ambiguous_match: 3,
  document_without_movement: 4,
  duplicate_suspect: 5,
  unclassified: 6,
};

export function buildReviewQueue(ledger: PeriodLedger): ReviewQueue {
  const items: QueueItem[] = [];

  if (ledger.cardSettlement && !ledger.cardSettlement.reconciled) {
    const card = ledger.cardSettlement;
    items.push({
      reason: "card_settlement_mismatch",
      priority: PRIORITY.card_settlement_mismatch,
      date: `${ledger.period}-01`,
      description: "Datáfono de clínica: banco vs facturación",
      amountCents: card.differenceCents,
      detail: `Banco ${formatCents(card.bankTotalCents)} · facturación ${formatCents(
        card.salesTotalCents,
      )} · diferencia ${formatCents(card.differenceCents)}`,
    });
  }

  for (const entry of ledger.entries) {
    if (entry.reconciliation === "missing_document") {
      items.push(itemFromEntry(entry, "missing_document", "Sin documento justificativo localizado"));
    } else if (entry.reconciliation === "ambiguous") {
      items.push(itemFromEntry(entry, "ambiguous_match", "Varios documentos posibles; ninguno asociado"));
    }

    if (entry.direction !== "internal" && entry.classificationStatus === "pending") {
      items.push(itemFromEntry(entry, "unclassified", "Pendiente de categoría y P&L"));
    }
  }

  for (const document of ledger.unmatchedDocuments) {
    items.push(itemFromDocument(document));
  }

  for (const incident of ledger.incidents) {
    if (incident.type !== "DUPLICATE_SUSPECT") continue;
    const entry = ledger.entries.find((e) => e.id === incident.entryIds[0]);
    items.push({
      reason: "duplicate_suspect",
      priority: PRIORITY.duplicate_suspect,
      entryId: entry?.id,
      date: entry?.date ?? `${ledger.period}-01`,
      accountId: entry?.accountId,
      description: entry?.description ?? incident.message,
      amountCents: entry?.amountCents ?? null,
      detail: incident.message,
    });
  }

  items.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date));

  const counts = Object.keys(PRIORITY).reduce(
    (acc, reason) => {
      acc[reason as QueueReason] = items.filter((i) => i.reason === reason).length;
      return acc;
    },
    {} as Record<QueueReason, number>,
  );

  return { period: ledger.period, items, counts };
}

function itemFromEntry(entry: LedgerEntry, reason: QueueReason, detail: string): QueueItem {
  return {
    reason,
    priority: PRIORITY[reason],
    entryId: entry.id,
    date: entry.date,
    accountId: entry.accountId,
    description: entry.description,
    amountCents: entry.amountCents,
    detail,
  };
}

function itemFromDocument(document: SupportingDocument): QueueItem {
  return {
    reason: "document_without_movement",
    priority: PRIORITY.document_without_movement,
    date: document.date,
    description: `${document.issuer}${document.reference ? ` · ${document.reference}` : ""}`,
    amountCents: document.amountCents,
    detail: `Documento ${document.docType} sin movimiento localizado (${document.document.name}). No se ha creado ningún movimiento.`,
  };
}

/** Etiquetas legibles para informes e interfaz. */
export const QUEUE_LABELS: Record<QueueReason, string> = {
  card_settlement_mismatch: "Diferencia de datáfono",
  missing_document: "Movimientos sin documento",
  ambiguous_match: "Matches ambiguos",
  document_without_movement: "Documentos sin movimiento",
  duplicate_suspect: "Posibles duplicados",
  unclassified: "Sin clasificar",
};
