/**
 * Vista operativa del periodo: movimientos, estado documental y métricas MVP.
 *
 * Sustituye a la antigua vista de "Cash Flow". El objetivo de esta etapa no es
 * producir un estado financiero, sino demostrar que cada movimiento está donde
 * debe, con su documento y su cuenta. Cash Flow operativo, EBITDA y balances
 * llegarán cuando la conciliación sea de fiar.
 */

import { formatCents } from "./money";
import { periodLabel } from "./period";
import { buildReviewQueue, QUEUE_LABELS, type ReviewQueue } from "./review-queue";
import type {
  AccountSummary,
  Direction,
  LedgerEntry,
  PeriodLedger,
  ReconciliationStatus,
} from "./types";

export interface MovementRow {
  entryId: string;
  seq: number;
  date: string;
  accountId: string;
  accountLabel: string;
  direction: Direction;
  description: string;
  amountCents: number;
  category: string | null;
  pnl: string | null;
  reconciliation: ReconciliationStatus;
  reconciliationReason: string | null;
  documentName: string | null;
  documentUrl: string | null;
  documentCount: number;
  /** Confianza del match automático, si lo hubo. */
  matchScore: number | null;
  needsReview: boolean;
}

export interface PeriodView {
  period: string;
  label: string;
  movements: MovementRow[];
  queue: ReviewQueue;
  metrics: PeriodMetrics;
}

/** Métricas del MVP. Nada de EBITDA ni balances todavía. */
export interface PeriodMetrics {
  incomeCents: number;
  expenseCents: number;
  netCashFlowCents: number;
  byAccount: AccountSummary[];
  reconciledPct: number;
  pendingCount: number;
  unjustifiedAmountCents: number;
  expensesByCategory: Array<{ key: string; amountCents: number; count: number }>;
  expensesByPnl: Array<{ key: string; amountCents: number; count: number }>;
}

export function buildPeriodView(ledger: PeriodLedger): PeriodView {
  const sorted = [...ledger.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id),
  );

  const accountLabels = new Map(ledger.accounts.map((a) => [a.id, a.label]));
  const movements = sorted.map((entry, index) => toRow(entry, index + 1, accountLabels));
  const queue = buildReviewQueue(ledger);

  return {
    period: ledger.period,
    label: periodLabel(ledger.period),
    movements,
    queue,
    metrics: {
      incomeCents: ledger.summary.incomeCents,
      expenseCents: ledger.summary.expenseCents,
      netCashFlowCents: ledger.summary.netCents,
      byAccount: Object.values(ledger.summary.byAccount),
      reconciledPct: ledger.summary.reconciledPct,
      pendingCount: queue.items.length,
      unjustifiedAmountCents: ledger.summary.unjustifiedAmountCents,
      expensesByCategory: groupRows(ledger.entries, (e) => e.category ?? "PENDIENTE"),
      expensesByPnl: groupRows(ledger.entries, (e) => e.pnl ?? "PENDIENTE"),
    },
  };
}

function toRow(
  entry: LedgerEntry,
  seq: number,
  accountLabels: Map<string, string>,
): MovementRow {
  const attached = entry.documents[0] ?? null;
  return {
    entryId: entry.id,
    seq,
    date: entry.date,
    accountId: entry.accountId,
    accountLabel: accountLabels.get(entry.accountId) ?? entry.accountId,
    direction: entry.direction,
    description: entry.description,
    amountCents: entry.amountCents,
    category: entry.category,
    pnl: entry.pnl,
    reconciliation: entry.reconciliation,
    reconciliationReason: entry.reconciliationReason ?? null,
    documentName: attached?.ref.name ?? null,
    documentUrl: attached?.ref.url ?? null,
    documentCount: entry.documents.length,
    matchScore: attached?.score ?? null,
    needsReview: entry.reviewStatus === "needs_review",
  };
}

function groupRows(
  entries: LedgerEntry[],
  keyOf: (entry: LedgerEntry) => string,
): Array<{ key: string; amountCents: number; count: number }> {
  const map = new Map<string, { key: string; amountCents: number; count: number }>();
  for (const entry of entries) {
    if (entry.direction !== "expense") continue;
    const key = keyOf(entry);
    const current = map.get(key) ?? { key, amountCents: 0, count: 0 };
    current.amountCents += Math.abs(entry.amountCents);
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

const RECONCILIATION_LABELS: Record<ReconciliationStatus, string> = {
  pending: "sin evaluar",
  reconciled: "conciliado",
  missing_document: "sin documento",
  ambiguous: "ambiguo",
  not_document_required: "no requiere documento",
};

/** Render en Markdown de la vista del periodo, para los informes del CLI. */
export function renderPeriodMarkdown(view: PeriodView): string {
  const out: string[] = [];
  const m = view.metrics;

  out.push(`## Periodo — ${view.label}`, "");
  out.push(
    `- Ingresos: **${formatCents(m.incomeCents)}**`,
    `- Gastos: **${formatCents(m.expenseCents)}**`,
    `- Flujo neto de caja: **${formatCents(m.netCashFlowCents)}**`,
    `- Movimientos conciliados: **${m.reconciledPct}%**`,
    `- Pendientes de revisión: **${m.pendingCount}**`,
    `- Importe pendiente de justificar: **${formatCents(m.unjustifiedAmountCents)}**`,
    "",
  );

  out.push("### Por tesorería", "");
  out.push("| Cuenta | Entidad | Movimientos | Ingresos | Gastos | Neto |");
  out.push("|--------|---------|-------------|----------|--------|------|");
  for (const account of m.byAccount) {
    out.push(
      `| ${account.label} | ${account.legalEntity} | ${account.movementCount} | ${formatCents(
        account.incomeCents,
      )} | ${formatCents(account.expenseCents)} | ${formatCents(account.netCents)} |`,
    );
  }
  out.push("");

  out.push("### Cola de revisión", "");
  if (view.queue.items.length === 0) {
    out.push("_Vacía._", "");
  } else {
    for (const [reason, count] of Object.entries(view.queue.counts)) {
      if (count === 0) continue;
      out.push(`- ${QUEUE_LABELS[reason as keyof typeof QUEUE_LABELS]}: **${count}**`);
    }
    out.push("");
    out.push("| Motivo | Fecha | Cuenta | Concepto | Importe | Detalle |");
    out.push("|--------|-------|--------|----------|---------|---------|");
    for (const item of view.queue.items.slice(0, 100)) {
      out.push(
        `| ${QUEUE_LABELS[item.reason]} | ${item.date} | ${item.accountId ?? "—"} | ${escape(
          item.description,
        )} | ${item.amountCents === null ? "—" : formatCents(item.amountCents)} | ${escape(item.detail)} |`,
      );
    }
    if (view.queue.items.length > 100) {
      out.push(`| … | | | ${view.queue.items.length - 100} elementos más | | |`);
    }
    out.push("");
  }

  out.push("### Movimientos", "");
  out.push("| # | Fecha | Cuenta | Concepto | Tipo | Importe | Documental | Documento | Categoría | P&L |");
  out.push("|---|-------|--------|----------|------|---------|------------|-----------|-----------|-----|");
  for (const row of view.movements) {
    out.push(
      `| ${row.seq} | ${row.date} | ${row.accountId} | ${escape(row.description)} | ${
        row.direction
      } | ${formatCents(row.amountCents)} | ${RECONCILIATION_LABELS[row.reconciliation]} | ${escape(
        row.documentName ?? "—",
      )} | ${row.category ?? "PENDIENTE"} | ${row.pnl ?? "PENDIENTE"} |`,
    );
  }
  out.push("");

  out.push("### Gastos por P&L", "");
  for (const group of m.expensesByPnl) {
    out.push(`- ${group.key}: ${formatCents(group.amountCents)} (${group.count})`);
  }
  out.push("", "### Gastos por categoría", "");
  for (const group of m.expensesByCategory) {
    out.push(`- ${group.key}: ${formatCents(group.amountCents)} (${group.count})`);
  }

  return out.join("\n");
}

function escape(value: string): string {
  return value.replace(/\|/g, "\\|");
}
