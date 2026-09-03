/**
 * Datáfono de clínica: detección y conciliación agregada (D32/D33/D34).
 *
 * REGLA FINANCIERA:
 *   El banco agrupa muchas operaciones de tarjeta en una liquidación. Las
 *   facturas de venta están individualizadas. Por eso NO se concilia factura a
 *   factura: se compara SUMA MENSUAL contra SUMA MENSUAL.
 *
 *   Liquidaciones de banco + facturas de venta = EL MISMO ingreso.
 *   Solo se reconoce una vez, como una única línea consolidada.
 */

import { sumCents } from "./money";
import { normalizeText } from "./text";
import type {
  BankMovement,
  CardSettlementReconciliation,
  ClinicSale,
  Period,
} from "./types";

/**
 * Patrones que identifican una liquidación de datáfono en el extracto.
 *
 * El patrón canónico confirmado por negocio es "LIQUIDACIÓN DE REMESAS DE
 * COMERCIO". Se admiten variantes inequívocamente equivalentes. Cualquier
 * concepto que no encaje aquí NO se trata como datáfono: se revisa como ingreso
 * normal, que es el lado seguro del error.
 */
const SETTLEMENT_PATTERNS: string[][] = [
  ["liquidacion", "remesas", "comercio"],
  ["liquidacion", "remesa", "comercio"],
  ["liquidacion", "comercios"],
];

/** True si el concepto bancario corresponde a una liquidación de datáfono. */
export function isCardSettlement(concept: string): boolean {
  const normalized = normalizeText(concept);
  if (normalized === "") return false;
  return SETTLEMENT_PATTERNS.some((words) => words.every((w) => normalized.includes(w)));
}

/** Separa los movimientos bancarios entre liquidaciones de datáfono y el resto. */
export function splitCardSettlements(movements: BankMovement[]): {
  settlements: BankMovement[];
  others: BankMovement[];
} {
  const settlements: BankMovement[] = [];
  const others: BankMovement[] = [];
  for (const movement of movements) {
    if (isCardSettlement(movement.concept)) settlements.push(movement);
    else others.push(movement);
  }
  return { settlements, others };
}

/**
 * Concilia el datáfono del mes: total banco contra total facturación clínica.
 *
 * NUNCA ajusta cifras para que cuadren. Si hay diferencia, la reporta tal cual
 * y el llamante genera una incidencia CARD_SETTLEMENT_MISMATCH.
 */
export function reconcileCardSettlements(
  period: Period,
  settlements: BankMovement[],
  clinicBankSales: ClinicSale[],
): CardSettlementReconciliation {
  const bankTotalCents = sumCents(settlements.map((m) => m.amountCents));
  const salesTotalCents = sumCents(clinicBankSales.map((s) => Math.abs(s.amountCents)));
  const differenceCents = bankTotalCents - salesTotalCents;

  return {
    period,
    bankTotalCents,
    salesTotalCents,
    differenceCents,
    reconciled: differenceCents === 0,
    bankMovementCount: settlements.length,
    salesLineCount: clinicBankSales.length,
  };
}
