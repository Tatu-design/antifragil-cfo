/**
 * Ingesta de un lote de documentos.
 *
 * El usuario arrastra 40 archivos y espera un resumen, no un formulario por
 * archivo. Esto es lo que convierte un puñado de bytes en documentos del
 * sistema:
 *
 *   archivo → huella → ¿ya existe? → reconocer → almacenar → registrar
 *
 * Idempotencia: la identidad de un documento es su contenido (SHA-256), no su
 * nombre. Volver a subir exactamente el mismo archivo no crea nada nuevo, y se
 * reporta como duplicado ignorado.
 */

import { contentHash, storagePath } from "./hash";
import { isAcceptedFile, recognizeFile, type Recognition } from "./recognize";
import type { DocumentStorage } from "./storage";
import { parseCsv, detectDelimiter, type SheetData } from "../sources/workbook";

/** Un archivo tal y como llega de la interfaz. */
export interface IncomingFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type IngestOutcome =
  /** Reconocido con evidencia suficiente y almacenado. */
  | "recognized"
  /** Almacenado, pero hace falta que una persona confirme algo. */
  | "needs_review"
  /** Ya estaba: mismo contenido exacto. No se duplica. */
  | "duplicate"
  /** Formato no admitido o archivo ilegible. */
  | "rejected";

export interface IngestedDocument {
  /** Identidad estable del documento: su huella de contenido. */
  hash: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  outcome: IngestOutcome;
  recognition: Recognition | null;
  /** Motivo del rechazo, si lo hubo. */
  error?: string;
}

export interface IngestSummary {
  period: string;
  received: number;
  recognized: number;
  needsReview: number;
  duplicates: number;
  rejected: number;
  documents: IngestedDocument[];
  /** Nombre del almacén usado, para el informe técnico. */
  storage: string;
}

export interface IngestOptions {
  period: string;
  storage: DocumentStorage;
  /** Huellas ya conocidas del periodo. Base de la detección de duplicados. */
  knownHashes?: Set<string>;
  /**
   * Cuenta forzada por el usuario. Solo se usa cuando ha respondido a la
   * pregunta "¿este extracto es de la SL o de la SC?".
   */
  forcedAccountId?: string | null;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function ingestFiles(
  files: IncomingFile[],
  options: IngestOptions,
): Promise<IngestSummary> {
  const known = new Set(options.knownHashes ?? []);
  const documents: IngestedDocument[] = [];

  for (const file of files) {
    documents.push(await ingestOne(file, options, known));
  }

  return {
    period: options.period,
    received: files.length,
    recognized: documents.filter((d) => d.outcome === "recognized").length,
    needsReview: documents.filter((d) => d.outcome === "needs_review").length,
    duplicates: documents.filter((d) => d.outcome === "duplicate").length,
    rejected: documents.filter((d) => d.outcome === "rejected").length,
    documents,
    storage: options.storage.name,
  };
}

async function ingestOne(
  file: IncomingFile,
  options: IngestOptions,
  known: Set<string>,
): Promise<IngestedDocument> {
  const base = {
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.bytes.byteLength,
  };

  if (!isAcceptedFile(file.fileName, file.mimeType)) {
    return {
      ...base,
      hash: "",
      storagePath: "",
      outcome: "rejected",
      recognition: null,
      error: "Formato no admitido. Se aceptan PDF, XLSX y CSV.",
    };
  }

  if (file.bytes.byteLength === 0) {
    return { ...base, hash: "", storagePath: "", outcome: "rejected", recognition: null, error: "El archivo está vacío." };
  }

  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    return {
      ...base,
      hash: "",
      storagePath: "",
      outcome: "rejected",
      recognition: null,
      error: `El archivo supera el máximo admitido (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`,
    };
  }

  const hash = contentHash(file.bytes);

  // Duplicado exacto: mismo contenido, aunque el nombre sea distinto.
  if (known.has(hash)) {
    return {
      ...base,
      hash,
      storagePath: storagePath(options.period, hash, file.fileName),
      outcome: "duplicate",
      recognition: null,
    };
  }
  known.add(hash);

  const recognition = recognizeFile(
    {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      sheets: safeParseSheets(file),
    },
    options.period,
  );

  // El usuario ya ha contestado a qué cuenta pertenece el extracto.
  if (options.forcedAccountId && recognition.kind === "bank_statement") {
    recognition.accountId = options.forcedAccountId;
    recognition.needsReview = false;
    recognition.question = null;
    recognition.reasons.push("cuenta indicada por el usuario");
  }

  const target = storagePath(options.period, hash, file.fileName);
  let stored;
  try {
    stored = await options.storage.put(target, file.bytes);
  } catch (error) {
    return {
      ...base,
      hash,
      storagePath: target,
      outcome: "rejected",
      recognition,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // El almacén ya lo tenía: es el mismo documento subido otra vez.
  if (stored.alreadyExisted) {
    return { ...base, hash, storagePath: target, outcome: "duplicate", recognition };
  }

  return {
    ...base,
    hash,
    storagePath: target,
    outcome: recognition.needsReview ? "needs_review" : "recognized",
    recognition,
  };
}

/**
 * Lee las primeras filas de un CSV para poder reconocer su estructura.
 *
 * Solo CSV: abrir un XLSX aquí obligaría a cargar ExcelJS por cada archivo del
 * lote. Para XLSX, la estructura se analiza al procesar el mes, y el
 * reconocimiento se apoya en nombre y extensión, que en la práctica bastan.
 */
function safeParseSheets(file: IncomingFile): SheetData[] | undefined {
  if (!/\.csv$/i.test(file.fileName) && file.mimeType !== "text/csv") return undefined;
  try {
    const text = new TextDecoder("utf-8").decode(file.bytes.slice(0, 64 * 1024));
    const rows = parseCsv(text, detectDelimiter(text)).slice(0, 30);
    return [{ name: file.fileName, rows }];
  } catch {
    return undefined;
  }
}

/** Texto del resumen de carga, en el lenguaje del usuario. */
export function summaryHeadline(summary: IngestSummary): string[] {
  const lines = [`${summary.received} documento${summary.received === 1 ? "" : "s"} recibido${summary.received === 1 ? "" : "s"}`];
  if (summary.recognized > 0) lines.push(`${summary.recognized} reconocido${summary.recognized === 1 ? "" : "s"}`);
  if (summary.needsReview > 0) {
    lines.push(`${summary.needsReview} necesita${summary.needsReview === 1 ? "" : "n"} revisión`);
  }
  if (summary.duplicates > 0) {
    lines.push(`${summary.duplicates} duplicado${summary.duplicates === 1 ? "" : "s"} ignorado${summary.duplicates === 1 ? "" : "s"}`);
  }
  if (summary.rejected > 0) lines.push(`${summary.rejected} no admitido${summary.rejected === 1 ? "" : "s"}`);
  return lines;
}
