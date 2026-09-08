/**
 * Cuentas de tesorería de Antifrágil.
 *
 * Tres orígenes de movimiento convergen en un único ledger, pero cada apunte
 * conserva SIEMPRE su cuenta: sin eso no se puede responder "¿cuánto movió la
 * SC este mes?" ni cuadrar cada tesorería por separado.
 *
 * Los ids son estables porque forman parte del identificador de cada apunte y
 * del nombre de las carpetas de entrada. Cambiar un id cambia todos los ids del
 * histórico, así que no se tocan a la ligera.
 */

import type { LegalEntity, TreasuryAccount, TreasuryKind } from "./types";

export const ACCOUNT_SL_BANK = "sl_bank";
export const ACCOUNT_SC_BANK = "sc_bank";
export const ACCOUNT_CASH = "cash";

/**
 * Catálogo por defecto.
 *
 * Las etiquetas son provisionales hasta ver los extractos reales (entidad y
 * denominación exactas). Cambiar una etiqueta es inocuo; cambiar un id no.
 */
export const DEFAULT_ACCOUNTS: TreasuryAccount[] = [
  { id: ACCOUNT_SL_BANK, label: "Banco SL", kind: "bank", legalEntity: "SL" },
  { id: ACCOUNT_SC_BANK, label: "Banco SC", kind: "bank", legalEntity: "SC" },
  { id: ACCOUNT_CASH, label: "Caja Antifrágil", kind: "cash", legalEntity: "SL" },
];

export function findAccount(
  accounts: TreasuryAccount[],
  accountId: string,
): TreasuryAccount | undefined {
  return accounts.find((a) => a.id === accountId);
}

/**
 * Resuelve la cuenta de un movimiento.
 *
 * Si el id no está en el catálogo NO se inventa una cuenta plausible: se
 * devuelve una entrada explícitamente marcada como desconocida para que
 * aparezca en los informes y alguien la configure.
 */
export function resolveAccount(
  accounts: TreasuryAccount[],
  accountId: string,
): TreasuryAccount {
  return (
    findAccount(accounts, accountId) ?? {
      id: accountId,
      label: `Cuenta sin configurar (${accountId})`,
      kind: guessKind(accountId),
      legalEntity: guessEntity(accountId),
    }
  );
}

function guessKind(accountId: string): TreasuryKind {
  return accountId.includes("cash") || accountId.includes("caja") ? "cash" : "bank";
}

function guessEntity(accountId: string): LegalEntity {
  if (accountId.includes("_sc") || accountId.startsWith("sc")) return "SC";
  if (accountId.includes("_sl") || accountId.startsWith("sl")) return "SL";
  return "OTHER";
}
