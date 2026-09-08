/**
 * ¿Este movimiento necesita documento justificativo?
 *
 * Tratar todo movimiento como "factura faltante" convierte la cola de revisión
 * en ruido: una comisión bancaria o un traspaso entre cuentas propias no tienen
 * documento y nunca lo tendrán. Marcarlos como `not_document_required` es un
 * estado FINAL legítimo, no una excepción escondida.
 *
 * La lista es corta y explícita a propósito. Solo entra aquí lo que es
 * inequívoco; cualquier duda se queda como `missing_document` y la revisa una
 * persona, que es el lado seguro del error.
 */

import { normalizeText } from "./text";

export interface DocumentRequirementRule {
  id: string;
  /** Todas estas palabras deben aparecer en el concepto normalizado. */
  words: string[];
  /** Explicación para el informe de auditoría. */
  reason: string;
}

export const NO_DOCUMENT_REQUIRED_RULES: DocumentRequirementRule[] = [
  { id: "comision", words: ["comision"], reason: "Comisión bancaria: la cobra el banco, no genera factura de proveedor." },
  { id: "comisiones", words: ["comisiones"], reason: "Comisiones bancarias." },
  { id: "mantenimiento_cuenta", words: ["mantenimiento", "cuenta"], reason: "Mantenimiento de cuenta bancaria." },
  { id: "intereses", words: ["intereses"], reason: "Intereses bancarios." },
  { id: "liquidacion_intereses", words: ["liquidacion", "intereses"], reason: "Liquidación de intereses del banco." },
  { id: "redondeo", words: ["redondeo"], reason: "Ajuste de redondeo." },
];

export interface DocumentRequirement {
  required: boolean;
  /** Id de la regla que lo eximió, si aplica. */
  ruleId?: string;
  reason?: string;
}

/**
 * Decide si un movimiento requiere documento justificativo.
 *
 * Los movimientos internos de tesorería nunca lo requieren: mover dinero de una
 * cuenta propia a otra no es una operación con un tercero.
 */
export function documentRequirement(
  concept: string,
  options: { isInternal: boolean },
): DocumentRequirement {
  if (options.isInternal) {
    return {
      required: false,
      ruleId: "movimiento_interno",
      reason: "Movimiento interno de tesorería: no hay tercero que emita documento.",
    };
  }

  const normalized = normalizeText(concept);
  for (const rule of NO_DOCUMENT_REQUIRED_RULES) {
    if (rule.words.every((w) => normalized.includes(w))) {
      return { required: false, ruleId: rule.id, reason: rule.reason };
    }
  }

  return { required: true };
}
