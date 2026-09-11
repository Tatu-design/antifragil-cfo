import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la Secret Key para los scripts de administración.
 *
 * ¿Por qué no se reutiliza `lib/supabase/secret.ts`? Porque ese módulo está
 * marcado con `server-only`, que lanza al importarse fuera del runtime de React
 * Server Components. Es justo la protección que queremos en el código de la
 * aplicación, y por eso no se toca.
 *
 * Estos scripts son otra cosa: se ejecutan a mano desde la terminal del
 * administrador, nunca desde una petición web. De ahí este helper aparte.
 *
 * Sigue valiendo la regla de fondo: la Secret Key solo aparece en estos dos
 * módulos, y la operativa financiera nunca la usa.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY. Ejecuta el comando con .env.local cargado.",
    );
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
