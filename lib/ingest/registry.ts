import type { SupportingDocument } from "../finance/types";

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
 * Este módulo define la FORMA del registro y las funciones puras que lo
 * transforman. Dónde se guarda (Supabase o disco local) lo decide
 * `lib/repositories/`.
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
  uploadedBy: string | null;
}

export interface PeriodDocuments {
  period: string;
  documents: RegisteredDocument[];
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
