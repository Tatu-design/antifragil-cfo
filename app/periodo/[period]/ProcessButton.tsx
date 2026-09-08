"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón de procesar el mes.
 *
 * El usuario no elige entre "construir" y "reprocesar": el sistema decide y
 * después cuenta qué ha hecho en lenguaje llano.
 */

interface ProcessResponse {
  mode: "full" | "incremental";
  movements: number;
  reconciledPct: number;
  pendingReview: number;
  resolved: number;
  skipped: Array<{ file: string; reason: string }>;
}

export function ProcessButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function process() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/periodos/${period}/procesar`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Error ${response.status}.`);
      setResult(payload as ProcessResponse);
      router.refresh();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Error al procesar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void process()}
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {busy ? "Procesando…" : "Procesar mes"}
      </button>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <p>
            {result.mode === "incremental"
              ? `Se han reintentado solo las incidencias pendientes: ${result.resolved} resuelta${result.resolved === 1 ? "" : "s"}.`
              : `Mes construido: ${result.movements} movimientos.`}
          </p>
          <p className="text-neutral-600 dark:text-neutral-400">
            {result.reconciledPct}% conciliado · {result.pendingReview} pendiente
            {result.pendingReview === 1 ? "" : "s"} de revisión
          </p>
          {result.skipped.length > 0 && (
            <ul className="space-y-1 border-t border-neutral-200 pt-2 text-amber-700 dark:border-neutral-800 dark:text-amber-400">
              {result.skipped.map((item) => (
                <li key={item.file}>
                  <strong>{item.file}</strong>: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
