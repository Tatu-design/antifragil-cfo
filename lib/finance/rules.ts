/**
 * Motor de clasificación determinista (D28/D29/D30/D31).
 *
 * NO hay IA aquí, y es intencionado. Una clasificación financiera opaca es peor
 * que ninguna clasificación: quien revisa el mes debe poder preguntar "¿por qué
 * este gasto es OPEX Estructura?" y recibir el id de una regla explícita.
 *
 * ESTADO ACTUAL: el catálogo de reglas se carga desde config y arranca VACÍO a
 * propósito. Hasta que no se analice el histórico enero-julio 2026 del Cash Flow
 * GEA y el propietario valide la taxonomía, TODO gasto nuevo queda con
 * categoría = null y P&L = null (pendiente). Es exactamente lo pedido: el motor
 * introduce el movimiento y su documentación; la decisión contable es humana.
 */

import { normalizeText } from "./text";
import type { ClassificationStatus, Treasury } from "./types";

export interface ClassificationRule {
  /** Identificador estable citado en la auditoría de cada apunte. */
  id: string;
  /** Todas estas palabras deben aparecer en el concepto normalizado. */
  contains: string[];
  /** Ninguna de estas palabras puede aparecer. Evita falsos positivos. */
  excludes?: string[];
  /** Si se indica, la regla solo aplica a esa tesorería. */
  treasury?: Treasury;
  /** Solo aplica a gastos, a ingresos, o a ambos. */
  appliesTo?: "expense" | "income" | "both";
  category: string;
  pnl: string;
  /** Confianza declarada por quien creó la regla, en [0, 1]. */
  confidence: number;
  enabled: boolean;
  /** Por qué existe la regla. Obligatorio: una regla sin motivo no es auditable. */
  note: string;
}

export interface RuleBook {
  version: string;
  /** Confianza mínima para aplicar una regla automáticamente. */
  minConfidence: number;
  rules: ClassificationRule[];
}

export const EMPTY_RULEBOOK: RuleBook = {
  version: "0-sin-reglas",
  minConfidence: 0.9,
  rules: [],
};

export interface ClassificationResult {
  category: string | null;
  pnl: string | null;
  status: ClassificationStatus;
  /** Id de la regla aplicada, si la hubo. */
  ruleId?: string;
  /** Explicación para el informe de auditoría. */
  reason: string;
}

export const PENDING_CLASSIFICATION: ClassificationResult = {
  category: null,
  pnl: null,
  status: "pending",
  reason: "Sin regla aplicable. Pendiente de clasificación manual.",
};

/**
 * Clasifica un concepto según el catálogo de reglas.
 *
 * Si dos reglas habilitadas compiten, NO se elige arbitrariamente: el apunte
 * queda pendiente. Un conflicto de reglas es un problema del catálogo que debe
 * resolver una persona, no el motor.
 */
export function classify(
  concept: string,
  options: {
    ruleBook: RuleBook;
    treasury: Treasury;
    direction: "expense" | "income";
  },
): ClassificationResult {
  const { ruleBook, treasury, direction } = options;
  const normalized = normalizeText(concept);
  if (normalized === "") return PENDING_CLASSIFICATION;

  const matches = ruleBook.rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.confidence < ruleBook.minConfidence) return false;
    if (rule.treasury && rule.treasury !== treasury) return false;
    const scope = rule.appliesTo ?? "both";
    if (scope !== "both" && scope !== direction) return false;
    if (rule.contains.length === 0) return false;
    if (!rule.contains.every((w) => normalized.includes(normalizeText(w)))) return false;
    if (rule.excludes?.some((w) => normalized.includes(normalizeText(w)))) return false;
    return true;
  });

  if (matches.length === 0) return PENDING_CLASSIFICATION;

  if (matches.length > 1) {
    const conflicting = matches.map((r) => r.id).join(", ");
    const sameOutcome = matches.every(
      (r) => r.category === matches[0].category && r.pnl === matches[0].pnl,
    );
    if (!sameOutcome) {
      return {
        category: null,
        pnl: null,
        status: "pending",
        reason: `Conflicto entre reglas (${conflicting}). Pendiente de decisión humana.`,
      };
    }
  }

  const rule = matches[0];
  return {
    category: rule.category,
    pnl: rule.pnl,
    status: "rule",
    ruleId: rule.id,
    reason: `Regla ${rule.id}: ${rule.note}`,
  };
}

/**
 * Clasificación heredada de un documento de origen (caso Cuenta de cash).
 *
 * Si el documento de cash ya trae categoría y P&L asignados por una persona,
 * se conservan: son una decisión humana previa, no una inferencia del motor.
 */
export function inheritClassification(
  category: string | null | undefined,
  pnl: string | null | undefined,
  sourceLabel: string,
): ClassificationResult {
  const hasCategory = typeof category === "string" && category.trim() !== "";
  const hasPnl = typeof pnl === "string" && pnl.trim() !== "";
  if (!hasCategory && !hasPnl) return PENDING_CLASSIFICATION;

  return {
    category: hasCategory ? category.trim() : null,
    pnl: hasPnl ? pnl.trim() : null,
    status: "manual",
    reason: `Clasificación heredada de ${sourceLabel}.`,
  };
}
