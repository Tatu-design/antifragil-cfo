/**
 * Cash Flow como VISTA calculada sobre el ledger (D20).
 *
 * No existe un "documento Cash Flow" que se edite: existe el ledger, y el Cash
 * Flow es su proyección para un mes. Reconstruirlo siempre desde el ledger es
 * lo que garantiza que no haya dos verdades distintas.
 *
 * Los movimientos internos quedan fuera por definición (D36/D37).
 */

import { formatCents, sumCents } from "./money";
import { periodLabel } from "./period";
import type { LedgerEntry, PeriodLedger, Treasury } from "./types";

export interface CashFlowLine {
  entryId: string;
  /** Nº de asiento dentro del mes, estable dado un ledger ordenado. */
  seq: number;
  date: string;
  concept: string;
  category: string | null;
  pnl: string | null;
  treasury: Treasury;
  hasInvoice: boolean;
  amountCents: number;
  /** Documento principal asociado, si existe. */
  documentName: string | null;
  documentUrl: string | null;
  needsReview: boolean;
}

export interface CashFlowGroupTotal {
  key: string;
  amountCents: number;
  lineCount: number;
}

export interface CashFlowView {
  period: string;
  label: string;
  income: CashFlowLine[];
  expenses: CashFlowLine[];
  internal: CashFlowLine[];
  totals: {
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    incomeByTreasury: Record<Treasury, number>;
    expenseByTreasury: Record<Treasury, number>;
    expenseWithInvoiceCents: number;
    expenseWithoutInvoiceCents: number;
  };
  expensesByCategory: CashFlowGroupTotal[];
  expensesByPnl: CashFlowGroupTotal[];
  /** Nº de líneas pendientes de clasificar. Bloquea el cierre del mes. */
  pendingClassificationCount: number;
}

export function buildCashFlowView(ledger: PeriodLedger): CashFlowView {
  const sorted = [...ledger.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );

  const income: CashFlowLine[] = [];
  const expenses: CashFlowLine[] = [];
  const internal: CashFlowLine[] = [];

  let incomeSeq = 0;
  let expenseSeq = 0;
  let internalSeq = 0;

  for (const entry of sorted) {
    if (entry.direction === "income") income.push(toLine(entry, ++incomeSeq));
    else if (entry.direction === "expense") expenses.push(toLine(entry, ++expenseSeq));
    else internal.push(toLine(entry, ++internalSeq));
  }

  const incomeCents = sumCents(income.map((l) => Math.abs(l.amountCents)));
  const expenseCents = sumCents(expenses.map((l) => Math.abs(l.amountCents)));

  return {
    period: ledger.period,
    label: periodLabel(ledger.period),
    income,
    expenses,
    internal,
    totals: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      incomeByTreasury: totalsByTreasury(income),
      expenseByTreasury: totalsByTreasury(expenses),
      expenseWithInvoiceCents: sumCents(
        expenses.filter((l) => l.hasInvoice).map((l) => Math.abs(l.amountCents)),
      ),
      expenseWithoutInvoiceCents: sumCents(
        expenses.filter((l) => !l.hasInvoice).map((l) => Math.abs(l.amountCents)),
      ),
    },
    expensesByCategory: groupBy(expenses, (l) => l.category ?? "PENDIENTE"),
    expensesByPnl: groupBy(expenses, (l) => l.pnl ?? "PENDIENTE"),
    pendingClassificationCount: ledger.summary.pendingClassificationCount,
  };
}

function toLine(entry: LedgerEntry, seq: number): CashFlowLine {
  const doc = entry.documents[0] ?? null;
  return {
    entryId: entry.id,
    seq,
    date: entry.date,
    concept: entry.description,
    category: entry.category,
    pnl: entry.pnl,
    treasury: entry.treasury,
    hasInvoice: entry.documents.length > 0,
    amountCents: entry.amountCents,
    documentName: doc?.name ?? null,
    documentUrl: doc?.url ?? null,
    needsReview: entry.reviewStatus === "needs_review",
  };
}

function totalsByTreasury(lines: CashFlowLine[]): Record<Treasury, number> {
  const totals: Record<Treasury, number> = { bank: 0, cash: 0 };
  for (const line of lines) totals[line.treasury] += Math.abs(line.amountCents);
  return totals;
}

function groupBy(
  lines: CashFlowLine[],
  keyOf: (line: CashFlowLine) => string,
): CashFlowGroupTotal[] {
  const map = new Map<string, CashFlowGroupTotal>();
  for (const line of lines) {
    const key = keyOf(line);
    const current = map.get(key) ?? { key, amountCents: 0, lineCount: 0 };
    current.amountCents += Math.abs(line.amountCents);
    current.lineCount += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

/** Render en texto del Cash Flow, para los informes de auditoría del CLI. */
export function renderCashFlowMarkdown(view: CashFlowView): string {
  const lines: string[] = [];
  lines.push(`## Cash Flow — ${view.label}`, "");
  lines.push(
    `- Ingresos: **${formatCents(view.totals.incomeCents)}**`,
    `- Gastos: **${formatCents(view.totals.expenseCents)}**`,
    `- Resultado: **${formatCents(view.totals.netCents)}**`,
    `- Pendientes de clasificar: **${view.pendingClassificationCount}**`,
    "",
  );

  lines.push("### Ingresos", "");
  lines.push("| # | Fecha | Concepto | Tesorería | Documento | Importe |");
  lines.push("|---|-------|----------|-----------|-----------|---------|");
  for (const line of view.income) {
    lines.push(
      `| ${line.seq} | ${line.date} | ${escape(line.concept)} | ${line.treasury} | ${
        escape(line.documentName ?? "—")
      } | ${formatCents(line.amountCents)} |`,
    );
  }

  lines.push("", "### Gastos", "");
  lines.push("| # | Fecha | Gasto | Categoría | P&L | Tesorería | Factura | Importe |");
  lines.push("|---|-------|-------|-----------|-----|-----------|---------|---------|");
  for (const line of view.expenses) {
    lines.push(
      `| ${line.seq} | ${line.date} | ${escape(line.concept)} | ${line.category ?? "PENDIENTE"} | ${
        line.pnl ?? "PENDIENTE"
      } | ${line.treasury} | ${line.hasInvoice ? "Sí" : "No"} | ${formatCents(line.amountCents)} |`,
    );
  }

  if (view.internal.length > 0) {
    lines.push(
      "",
      "### Movimientos internos de tesorería (excluidos del resultado)",
      "",
      "| Fecha | Concepto | Tesorería | Importe |",
      "|-------|----------|-----------|---------|",
    );
    for (const line of view.internal) {
      lines.push(
        `| ${line.date} | ${escape(line.concept)} | ${line.treasury} | ${formatCents(line.amountCents)} |`,
      );
    }
  }

  lines.push("", "### Gastos por P&L", "");
  for (const group of view.expensesByPnl) {
    lines.push(`- ${group.key}: ${formatCents(group.amountCents)} (${group.lineCount} línea/s)`);
  }

  lines.push("", "### Gastos por categoría", "");
  for (const group of view.expensesByCategory) {
    lines.push(`- ${group.key}: ${formatCents(group.amountCents)} (${group.lineCount} línea/s)`);
  }

  return lines.join("\n");
}

function escape(value: string): string {
  return value.replace(/\|/g, "\\|");
}
