/**
 * Lectura de libros de cálculo y CSV.
 *
 * Solo lee. Nunca escribe sobre los documentos originales del negocio.
 * Devuelve una matriz de celdas en bruto: la interpretación (dónde está la
 * cabecera, qué columna es el importe) vive en `table.ts`, para poder ajustarla
 * cuando conozcamos los formatos reales sin tocar la capa de lectura.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export type CellValue = string | number | boolean | Date | null;

export interface SheetData {
  name: string;
  rows: CellValue[][];
}

export interface WorkbookData {
  file: string;
  sheets: SheetData[];
}

/** Extensiones que el motor sabe leer como tabla. */
export const TABULAR_EXTENSIONS = new Set([".xlsx", ".xlsm", ".csv"]);

export async function readWorkbook(filePath: string): Promise<WorkbookData> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") {
    return { file: filePath, sheets: [await readCsv(filePath)] };
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    return readExcel(filePath);
  }
  throw new Error(
    `Formato no soportado para lectura tabular: ${ext || "(sin extensión)"} — ${path.basename(filePath)}`,
  );
}

async function readExcel(filePath: string): Promise<WorkbookData> {
  // Import diferido: exceljs solo se carga cuando de verdad hay un .xlsx.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: SheetData[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: CellValue[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values: CellValue[] = [];
      const rowSize = row.cellCount;
      for (let col = 1; col <= rowSize; col += 1) {
        values.push(normalizeCell(row.getCell(col).value));
      }
      rows.push(values);
    });
    sheets.push({ name: worksheet.name, rows });
  });

  return { file: filePath, sheets };
}

/** Aplana los tipos que devuelve ExcelJS a valores simples del dominio. */
function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Celda con fórmula: interesa el resultado calculado, no la fórmula.
    if ("result" in obj) return normalizeCell(obj.result);
    // Error de fórmula (#REF!, #VALUE!...): se conserva como texto para poder
    // reportarlo como FORMULA_ERROR en lugar de tratarlo como celda vacía.
    if ("error" in obj) return String(obj.error);
    // Texto enriquecido.
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return obj.richText.map((part) => String((part as { text?: string }).text ?? "")).join("");
    }
    if ("text" in obj) return String(obj.text);
    if ("hyperlink" in obj) return String(obj.hyperlink);
  }
  return String(value);
}

async function readCsv(filePath: string): Promise<SheetData> {
  const content = await readFile(filePath, "utf8");
  const delimiter = detectDelimiter(content);
  return { name: path.basename(filePath), rows: parseCsv(content, delimiter) };
}

/** Elige el delimitador más frecuente en las primeras líneas. */
export function detectDelimiter(content: string): string {
  const sample = content.split(/\r?\n/).slice(0, 10).join("\n");
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parser CSV con soporte de comillas dobles y saltos de línea embebidos. */
export function parseCsv(content: string, delimiter: string): CellValue[][] {
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = "";
  let inQuotes = false;

  const text = content.replace(/^﻿/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field === "" ? null : field);
      field = "";
    } else if (char === "\n") {
      row.push(field === "" ? null : field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field === "" ? null : field);
    rows.push(row);
  }

  return rows;
}
