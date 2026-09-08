/**
 * Índice documental de Google Drive.
 *
 * Drive sigue siendo el repositorio de los documentos, pero el motor NUNCA
 * recorre Drive para conciliar: consulta este índice. Buscar por todo Drive en
 * cada ejecución es lento, frágil y no reproducible.
 *
 * El flujo es: Drive → índice (Supabase) → motor de conciliación.
 */

import type { DocumentType } from "../finance/types";

/** Archivo tal y como lo devuelve la API de Drive, reducido a lo que importa. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string | null;
  modifiedTime?: string | null;
  size?: number | null;
  parents?: string[];
}

/** Carpeta de Drive con su ruta legible desde la raíz financiera. */
export interface DriveFolder {
  id: string;
  name: string;
  /** Ruta desde la raíz financiera, p. ej. "2026/Q3/2. Facturas/5. Agosto". */
  path: string;
}

/**
 * Cliente de Drive.
 *
 * Interfaz mínima a propósito: el motor y la indexación se prueban con una
 * implementación falsa, y la real (OAuth o service account, decisión O1) se
 * enchufa sin tocar nada más.
 */
export interface DriveClient {
  listFolders(parentId: string): Promise<DriveFile[]>;
  listFiles(parentId: string): Promise<DriveFile[]>;
}

/** Entrada del índice documental. Es lo que se guarda en Supabase. */
export interface IndexedDocument {
  driveFileId: string;
  name: string;
  url: string | null;
  mimeType: string;
  /** Ruta de carpeta dentro de la raíz financiera. */
  folderPath: string;
  /** Periodo YYYY-MM deducido de la ruta o del nombre. null si no se puede. */
  period: string | null;
  /** Tipo documental deducido. "other" cuando no hay señal suficiente. */
  docType: DocumentType;
  /** Emisor deducido del nombre, cuando el patrón lo permite. */
  issuer: string | null;
  /** Importe deducido del nombre. null si no aparece: nunca se inventa. */
  amountCents: number | null;
  /** Señales usadas para deducir lo anterior. Para auditar la indexación. */
  inferredFrom: string[];
  /** Momento de la última sincronización, en ISO. */
  syncedAt: string;
  modifiedTime: string | null;
  sizeBytes: number | null;
}

export interface SyncResult {
  /** Raíz financiera sincronizada. */
  rootFolderId: string;
  period: string | null;
  documents: IndexedDocument[];
  /** Carpetas recorridas, para el informe de sincronización. */
  visitedFolders: DriveFolder[];
  /** Problemas encontrados (carpeta no encontrada, permisos, etc.). */
  problems: string[];
}
