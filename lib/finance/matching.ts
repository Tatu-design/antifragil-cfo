/**
 * Conciliación documental bidireccional (D38/D39).
 *
 *   A) movimiento → factura : ¿este gasto tiene su factura?
 *   B) factura → movimiento : ¿esta factura está pagada?
 *
 * PRINCIPIO: nunca forzar una asociación dudosa. Es preferible una incidencia
 * a revisar que un cruce inventado. Un match erróneo contamina el ledger de
 * forma silenciosa; una incidencia solo cuesta un minuto de revisión.
 */

import { absCents } from "./money";
import { daysBetween } from "./period";
import { similarity } from "./text";
import type { Invoice, LedgerEntry } from "./types";

export interface MatchConfig {
  /** Tolerancia de importe en céntimos. 0 = el importe debe ser exacto. */
  amountToleranceCents: number;
  /** Ventana de días admitida entre fecha de factura y fecha de pago. */
  dateWindowDays: number;
  /** Similitud mínima de contraparte para aceptar un match automático. */
  minSupplierSimilarity: number;
  /**
   * Distancia mínima entre el mejor candidato y el segundo para considerar el
   * match inequívoco. Si dos candidatos puntúan casi igual → AMBIGUOUS_MATCH.
   */
  minScoreGap: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  amountToleranceCents: 0,
  dateWindowDays: 45,
  minSupplierSimilarity: 0.45,
  minScoreGap: 0.15,
};

export interface Candidate {
  invoice: Invoice;
  score: number;
  reasons: string[];
}

export type MatchOutcome =
  | { status: "matched"; candidate: Candidate }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "unmatched"; candidates: Candidate[] };

/**
 * Puntúa una factura frente a un apunte de gasto.
 *
 * El importe es condición NECESARIA: si no coincide dentro de tolerancia, la
 * factura queda descartada (score 0). Sobre esa base, fecha y proveedor
 * modulan la confianza.
 */
export function scoreCandidate(
  entry: LedgerEntry,
  invoice: Invoice,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Candidate | null {
  const entryAmount = absCents(entry.amountCents);
  const invoiceAmount = absCents(invoice.amountCents);
  const amountDiff = Math.abs(entryAmount - invoiceAmount);
  if (amountDiff > config.amountToleranceCents) return null;

  const reasons: string[] = [
    amountDiff === 0 ? "importe exacto" : `importe dentro de tolerancia (${amountDiff} cts)`,
  ];

  const days = Math.abs(daysBetween(invoice.date, entry.date));
  if (days > config.dateWindowDays) return null;
  reasons.push(days === 0 ? "misma fecha" : `${days} día(s) de diferencia`);

  // Cercanía temporal: 1.0 el mismo día, decayendo hasta 0 en el borde de la ventana.
  const dateScore = 1 - days / (config.dateWindowDays + 1);

  const supplierScore = Math.max(
    similarity(entry.description, invoice.supplier),
    entry.counterparty ? similarity(entry.counterparty, invoice.supplier) : 0,
    similarity(entry.rawDescription, invoice.supplier),
  );
  if (supplierScore > 0) reasons.push(`proveedor ~${supplierScore.toFixed(2)}`);

  // Un número de factura presente en el concepto bancario es una señal fuerte.
  let invoiceNumberBonus = 0;
  if (invoice.invoiceNumber && invoice.invoiceNumber.length >= 4) {
    const needle = invoice.invoiceNumber.toLowerCase();
    if (entry.rawDescription.toLowerCase().includes(needle)) {
      invoiceNumberBonus = 0.25;
      reasons.push("nº de factura presente en el concepto");
    }
  }

  const score = Math.min(
    1,
    0.5 + 0.2 * dateScore + 0.3 * supplierScore + invoiceNumberBonus,
  );

  return { invoice, score, reasons };
}

/** Busca la factura de un apunte de gasto entre las facturas disponibles. */
export function matchEntryToInvoices(
  entry: LedgerEntry,
  invoices: Invoice[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): MatchOutcome {
  const candidates = invoices
    .map((invoice) => scoreCandidate(entry, invoice, config))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { status: "unmatched", candidates: [] };

  const [best, second] = candidates;

  // Coincide el importe pero nada más respalda la asociación: no se fuerza.
  const supplierSupported =
    best.score >= 0.5 + 0.3 * config.minSupplierSimilarity ||
    best.reasons.includes("nº de factura presente en el concepto");

  if (!supplierSupported) {
    return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  }

  if (second && best.score - second.score < config.minScoreGap) {
    return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  }

  return { status: "matched", candidate: best };
}

export interface ReconciliationResult {
  /** Apuntes con su conciliación y documentos ya asignados. */
  entries: LedgerEntry[];
  /** Facturas que no han podido asociarse a ningún movimiento. */
  unmatchedInvoices: Invoice[];
  /** Apuntes con más de un candidato plausible. */
  ambiguous: Array<{ entry: LedgerEntry; candidates: Candidate[] }>;
}

/**
 * Ejecuta la conciliación de todos los gastos contra todas las facturas.
 *
 * Una factura solo puede asociarse a un movimiento (evita que la misma factura
 * justifique dos pagos distintos, que es una vía de doble contabilización).
 */
export function reconcileExpensesWithInvoices(
  entries: LedgerEntry[],
  invoices: Invoice[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): ReconciliationResult {
  const usedInvoiceIds = new Set<string>();
  const ambiguous: ReconciliationResult["ambiguous"] = [];

  // Se procesan primero los apuntes cuyo mejor candidato es más nítido, para
  // que un match claro no se quede sin factura por habérsela llevado un match
  // dudoso procesado antes.
  const scored = entries.map((entry) => {
    if (entry.direction !== "expense") return { entry, bestScore: -1 };
    const outcome = matchEntryToInvoices(entry, invoices, config);
    const bestScore = outcome.status === "matched" ? outcome.candidate.score : 0;
    return { entry, bestScore };
  });
  const order = [...scored].sort((a, b) => b.bestScore - a.bestScore).map((s) => s.entry.id);
  const positionById = new Map(order.map((id, index) => [id, index]));

  const resultById = new Map<string, LedgerEntry>();
  const sortedEntries = [...entries].sort(
    (a, b) => (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0),
  );

  for (const entry of sortedEntries) {
    if (entry.direction !== "expense") {
      resultById.set(entry.id, entry);
      continue;
    }

    const available = invoices.filter((i) => !usedInvoiceIds.has(i.id));
    const outcome = matchEntryToInvoices(entry, available, config);

    if (outcome.status === "matched") {
      usedInvoiceIds.add(outcome.candidate.invoice.id);
      resultById.set(entry.id, {
        ...entry,
        reconciliation: "matched",
        documents: [...entry.documents, outcome.candidate.invoice.document],
        notes: [...(entry.notes ?? []), `Factura asociada: ${outcome.candidate.reasons.join(", ")}.`],
      });
      continue;
    }

    if (outcome.status === "ambiguous") {
      ambiguous.push({ entry, candidates: outcome.candidates });
      resultById.set(entry.id, {
        ...entry,
        reconciliation: "ambiguous",
        reviewStatus: "needs_review",
        notes: [
          ...(entry.notes ?? []),
          `${outcome.candidates.length} facturas posibles con el mismo importe. Sin asociar automáticamente.`,
        ],
      });
      continue;
    }

    resultById.set(entry.id, {
      ...entry,
      reconciliation: "missing_document",
      reviewStatus: "needs_review",
    });
  }

  const resultEntries = entries.map((e) => resultById.get(e.id) ?? e);
  const unmatchedInvoices = invoices.filter((i) => !usedInvoiceIds.has(i.id));

  return { entries: resultEntries, unmatchedInvoices, ambiguous };
}

/**
 * Comprobación inversa: facturas sin movimiento localizado.
 *
 * Una factura sin pago NO se convierte en gasto (D39). Puede estar pendiente,
 * pagada en otro mes o por otra vía. Solo se reporta.
 */
export function findInvoicesWithoutMovement(
  invoices: Invoice[],
  entries: LedgerEntry[],
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Invoice[] {
  const documented = new Set<string>();
  for (const entry of entries) {
    for (const doc of entry.documents) {
      if (doc.name) documented.add(doc.name);
    }
  }

  return invoices.filter((invoice) => {
    if (documented.has(invoice.document.name)) return false;
    // Tampoco se reporta si existe un pago plausible aún sin asociar formalmente
    // (por ejemplo un gasto cash con el mismo importe y fecha cercana).
    const plausible = entries.some((entry) => {
      if (entry.direction !== "expense") return false;
      if (absCents(entry.amountCents) !== absCents(invoice.amountCents)) return false;
      return Math.abs(daysBetween(invoice.date, entry.date)) <= config.dateWindowDays &&
        similarity(entry.description, invoice.supplier) >= config.minSupplierSimilarity;
    });
    return !plausible;
  });
}
