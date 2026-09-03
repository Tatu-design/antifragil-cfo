/**
 * Movimientos internos de tesorería (D36/D37).
 *
 * REGLA FINANCIERA CRÍTICA:
 *   Mover dinero de un sitio a otro no crea riqueza ni la destruye.
 *   Una retirada de caja NO es un ingreso. Un traspaso NO es un gasto.
 *
 * Estos movimientos pueden registrarse en el ledger como `internal` para que el
 * saldo de tesorería cuadre, pero quedan EXCLUIDOS del P&L y del resultado.
 */

import { normalizeText } from "./text";

/**
 * Patrones de movimiento interno.
 *
 * Cada patrón es una lista de palabras que deben aparecer TODAS (en cualquier
 * orden) en el concepto normalizado. Se prefiere esta forma a una expresión
 * regular larga porque es legible, auditable y fácil de ampliar por el equipo.
 */
export const INTERNAL_PATTERNS: Array<{ id: string; words: string[]; note: string }> = [
  { id: "retirada_caja", words: ["retirada", "caja"], note: "Retirada de efectivo de la caja: tesorería, no ingreso." },
  { id: "retirada_efectivo", words: ["retirada", "efectivo"], note: "Retirada de efectivo: tesorería." },
  { id: "cantidad_inicial", words: ["cantidad", "inicial"], note: "Saldo de apertura de caja: no es actividad económica." },
  { id: "saldo_inicial", words: ["saldo", "inicial"], note: "Saldo de apertura: no es actividad económica." },
  { id: "traspaso", words: ["traspaso"], note: "Traspaso entre cuentas o cajas." },
  { id: "transferencia_interna", words: ["transferencia", "interna"], note: "Transferencia interna entre cuentas propias." },
  { id: "movimiento_interno", words: ["movimiento", "interno"], note: "Movimiento interno de tesorería." },
  { id: "ingreso_caja", words: ["ingreso", "caja"], note: "Ingreso físico de efectivo en caja o banco: tesorería." },
  { id: "ingreso_efectivo_banco", words: ["ingreso", "efectivo"], note: "Ingreso de efectivo: tesorería." },
  { id: "aportacion_caja", words: ["aportacion", "caja"], note: "Aportación a caja: tesorería." },
];

export interface InternalDetection {
  isInternal: boolean;
  /** Id del patrón que ha disparado la detección. */
  patternId?: string;
  /** Explicación legible para el informe de auditoría. */
  reason?: string;
}

/**
 * Determina si un concepto corresponde a un movimiento interno de tesorería.
 * Ante la duda NO marca como interno: prefiere que el apunte quede visible y
 * pendiente de revisión antes que desaparecer del P&L silenciosamente.
 */
export function detectInternalMovement(concept: string): InternalDetection {
  const normalized = normalizeText(concept);
  if (normalized === "") return { isInternal: false };

  for (const pattern of INTERNAL_PATTERNS) {
    if (pattern.words.every((w) => normalized.includes(w))) {
      return { isInternal: true, patternId: pattern.id, reason: pattern.note };
    }
  }
  return { isInternal: false };
}
