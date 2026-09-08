"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Zona de carga de documentos.
 *
 * Es la pieza central de la operativa: arrastrar los documentos del mes de una
 * vez y que el sistema deduzca qué es cada uno. Nada de subir factura por
 * factura, y nada de etiquetar a mano.
 *
 * Los archivos se envían en lotes pequeños para que la barra de progreso avance
 * de verdad y para no mandar 100 PDF en una sola petición.
 */

const BATCH_SIZE = 4;

interface UploadedDocument {
  hash: string;
  fileName: string;
  outcome: "recognized" | "needs_review" | "duplicate" | "rejected";
  kind: string | null;
  docType: string | null;
  accountId: string | null;
  question: string | null;
  questionType: string | null;
  reasons: string[];
  error: string | null;
}

interface UploadResult {
  received: number;
  recognized: number;
  needsReview: number;
  duplicates: number;
  rejected: number;
  documents: UploadedDocument[];
}

export function DropZone({
  period,
  periodLabel,
  mode = "documents",
}: {
  period: string;
  periodLabel: string;
  /** "statements" fuerza la pregunta de cuenta antes de subir extractos. */
  mode?: "documents" | "statements";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setResult(null);
      setProgress({ done: 0, total: files.length });

      const accumulated: UploadResult = {
        received: 0,
        recognized: 0,
        needsReview: 0,
        duplicates: 0,
        rejected: 0,
        documents: [],
      };

      try {
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          const formData = new FormData();
          for (const file of batch) formData.append("files", file);
          if (accountId) formData.append("accountId", accountId);

          const response = await fetch(`/api/periodos/${period}/documentos`, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(payload?.error ?? `Error ${response.status} al subir los documentos.`);
          }

          const payload = (await response.json()) as UploadResult;
          accumulated.received += payload.received;
          accumulated.recognized += payload.recognized;
          accumulated.needsReview += payload.needsReview;
          accumulated.duplicates += payload.duplicates;
          accumulated.rejected += payload.rejected;
          accumulated.documents.push(...payload.documents);

          setProgress({ done: Math.min(i + BATCH_SIZE, files.length), total: files.length });
        }

        setResult(accumulated);
        // Refresca la página para que el mes recoja los documentos nuevos.
        router.refresh();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Error al subir los documentos.");
      } finally {
        setProgress(null);
      }
    },
    [accountId, period, router],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      void upload(Array.from(event.dataTransfer.files));
    },
    [upload],
  );

  const problematic = result?.documents.filter(
    (d) => d.outcome === "needs_review" || d.outcome === "rejected",
  );

  return (
    <div className="space-y-4">
      {mode === "statements" && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">Cuenta (opcional):</span>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            <option value="">Detectar automáticamente</option>
            <option value="sl_bank">Banco SL</option>
            <option value="sc_bank">Banco SC</option>
          </select>
          <span className="text-xs text-neutral-500">
            Solo hace falta si el archivo no indica la cuenta.
          </span>
        </label>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragging
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-600"
        }`}
      >
        <p className="text-base font-medium">
          {mode === "statements"
            ? `Arrastra aquí los extractos de ${periodLabel}`
            : `Arrastra aquí los documentos de ${periodLabel}`}
        </p>
        <p className="text-sm text-neutral-500">
          Puedes soltar muchos a la vez · PDF, XLSX y CSV
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xlsm,.xls,.csv,application/pdf"
          className="hidden"
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {progress && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500">
            Subiendo {progress.done} de {progress.total}…
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="font-medium">
              {result.received} documento{result.received === 1 ? "" : "s"} recibido
              {result.received === 1 ? "" : "s"}
            </span>
            {result.recognized > 0 && (
              <span className="text-emerald-700 dark:text-emerald-400">
                {result.recognized} reconocido{result.recognized === 1 ? "" : "s"}
              </span>
            )}
            {result.needsReview > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {result.needsReview} necesita{result.needsReview === 1 ? "" : "n"} revisión
              </span>
            )}
            {result.duplicates > 0 && (
              <span className="text-neutral-500">
                {result.duplicates} duplicado{result.duplicates === 1 ? "" : "s"} ignorado
                {result.duplicates === 1 ? "" : "s"}
              </span>
            )}
            {result.rejected > 0 && (
              <span className="text-red-700 dark:text-red-400">
                {result.rejected} no admitido{result.rejected === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {problematic && problematic.length > 0 && (
            <div className="space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
                Solo esto necesita tu atención
              </p>
              <ul className="space-y-2 text-sm">
                {problematic.map((document) => (
                  <li key={document.hash || document.fileName} className="flex flex-col gap-0.5">
                    <span className="font-medium">{document.fileName}</span>
                    <span className="text-neutral-600 dark:text-neutral-400">
                      {document.error ?? document.question ?? "Requiere confirmación."}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
