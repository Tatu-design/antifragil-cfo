/**
 * Periodos contables y fechas.
 *
 * Todas las fechas del ledger viven como cadena ISO YYYY-MM-DD. No se usan
 * objetos Date en el dominio: evitan sorpresas de zona horaria al cruzar
 * documentos generados en distintos husos y herramientas.
 */

import type { Period } from "./types";

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export function assertValidPeriod(period: string): Period {
  if (!isValidPeriod(period)) {
    throw new Error(
      `Periodo inválido: "${period}". Formato esperado YYYY-MM (por ejemplo 2026-08).`,
    );
  }
  return period;
}

/** Periodo al que pertenece una fecha ISO. */
export function periodOf(isoDate: string): Period {
  return isoDate.slice(0, 7);
}

/** True si la fecha ISO cae dentro del periodo. */
export function isInPeriod(isoDate: string, period: Period): boolean {
  return periodOf(isoDate) === period;
}

/** Nombre del mes en español, para informes legibles. */
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function periodLabel(period: Period): string {
  const [year, month] = period.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? month;
  return `${name} ${year}`;
}

/** Diferencia en días entre dos fechas ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Interpreta una fecha procedente de una fuente externa.
 *
 * Soporta: Date nativo, serial de Excel, ISO, dd/mm/yyyy, dd-mm-yyyy,
 * dd.mm.yyyy y variantes con año de dos dígitos.
 *
 * Ambigüedad dd/mm vs mm/dd: se asume SIEMPRE formato español (día primero),
 * que es el de todos los documentos de Antifrágil. Devuelve null si no puede
 * interpretarse; el llamante genera SOURCE_ERROR en lugar de inventar fecha.
 */
export function parseDateToISO(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISO(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number") {
    return excelSerialToISO(value);
  }

  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;

  const iso = ISO_DATE_RE.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return validDate(Number(y), Number(m), Number(d)) ? toISO(Number(y), Number(m), Number(d)) : null;
  }

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return validDate(year, month, day) ? toISO(year, month, day) : null;
  }

  // Serial de Excel llegado como texto.
  if (/^\d+(\.\d+)?$/.test(text)) {
    return excelSerialToISO(Number(text));
  }

  return null;
}

/**
 * Convierte un serial de fecha de Excel a ISO.
 * Excel cuenta desde 1899-12-30 (incluye el bug del año bisiesto 1900).
 */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const ms = Math.round(serial * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toISO(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
