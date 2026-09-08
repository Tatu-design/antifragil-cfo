/**
 * Descubrimiento de archivos de un periodo en la zona local de trabajo.
 *
 * En esta fase las fuentes de MOVIMIENTOS son archivos locales (rápido y
 * determinista). Los DOCUMENTOS justificativos vendrán del índice de Drive,
 * pero también pueden dejarse en local mientras esa integración no esté lista:
 * ambas rutas alimentan la misma estructura, así que el motor no cambia.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK } from "../finance/accounts";
import { normalizeText } from "../finance/text";
import type { SourceKind } from "../finance/types";
import { TABULAR_EXTENSIONS } from "./workbook";

/**
 * Carpeta esperada dentro del periodo → tipo de fuente y cuenta.
 *
 * La cuenta se deduce de la carpeta y no del contenido: es explícito, no
 * ambiguo, y evita tener que reconocer el IBAN de cada entidad.
 */
export const SOURCE_FOLDERS: Record<string, { kind: SourceKind; accountId: string | null }> = {
  bank_sl: { kind: "bank_statement", accountId: ACCOUNT_SL_BANK },
  bank_sc: { kind: "bank_statement", accountId: ACCOUNT_SC_BANK },
  cash_account: { kind: "cash_account", accountId: ACCOUNT_CASH },
  clinic_bank: { kind: "clinic_bank_sales", accountId: null },
  clinic_cash: { kind: "clinic_cash_sales", accountId: null },
  documents: { kind: "supporting_document", accountId: null },
  // Cierre manual previo del mes. NO entra en el ledger: solo se usa como
  // referencia de contraste en el comando `compare`.
  manual_close: { kind: "manual", accountId: null },
};

export interface SourceFile {
  /** Ruta absoluta en disco. */
  absolutePath: string;
  /** Ruta relativa a la carpeta del periodo, para informes legibles. */
  relativePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  /** Tipo de fuente deducido de la carpeta y, en su defecto, del nombre. */
  kind: SourceKind | "unknown";
  /** Cuenta de tesorería de la que procede, cuando aplica. */
  accountId: string | null;
  /** Cómo se ha deducido el tipo. Para el informe de inspección. */
  kindReason: string;
  /** True si el motor puede leerlo como tabla. */
  tabular: boolean;
}

export interface DiscoveryResult {
  period: string;
  root: string;
  files: SourceFile[];
  /** Carpetas esperadas que no existen o están vacías. */
  missingFolders: string[];
  /** Archivos cuyo tipo no ha podido deducirse con seguridad. */
  unclassified: SourceFile[];
}

/** Escanea la carpeta de un periodo y clasifica todo lo que encuentra. */
export async function discoverPeriodFiles(
  periodRoot: string,
  period: string,
): Promise<DiscoveryResult> {
  const files: SourceFile[] = [];
  const missingFolders: string[] = [];

  for (const [folder, config] of Object.entries(SOURCE_FOLDERS)) {
    const folderPath = path.join(periodRoot, folder);
    const found = await walk(folderPath, periodRoot);
    if (found.length === 0) {
      missingFolders.push(folder);
      continue;
    }
    for (const file of found) {
      files.push({
        ...file,
        kind: config.kind,
        accountId: config.accountId,
        kindReason: `carpeta "${folder}/"`,
      });
    }
  }

  // Archivos sueltos en la raíz del periodo: se intenta deducir por el nombre.
  for (const file of await walk(periodRoot, periodRoot, 0)) {
    const guess = guessKindFromName(file.fileName);
    files.push({ ...file, kind: guess.kind, accountId: guess.accountId, kindReason: guess.reason });
  }

  return {
    period,
    root: periodRoot,
    files,
    missingFolders,
    unclassified: files.filter((f) => f.kind === "unknown"),
  };
}

/**
 * Deducción del tipo por el nombre del archivo.
 *
 * Las convenciones documentales (G_ gasto, I_ ingreso) son una señal auxiliar,
 * nunca la única prueba. Ante la duda devuelve "unknown" para que aparezca en
 * el informe y lo confirme una persona.
 */
export function guessKindFromName(fileName: string): {
  kind: SourceKind | "unknown";
  accountId: string | null;
  reason: string;
} {
  const normalized = normalizeText(fileName);

  if (normalized.includes("extracto") || normalized.includes("movimientos cuenta")) {
    // Un extracto suelto no dice a qué cuenta pertenece: mejor pedir que se
    // coloque en su carpeta que adivinar la entidad legal.
    const accountId = normalized.includes(" sc") || normalized.includes("sociedad civil")
      ? ACCOUNT_SC_BANK
      : normalized.includes(" sl")
        ? ACCOUNT_SL_BANK
        : null;
    return {
      kind: accountId ? "bank_statement" : "unknown",
      accountId,
      reason: accountId
        ? 'el nombre contiene "extracto" y la entidad (SL/SC)'
        : 'el nombre contiene "extracto" pero no indica la cuenta: colócalo en bank_sl/ o bank_sc/',
    };
  }
  if (normalized.includes("cuenta de cash") || normalized.includes("caja")) {
    return { kind: "cash_account", accountId: ACCOUNT_CASH, reason: "el nombre apunta a la cuenta de cash" };
  }
  if (normalized.includes("ventas clinica") && normalized.includes("banco")) {
    return { kind: "clinic_bank_sales", accountId: null, reason: 'el nombre contiene "ventas clínica ... banco"' };
  }
  if (
    normalized.includes("ventas clinica") &&
    (normalized.includes("cash") || normalized.includes("efectivo"))
  ) {
    return { kind: "clinic_cash_sales", accountId: null, reason: 'el nombre contiene "ventas clínica ... cash"' };
  }
  if (/^[gi][\s_-]/.test(normalized)) {
    return {
      kind: "supporting_document",
      accountId: null,
      reason: 'prefijo "G_"/"I_" (convención documental)',
    };
  }
  return {
    kind: "unknown",
    accountId: null,
    reason: "no ha podido deducirse del nombre; requiere confirmación",
  };
}

type RawFile = Omit<SourceFile, "kind" | "kindReason" | "accountId">;

/** Recorre un directorio. `maxDepth` 0 = solo el propio nivel, sin subcarpetas. */
async function walk(dir: string, base: string, maxDepth = 5, depth = 0): Promise<RawFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: RawFile[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) files.push(...(await walk(absolutePath, base, maxDepth, depth + 1)));
      continue;
    }
    if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
    if (entry.name.toLowerCase() === "readme.md") continue;

    const info = await stat(absolutePath);
    const extension = path.extname(entry.name).toLowerCase();
    files.push({
      absolutePath,
      relativePath: path.relative(base, absolutePath).split(path.sep).join("/"),
      fileName: entry.name,
      extension,
      sizeBytes: info.size,
      tabular: TABULAR_EXTENSIONS.has(extension),
    });
  }
  return files;
}
