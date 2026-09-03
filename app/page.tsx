/**
 * Página de estado del proyecto.
 *
 * La interfaz operativa (dashboard mensual, incidencias, Cash Flow) llega
 * cuando el motor financiero esté validado con agosto 2026. Hasta entonces esta
 * página solo dice en qué punto está el sistema. No muestra ningún dato
 * financiero.
 */

const phases = [
  { name: "Motor financiero (reglas, conciliación, incidencias)", done: true },
  { name: "Lectura de fuentes locales e informes de auditoría", done: true },
  { name: "Esquema Supabase con RLS", done: true },
  { name: "Inspección de los documentos reales de agosto 2026", done: false },
  { name: "Importación a Supabase y cierre de mes", done: false },
  { name: "Integración con Google Drive", done: false },
  { name: "Interfaz operativa mensual", done: false },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Antifrágil
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">CFO</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Sistema financiero interno. Convierte extractos, facturas y ventas en un
          ledger trazable, y el Cash Flow en una vista calculada sobre él.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-neutral-500 uppercase">
          Estado
        </h2>
        <ul className="space-y-2">
          {phases.map((phase) => (
            <li key={phase.name} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={`mt-1.5 size-2 shrink-0 rounded-full ${
                  phase.done ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
              <span className={phase.done ? "" : "text-neutral-500"}>
                {phase.name}
                <span className="sr-only">{phase.done ? " (completado)" : " (pendiente)"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="font-medium">El motor se usa desde la línea de comandos</h2>
        <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
          <code>{`npm run cfo -- inspect 2026-08
npm run cfo -- analyze 2026-08`}</code>
        </pre>
        <p className="text-neutral-600 dark:text-neutral-400">
          Ningún comando escribe sobre los documentos originales del negocio.
        </p>
      </section>
    </main>
  );
}
