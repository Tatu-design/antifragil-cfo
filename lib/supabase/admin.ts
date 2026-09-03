import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente privilegiado (service_role). SALTA RLS.
 *
 * Reglas de uso, sin excepciones (D48):
 *   - Solo desde código de servidor. El import de "server-only" hace que el
 *     build falle si alguien lo arrastra a un Client Component.
 *   - Nunca para servir datos directamente al navegador sin filtrar antes.
 *   - Solo para operaciones de sistema: importaciones, recálculos, auditoría.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. El cliente privilegiado no puede crearse.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
