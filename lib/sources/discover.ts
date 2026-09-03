/**
 * Descubrimiento de archivos de un periodo en la zona local de trabajo.
 *
 * En esta fase las fuentes son archivos locales (rápido y determinista). La
 * integración con Google Drive vendrá después y alimentará exactamente la misma
 * estructura `SourceFile`, de modo que el motor no tenga que cambiar.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "../finance/text";
import type { SourceKind } from "../finance/types";
import { TABULAR_EXTENSIONS } from "./workbook";

/** Carpeta esperada dentro del periodo para cada tipo de fuente. */
export const SOURCE_FOLDERS: Record<string, SourceKind> = {
  bank: "bank_statement",
  expenses: "expense_invoice",
  income: "income_document",
  clinic_bank: "clinic_bank_sales",
  clinic_cash: "clinic_cash_sales",
  cash_account: "cash_account",
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

  for (const folder of Object.keys(SOURCE_FOLDERS)) {
    const folderPath = path.join(periodRoot, folder);
    const found = await walk(folderPath, periodRoot);
    if (found.length === 0) {
      missingFolders.push(folder);
      continue;
    }
    for (const file of found) {
      files.push({
        ...file,
        kind: SOURCE_FOLDERS[folder],
        kindReason: `carpeta "${folder}/"`,
      });
    }
  }

  // Archivos sueltos en la raíz del periodo: se intenta deducir por el nombre.
  for (const file of await walk(periodRoot, periodRoot, 0)) {
    const guess = guessKindFromName(file.fileName);
    files.push({ ...file, kind: guess.kind, kindReason: guess.reason });
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
export function guessKindFromName(fileName: string): { kind: SourceKind | "unknown"; reason: string } {
  const normalized = normalizeText(fileName);

  if (normalized.includes("extracto") || normalized.includes("movimientos cuenta")) {
    return { kind: "bank_statement", reason: 'el nombre contiene "extracto"' };
  }
  if (normalized.includes("cuenta de cash") || normalized.includes("caja")) {
    return { kind: "cash_account", reason: 'el nombre apunta a la cuenta de cash' };
  }
  if (normalized.includes("ventas clinica") && normalized.includes("banco")) {
    return { kind: "clinic_bank_sales", reason: 'el nombre contiene "ventas clínica ... banco"' };
  }
  if (normalized.includes("ventas clinica") && (normalized.includes("cash") || normalized.includes("efectivo"))) {
    return { kind: "clinic_cash_sales", reason: 'el nombre contiene "ventas clínica ... cash"' };
  }
  if (/^g[\s_-]/.test(normalized)) {
    return { kind: "expense_invoice", reason: 'prefijo "G_" (convención documental de gasto)' };
  }
  if (/^i[\s_-]/.test(normalized)) {
    return { kind: "income_document", reason: 'prefijo "I_" (convención documental de ingreso)' };
  }
  return { kind: "unknown", reason: "no ha podido deducirse del nombre; requiere confirmación" };
}

type RawFile = Omit<SourceFile, "kind" | "kindReason">;

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
