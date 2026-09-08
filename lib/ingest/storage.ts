import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../paths";

/**
 * Almacén de documentos.
 *
 * Interfaz mínima con dos implementaciones:
 *
 *   - **Supabase Storage** (destino definitivo): bucket PRIVADO. Los documentos
 *     no se sirven nunca por URL pública; se accede con URLs firmadas de vida
 *     corta generadas en el servidor.
 *   - **Local** (hoy): la zona de trabajo local, para poder operar antes de que
 *     Supabase esté configurado.
 *
 * La aplicación elige una u otra según haya credenciales. El resto del código no
 * sabe cuál está usando, así que migrar no toca nada más que este archivo.
 */

export interface StoredDocument {
  /** Ruta dentro del almacén. Determinista: periodo + hash + extensión. */
  storagePath: string;
  /** True si el documento ya estaba almacenado (misma huella de contenido). */
  alreadyExisted: boolean;
}

export interface DocumentStorage {
  /** Nombre legible del backend, para los informes y la interfaz. */
  readonly name: string;
  /** Guarda el documento. Si ya existe esa ruta, no lo reescribe. */
  put(storagePath: string, bytes: Uint8Array): Promise<StoredDocument>;
  /** URL temporal para visualizar el documento. */
  signedUrl(storagePath: string, expiresInSeconds?: number): Promise<string | null>;
  /** Contenido del documento, para reprocesarlo sin volver a subirlo. */
  read(storagePath: string): Promise<Uint8Array | null>;
}

/** Bucket privado de Supabase Storage. */
export const DOCUMENTS_BUCKET = "documentos";

/**
 * Almacén local: `local-data/documents/`.
 *
 * Es la implementación activa mientras no haya Supabase. Vive dentro de la zona
 * excluida del repositorio, así que ningún documento real puede escaparse a Git.
 */
export function createLocalStorage(): DocumentStorage {
  const root = path.join(dataRoot(), "documents");

  return {
    name: "local",

    async put(storagePath, bytes) {
      const absolute = path.join(root, storagePath);
      try {
        await stat(absolute);
        // Mismo hash y misma ruta: es el mismo documento, no se reescribe.
        return { storagePath, alreadyExisted: true };
      } catch {
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, bytes);
        return { storagePath, alreadyExisted: false };
      }
    },

    async signedUrl(storagePath) {
      // En local no hay firma: se sirve por una ruta propia de la aplicación,
      // que valida sesión y pertenencia antes de leer nada del disco.
      return `/api/documentos/${encodeURIComponent(storagePath)}`;
    },

    async read(storagePath) {
      try {
        return new Uint8Array(await readFile(path.join(root, storagePath)));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Almacén en Supabase Storage (bucket privado).
 *
 * Usa el cliente **de sesión**, no el privilegiado: cada operación viaja como
 * el usuario autenticado y las políticas de storage.objects deciden. Así la
 * autorización no depende de que el código se acuerde de comprobarla, y el
 * service_role no hace falta para la operativa normal.
 *
 * El guard de la ruta ya ha validado sesión y pertenencia antes de llegar aquí;
 * esto es la segunda barrera, la que de verdad no se puede saltar.
 */
export function createSupabaseStorage(): DocumentStorage {
  return {
    name: "supabase",

    async put(storagePath, bytes) {
      const { createClient } = await import("../supabase/server");
      const supabase = await createClient();

      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, bytes, {
          contentType: contentTypeFor(storagePath),
          // No sobrescribir: si la ruta existe, es el mismo contenido (el
          // nombre es su hash), así que subirlo otra vez no aporta nada.
          upsert: false,
        });

      if (error) {
        // El almacén ya tenía este documento: es el caso idempotente esperado.
        if (isDuplicateError(error)) return { storagePath, alreadyExisted: true };
        throw new Error(`No se ha podido guardar el documento: ${error.message}`);
      }

      return { storagePath, alreadyExisted: false };
    },

    async signedUrl(storagePath, expiresInSeconds = 300) {
      const { createClient } = await import("../supabase/server");
      const supabase = await createClient();
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      return error ? null : (data?.signedUrl ?? null);
    },

    async read(storagePath) {
      const { createClient } = await import("../supabase/server");
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/**
 * Elige el almacén disponible.
 *
 * Basta con las claves públicas: la operativa normal no usa service_role, así
 * que su ausencia no debe degradar la aplicación a modo local por accidente.
 */
export function createDocumentStorage(): DocumentStorage {
  const configured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return configured ? createSupabaseStorage() : createLocalStorage();
}

function isDuplicateError(error: { message?: string; statusCode?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  return (
    error.statusCode === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

function contentTypeFor(storagePath: string): string {
  if (storagePath.endsWith(".pdf")) return "application/pdf";
  if (storagePath.endsWith(".csv")) return "text/csv";
  if (storagePath.endsWith(".xlsx") || storagePath.endsWith(".xlsm")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (storagePath.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}
