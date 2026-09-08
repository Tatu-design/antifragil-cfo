/**
 * Conciliación documental bidireccional.
 *
 *   A) movimiento → documento : ¿este movimiento está justificado?
 *   B) documento → movimiento : ¿este documento está pagado/cobrado?
 *
 * Cardinalidades soportadas:
 *   1 movimiento ↔ 1 documento    caso habitual
 *   1 movimiento ↔ N documentos   un pago que liquida varias facturas
 *   N movimientos ↔ 1 documento   una nómina o un impuesto pagado en varios cargos
 *   agregado de periodo           datáfono (ver card-settlements.ts)
 *
 * PRINCIPIO: nunca forzar una asociación dudosa. Un match erróneo contamina el
 * ledger en silencio; una incidencia solo cuesta un minuto de revisión.
 *
 * Toda asociación automática guarda método, confianza y motivos, para poder
 * auditar meses después por qué el motor decidió lo que decidió.
 */

import { absCents, sumCents } from "./money";
import { daysBetween } from "./period";
import { similarity } from "./text";
import type {
  AttachedDocument,
  LedgerEntry,
  SupportingDocument,
} from "./types";

export interface MatchConfig {
  /** Tolerancia de importe en céntimos. 0 = el importe debe ser exacto. */
  amountToleranceCents: number;
  /** Ventana de días admitida entre fecha del documento y fecha del pago. */
  dateWindowDays: number;
  /** Similitud mínima de emisor para aceptar un match automático. */
  minIssuerSimilarity: number;
  /**
   * Distancia mínima entre el mejor candidato y el segundo para considerar el
   * match inequívoco. Si dos candidatos puntúan casi igual → ambiguo.
   */
  minScoreGap: number;
  /** Máximo de movimientos que pueden sumar para justificar un documento. */
  maxAggregateSize: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  amountToleranceCents: 0,
  dateWindowDays: 45,
  minIssuerSimilarity: 0.45,
  minScoreGap: 0.15,
  maxAggregateSize: 4,
};

export interface Candidate {
  document: SupportingDocument;
  score: number;
  reasons: string[];
  method: AttachedDocument["method"];
}

export type MatchOutcome =
  | { status: "matched"; candidate: Candidate }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "unmatched"; candidates: Candidate[] };

/**
 * Puntúa un documento frente a un movimiento.
 *
 * El importe es condición NECESARIA: si no coincide dentro de tolerancia, el
 * documento queda descartado. Sobre esa base, fecha y emisor modulan la
 * confianza. Un documento sin importe extraído no puede puntuarse por importe
 * y solo se acepta si su referencia aparece literalmente en el concepto.
 */
export function scoreCandidate(
  entry: LedgerEntry,
  document: SupportingDocument,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Candidate | null {
  const referenceHit = hasReferenceInConcept(entry, document);

  if (document.amountCents === null) {
    // Sin importe no hay prueba numérica. Solo la referencia literal basta.
    if (!referenceHit) return null;
    return {
      document,
      score: 0.7,
      reasons: ["referencia del documento presente en el concepto", "documento sin importe extraído"],
      method: "reference_in_concept",
    };
  }

  const amountDiff = Math.abs(absCents(entry.amountCents) - absCents(document.amountCents));
  if (amountDiff > config.amountToleranceCents) return null;

  const reasons: string[] = [
    amountDiff === 0 ? "importe exacto" : `importe dentro de tolerancia (${amountDiff} cts)`,
  ];

  const days = Math.abs(daysBetween(document.date, entry.date));
  if (days > config.dateWindowDays) return null;
  reasons.push(days === 0 ? "misma fecha" : `${days} día(s) de diferencia`);

  // Cercanía temporal: 1.0 el mismo día, decayendo hasta 0 en el borde.
  const dateScore = 1 - days / (config.dateWindowDays + 1);

  const issuerScore = Math.max(
    similarity(entry.description, document.issuer),
    entry.counterparty ? similarity(entry.counterparty, document.issuer) : 0,
    similarity(entry.rawDescription, document.issuer),
  );
  if (issuerScore > 0) reasons.push(`emisor ~${issuerScore.toFixed(2)}`);

  let referenceBonus = 0;
  if (referenceHit) {
    referenceBonus = 0.25;
    reasons.push("referencia presente en el concepto");
  }

  const score = Math.min(1, 0.5 + 0.2 * dateScore + 0.3 * issuerScore + referenceBonus);

  return {
    document,
    score,
    reasons,
    method: referenceHit ? "reference_in_concept" : "amount_date_issuer",
  };
}

function hasReferenceInConcept(entry: LedgerEntry, document: SupportingDocument): boolean {
  const reference = document.reference;
  if (!reference || reference.length < 4) return false;
  return entry.rawDescription.toLowerCase().includes(reference.toLowerCase());
}

/** Busca el documento de un movimiento entre los disponibles. */
export function matchEntryToDocuments(
  entry: LedgerEntry,
  documents: SupportingDocument[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): MatchOutcome {
  const candidates = documents
    .map((document) => scoreCandidate(entry, document, config))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { status: "unmatched", candidates: [] };

  const [best, second] = candidates;

  // Coincide el importe pero nada más respalda la asociación: no se fuerza.
  const supported =
    best.method === "reference_in_concept" ||
    best.score >= 0.5 + 0.3 * config.minIssuerSimilarity;

  if (!supported) return { status: "ambiguous", candidates: candidates.slice(0, 5) };

  if (second && best.score - second.score < config.minScoreGap) {
    return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  }

  return { status: "matched", candidate: best };
}

/**
 * N movimientos ↔ 1 documento.
 *
 * Caso real: una nómina o un impuesto que se paga en dos o tres cargos, o un
 * proveedor al que se le liquidan varios recibos con un único documento.
 *
 * Solo se acepta si la suma es EXACTA, todos los movimientos caen dentro de la
 * ventana de fechas y al menos uno apunta al emisor. Se busca el grupo más
 * pequeño posible: cuantos menos movimientos, más creíble la agrupación.
 */
export function findAggregateMatch(
  entries: LedgerEntry[],
  document: SupportingDocument,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): { entries: LedgerEntry[]; reasons: string[]; score: number } | null {
  if (document.amountCents === null || document.amountCents === 0) return null;
  const target = absCents(document.amountCents);

  const eligible = entries.filter((entry) => {
    if (entry.direction === "internal") return false;
    if (entry.documents.length > 0) return false;
    if (Math.abs(daysBetween(document.date, entry.date)) > config.dateWindowDays) return false;
    return absCents(entry.amountCents) < target;
  });

  if (eligible.length < 2) return null;
  const best = findSubsetSummingTo(eligible, target, config.maxAggregateSize);
  if (!best) return null;

  const issuerScore = Math.max(
    ...best.map((entry) => similarity(entry.rawDescription, document.issuer)),
  );
  if (issuerScore < config.minIssuerSimilarity) return null;

  return {
    entries: best,
    score: Math.min(1, 0.55 + 0.3 * issuerScore),
    reasons: [
      `${best.length} movimientos suman exactamente el importe del documento`,
      `emisor ~${issuerScore.toFixed(2)}`,
    ],
  };
}

/**
 * Busca el subconjunto más pequeño cuyo importe sume exactamente el objetivo.
 *
 * Búsqueda exhaustiva acotada por `maxSize` (4 por defecto): con los volúmenes
 * de un mes es instantánea, y acotarla evita que el motor "encuentre" sumas
 * casuales de siete movimientos que no significan nada.
 */
function findSubsetSummingTo(
  entries: LedgerEntry[],
  target: number,
  maxSize: number,
): LedgerEntry[] | null {
  const pool = entries.slice(0, 40);

  for (let size = 2; size <= Math.min(maxSize, pool.length); size += 1) {
    const found = search(0, [], 0, size);
    if (found) return found;
  }
  return null;

  function search(
    start: number,
    chosen: LedgerEntry[],
    total: number,
    size: number,
  ): LedgerEntry[] | null {
    if (chosen.length === size) return total === target ? [...chosen] : null;
    for (let i = start; i < pool.length; i += 1) {
      const next = total + absCents(pool[i].amountCents);
      if (next > target) continue;
      chosen.push(pool[i]);
      const result = search(i + 1, chosen, next, size);
      chosen.pop();
      if (result) return result;
    }
    return null;
  }
}

/**
 * 1 movimiento ↔ N documentos.
 *
 * Caso real: un pago único que liquida varias facturas del mismo proveedor.
 * Mismas cautelas: suma exacta, ventana de fechas y emisor coherente.
 */
export function findMultiDocumentMatch(
  entry: LedgerEntry,
  documents: SupportingDocument[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): { documents: SupportingDocument[]; reasons: string[]; score: number } | null {
  const target = absCents(entry.amountCents);
  if (target === 0) return null;

  const eligible = documents.filter(
    (d) =>
      d.amountCents !== null &&
      d.amountCents > 0 &&
      absCents(d.amountCents) < target &&
      Math.abs(daysBetween(d.date, entry.date)) <= config.dateWindowDays &&
      similarity(entry.rawDescription, d.issuer) >= config.minIssuerSimilarity,
  );

  if (eligible.length < 2) return null;

  // Se agrupan por emisor: mezclar proveedores distintos en un mismo pago es
  // posible, pero no es una conclusión que el motor deba sacar solo.
  const byIssuer = new Map<string, SupportingDocument[]>();
  for (const document of eligible) {
    const key = document.issuer.toLowerCase();
    byIssuer.set(key, [...(byIssuer.get(key) ?? []), document]);
  }

  for (const group of byIssuer.values()) {
    if (group.length < 2) continue;
    const total = sumCents(group.map((d) => absCents(d.amountCents ?? 0)));
    if (total !== target) continue;
    return {
      documents: group,
      score: 0.8,
      reasons: [`${group.length} documentos del mismo emisor suman el importe del pago`],
    };
  }

  return null;
}
