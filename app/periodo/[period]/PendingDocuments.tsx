"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Documentos que el sistema no ha sabido identificar del todo.
 *
 * Es la única parte de la carga que pide intervención humana, y por eso se
 * limita a lo imprescindible: de qué cuenta es un extracto, o qué es un archivo
 * que no se ha podido reconocer.
 */

export interface PendingDocument {
  hash: string;
  fileName: string;
  kind: string;
  question: string | null;
  storagePath: string;
}

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "supporting_document", label: "Documento justificativo" },
  { value: "bank_statement", label: "Extracto bancario" },
  { value: "cash_account", label: "Cuenta de cash" },
  { value: "clinic_bank_sales", label: "Ventas clínica — banco" },
  { value: "clinic_cash_sales", label: "Ventas clínica — efectivo" },
];

export function PendingDocuments({
  period,
  documents,
}: {
  period: string;
  documents: PendingDocument[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(hash: string, resolution: { kind?: string; accountId?: string | null }) {
    setBusy(hash);
    setError(null);
    try {
      const response = await fetch(`/api/periodos/${period}/documentos/${hash}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolution),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Error ${response.status}.`);
      }
      router.refresh();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "No se ha podido guardar.");
    } finally {
      setBusy(null);
    }
  }

  if (documents.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
        Documentos por confirmar ({documents.length})
      </h2>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {documents.map((document) => (
          <li key={document.hash} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <a
                href={`/api/documentos/${document.storagePath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline decoration-dotted underline-offset-2"
              >
                {document.fileName}
              </a>
              <p className="text-neutral-600 dark:text-neutral-400">
                {document.question ?? "Requiere confirmación."}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {document.kind === "bank_statement" ? (
                <>
                  <button
                    type="button"
                    disabled={busy === document.hash}
                    onClick={() => void resolve(document.hash, { accountId: "sl_bank" })}
                    className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Es de la SL
                  </button>
                  <button
                    type="button"
                    disabled={busy === document.hash}
                    onClick={() => void resolve(document.hash, { accountId: "sc_bank" })}
                    className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Es de la SC
                  </button>
                </>
              ) : (
                <select
                  defaultValue=""
                  disabled={busy === document.hash}
                  onChange={(event) => {
                    if (event.target.value) void resolve(document.hash, { kind: event.target.value });
                  }}
                  className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
                >
                  <option value="">¿Qué es?</option>
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
