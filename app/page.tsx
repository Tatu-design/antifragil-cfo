import Link from "next/link";
import { listAnalyzedPeriods } from "@/lib/period-store";
import { periodLabel } from "@/lib/finance/period";

/**
 * Portada: elegir periodo.
 *
 * Los periodos disponibles son los ya analizados con `npm run cfo -- analyze`.
 * No se muestra ninguna cifra aquí: solo el acceso a cada mes.
 */
// Lee la carpeta local de trabajo en cada visita: si se prerenderizara, la
// lista de periodos se congelaría con lo que hubiera en el momento del build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const periods = await listAnalyzedPeriods();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Antifrágil</p>
        <h1 className="text-3xl font-semibold tracking-tight">CFO</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Conciliación de los movimientos de tesorería (banco SL, banco SC y caja)
          con su documentación justificativa.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">Periodos</h2>
        {periods.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="mb-3 text-neutral-600 dark:text-neutral-400">
              Todavía no hay ningún periodo analizado. Procesa uno desde la terminal:
            </p>
            <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
              <code>{`npm run cfo -- inspect 2026-09
npm run cfo -- analyze 2026-09`}</code>
            </pre>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {periods.map((period) => (
              <li key={period}>
                <Link
                  href={`/periodo/${period}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium capitalize">{periodLabel(period)}</span>
                  <span className="text-neutral-500">{period} →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Los datos se leen de la carpeta local de trabajo. Ningún comando escribe sobre
        los documentos originales del negocio.
      </p>
    </main>
  );
}
