import "server-only";
import { createClient } from "../supabase/server";

/**
 * Autorización server-side. Única puerta de entrada a los datos financieros.
 *
 * REGLA: toda operación que lea o modifique información financiera pasa por
 * aquí ANTES de tocar nada. La interfaz no es una barrera de seguridad: ocultar
 * un botón no autoriza nada.
 *
 * Dos comprobaciones, en este orden:
 *   1. ¿Hay sesión válida? (Supabase Auth, cookie verificada contra el servidor)
 *   2. ¿Ese usuario está en `cfo_members`? (lista blanca de acceso)
 *
 * La segunda es la que evita que cualquiera que consiga registrarse en el
 * proyecto de Supabase vea las finanzas de la empresa.
 */

export type AuthFailure = "unauthenticated" | "not_member";

export interface AuthorizedUser {
  id: string;
  email: string | null;
  role: "owner" | "editor" | "viewer";
  /** True si la sesión es la del modo local de desarrollo, sin Supabase. */
  isLocalDev: boolean;
}

export type AuthResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; reason: AuthFailure };

/** ¿Está Supabase configurado en este entorno? */
export function isSupabaseConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}

/**
 * Modo local de desarrollo.
 *
 * Permite trabajar sin Supabase (tests, depuración, demo con datos sintéticos).
 * Exige DOS condiciones a la vez, y ninguna se cumple por accidente en Vercel:
 * no estar en producción y activarlo explícitamente por variable de entorno.
 *
 * Es deliberadamente fail-closed: si Supabase no está configurado y esto no
 * está activado, la aplicación NO deja pasar a nadie.
 */
export function isLocalDevMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ANTIFRAGIL_CFO_LOCAL_MODE === "1" &&
    !isSupabaseConfigured()
  );
}

const LOCAL_DEV_USER: AuthorizedUser = {
  id: "local-dev",
  email: null,
  role: "owner",
  isLocalDev: true,
};

/**
 * Resuelve el usuario autorizado de la petición actual.
 *
 * Usa `getUser()`, que valida el token contra el servidor de Auth. NUNCA
 * `getSession()`, cuyo contenido procede de la cookie y por tanto es
 * manipulable por el cliente.
 */
export async function authorize(): Promise<AuthResult> {
  if (isLocalDevMode()) return { ok: true, user: LOCAL_DEV_USER };
  if (!isSupabaseConfigured()) return { ok: false, reason: "unauthenticated" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, reason: "unauthenticated" };

  // La pertenencia se consulta con el cliente de sesión, así que la política
  // RLS de `cfo_members` (solo la propia fila) es la que responde. Un usuario
  // autenticado que no esté en la tabla recibe cero filas y queda fuera.
  const { data: member } = await supabase
    .from("cfo_members")
    .select("user_id, email, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return { ok: false, reason: "not_member" };

  return {
    ok: true,
    user: {
      id: user.id,
      email: member.email ?? user.email ?? null,
      role: (member.role as AuthorizedUser["role"]) ?? "viewer",
      isLocalDev: false,
    },
  };
}

/** ¿Puede escribir este usuario? Viewer solo lee. */
export function canWrite(user: AuthorizedUser): boolean {
  return user.role === "owner" || user.role === "editor";
}
