"use client";

import { useState } from "react";

/**
 * Comparación con el cierre manual del mes.
 *
 * Aparece solo cuando se ha subido un Cash Flow previo. Ninguna de las dos
 * versiones se presume correcta: el informe aísla las diferencias y cada una
 * queda pendiente de que una persona decida qué ha pasado.
 */

interface Difference {
  kind: "only_in_engine" | "only_in_manual" | "amount_mismatch";
  date: string;
  description: string;
  engineAmountCents: number | null;
  manualAmountCents: number | null;
  deltaCents: number;
  evidence: string[];
}

interface ComparisonResponse {
  manualLines: number;
  matched: number;
  differences: number;
  byKind: Record<string, number>;
  warnings?: string[];
  items: Difference[];
  error?: string;
}

const KIND_LABELS: Record<Difference["kind"], string> = {
  only_in_engine: "Solo en el motor",
  only_in_manual: "Solo en tu cierre",
  amount_mismatch: "Importe distinto",
};

function euros(cents: number | null): string {
  if (cents === null) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${String(abs % 100).padStart(2, "0")} €`;
}

export function CompareButton({ period }: { period: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/periodos/${period}/comparar`, { method: "POST" });
      const payload = (await response.json()) as ComparisonResponse;
      if (!response.ok) throw new Error(payload.error ?? `Error ${response.status}.`);
      setResult(payload);
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : "Error al comparar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
        Comparar con el cierre manual
      </h2>

      <button
        type="button"
        onClick={() => void compare()}
        disabled={busy}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {busy ? "Comparando…" : "Comparar"}
      </button>

      {error && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <p>
            {result.manualLines} líneas en tu cierre · <strong>{result.matched}</strong> coinciden ·{" "}
            <strong>{result.differences}</strong> diferencias
          </p>

          {(result.warnings ?? []).length > 0 && (
            <ul className="text-amber-700 dark:text-amber-400">
              {result.warnings!.map((w) => (
                <li key={w}>⚠️ {w}</li>
              ))}
            </ul>
          )}

          {result.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-2 py-1 font-medium">Tipo</th>
                    <th className="px-2 py-1 font-medium">Fecha</th>
                    <th className="px-2 py-1 font-medium">Concepto</th>
                    <th className="px-2 py-1 text-right font-medium">Motor</th>
                    <th className="px-2 py-1 text-right font-medium">Tu cierre</th>
                    <th className="px-2 py-1 font-medium">Evidencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {result.items.map((item, index) => (
                    <tr key={`${item.date}-${item.description}-${index}`}>
                      <td className="px-2 py-1">{KIND_LABELS[item.kind]}</td>
                      <td className="px-2 py-1">{item.date}</td>
                      <td className="px-2 py-1">{item.description}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {euros(item.engineAmountCents)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {euros(item.manualAmountCents)}
                      </td>
                      <td className="px-2 py-1 text-neutral-500">{item.evidence.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-neutral-500">
            Ninguna versión se presume correcta. Cada diferencia queda pendiente de tu
            decisión: error del motor, error del cierre, diferencia de criterio o
            documento que falta.
          </p>
        </div>
      )}
    </section>
  );
}
