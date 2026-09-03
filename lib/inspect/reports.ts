/**
 * Informes de auditoría de una ejecución mensual.
 *
 * Requisito D49: cualquier cifra debe poder rastrearse hasta su archivo y fila.
 * Estos informes son la forma en que el motor se explica ante una persona.
 */

import { renderCashFlowMarkdown, type CashFlowView } from "../finance/cashflow";
import { describeIncident } from "../finance/incidents";
import { formatCents } from "../finance/money";
import { periodLabel } from "../finance/period";
import type { PeriodLedger } from "../finance/types";
import type { AdaptationResult } from "../sources/adapters";

export function renderReconciliationReport(
  ledger: PeriodLedger,
  adaptation: AdaptationResult,
): string {
  const out: string[] = [];
  out.push(`# Informe de conciliación — ${periodLabel(ledger.period)}`, "");

  // ── Datáfono ──────────────────────────────────────────────────────────────
  out.push("## Datáfono de clínica", "");
  const card = ledger.cardSettlement;
  if (!card) {
    out.push("_No se han detectado liquidaciones de datáfono ni ventas de clínica por banco._", "");
  } else {
    out.push(
      `- Liquidaciones de remesas de comercio detectadas: **${card.bankMovementCount}**`,
      `- Total datáfono banco: **${formatCents(card.bankTotalCents)}**`,
      `- Total facturación clínica banco: **${formatCents(card.salesTotalCents)}** (${card.salesLineCount} líneas)`,
      `- Diferencia: **${formatCents(card.differenceCents)}**`,
      `- Estado: **${card.reconciled ? "DATÁFONO CONCILIADO" : "DATÁFONO NO CONCILIADO"}**`,
      "",
    );
    if (!card.reconciled) {
      out.push(
        "> Las cifras no se han ajustado. La diferencia queda como incidencia para revisión.",
        "",
      );
    }
  }

  // ── Gastos ────────────────────────────────────────────────────────────────
  const expenses = ledger.entries.filter((e) => e.direction === "expense");
  const matched = expenses.filter((e) => e.reconciliation === "matched");
  const missing = expenses.filter((e) => e.reconciliation === "missing_document");
  const ambiguous = expenses.filter((e) => e.reconciliation === "ambiguous");

  out.push("## Gastos → facturas", "");
  out.push(
    `- Gastos analizados: **${expenses.length}**`,
    `- Conciliados con factura: **${matched.length}**`,
    `- Sin factura localizada: **${missing.length}**`,
    `- Con asociación ambigua (sin asociar): **${ambiguous.length}**`,
    "",
  );

  if (missing.length > 0) {
    out.push("### Gastos sin factura", "");
    out.push("| Fecha | Gasto | Tesorería | Importe | Origen |");
    out.push("|-------|-------|-----------|---------|--------|");
    for (const entry of missing) {
      out.push(
        `| ${entry.date} | ${escape(entry.description)} | ${entry.treasury} | ${formatCents(
          entry.amountCents,
        )} | ${escape(sourceLabel(entry.source.file, entry.source.row))} |`,
      );
    }
    out.push("");
  }

  // ── Facturas sin movimiento ───────────────────────────────────────────────
  const invoiceIncidents = ledger.incidents.filter((i) => i.type === "INVOICE_WITHOUT_MOVEMENT");
  out.push("## Facturas → movimientos", "");
  out.push(`- Facturas sin movimiento localizado: **${invoiceIncidents.length}**`, "");
  if (invoiceIncidents.length > 0) {
    out.push("> Ninguna se ha convertido en gasto. Pueden estar pendientes de pago,", "");
    out.push("> pagadas en otro mes o por otra vía.", "");
    for (const incident of invoiceIncidents) {
      out.push(`- ${incident.message}`);
    }
    out.push("");
  }

  // ── Ingresos ──────────────────────────────────────────────────────────────
  const incomeIncidents = ledger.incidents.filter((i) => i.type === "INCOME_WITHOUT_INVOICE");
  out.push("## Ingresos bancarios (no datáfono)", "");
  out.push(`- Ingresos sin factura localizada: **${incomeIncidents.length}**`, "");
  for (const incident of incomeIncidents) out.push(`- ${incident.message}`);
  out.push("");

  // ── Movimientos internos ──────────────────────────────────────────────────
  const internal = ledger.entries.filter((e) => e.direction === "internal");
  out.push("## Movimientos internos de tesorería", "");
  out.push(
    `- Detectados: **${internal.length}** (excluidos del resultado, como debe ser)`,
    "",
  );
  for (const entry of internal) {
    out.push(
      `- ${entry.date} · ${entry.description} · ${formatCents(entry.amountCents)} — ${
        entry.notes?.[0] ?? "movimiento interno"
      }`,
    );
  }
  out.push("");

  // ── Fuentes no incorporadas ───────────────────────────────────────────────
  if (adaptation.pendingDocuments.length > 0) {
    out.push("## Documentos no incorporados automáticamente", "");
    for (const doc of adaptation.pendingDocuments) {
      out.push(`- \`${doc.file}\` — ${doc.reason}`);
    }
    out.push("");
  }

  if (adaptation.problems.length > 0) {
    out.push("## Filas con problemas de lectura", "");
    for (const problem of adaptation.problems.slice(0, 50)) {
      out.push(`- \`${problem.file}\` hoja "${problem.sheet}" fila ${problem.row}: ${problem.problems.join("; ")}`);
    }
    if (adaptation.problems.length > 50) {
      out.push(`- … y ${adaptation.problems.length - 50} más.`);
    }
    out.push("");
  }

  return out.join("\n");
}

export function renderRunSummary(ledger: PeriodLedger, view: CashFlowView): string {
  const out: string[] = [];
  const s = ledger.summary;

  out.push(`# Resumen de ejecución — ${periodLabel(ledger.period)}`, "");
  out.push(
    `- Apuntes en el ledger: **${s.entryCount}**`,
    `- Ingresos: **${formatCents(s.incomeCents)}**`,
    `- Gastos: **${formatCents(s.expenseCents)}**`,
    `- Resultado: **${formatCents(s.netCents)}**`,
    `- Movimientos internos (fuera del resultado): **${s.internalMovementCount}**`,
    `- Pendientes de clasificar: **${s.pendingClassificationCount}**`,
    `- Gasto con factura: **${formatCents(s.withInvoiceCents)}** · sin factura: **${formatCents(
      s.withoutInvoiceCents,
    )}**`,
    "",
  );

  out.push("## Incidencias", "");
  const total = ledger.incidents.length;
  if (total === 0) {
    out.push("_Ninguna._", "");
  } else {
    for (const [type, count] of Object.entries(s.incidentCountByType)) {
      out.push(`- ${type}: **${count}**`);
    }
    out.push("");
    out.push("### Detalle", "");
    out.push("```");
    for (const incident of ledger.incidents) out.push(describeIncident(incident));
    out.push("```", "");
  }

  out.push(renderCashFlowMarkdown(view), "");

  out.push("## Estado", "");
  const blocking = ledger.incidents.filter((i) => i.severity === "error").length;
  if (blocking > 0) {
    out.push(
      `⛔ **${blocking} incidencia(s) de gravedad ERROR.** El mes no debe darse por cerrado hasta resolverlas.`,
    );
  } else if (s.pendingClassificationCount > 0) {
    out.push(
      `🟡 Sin errores bloqueantes, pero quedan **${s.pendingClassificationCount}** apuntes por clasificar manualmente.`,
    );
  } else {
    out.push("🟢 Sin incidencias bloqueantes y sin apuntes pendientes de clasificar.");
  }

  return out.join("\n");
}

function escape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function sourceLabel(file: string, row: number | null | undefined): string {
  return row ? `${file}:${row}` : file;
}
