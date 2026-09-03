/**
 * Normalización de texto y similitud entre conceptos.
 *
 * Se usa para comparar conceptos bancarios con nombres de proveedor, detectar
 * movimientos internos y reconocer liquidaciones de datáfono. Toda comparación
 * del motor pasa por aquí para que sea determinista y auditable.
 */

/** Minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras vacías que no aportan señal al comparar contrapartes. */
const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "en", "a", "por", "para", "con",
  "sl", "slu", "sa", "sau", "sociedad", "limitada", "anonima", "cb", "scp",
  "recibo", "pago", "compra", "transferencia", "tarjeta", "adeudo", "cargo",
  "factura", "fra", "nomina", "traspaso", "bizum", "s", "l",
]);

/** Trocea un texto en tokens significativos y normalizados. */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Similitud entre dos textos en [0, 1].
 *
 * Combina Jaccard sobre tokens con un bonus por contención literal, que es lo
 * que ocurre en la práctica: el concepto bancario suele contener el nombre
 * comercial del proveedor rodeado de ruido ("PAGO TARJETA 5410 OPENAI *CHATGPT").
 */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Contención: qué proporción del texto más corto aparece en el más largo.
  const smaller = ta.size <= tb.size ? ta : tb;
  const larger = ta.size <= tb.size ? tb : ta;
  let contained = 0;
  for (const t of smaller) if (larger.has(t)) contained += 1;
  const containment = contained / smaller.size;

  return Math.max(jaccard, containment * 0.9);
}

/** True si el texto normalizado contiene todas las palabras del patrón. */
export function containsAllWords(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const words = normalizeText(needle).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => h.includes(w));
}
