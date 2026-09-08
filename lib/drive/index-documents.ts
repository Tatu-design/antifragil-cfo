/**
 * Sincronización e indexación de documentos de Drive.
 *
 * Reglas de esta capa:
 *   - Se navega SOLO la rama del periodo: Año → Trimestre → Tipo → Mes.
 *     Nunca se recorre todo Drive.
 *   - Es idempotente: sincronizar dos veces produce el mismo índice, y la clave
 *     es el `driveFileId`, que Drive garantiza estable.
 *   - Lo que no se puede deducir se deja `null`. Nunca se inventa un importe,
 *     un emisor ni un periodo.
 */

import { parseAmountToCents } from "../finance/money";
import { normalizeText } from "../finance/text";
import type { DocumentType, SupportingDocument } from "../finance/types";
import type { DriveClient, DriveFile, DriveFolder, IndexedDocument, SyncResult } from "./types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface SyncOptions {
  /** Carpeta raíz financiera de Drive. */
  rootFolderId: string;
  /** Periodo a sincronizar, YYYY-MM. */
  period: string;
  /** Profundidad máxima de navegación desde la raíz. */
  maxDepth?: number;
  /** Reloj inyectable: la hora no debe hacer irreproducibles los tests. */
  now?: () => Date;
}

/**
 * Recorre la rama del periodo e indexa sus documentos.
 *
 * La estructura real es Año → Trimestre → Tipo de documento → Mes, pero los
 * nombres varían ("DocumentaciónAF-Q32026", "2. Facturas", "5. Agosto"). En vez
 * de codificar esos nombres, se navega por coincidencia: se entra en las
 * carpetas cuyo nombre es compatible con el periodo (año, trimestre o mes) o
 * que son genéricas de tipo documental.
 */
export async function syncPeriodDocuments(
  client: DriveClient,
  options: SyncOptions,
): Promise<SyncResult> {
  const { rootFolderId, period } = options;
  const maxDepth = options.maxDepth ?? 5;
  const now = options.now ?? (() => new Date());
  const syncedAt = now().toISOString();

  const documents: IndexedDocument[] = [];
  const visitedFolders: DriveFolder[] = [];
  const problems: string[] = [];
  const seenFolderIds = new Set<string>();

  async function walk(folderId: string, path: string, depth: number): Promise<void> {
    if (depth > maxDepth || seenFolderIds.has(folderId)) return;
    seenFolderIds.add(folderId);
    visitedFolders.push({ id: folderId, name: path.split("/").pop() ?? "", path });

    let files: DriveFile[];
    try {
      files = await client.listFiles(folderId);
    } catch (error) {
      problems.push(`No se ha podido listar "${path}": ${String(error)}`);
      return;
    }

    for (const file of files) {
      if (file.mimeType === FOLDER_MIME) continue;
      documents.push(indexFile(file, path, period, syncedAt));
    }

    let folders: DriveFile[];
    try {
      folders = await client.listFolders(folderId);
    } catch (error) {
      problems.push(`No se han podido listar las subcarpetas de "${path}": ${String(error)}`);
      return;
    }

    for (const folder of folders) {
      if (!folderMatchesPeriod(folder.name, period)) continue;
      await walk(folder.id, path === "" ? folder.name : `${path}/${folder.name}`, depth + 1);
    }
  }

  await walk(rootFolderId, "", 0);

  if (documents.length === 0) {
    problems.push(
      `No se ha indexado ningún documento para ${period}. Revisa la raíz financiera y la estructura de carpetas.`,
    );
  }

  return { rootFolderId, period, documents, visitedFolders, problems };
}

/**
 * ¿Merece la pena entrar en esta carpeta buscando el periodo?
 *
 * Se entra si el nombre menciona el año, el trimestre o el mes del periodo, o
 * si es una carpeta genérica (sin año ni mes) que probablemente sea un nivel
 * intermedio de tipo documental. Se descarta explícitamente lo que corresponde
 * a otro año, trimestre o mes: ahí está el ahorro frente a escanear todo Drive.
 */
export function folderMatchesPeriod(folderName: string, period: string): boolean {
  const normalized = normalizeText(folderName);
  const [yearText, monthText] = period.split("-");
  const monthIndex = Number(monthText);
  const quarter = Math.ceil(monthIndex / 3);

  const mentionsSomeYear = /\b20\d{2}\b/.test(normalized);
  const mentionsThisYear = normalized.includes(yearText) || normalized.includes(`q${quarter}${yearText}`);
  if (mentionsSomeYear && !mentionsThisYear) return false;

  const mentionsSomeQuarter = /\bq[1-4]\b/.test(normalized) || /q[1-4]20\d{2}/.test(normalized);
  const mentionsThisQuarter =
    normalized.includes(`q${quarter}`) || normalized.includes(`q${quarter}${yearText}`);
  if (mentionsSomeQuarter && !mentionsThisQuarter) return false;

  const mentionedMonth = MONTHS.findIndex((m) => normalized.includes(m));
  if (mentionedMonth >= 0 && mentionedMonth + 1 !== monthIndex) return false;

  // Carpeta que menciona el mes correcto, el año correcto, o ninguno de los dos
  // (nivel intermedio como "2. Facturas"): se entra.
  return true;
}

/** Deduce lo que se puede del nombre y la ruta. Lo que no, queda `null`. */
export function indexFile(
  file: DriveFile,
  folderPath: string,
  fallbackPeriod: string,
  syncedAt: string,
): IndexedDocument {
  const inferredFrom: string[] = [];
  const normalized = normalizeText(file.name);

  const docType = inferDocType(normalized, folderPath, inferredFrom);
  const period = inferPeriod(normalized, folderPath) ?? fallbackPeriod;
  if (period === fallbackPeriod) inferredFrom.push("periodo de la carpeta sincronizada");

  const amountCents = inferAmount(file.name, inferredFrom);
  const issuer = inferIssuer(file.name, inferredFrom);

  return {
    driveFileId: file.id,
    name: file.name,
    url: file.webViewLink ?? null,
    mimeType: file.mimeType,
    folderPath,
    period,
    docType,
    issuer,
    amountCents,
    inferredFrom,
    syncedAt,
    modifiedTime: file.modifiedTime ?? null,
    sizeBytes: file.size ?? null,
  };
}

function inferDocType(
  normalizedName: string,
  folderPath: string,
  inferredFrom: string[],
): DocumentType {
  const path = normalizeText(folderPath);
  const haystack = `${path} ${normalizedName}`;

  const rules: Array<{ type: DocumentType; words: string[]; label: string }> = [
    { type: "payroll", words: ["nomina"], label: 'nombre contiene "nómina"' },
    { type: "social_security", words: ["seguridad social"], label: "Seguridad Social" },
    { type: "social_security", words: ["rnt"], label: "documento RNT" },
    { type: "social_security", words: ["rlc"], label: "documento RLC" },
    { type: "tax", words: ["modelo"], label: 'nombre contiene "modelo"' },
    { type: "tax", words: ["impuesto"], label: 'nombre contiene "impuesto"' },
    { type: "tax", words: ["aeat"], label: "AEAT" },
    { type: "sales_sheet", words: ["ventas"], label: 'nombre contiene "ventas"' },
    { type: "bank_statement", words: ["extracto"], label: 'nombre contiene "extracto"' },
    { type: "receipt", words: ["recibo"], label: 'nombre contiene "recibo"' },
    { type: "contract", words: ["contrato"], label: 'nombre contiene "contrato"' },
    { type: "invoice", words: ["factura"], label: 'nombre contiene "factura"' },
    { type: "invoice", words: ["fra"], label: 'abreviatura "fra"' },
  ];

  for (const rule of rules) {
    if (rule.words.every((w) => haystack.includes(w))) {
      inferredFrom.push(rule.label);
      return rule.type;
    }
  }

  // Convención documental: G_ gasto, I_ ingreso. Señal auxiliar, no prueba.
  if (/^g[\s_-]/.test(normalizedName)) {
    inferredFrom.push('prefijo "G_" (convención de gasto)');
    return "invoice";
  }
  if (/^i[\s_-]/.test(normalizedName)) {
    inferredFrom.push('prefijo "I_" (convención de ingreso)');
    return "invoice";
  }

  return "other";
}

function inferPeriod(normalizedName: string, folderPath: string): string | null {
  const haystack = `${normalizeText(folderPath)} ${normalizedName}`;

  const monthIndex = MONTHS.findIndex((m) => haystack.includes(m));
  if (monthIndex < 0) return null;

  const fullYear = /\b(20\d{2})\b/.exec(haystack);
  if (fullYear) return `${fullYear[1]}-${String(monthIndex + 1).padStart(2, "0")}`;

  const shortYear = /\b(2\d)\b/.exec(haystack);
  if (shortYear) return `20${shortYear[1]}-${String(monthIndex + 1).padStart(2, "0")}`;

  return null;
}

/**
 * Importe en el nombre del archivo.
 *
 * Muchos documentos lo llevan entre paréntesis, p. ej. "... (5025)" para 50,25 €.
 * Es una convención frágil, así que solo se acepta cuando es inequívoca y queda
 * registrada como inferencia. Si no aparece, `null`: se conciliará por otras vías.
 */
function inferAmount(name: string, inferredFrom: string[]): number | null {
  const parenthesised = /\((\d{3,7})\)/.exec(name);
  if (parenthesised) {
    const cents = Number(parenthesised[1]);
    if (Number.isFinite(cents)) {
      inferredFrom.push(`importe deducido del sufijo "(${parenthesised[1]})" del nombre`);
      return cents;
    }
  }

  const explicit = /(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*(?:€|eur)/i.exec(name);
  if (explicit) {
    const cents = parseAmountToCents(explicit[1]);
    if (cents !== null) {
      inferredFrom.push("importe explícito en el nombre");
      return cents;
    }
  }

  return null;
}

/** Emisor deducido del nombre, quitando prefijos, periodo y extensión. */
function inferIssuer(name: string, inferredFrom: string[]): string | null {
  let text = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  text = text.replace(/^[GI][_\s-]+/i, "");
  text = text.replace(/\(\d+\)\s*$/, "");
  for (const month of MONTHS) {
    text = text.replace(new RegExp(`\\b${month}\\b`, "gi"), "");
  }
  text = text.replace(/\b20\d{2}\b|\b2\d\b/g, "").replace(/\s{2,}/g, " ").trim();

  if (text.length < 3) return null;
  inferredFrom.push("emisor deducido del nombre del archivo");
  return text;
}

/**
 * Convierte el índice en documentos justificativos utilizables por el motor.
 *
 * Un documento sin importe deducido entra igualmente: podrá conciliarse por
 * referencia en el concepto, y si no, aparecerá como documento sin movimiento
 * para revisión humana. Es preferible a descartarlo en silencio.
 */
export function toSupportingDocuments(index: IndexedDocument[]): SupportingDocument[] {
  return index.map((doc) => ({
    id: doc.driveFileId,
    docType: doc.docType,
    issuer: doc.issuer ?? doc.name,
    reference: null,
    date: doc.period ? `${doc.period}-01` : "",
    amountCents: doc.amountCents,
    period: doc.period,
    document: {
      name: doc.name,
      docType: doc.docType,
      driveFileId: doc.driveFileId,
      url: doc.url,
      mimeType: doc.mimeType,
      folderPath: doc.folderPath,
      issuer: doc.issuer,
      date: doc.period ? `${doc.period}-01` : null,
      amountCents: doc.amountCents,
    },
    source: {
      kind: "supporting_document",
      file: doc.name,
      raw: doc.folderPath,
    },
  }));
}
