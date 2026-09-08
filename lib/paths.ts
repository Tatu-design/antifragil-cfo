/**
 * Rutas de la zona local de trabajo.
 *
 * Todo lo que contenga datos financieros reales vive bajo `local-data/`, que
 * está excluida del repositorio. Se puede reubicar con la variable de entorno
 * ANTIFRAGIL_CFO_DATA_DIR (por ejemplo, a una carpeta sincronizada con Drive).
 */

import path from "node:path";

export function dataRoot(): string {
  return process.env.ANTIFRAGIL_CFO_DATA_DIR ?? path.resolve(process.cwd(), "local-data");
}

/** Carpeta de entrada de un periodo: local-data/inputs/2026-08/ */
export function inputsRoot(period: string): string {
  return path.join(dataRoot(), "inputs", period);
}

/** Carpeta de salida de un periodo: local-data/outputs/2026-08/ */
export function outputsRoot(period: string): string {
  return path.join(dataRoot(), "outputs", period);
}

/** Carpeta de copias de seguridad de documentos originales. */
export function backupsRoot(): string {
  return path.join(dataRoot(), "backups");
}

/** Carpeta de logs de ejecución. */
export function logsRoot(): string {
  return path.join(dataRoot(), "logs");
}

/** Subcarpetas de entrada esperadas dentro de un periodo. */
export const INPUT_FOLDERS = [
  'bank_sl',
  'bank_sc',
  'cash_account',
  'clinic_bank',
  'clinic_cash',
  'documents',
  'manual_close',
] as const;
