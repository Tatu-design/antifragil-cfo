import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la **Secret Key** (`sb_secret_…`). SALTA RLS.
 *
 * Es el sucesor de la antigua `service_role`, que Supabase está retirando. El
 * SDK reconoce el formato nuevo de forma nativa (`sb_publishable_…` /
 * `sb_secret_…`), así que no hace falta nada especial más allá de pasarla.
 *
 * Reglas de uso, sin excepciones:
 *   - Solo desde código de servidor. El import de "server-only" hace que el
 *     build falle si alguien lo arrastra a un Client Component.
 *   - NUNCA en la operativa financiera normal: esa va con el cliente de sesión
 *     del usuario, de forma que RLS sea la barrera real.
 *   - Reservado a operaciones administrativas inevitables, hoy solo el alta del
 *     primer miembro (`scripts/bootstrap-member.ts`), porque escribir en
 *     `cfo_members` desde el cliente permitiría a cualquiera autorizarse.
 *
 * La clave nunca se registra en logs ni se devuelve en errores.
 */
export function createSecretClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. El cliente administrativo no puede crearse.",
    );
  }

  return createSupabaseClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
