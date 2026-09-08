import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupportingDocument } from "../finance/types";
import { dataRoot } from "../paths";
import type { IngestedDocument, IngestSummary } from "./ingest";

/**
 * Registro de los documentos de un periodo.
 *
 * Guarda qué se ha subido, qué se dedujo de cada archivo y dónde está
 * almacenado. Es lo que permite:
 *
 *   - detectar duplicados entre cargas distintas (por huella de contenido),
 *   - añadir documentos en cualquier momento sin rehacer lo anterior,
 *   - alimentar el motor de conciliación,
 *   - abrir el documento desde el asiento.
 *
 * Hoy vive en un manifiesto JSON dentro de la zona local. Cuando Supabase esté
 * conectado pasará a la tabla `documents`, con la misma forma: solo cambia este
 * archivo.
 */

export interface RegisteredDocument {
  hash: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  period: string;
  /** Qué es: documento justificativo, extracto, cuenta de cash, ventas… */
  kind: string;
  accountId: string | null;
  docType: string;
  amountCents: number | null;
  confidence: number;
  reasons: string[];
  /** Sigue pendiente de que una persona confirme algo. */
  needsReview: boolean;
  question: string | null;
  uploadedAt: string;
}

export interface PeriodDocuments {
  period: string;
  documents: RegisteredDocument[];
}

function manifestPath(period: string): string {
  return path.join(dataRoot(), "documents", period, "manifest.json");
}

export async function loadPeriodDocuments(period: string): Promise<PeriodDocuments> {
  try {
    const content = await readFile(manifestPath(period), "utf8");
    return JSON.parse(content) as PeriodDocuments;
  } catch {
    return { period, documents: [] };
  }
}

export async function knownHashes(period: string): Promise<Set<string>> {
  const { documents } = await loadPeriodDocuments(period);
  return new Set(documents.map((d) => d.hash));
}

/**
 * Incorpora el resultado de una carga al registro.
 *
 * Los duplicados no se añaden: ya están. Los rechazados tampoco, porque no
 * llegaron a almacenarse.
 */
export async function registerIngest(
  summary: IngestSummary,
  now: () => Date = () => new Date(),
): Promise<PeriodDocuments> {
  const current = await loadPeriodDocuments(summary.period);
  const byHash = new Map(current.documents.map((d) => [d.hash, d]));

  for (const document of summary.documents) {
    if (document.outcome === "duplicate" || document.outcome === "rejected") continue;
    if (byHash.has(document.hash)) continue;
    byHash.set(document.hash, toRegistered(document, summary.period, now().toISOString()));
  }

  const next: PeriodDocuments = {
    period: summary.period,
    documents: [...byHash.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)),
  };

  const target = manifestPath(summary.period);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(next, null, 2), "utf8");

  return next;
}

/** Resuelve una duda pendiente sobre un documento (cuenta o tipo). */
export async function resolveDocument(
  period: string,
  hash: string,
  resolution: { kind?: string; accountId?: string | null; docType?: string },
): Promise<PeriodDocuments> {
  const current = await loadPeriodDocuments(period);
  const documents = current.documents.map((document) =>
    document.hash === hash
      ? {
          ...document,
          ...(resolution.kind ? { kind: resolution.kind } : {}),
          ...(resolution.accountId !== undefined ? { accountId: resolution.accountId } : {}),
          ...(resolution.docType ? { docType: resolution.docType } : {}),
          needsReview: false,
          question: null,
          reasons: [...document.reasons, "confirmado manualmente"],
          confidence: 1,
        }
      : document,
  );

  const next: PeriodDocuments = { period, documents };
  const target = manifestPath(period);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function toRegistered(
  document: IngestedDocument,
  period: string,
  uploadedAt: string,
): RegisteredDocument {
  const recognition = document.recognition;
  return {
    hash: document.hash,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    storagePath: document.storagePath,
    period: recognition?.period ?? period,
    kind: recognition?.kind ?? "unknown",
    accountId: recognition?.accountId ?? null,
    docType: recognition?.docType ?? "other",
    amountCents: recognition?.amountCents ?? null,
    confidence: recognition?.confidence ?? 0,
    reasons: recognition?.reasons ?? [],
    needsReview: recognition?.needsReview ?? true,
    question: recognition?.question?.message ?? null,
    uploadedAt,
  };
}

/**
 * Documentos justificativos utilizables por el motor de conciliación.
 *
 * Solo entran los que son justificantes. Los extractos, la cuenta de cash y los
 * Excels de ventas son fuentes de movimientos, no pruebas documentales, y se
 * procesan por otra vía.
 */
export function toSupportingDocuments(registry: PeriodDocuments): SupportingDocument[] {
  return registry.documents
    .filter((d) => d.kind === "supporting_document")
    .map((d) => ({
      id: d.hash,
      docType: d.docType as SupportingDocument["docType"],
      issuer: issuerFromFileName(d.fileName),
      reference: null,
      date: d.period ? `${d.period}-01` : "",
      amountCents: d.amountCents,
      period: d.period,
      document: {
        name: d.fileName,
        docType: d.docType as SupportingDocument["docType"],
        driveFileId: null,
        url: null,
        localPath: d.storagePath,
        issuer: issuerFromFileName(d.fileName),
        date: d.period ? `${d.period}-01` : null,
        amountCents: d.amountCents,
      },
      source: {
        kind: "supporting_document",
        file: d.fileName,
        raw: d.storagePath,
      },
    }));
}

const MONTHS_RE =
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gi;

/** Emisor probable a partir del nombre: sin prefijo, sin mes, sin extensión. */
export function issuerFromFileName(fileName: string): string {
  let text = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  text = text.replace(/^[GI][_\s-]+/i, "");
  text = text.replace(/\(\d+\)\s*$/, "");
  text = text.replace(MONTHS_RE, "");
  text = text.replace(/\b20\d{2}\b|\b2\d\b/g, "").replace(/[_-]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return text.length >= 3 ? text : fileName;
}
