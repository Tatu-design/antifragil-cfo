import { NextResponse, type NextRequest } from "next/server";
import { guardApi, safeError } from "@/lib/auth/api";
import { isValidPeriod } from "@/lib/finance/period";
import { ingestFiles, summaryHeadline, type IncomingFile } from "@/lib/ingest/ingest";
import { knownHashes, registerIngest } from "@/lib/repositories";
import { createDocumentStorage } from "@/lib/ingest/storage";

/**
 * Recepción de documentos de un periodo.
 *
 * El navegador sube por lotes (multipart) y aquí se ejecuta la ingesta: huella,
 * reconocimiento, almacenamiento y registro. Devuelve el resumen que la interfaz
 * muestra al usuario.
 *
 * Se usa un Route Handler y no una Server Action porque las Server Actions
 * tienen un límite de cuerpo pensado para formularios, y aquí pueden llegar
 * decenas de PDF de una vez.
 */

export const runtime = "nodejs";
// La carga escribe en el almacén: nunca debe cachearse ni prerenderizarse.
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ period: string }> },
) {
  // Autorización ANTES de leer el cuerpo: nada se procesa sin sesión válida.
  const guard = await guardApi({ write: true });
  if (!guard.ok) return guard.response;

  const { period } = await params;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "Periodo inválido." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se ha podido leer la carga." }, { status: 400 });
  }

  const forcedAccountId = readOptionalString(formData.get("accountId"));

  const files: IncomingFile[] = [];
  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File)) continue;
    files.push({
      fileName: entry.name,
      mimeType: entry.type || "application/octet-stream",
      bytes: new Uint8Array(await entry.arrayBuffer()),
    });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "No se ha recibido ningún archivo." }, { status: 400 });
  }

  try {
    const summary = await ingestFiles(files, {
      period,
      storage: createDocumentStorage(),
      knownHashes: await knownHashes(period),
      forcedAccountId,
      uploadedBy: guard.user.id,
    });

    await registerIngest(summary, guard.user.id);

    return NextResponse.json({
      headline: summaryHeadline(summary),
      received: summary.received,
      recognized: summary.recognized,
      needsReview: summary.needsReview,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      documents: summary.documents.map((document) => ({
        hash: document.hash,
        fileName: document.fileName,
        outcome: document.outcome,
        kind: document.recognition?.kind ?? null,
        docType: document.recognition?.docType ?? null,
        accountId: document.recognition?.accountId ?? null,
        period: document.recognition?.period ?? null,
        question: document.recognition?.question?.message ?? null,
        questionType: document.recognition?.question?.type ?? null,
        reasons: document.recognition?.reasons ?? [],
        error: document.error ?? null,
      })),
    });
  } catch (error) {
    return safeError(error, "No se ha podido procesar la carga.");
  }
}

function readOptionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
