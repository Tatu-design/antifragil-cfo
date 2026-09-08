import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/finance/money";
import { isValidPeriod, periodLabel } from "@/lib/finance/period";
import { buildPeriodView } from "@/lib/finance/period-view";
import { QUEUE_LABELS } from "@/lib/finance/review-queue";
import { loadPeriodLedger } from "@/lib/period-store";
import type { ReconciliationStatus } from "@/lib/finance/types";

/**
 * Vista operativa de un mes.
 *
 * Lo primero que se ve es lo que hay que hacer (la cola de revisión), y debajo
 * todos los movimientos con su cuenta, su documento y su estado. Las métricas
 * son las del MVP: nada de EBITDA ni balances todavía.
 */

const RECONCILIATION_STYLES: Record<ReconciliationStatus, { label: string; className: string }> = {
  reconciled: { label: "Conciliado", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  not_document_required: { label: "No requiere doc.", className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400" },
  missing_document: { label: "Sin documento", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  ambiguous: { label: "Ambiguo", className: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300" },
  pending: { label: "Sin evaluar", className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400" },
};

export default async function PeriodPage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  if (!isValidPeriod(period)) notFound();

  const ledger = await loadPeriodLedger(period);
  if (!ledger) notFound();

  const view = buildPeriodView(ledger);
  const m = view.metrics;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-6 py-10">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Periodos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight capitalize">{periodLabel(period)}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {m.byAccount.filter((a) => a.movementCount > 0).length} tesorerías ·{" "}
          {ledger.summary.entryCount} movimientos · {m.reconciledPct}% conciliado
        </p>
      </header>

      {/* ── Métricas MVP ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Ingresos" value={formatCents(m.incomeCents)} />
        <Metric label="Gastos" value={formatCents(m.expenseCents)} />
        <Metric label="Flujo neto" value={formatCents(m.netCashFlowCents)} />
        <Metric label="Conciliado" value={`${m.reconciledPct}%`} />
        <Metric label="Pendientes" value={String(m.pendingCount)} />
        <Metric label="Sin justificar" value={formatCents(m.unjustifiedAmountCents)} />
      </section>

      {/* ── Por tesorería ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Por tesorería
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900">
              <tr>
                <Th>Cuenta</Th>
                <Th>Entidad</Th>
                <Th align="right">Movimientos</Th>
                <Th align="right">Ingresos</Th>
                <Th align="right">Gastos</Th>
                <Th align="right">Neto</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {m.byAccount.map((account) => (
                <tr key={account.accountId}>
                  <Td>{account.label}</Td>
                  <Td>{account.legalEntity}</Td>
                  <Td align="right">{account.movementCount}</Td>
                  <Td align="right">{formatCents(account.incomeCents)}</Td>
                  <Td align="right">{formatCents(account.expenseCents)}</Td>
                  <Td align="right">{formatCents(account.netCents)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Cola de revisión ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Pendiente de revisión ({view.queue.items.length})
        </h2>

        {view.queue.items.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            Nada pendiente en este periodo.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {Object.entries(view.queue.counts)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => (
                  <span
                    key={reason}
                    className="rounded-full bg-neutral-100 px-3 py-1 text-xs dark:bg-neutral-900"
                  >
                    {QUEUE_LABELS[reason as keyof typeof QUEUE_LABELS]}: <strong>{count}</strong>
                  </span>
                ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <Th>Motivo</Th>
                    <Th>Fecha</Th>
                    <Th>Cuenta</Th>
                    <Th>Concepto</Th>
                    <Th align="right">Importe</Th>
                    <Th>Detalle</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {view.queue.items.map((item, index) => (
                    <tr key={`${item.reason}-${item.entryId ?? index}`}>
                      <Td>{QUEUE_LABELS[item.reason]}</Td>
                      <Td>{item.date}</Td>
                      <Td>{item.accountId ?? "—"}</Td>
                      <Td>{item.description}</Td>
                      <Td align="right">
                        {item.amountCents === null ? "—" : formatCents(item.amountCents)}
                      </Td>
                      <Td className="text-neutral-500">{item.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Movimientos ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Movimientos ({view.movements.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 dark:bg-neutral-900">
              <tr>
                <Th>Fecha</Th>
                <Th>Cuenta</Th>
                <Th>Concepto</Th>
                <Th align="right">Importe</Th>
                <Th>Documental</Th>
                <Th>Documento</Th>
                <Th>Categoría</Th>
                <Th>P&amp;L</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {view.movements.map((row) => {
                const style = RECONCILIATION_STYLES[row.reconciliation];
                return (
                  <tr key={row.entryId}>
                    <Td>{row.date}</Td>
                    <Td>{row.accountLabel}</Td>
                    <Td>
                      {row.description}
                      {row.direction === "internal" && (
                        <span className="ml-2 text-xs text-neutral-500">(interno)</span>
                      )}
                    </Td>
                    <Td align="right">{formatCents(row.amountCents)}</Td>
                    <Td>
                      <span className={`rounded px-2 py-0.5 text-xs ${style.className}`}>
                        {style.label}
                      </span>
                    </Td>
                    <Td>
                      {row.documentName === null ? (
                        <span className="text-neutral-400">—</span>
                      ) : row.documentUrl ? (
                        <a
                          href={row.documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted underline-offset-2"
                        >
                          {row.documentName}
                        </a>
                      ) : (
                        row.documentName
                      )}
                      {row.documentCount > 1 && (
                        <span className="ml-1 text-xs text-neutral-500">+{row.documentCount - 1}</span>
                      )}
                    </Td>
                    <Td className={row.category ? "" : "text-amber-700 dark:text-amber-500"}>
                      {row.category ?? "Pendiente"}
                    </Td>
                    <Td className={row.pnl ? "" : "text-amber-700 dark:text-amber-500"}>
                      {row.pnl ?? "Pendiente"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500">
          La clasificación (categoría y P&amp;L) todavía se decide fuera de la aplicación.
          El siguiente paso es poder elegirla aquí y guardarla como regla para meses futuros.
        </p>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 ${align === "right" ? "text-right tabular-nums" : ""} ${className}`}>
      {children}
    </td>
  );
}
