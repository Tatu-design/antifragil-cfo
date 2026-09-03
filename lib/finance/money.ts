/**
 * Aritmética monetaria en céntimos enteros.
 *
 * Regla del proyecto: NUNCA se opera con números en coma flotante sobre euros.
 * Todo importe vive como entero de céntimos desde que entra hasta que sale.
 */

/** Convierte céntimos a euros como número (solo para presentación). */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

/** Convierte euros (número) a céntimos enteros, redondeando al céntimo. */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Interpreta un importe procedente de una fuente externa (Excel, CSV, banco).
 *
 * Acepta números nativos y cadenas en formato español ("1.234,56 €"),
 * inglés ("1,234.56"), con signo delante o detrás, y negativos entre
 * paréntesis ("(1.234,56)").
 *
 * Devuelve `null` si el valor no es interpretable como importe. El motor
 * NUNCA asume cero ante un valor ilegible: genera una incidencia SOURCE_ERROR.
 */
export function parseAmountToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? eurosToCents(value) : null;
  }
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (text === "") return null;

  // Negativo entre paréntesis, convención contable.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Fuera símbolos de moneda, espacios finos y espacios normales.
  text = text.replace(/[€$£\s  ]/g, "");

  // Signo delante o detrás.
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }

  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimalSep: "," | "." | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    // El separador que aparece más a la derecha es el decimal.
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    // Solo comas. Con 1-2 decimales detrás es separador decimal (formato ES).
    // Con exactamente 3 dígitos detrás lo tratamos como separador de miles:
    // es la lectura conservadora y evita inflar importes x1000.
    const tail = text.length - lastComma - 1;
    decimalSep = tail > 0 && tail <= 2 ? "," : null;
  } else if (lastDot >= 0) {
    const tail = text.length - lastDot - 1;
    decimalSep = tail > 0 && tail <= 2 ? "." : null;
  }

  let normalized: string;
  if (decimalSep === null) {
    normalized = text.replace(/[.,]/g, "");
  } else {
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized =
      text.split(thousandsSep).join("").replace(decimalSep, ".");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  const cents = eurosToCents(parsed);
  return negative ? -cents : cents;
}

/** Formatea céntimos en formato español: 1.234,56 €. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${rest} €`;
}

/** Suma exacta de céntimos. */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Valor absoluto en céntimos. */
export function absCents(cents: number): number {
  return Math.abs(cents);
}
