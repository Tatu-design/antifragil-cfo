/**
 * Comparación entre el mes reconstruido por el motor y un cierre manual previo.
 *
 * Agosto 2026 ya se cerró a mano. Ese cierre es una referencia MUY valiosa,
 * pero no una verdad infalible: puede contener errores, igual que el motor.
 *
 * Por eso este módulo NO ajusta nada ni asume quién tiene razón. Empareja lo
 * que puede, aísla las diferencias y aporta la evidencia disponible para que
 * una persona decida. Toda diferencia nace como `pending`.
 *
 * Regla explícita: si el motor difiere del cierre manual, NO se retoca el
 * algoritmo para reproducir el resultado histórico. Primero se entiende la
 * causa; solo se cambia el motor si el equivocado es el motor.
 */

import { absCents, formatCents } from "./money";
import { daysBetween } from "./period";
import { similarity } from "./text";
import type { LedgerEntry, PeriodLedger } from "./types";

/** Línea del cierre manual, leída del Cash Flow histórico. */
export interface ManualLine {
  date: string;
  description: string;
  /** Importe en céntimos, con signo (negativo = gasto). */
  amountCents: number;
  category?: string | null;
  pnl?: string | null;
  treasury?: string | null;
  /** Origen exacto de la línea, para poder volver a ella. */
  sourceRow?: number | null;
}

export type DifferenceKind =
  /** Está en el motor y no en el cierre manual. */
  | "only_in_engine"
  /** Está en el cierre manual y no en el motor. */
  | "only_in_manual"
  /** Emparejados, pero con importes distintos. */
  | "amount_mismatch";

/**
 * Clasificación de una diferencia. Nace SIEMPRE como `pending`: decidir quién
 * se equivocó es una tarea humana, no del motor.
 */
export type DifferenceVerdict =
  | "pending"
  | "probable_engine_error"
  | "probable_manual_error"
  | "criteria_difference";

export interface Difference {
  kind: DifferenceKind;
  verdict: DifferenceVerdict;
  date: string;
  description: string;
  engineAmountCents: number | null;
  manualAmountCents: number | null;
  deltaCents: number;
  /** Apunte del motor implicado, si lo hay. */
  entryId?: string;
  /** Evidencia objetiva que ayuda a decidir, sin concluir por el usuario. */
  evidence: string[];
}

export interface ComparisonResult {
  period: string;
  matchedCount: number;
  differences: Difference[];
  totals: {
    engineIncomeCents: number;
    engineExpenseCents: number;
    manualIncomeCents: number;
    manualExpenseCents: number;
    incomeDeltaCents: number;
    expenseDeltaCents: number;
  };
}

export interface CompareOptions {
  /** Ventana de días para considerar que dos líneas son la misma operación. */
  dateWindowDays?: number;
  /** Similitud mínima de descripción para emparejar. */
  minDescriptionSimilarity?: number;
}

export function compareWithManualClose(
  ledger: PeriodLedger,
  manualLines: ManualLine[],
  options: CompareOptions = {},
): ComparisonResult {
  const dateWindow = options.dateWindowDays ?? 7;
  const minSimilarity = options.minDescriptionSimilarity ?? 0.4;

  // Los movimientos internos no aparecen en un Cash Flow: compararlos generaría
  // diferencias falsas por diseño.
  const engineEntries = ledger.entries.filter((e) => e.direction !== "internal");

  const usedManual = new Set<number>();
  const differences: Difference[] = [];
  let matchedCount = 0;

  for (const entry of engineEntries) {
    const index = findBestManualMatch(entry, manualLines, usedManual, dateWindow, minSimilarity);

    if (index === null) {
      differences.push({
        kind: "only_in_engine",
        verdict: "pending",
        date: entry.date,
        description: entry.description,
        engineAmountCents: entry.amountCents,
        manualAmountCents: null,
        deltaCents: entry.amountCents,
        entryId: entry.id,
        evidence: engineEvidence(entry),
      });
      continue;
    }

    usedManual.add(index);
    const manual = manualLines[index];

    if (manual.amountCents === entry.amountCents) {
      matchedCount += 1;
      continue;
    }

    differences.push({
      kind: "amount_mismatch",
      verdict: "pending",
      date: entry.date,
      description: entry.description,
      engineAmountCents: entry.amountCents,
      manualAmountCents: manual.amountCents,
      deltaCents: entry.amountCents - manual.amountCents,
      entryId: entry.id,
      evidence: [
        `Motor ${formatCents(entry.amountCents)} vs cierre manual ${formatCents(manual.amountCents)}.`,
        ...engineEvidence(entry),
        manual.sourceRow ? `Línea ${manual.sourceRow} del cierre manual.` : "",
      ].filter(Boolean),
    });
  }

  manualLines.forEach((manual, index) => {
    if (usedManual.has(index)) return;
    differences.push({
      kind: "only_in_manual",
      verdict: "pending",
      date: manual.date,
      description: manual.description,
      engineAmountCents: null,
      manualAmountCents: manual.amountCents,
      deltaCents: -manual.amountCents,
      evidence: [
        "No hay ningún movimiento equivalente en las fuentes de tesorería procesadas.",
        "Puede ser: un movimiento de una cuenta no incorporada, un apunte manual del cierre, o un error histórico.",
        manual.sourceRow ? `Línea ${manual.sourceRow} del cierre manual.` : "",
      ].filter(Boolean),
    });
  });

  differences.sort(
    (a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || a.date.localeCompare(b.date),
  );

  return {
    period: ledger.period,
    matchedCount,
    differences,
    totals: buildTotals(engineEntries, manualLines),
  };
}

function findBestManualMatch(
  entry: LedgerEntry,
  manualLines: ManualLine[],
  used: Set<number>,
  dateWindow: number,
  minSimilarity: number,
): number | null {
  let bestIndex: number | null = null;
  let bestScore = 0;

  manualLines.forEach((manual, index) => {
    if (used.has(index)) return;
    if (Math.abs(daysBetween(manual.date, entry.date)) > dateWindow) return;

    const sameSign = Math.sign(manual.amountCents) === Math.sign(entry.amountCents);
    if (!sameSign) return;

    const exactAmount = absCents(manual.amountCents) === absCents(entry.amountCents);
    const descriptionScore = similarity(entry.description, manual.description);

    // Importe exacto es señal fuerte; si no, hace falta descripción parecida.
    if (!exactAmount && descriptionScore < minSimilarity) return;

    const score = (exactAmount ? 0.6 : 0) + 0.4 * descriptionScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

/** Evidencia objetiva del lado del motor. Describe, no concluye. */
function engineEvidence(entry: LedgerEntry): string[] {
  const evidence = [
    `Origen: ${entry.source.file}${entry.source.row ? `, fila ${entry.source.row}` : ""} (${entry.accountId}).`,
  ];

  if (entry.aggregates?.length) {
    evidence.push(`Línea consolidada de ${entry.aggregates.length} movimientos.`);
  }
  if (entry.documents.length > 0) {
    evidence.push(`Documento asociado: ${entry.documents[0].ref.name}.`);
  } else if (entry.reconciliation === "missing_document") {
    evidence.push("Sin documento justificativo localizado.");
  }

  return evidence;
}

function buildTotals(
  engineEntries: LedgerEntry[],
  manualLines: ManualLine[],
): ComparisonResult["totals"] {
  const engineIncomeCents = sum(engineEntries.filter((e) => e.amountCents > 0).map((e) => e.amountCents));
  const engineExpenseCents = sum(
    engineEntries.filter((e) => e.amountCents < 0).map((e) => Math.abs(e.amountCents)),
  );
  const manualIncomeCents = sum(manualLines.filter((l) => l.amountCents > 0).map((l) => l.amountCents));
  const manualExpenseCents = sum(
    manualLines.filter((l) => l.amountCents < 0).map((l) => Math.abs(l.amountCents)),
  );

  return {
    engineIncomeCents,
    engineExpenseCents,
    manualIncomeCents,
    manualExpenseCents,
    incomeDeltaCents: engineIncomeCents - manualIncomeCents,
    expenseDeltaCents: engineExpenseCents - manualExpenseCents,
  };
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Informe de comparación en Markdown. */
export function renderComparisonReport(result: ComparisonResult): string {
  const out: string[] = [];
  out.push(`# Comparación motor vs cierre manual — ${result.period}`, "");
  out.push(
    "> Ninguna de las dos versiones se presume correcta. Toda diferencia nace como",
    "> `pending` y la clasifica una persona. El motor NO se ajusta para reproducir",
    "> el resultado histórico sin entender antes la causa.",
    "",
  );

  const t = result.totals;
  out.push("## Totales", "");
  out.push("| Concepto | Motor | Cierre manual | Diferencia |");
  out.push("|----------|-------|---------------|------------|");
  out.push(
    `| Ingresos | ${formatCents(t.engineIncomeCents)} | ${formatCents(t.manualIncomeCents)} | ${formatCents(t.incomeDeltaCents)} |`,
  );
  out.push(
    `| Gastos | ${formatCents(t.engineExpenseCents)} | ${formatCents(t.manualExpenseCents)} | ${formatCents(t.expenseDeltaCents)} |`,
  );
  out.push("");

  out.push(`- Líneas emparejadas sin diferencia: **${result.matchedCount}**`);
  out.push(`- Diferencias a investigar: **${result.differences.length}**`, "");

  if (result.differences.length === 0) {
    out.push("_Sin diferencias._");
    return out.join("\n");
  }

  out.push("## Diferencias", "");
  for (const diff of result.differences) {
    out.push(
      `### ${KIND_LABELS[diff.kind]} · ${diff.date} · ${diff.description}`,
      "",
      `- Motor: ${diff.engineAmountCents === null ? "—" : formatCents(diff.engineAmountCents)}`,
      `- Cierre manual: ${diff.manualAmountCents === null ? "—" : formatCents(diff.manualAmountCents)}`,
      `- Veredicto: **${diff.verdict}** (pendiente de decisión humana)`,
      "",
    );
    for (const line of diff.evidence) out.push(`  - ${line}`);
    out.push("");
  }

  return out.join("\n");
}

const KIND_LABELS: Record<DifferenceKind, string> = {
  only_in_engine: "Solo en el motor",
  only_in_manual: "Solo en el cierre manual",
  amount_mismatch: "Importe distinto",
};
