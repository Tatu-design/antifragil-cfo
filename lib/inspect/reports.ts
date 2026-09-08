/**
 * Informes de auditoría de una ejecución mensual.
 *
 * Cualquier cifra debe poder rastrearse hasta su archivo y fila. Estos informes
 * son la forma en que el motor se explica ante una persona.
 */

import { describeIncident } from "../finance/incidents";
import { formatCents } from "../finance/money";
import { periodLabel } from "../finance/period";
import { renderPeriodMarkdown, type PeriodView } from "../finance/period-view";
import { QUEUE_LABELS } from "../finance/review-queue";
import type { PeriodLedger } from "../finance/types";
import type { AdaptationResult } from "../sources/adapters";

export function renderReconciliationReport(
  ledger: PeriodLedger,
  adaptation: AdaptationResult,
): string {
  const out: string[] = [];
  out.push(`# Informe de conciliación — ${periodLabel(ledger.period)}`, "");

  // ── Estado documental por cuenta ──────────────────────────────────────────
  out.push("## Estado documental por tesorería", "");
  out.push("| Cuenta | Movimientos | Conciliados | Sin documento | Ambiguos | No requieren doc. |");
  out.push("|--------|-------------|-------------|---------------|----------|-------------------|");
  for (const account of ledger.accounts) {
    const rows = ledger.entries.filter((e) => e.accountId === account.id);
    if (rows.length === 0) continue;
    out.push(
      `| ${account.label} | ${rows.length} | ${count(rows, "reconciled")} | ${count(
        rows,
        "missing_document",
      )} | ${count(rows, "ambiguous")} | ${count(rows, "not_document_required")} |`,
    );
  }
  out.push("");

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
      out.push("> Las cifras no se han ajustado. La diferencia queda para revisión.", "");
    }
  }

  // ── Movimientos sin documento ─────────────────────────────────────────────
  const missing = ledger.entries.filter((e) => e.reconciliation === "missing_document");
  out.push("## Movimientos sin documento justificativo", "");
  out.push(`- Total: **${missing.length}**`, "");
  if (missing.length > 0) {
    out.push("| Fecha | Cuenta | Concepto | Importe | Origen |");
    out.push("|-------|--------|----------|---------|--------|");
    for (const entry of missing) {
      out.push(
        `| ${entry.date} | ${entry.accountId} | ${escape(entry.description)} | ${formatCents(
          entry.amountCents,
        )} | ${escape(sourceLabel(entry.source.file, entry.source.row))} |`,
      );
    }
    out.push("");
  }

  // ── Movimientos que no requieren documento ────────────────────────────────
  const notRequired = ledger.entries.filter((e) => e.reconciliation === "not_document_required");
  if (notRequired.length > 0) {
    out.push("## Movimientos que no requieren documento", "");
    out.push("_Estado final legítimo, no una excepción pendiente._", "");
    for (const entry of notRequired) {
      out.push(
        `- ${entry.date} · ${entry.accountId} · ${entry.description} · ${formatCents(
          entry.amountCents,
        )} — ${entry.reconciliationReason ?? "sin motivo registrado"}`,
      );
    }
    out.push("");
  }

  // ── Documentos sin movimiento ─────────────────────────────────────────────
  out.push("## Documentos sin movimiento localizado", "");
  out.push(`- Total: **${ledger.unmatchedDocuments.length}**`, "");
  if (ledger.unmatchedDocuments.length > 0) {
    out.push("> Ninguno se ha convertido en movimiento. Pueden estar pendientes de pago,", "");
    out.push("> pagados en otro mes o por otra vía.", "");
    for (const document of ledger.unmatchedDocuments) {
      out.push(
        `- ${document.date || "(sin fecha)"} · ${document.docType} · ${document.issuer} · ${
          document.amountCents === null ? "importe no extraído" : formatCents(document.amountCents)
        } — \`${document.document.name}\``,
      );
    }
    out.push("");
  }

  // ── Asociaciones automáticas y su evidencia ───────────────────────────────
  const reconciled = ledger.entries.filter(
    (e) => e.reconciliation === "reconciled" && e.documents.length > 0,
  );
  if (reconciled.length > 0) {
    out.push("## Asociaciones realizadas y su evidencia", "");
    out.push("| Fecha | Concepto | Documento(s) | Método | Confianza | Motivos |");
    out.push("|-------|----------|--------------|--------|-----------|---------|");
    for (const entry of reconciled) {
      const first = entry.documents[0];
      out.push(
        `| ${entry.date} | ${escape(entry.description)} | ${escape(
          entry.documents.map((d) => d.ref.name).join(", "),
        )} | ${first.method} | ${first.score === null ? "manual" : first.score.toFixed(2)} | ${escape(
          first.reasons.join("; "),
        )} |`,
      );
    }
    out.push("");
  }

  // ── Movimientos internos ──────────────────────────────────────────────────
  const internal = ledger.entries.filter((e) => e.direction === "internal");
  out.push("## Movimientos internos de tesorería", "");
  out.push(`- Detectados: **${internal.length}** (excluidos del resultado)`, "");
  for (const entry of internal) {
    out.push(
      `- ${entry.date} · ${entry.accountId} · ${entry.description} · ${formatCents(
        entry.amountCents,
      )} — ${entry.notes?.[0] ?? "movimiento interno"}`,
    );
  }
  out.push("");

  // ── Fuentes no incorporadas ───────────────────────────────────────────────
  if (adaptation.pendingDocuments.length > 0) {
    out.push("## Documentos no convertidos en datos estructurados", "");
    for (const doc of adaptation.pendingDocuments) {
      out.push(`- \`${doc.file}\` — ${doc.reason}`);
    }
    out.push("");
  }

  if (adaptation.problems.length > 0) {
    out.push("## Filas con problemas de lectura", "");
    for (const problem of adaptation.problems.slice(0, 50)) {
      out.push(
        `- \`${problem.file}\` hoja "${problem.sheet}" fila ${problem.row}: ${problem.problems.join("; ")}`,
      );
    }
    if (adaptation.problems.length > 50) {
      out.push(`- … y ${adaptation.problems.length - 50} más.`);
    }
    out.push("");
  }

  return out.join("\n");
}

export function renderRunSummary(ledger: PeriodLedger, view: PeriodView): string {
  const out: string[] = [];
  const s = ledger.summary;

  out.push(`# Resumen de ejecución — ${periodLabel(ledger.period)}`, "");
  out.push(
    `- Movimientos en el ledger: **${s.entryCount}**`,
    `- Ingresos: **${formatCents(s.incomeCents)}**`,
    `- Gastos: **${formatCents(s.expenseCents)}**`,
    `- Flujo neto de caja: **${formatCents(s.netCents)}**`,
    `- Movimientos conciliados: **${s.reconciledPct}%**`,
    `- Importe pendiente de justificar: **${formatCents(s.unjustifiedAmountCents)}**`,
    `- Movimientos internos (fuera del resultado): **${s.internalMovementCount}**`,
    `- Pendientes de clasificar: **${s.pendingClassificationCount}**`,
    "",
  );

  out.push("## Cola de revisión", "");
  if (view.queue.items.length === 0) {
    out.push("_Vacía._", "");
  } else {
    for (const [reason, count] of Object.entries(view.queue.counts)) {
      if (count === 0) continue;
      out.push(`- ${QUEUE_LABELS[reason as keyof typeof QUEUE_LABELS]}: **${count}**`);
    }
    out.push("");
  }

  out.push("## Incidencias", "");
  if (ledger.incidents.length === 0) {
    out.push("_Ninguna._", "");
  } else {
    for (const [type, count] of Object.entries(s.incidentCountByType)) {
      out.push(`- ${type}: **${count}**`);
    }
    out.push("", "### Detalle", "", "```");
    for (const incident of ledger.incidents) out.push(describeIncident(incident));
    out.push("```", "");
  }

  out.push(renderPeriodMarkdown(view), "");

  out.push("## Estado", "");
  const blocking = ledger.incidents.filter((i) => i.severity === "error").length;
  if (blocking > 0) {
    out.push(
      `⛔ **${blocking} incidencia(s) de gravedad ERROR.** El mes no debe darse por cerrado hasta resolverlas.`,
    );
  } else if (view.queue.items.length > 0) {
    out.push(
      `🟡 Sin errores bloqueantes, pero quedan **${view.queue.items.length}** elementos en la cola de revisión.`,
    );
  } else {
    out.push("🟢 Sin incidencias bloqueantes y sin nada pendiente de revisar.");
  }

  return out.join("\n");
}

function count(
  entries: PeriodLedger["entries"],
  status: PeriodLedger["entries"][number]["reconciliation"],
): number {
  return entries.filter((e) => e.reconciliation === status).length;
}

function escape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function sourceLabel(file: string, row: number | null | undefined): string {
  return row ? `${file}:${row}` : file;
}
