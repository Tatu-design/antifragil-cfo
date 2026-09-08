/**
 * Tests de integración contra un Supabase real.
 *
 * Se SALTAN automáticamente si no hay credenciales, para que la suite normal no
 * dependa de la red. Se ejecutan con las variables del proyecto ya configuradas:
 *
 *   npm run test
 *
 * Lo que comprueban no se puede comprobar leyendo código: que RLS bloquea de
 * verdad a un usuario anónimo y que el bucket no sirve archivos sin permiso.
 * Usan exclusivamente datos sintéticos.
 */

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anonKey);

/** Cliente anónimo: sin sesión, como un extraño que conoce la URL del proyecto. */
function anonymousClient() {
  return createClient(url!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const FINANCIAL_TABLES = [
  "periods",
  "documents",
  "ledger_entries",
  "entry_documents",
  "incidents",
  "card_settlements",
  "document_uploads",
  "close_comparisons",
  "audit_events",
  "cfo_members",
];

describe.skipIf(!configured)("RLS con un usuario anónimo", () => {
  it("no puede leer ninguna tabla financiera", async () => {
    const supabase = anonymousClient();

    for (const table of FINANCIAL_TABLES) {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      // O la política lo rechaza, o devuelve cero filas. Lo que nunca puede
      // pasar es que salgan datos.
      expect(data ?? [], `la tabla ${table} ha devuelto datos a un anónimo`).toHaveLength(0);
      if (error) expect(error.message).toBeTruthy();
    }
  });

  it("no puede escribir en el ledger", async () => {
    const supabase = anonymousClient();
    const { error } = await supabase.from("periods").insert({ period: "2099-01" });

    expect(error, "un anónimo ha podido escribir un periodo").not.toBeNull();
  });

  it("no puede insertar documentos", async () => {
    const supabase = anonymousClient();
    const { error } = await supabase.from("documents").insert({
      period: "2099-01",
      content_hash: "0".repeat(64),
      storage_path: "2099-01/prueba.pdf",
      name: "prueba.pdf",
    });

    expect(error, "un anónimo ha podido insertar un documento").not.toBeNull();
  });

  it("no puede modificar la lista de miembros", async () => {
    const supabase = anonymousClient();
    const { error } = await supabase
      .from("cfo_members")
      .insert({ user_id: "00000000-0000-0000-0000-000000000000", email: "intruso@example.com" });

    expect(error, "un anónimo ha podido concederse acceso").not.toBeNull();
  });
});

describe.skipIf(!configured)("Storage privado", () => {
  it("el bucket de documentos no es público", async () => {
    const supabase = anonymousClient();
    // Listar el contenido de un bucket privado sin sesión no debe dar archivos.
    const { data, error } = await supabase.storage.from("documentos").list();

    expect(data ?? [], "el bucket ha listado archivos a un anónimo").toHaveLength(0);
    if (error) expect(error.message).toBeTruthy();
  });

  it("una URL pública construida a mano no sirve el archivo", async () => {
    const supabase = anonymousClient();
    const { data } = supabase.storage.from("documentos").getPublicUrl("2026-09/inexistente.pdf");

    const response = await fetch(data.publicUrl);
    // En un bucket privado, la URL "pública" no devuelve el contenido.
    expect(response.ok).toBe(false);
  });

  it("un anónimo no puede firmar una URL", async () => {
    const supabase = anonymousClient();
    const { data, error } = await supabase.storage
      .from("documentos")
      .createSignedUrl("2026-09/inexistente.pdf", 60);

    expect(data?.signedUrl ?? null).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!configured)("configuración del proyecto", () => {
  it("las claves públicas no son la service_role", () => {
    // La service_role nunca debe estar en una variable NEXT_PUBLIC_.
    expect(anonKey).toBeTruthy();
    expect(anonKey).not.toBe(process.env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("el esquema está aplicado", async () => {
    const supabase = anonymousClient();
    // Una tabla inexistente da un error distinto (42P01) al de RLS.
    const { error } = await supabase.from("ledger_entries").select("id").limit(1);
    expect(error?.code).not.toBe("42P01");
  });
});
