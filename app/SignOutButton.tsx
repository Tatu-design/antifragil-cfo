import { signOut } from "./login/actions";

/**
 * Identidad de la sesión y salida.
 *
 * El cierre de sesión es una Server Action: invalida la sesión en el servidor,
 * no solo borra algo en el navegador.
 */
export function SignOutButton({
  email,
  isLocalDev,
}: {
  email: string | null;
  isLocalDev: boolean;
}) {
  if (isLocalDev) {
    return (
      <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">
        modo local de desarrollo
      </span>
    );
  }

  return (
    <form action={signOut} className="flex items-center gap-3 text-xs text-neutral-500">
      {email && <span className="hidden sm:inline">{email}</span>}
      <button type="submit" className="underline decoration-dotted underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300">
        Salir
      </button>
    </form>
  );
}
