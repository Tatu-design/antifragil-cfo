import { redirect } from "next/navigation";
import { authorize, isLocalDevMode, isSupabaseConfigured } from "@/lib/auth/guard";
import { LoginForm } from "./LoginForm";

/**
 * Entrada a la aplicación.
 *
 * MVP deliberadamente simple: email y contraseña con Supabase Auth. Sin
 * registro público, sin recuperación de contraseña y sin invitaciones: los
 * usuarios se dan de alta desde el panel de Supabase y se autorizan añadiéndolos
 * a `cfo_members`. Añadir más usuarios después no obliga a rehacer la seguridad.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const result = await authorize();
  if (result.ok) redirect("/");

  const configured = isSupabaseConfigured();
  const localDev = isLocalDevMode();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Antifrágil</p>
        <h1 className="text-2xl font-semibold tracking-tight">CFO</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Acceso restringido. Esta aplicación contiene información financiera de la
          empresa.
        </p>
      </header>

      {configured ? (
        <LoginForm />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-medium">Supabase no está configurado.</p>
          <p className="mt-2">
            {localDev
              ? "El modo local de desarrollo está activo: la aplicación funciona sin autenticación con datos sintéticos."
              : "Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local. Sin ellas, la aplicación no da acceso a nada."}
          </p>
        </div>
      )}

      {result.ok === false && result.reason === "not_member" && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Tu usuario existe pero no tiene acceso autorizado a los datos financieros.
        </p>
      )}
    </main>
  );
}
