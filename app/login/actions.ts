"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Inicio y cierre de sesión.
 *
 * Server Actions: las credenciales nunca pasan por una API propia ni quedan en
 * la URL, y la cookie de sesión la escribe el servidor con los atributos
 * seguros que fija `@supabase/ssr`.
 */

export interface LoginState {
  error: string | null;
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Introduce tu email y tu contraseña." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensaje único a propósito: no se revela si el email existe o no.
    return { error: "Credenciales incorrectas." };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
