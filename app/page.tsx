import Link from "next/link";
import { redirect } from "next/navigation";
import { authorize } from "@/lib/auth/guard";
import { SignOutButton } from "./SignOutButton";
import { periodLabel } from "@/lib/finance/period";
import { listAnalyzedPeriods, listPeriodsWithDocuments } from "@/lib/repositories";
import { PeriodPicker } from "./PeriodPicker";

/**
 * Portada: elegir mes.
 *
 * El flujo operativo empieza aquí: seleccionar mes → arrastrar archivos →
 * procesar → revisar. No se muestra ninguna cifra en esta pantalla.
 */

// Lee la zona de trabajo en cada visita: prerenderizarla congelaría la lista.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Segunda barrera, independiente del middleware: ninguna página financiera
  // se renderiza sin comprobar la autorización en servidor.
  const auth = await authorize();
  if (!auth.ok) redirect("/login");

  const [analyzed, withDocuments] = await Promise.all([
    listAnalyzedPeriods(),
    listPeriodsWithDocuments(),
  ]);
  const periods = [...new Set([...analyzed, ...withDocuments])].sort().reverse();

  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Antifrágil</p>
          <SignOutButton email={auth.user.email} isLocalDev={auth.user.isLocalDev} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">CFO</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Conciliación de los movimientos de tesorería (banco SL, banco SC y caja)
          con su documentación justificativa.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Abrir un mes</h2>
        <PeriodPicker defaultPeriod={defaultPeriod} />
        <p className="text-xs text-neutral-500">
          Abre el mes y arrastra sus documentos. No hace falta prepararlo antes.
        </p>
      </section>

      {periods.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
            Meses con actividad
          </h2>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {periods.map((period) => (
              <li key={period}>
                <Link
                  href={`/periodo/${period}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium capitalize">{periodLabel(period)}</span>
                  <span className="text-neutral-500">
                    {analyzed.includes(period) ? "procesado" : "sin procesar"} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
