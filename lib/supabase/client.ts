import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para el navegador.
 *
 * Usa la Publishable Key (`sb_publishable_…`), que es pública por diseño: puede
 * viajar al navegador porque no autoriza nada por sí sola. Toda la protección
 * real está en RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
