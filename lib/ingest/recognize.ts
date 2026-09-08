/**
 * Reconocimiento automático de un archivo subido.
 *
 * El usuario arrastra 40 documentos y no debería etiquetar ninguno. Aquí se
 * decide qué es cada archivo combinando señales deterministas:
 *
 *   nombre · extensión/MIME · prefijos G_/I_ · periodo en el nombre ·
 *   importe en el nombre · estructura tabular · contenido cuando es fiable
 *
 * PRINCIPIO: ninguna señal por sí sola manda. Se acumulan, y si la evidencia no
 * alcanza el umbral, el archivo queda `needs_review` para que se resuelva desde
 * la interfaz. Adivinar mal el tipo de un documento es peor que preguntar.
 */

import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK } from "../finance/accounts";
import { normalizeText } from "../finance/text";
import type { DocumentType, SourceKind } from "../finance/types";
import { detectTable } from "../sources/table";
import type { SheetData } from "../sources/workbook";

/** Qué papel juega el archivo en el sistema. */
export type RecognizedKind = SourceKind | "unknown";

export interface RecognitionInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Primeras filas del archivo si es tabular. Permite distinguir un extracto
   * (fecha + concepto + importe, muchas filas) de un índice de documentos
   * (proveedor + nº de factura).
   */
  sheets?: SheetData[];
  /** Texto extraído, cuando se pueda obtener de forma fiable. */
  textSample?: string | null;
}

export interface Recognition {
  kind: RecognizedKind;
  /** Cuenta de tesorería, cuando aplica y se ha podido determinar. */
  accountId: string | null;
  /** Periodo YYYY-MM deducido del nombre o del contenido. */
  period: string | null;
  /** Tipo documental, para los justificantes. */
  docType: DocumentType;
  /** Importe deducido del nombre, en céntimos. `null` si no aparece. */
  amountCents: number | null;
  /** Confianza acumulada en [0, 1]. */
  confidence: number;
  /** Señales que han llevado a esta conclusión. Se muestran al usuario. */
  reasons: string[];
  /** True si hace falta que una persona confirme algo. */
  needsReview: boolean;
  /** Qué hay que preguntar exactamente, si needsReview. */
  question: RecognitionQuestion | null;
}

export type RecognitionQuestion =
  /** Sabemos que es un extracto pero no de qué cuenta. */
  | { type: "account"; message: string }
  /** No sabemos qué es el archivo. */
  | { type: "kind"; message: string }
  /** Sabemos qué es, pero no de qué mes. */
  | { type: "period"; message: string };

/** Umbral por debajo del cual no se da por buena la deducción. */
const CONFIDENCE_THRESHOLD = 0.6;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

export function recognizeFile(input: RecognitionInput, fallbackPeriod: string): Recognition {
  const reasons: string[] = [];
  const name = normalizeText(input.fileName);
  const isTabular = isSpreadsheet(input);

  const period = detectPeriod(input, reasons);
  const amountCents = detectAmount(input.fileName, reasons);

  // ── 1 · Fuentes de movimientos, que son las que más importa acertar ───────
  const source = detectMovementSource(input, name, isTabular, reasons);
  if (source) {
    const needsAccount = source.kind === "bank_statement" && source.accountId === null;
    return {
      kind: source.kind,
      accountId: source.accountId,
      period: period ?? fallbackPeriod,
      docType: source.kind === "cash_account" ? "other" : "sales_sheet",
      amountCents,
      confidence: source.confidence,
      reasons,
      needsReview: needsAccount || source.confidence < CONFIDENCE_THRESHOLD,
      question: needsAccount
        ? {
            type: "account",
            message: "Parece un extracto bancario, pero no se ha podido determinar si es de la SL o de la SC.",
          }
        : source.confidence < CONFIDENCE_THRESHOLD
          ? { type: "kind", message: "No hay evidencia suficiente sobre qué contiene este archivo." }
          : null,
    };
  }

  // ── 2 · Documentos justificativos ─────────────────────────────────────────
  const doc = detectDocumentType(input, name, reasons);
  const confidence = doc.confidence + (period ? 0.1 : 0) + (amountCents !== null ? 0.1 : 0);
  const enough = confidence >= CONFIDENCE_THRESHOLD;

  return {
    kind: enough ? "supporting_document" : "unknown",
    accountId: null,
    period: period ?? fallbackPeriod,
    docType: doc.docType,
    amountCents,
    confidence: Math.min(1, confidence),
    reasons,
    needsReview: !enough,
    question: enough
      ? null
      : {
          type: "kind",
          message: "No se ha podido determinar qué es este archivo con seguridad suficiente.",
        },
  };
}

// ── Fuentes de movimientos ──────────────────────────────────────────────────

interface SourceDetection {
  kind: SourceKind;
  accountId: string | null;
  confidence: number;
}

function detectMovementSource(
  input: RecognitionInput,
  name: string,
  isTabular: boolean,
  reasons: string[],
): SourceDetection | null {
  // Ventas de clínica: el nombre es muy característico y la confusión con un
  // extracto sería grave, así que se comprueba primero.
  if (name.includes("ventas") && name.includes("clinica")) {
    if (name.includes("banco") || name.includes("datafono")) {
      reasons.push('el nombre indica ventas de clínica cobradas por banco/datáfono');
      return { kind: "clinic_bank_sales", accountId: null, confidence: 0.95 };
    }
    if (name.includes("cash") || name.includes("efectivo") || name.includes("metalico")) {
      reasons.push("el nombre indica ventas de clínica cobradas en efectivo");
      return { kind: "clinic_cash_sales", accountId: null, confidence: 0.95 };
    }
  }

  if (name.includes("cuenta de cash") || name.includes("cuenta cash") || name.includes("caja")) {
    reasons.push("el nombre apunta a la cuenta de cash");
    return { kind: "cash_account", accountId: ACCOUNT_CASH, confidence: 0.9 };
  }

  const looksLikeStatementName =
    name.includes("extracto") ||
    name.includes("movimientos") ||
    name.includes("bbva") ||
    name.includes("santander") ||
    name.includes("caixa") ||
    name.includes("sabadell");

  const looksLikeStatementTable = isTabular && hasStatementShape(input.sheets);

  if (looksLikeStatementName || looksLikeStatementTable) {
    if (looksLikeStatementName) reasons.push("el nombre apunta a un extracto bancario");
    if (looksLikeStatementTable) {
      reasons.push("la estructura tabular es la de un extracto (fecha, concepto e importe)");
    }
    const account = detectAccount(input, name, reasons);
    return {
      kind: "bank_statement",
      accountId: account,
      // Nombre y estructura coincidiendo es prueba fuerte; una sola, aceptable.
      confidence: looksLikeStatementName && looksLikeStatementTable ? 0.95 : 0.75,
    };
  }

  return null;
}

/**
 * ¿La tabla tiene forma de extracto?
 *
 * Un extracto trae fecha, concepto e importe, y muchas filas. Un índice de
 * documentos trae proveedor o número de factura. La diferencia está en las
 * columnas, no en el nombre del archivo.
 */
function hasStatementShape(sheets: SheetData[] | undefined): boolean {
  if (!sheets || sheets.length === 0) return false;

  for (const sheet of sheets) {
    const map = detectTable(sheet);
    if (map.headerRowIndex < 0) continue;

    const hasDate = map.byRole.date !== undefined;
    const hasConcept = map.byRole.concept !== undefined;
    const hasAmount =
      map.byRole.amount !== undefined ||
      (map.byRole.debit !== undefined && map.byRole.credit !== undefined);
    const hasSupplier = map.byRole.supplier !== undefined || map.byRole.invoiceNumber !== undefined;

    if (hasDate && hasConcept && hasAmount && !hasSupplier) return true;
  }
  return false;
}

/**
 * ¿De qué cuenta es este extracto?
 *
 * Se busca la entidad legal en el nombre y el IBAN en el contenido. Si no hay
 * evidencia clara devuelve null: es preferible una pregunta a asignar el
 * extracto de la SC a la SL, que contaminaría dos tesorerías a la vez.
 */
function detectAccount(input: RecognitionInput, name: string, reasons: string[]): string | null {
  if (/\bsl\b/.test(name) || name.includes("sociedad limitada")) {
    reasons.push('el nombre identifica la cuenta de la SL');
    return ACCOUNT_SL_BANK;
  }
  if (/\bsc\b/.test(name) || name.includes("sociedad civil")) {
    reasons.push('el nombre identifica la cuenta de la SC');
    return ACCOUNT_SC_BANK;
  }

  // IBAN en el contenido. Los últimos dígitos de cada cuenta se configuran con
  // variables de entorno: no se codifican datos bancarios en el repositorio.
  const iban = findIban(input);
  if (iban) {
    const slTail = process.env.ANTIFRAGIL_IBAN_SL_TAIL?.trim();
    const scTail = process.env.ANTIFRAGIL_IBAN_SC_TAIL?.trim();
    if (slTail && iban.endsWith(slTail)) {
      reasons.push("el IBAN del archivo corresponde a la cuenta de la SL");
      return ACCOUNT_SL_BANK;
    }
    if (scTail && iban.endsWith(scTail)) {
      reasons.push("el IBAN del archivo corresponde a la cuenta de la SC");
      return ACCOUNT_SC_BANK;
    }
    reasons.push("se ha encontrado un IBAN, pero no coincide con ninguna cuenta configurada");
  }

  return null;
}

function findIban(input: RecognitionInput): string | null {
  const haystack = [
    input.fileName,
    input.textSample ?? "",
    ...(input.sheets ?? []).flatMap((sheet) =>
      sheet.rows.slice(0, 15).flatMap((row) => row.map((cell) => String(cell ?? ""))),
    ),
  ].join(" ");

  const match = /ES\d{2}[\s-]?(?:\d{4}[\s-]?){4}\d{4}/i.exec(haystack);
  return match ? match[0].replace(/[\s-]/g, "").toUpperCase() : null;
}

// ── Documentos justificativos ───────────────────────────────────────────────

function detectDocumentType(
  input: RecognitionInput,
  name: string,
  reasons: string[],
): { docType: DocumentType; confidence: number } {
  const haystack = `${name} ${normalizeText(input.textSample ?? "")}`;

  const rules: Array<{ type: DocumentType; words: string[]; label: string; weight: number }> = [
    { type: "payroll", words: ["nomina"], label: 'contiene "nómina"', weight: 0.8 },
    { type: "social_security", words: ["seguridad social"], label: "Seguridad Social", weight: 0.8 },
    { type: "social_security", words: ["rnt"], label: "documento RNT", weight: 0.7 },
    { type: "social_security", words: ["rlc"], label: "documento RLC", weight: 0.7 },
    { type: "tax", words: ["modelo"], label: 'contiene "modelo"', weight: 0.7 },
    { type: "tax", words: ["impuesto"], label: 'contiene "impuesto"', weight: 0.75 },
    { type: "tax", words: ["aeat"], label: "AEAT", weight: 0.8 },
    { type: "receipt", words: ["recibo"], label: 'contiene "recibo"', weight: 0.7 },
    { type: "contract", words: ["contrato"], label: 'contiene "contrato"', weight: 0.7 },
    { type: "invoice", words: ["factura"], label: 'contiene "factura"', weight: 0.8 },
    { type: "invoice", words: ["fra"], label: 'abreviatura "fra"', weight: 0.6 },
  ];

  for (const rule of rules) {
    if (rule.words.every((w) => haystack.includes(w))) {
      reasons.push(rule.label);
      return { docType: rule.type, confidence: rule.weight };
    }
  }

  // Convención documental de Antifrágil: G_ gasto, I_ ingreso. Es una señal
  // auxiliar fuerte porque la usa el propio equipo al nombrar los archivos.
  if (/^g[\s_-]/.test(name)) {
    reasons.push('prefijo "G_" (convención de gasto)');
    return { docType: "invoice", confidence: 0.7 };
  }
  if (/^i[\s_-]/.test(name)) {
    reasons.push('prefijo "I_" (convención de ingreso)');
    return { docType: "invoice", confidence: 0.7 };
  }

  if (input.mimeType === "application/pdf") {
    reasons.push("es un PDF sin señales claras de su tipo");
    return { docType: "other", confidence: 0.35 };
  }

  reasons.push("no hay señales reconocibles en el nombre ni en el contenido");
  return { docType: "other", confidence: 0.2 };
}

// ── Señales transversales ───────────────────────────────────────────────────

/** Periodo en el nombre: "Septiembre 26", "2026-09", "09-2026"… */
export function detectPeriod(input: RecognitionInput, reasons: string[]): string | null {
  const name = normalizeText(input.fileName);

  const iso = /\b(20\d{2})[-_](0[1-9]|1[0-2])\b/.exec(name);
  if (iso) {
    reasons.push(`periodo ${iso[1]}-${iso[2]} en el nombre`);
    return `${iso[1]}-${iso[2]}`;
  }

  const monthIndex = MONTHS.findIndex((m) => name.includes(m));
  if (monthIndex >= 0) {
    const month = String(monthIndex + 1).padStart(2, "0");
    const fullYear = /\b(20\d{2})\b/.exec(name);
    if (fullYear) {
      reasons.push(`mes y año en el nombre (${MONTHS[monthIndex]} ${fullYear[1]})`);
      return `${fullYear[1]}-${month}`;
    }
    const shortYear = /\b(2\d)\b/.exec(name);
    if (shortYear) {
      reasons.push(`mes y año abreviado en el nombre (${MONTHS[monthIndex]} ${shortYear[1]})`);
      return `20${shortYear[1]}-${month}`;
    }
  }

  return null;
}

/**
 * Importe en el nombre.
 *
 * La convención "(5025)" para 50,25 € es frágil, así que solo se acepta cuando
 * es inequívoca y queda registrada como inferencia. Si no aparece, `null`.
 */
export function detectAmount(fileName: string, reasons: string[]): number | null {
  const parenthesised = /\((\d{3,7})\)/.exec(fileName);
  if (parenthesised) {
    reasons.push(`importe deducido del sufijo "(${parenthesised[1]})"`);
    return Number(parenthesised[1]);
  }

  const explicit = /(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*(?:€|eur)/i.exec(fileName);
  if (explicit) {
    const cents = Math.round(Number(explicit[1].replace(/[.\s]/g, "").replace(",", ".")) * 100);
    if (Number.isFinite(cents)) {
      reasons.push("importe explícito en el nombre");
      return cents;
    }
  }

  return null;
}

function isSpreadsheet(input: RecognitionInput): boolean {
  if (SPREADSHEET_MIMES.has(input.mimeType)) return true;
  return /\.(xlsx|xlsm|xls|csv)$/i.test(input.fileName);
}

/** Extensiones aceptadas en la carga. */
export const ACCEPTED_EXTENSIONS = [".pdf", ".xlsx", ".xlsm", ".xls", ".csv"];

export function isAcceptedFile(fileName: string, mimeType: string): boolean {
  if (mimeType === "application/pdf") return true;
  if (SPREADSHEET_MIMES.has(mimeType)) return true;
  return ACCEPTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
}
