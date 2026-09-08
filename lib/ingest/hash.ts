/**
 * Huella de contenido de un documento.
 *
 * Es la base de la idempotencia de la carga: subir dos veces exactamente el
 * mismo archivo no puede crear dos documentos. El nombre no sirve para esto
 * (la misma factura llega como "factura.pdf", "factura (1).pdf", "IMG_0421.pdf"),
 * así que la identidad es el contenido, no cómo se llame.
 */

import { createHash } from "node:crypto";

/** SHA-256 del contenido, en hexadecimal. */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Ruta de almacenamiento de un documento.
 *
 * Se organiza por periodo y se nombra por su hash: dos subidas del mismo
 * archivo escriben en la misma ruta, así que el almacén también es idempotente.
 * La extensión se conserva para que el navegador sepa abrirlo.
 */
export function storagePath(period: string, hash: string, fileName: string): string {
  const extension = extensionOf(fileName);
  return `${period}/${hash}${extension}`;
}

export function extensionOf(fileName: string): string {
  const match = /\.[a-z0-9]{1,8}$/i.exec(fileName.trim());
  return match ? match[0].toLowerCase() : "";
}
