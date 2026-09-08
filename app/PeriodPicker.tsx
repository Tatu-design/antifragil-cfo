"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Selector de mes.
 *
 * Primer paso del flujo operativo: elegir el mes. Un periodo no hay que
 * "crearlo": se abre y ya se pueden arrastrar documentos.
 */
export function PeriodPicker({ defaultPeriod }: { defaultPeriod: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(defaultPeriod);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) router.push(`/periodo/${period}`);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        type="month"
        value={period}
        onChange={(event) => setPeriod(event.target.value)}
        className="rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        aria-label="Mes"
      />
      <button
        type="submit"
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Abrir mes
      </button>
    </form>
  );
}
