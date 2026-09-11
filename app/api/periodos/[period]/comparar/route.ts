import { NextResponse, type NextRequest } from "next/server";
import { guardApi, safeError } from "@/lib/auth/api";
import { compareWithManualClose } from "@/lib/finance/compare";
import { isValidPeriod } from "@/lib/finance/period";
import { extractManualClose } from "@/lib/ingest/manual-close";
import { createDocumentStorage } from "@/lib/ingest/storage";
import { loadPeriodDocuments, loadPeriodLedger } from "@/lib/repositories";
import { createClient } from "@/lib/supabase/server";

/**
 * Compara el mes reconstruido con el cierre manual previo.
 *
 * El cierre manual es una referencia, no una verdad: toda diferencia se guarda
 * con veredicto `pending` y la clasifica una persona. El motor nunca se ajusta
 * para reproducir el histórico sin entender antes la causa.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ period: string }> },
) {
  const guard = await guardApi({ write: true });
  if (!guard.ok) return guard.response;

  const { period } = await params;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "Periodo inválido." }, { status: 400 });
  }

  try {
    const ledger = await loadPeriodLedger(period);
    if (!ledger) {
      return NextResponse.json(
        { error: "El periodo no está procesado todavía." },
        { status: 409 },
      );
    }

    const registry = await loadPeriodDocuments(period);
    const extraction = await extractManualClose(registry, createDocumentStorage());

    if (extraction.lines.length === 0) {
      return NextResponse.json(
        { error: "No hay cierre manual legible.", warnings: extraction.warnings },
        { status: 409 },
      );
    }

    const comparison = compareWithManualClose(ledger, extraction.lines);

    // Se persiste para poder ir clasificando cada diferencia con calma. Se
    // rehace en cada comparación, pero conservando los veredictos ya decididos.
    const supabase = await createClient();
    const { data: previous } = await supabase
      .from("close_comparisons")
      .select("description, entry_date, delta_cents, verdict, resolution_note")
      .eq("period", period);

    const decided = new Map(
      (previous ?? [])
        .filter((row) => row.verdict !== "pending")
        .map((row) => [
          `${row.entry_date ?? ""}|${row.description}|${row.delta_cents}`,
          row,
        ]),
    );

    await supabase.from("close_comparisons").delete().eq("period", period);

    if (comparison.differences.length > 0) {
      const rows = comparison.differences.map((diff) => {
        const key = `${diff.date}|${diff.description}|${diff.deltaCents}`;
        const kept = decided.get(key);
        return {
          period,
          kind: diff.kind,
          // Un veredicto ya decidido por una persona sobrevive al recálculo.
          verdict: kept?.verdict ?? diff.verdict,
          resolution_note: kept?.resolution_note ?? null,
          entry_id: diff.entryId ?? null,
          entry_date: diff.date,
          description: diff.description,
          engine_amount_cents: diff.engineAmountCents,
          manual_amount_cents: diff.manualAmountCents,
          delta_cents: diff.deltaCents,
          evidence: diff.evidence,
        };
      });

      const { error } = await supabase.from("close_comparisons").insert(rows);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      period,
      manualLines: extraction.lines.length,
      source: extraction.source,
      warnings: extraction.warnings,
      matched: comparison.matchedCount,
      differences: comparison.differences.length,
      totals: comparison.totals,
      byKind: {
        only_in_engine: comparison.differences.filter((d) => d.kind === "only_in_engine").length,
        only_in_manual: comparison.differences.filter((d) => d.kind === "only_in_manual").length,
        amount_mismatch: comparison.differences.filter((d) => d.kind === "amount_mismatch").length,
      },
      items: comparison.differences.map((d) => ({
        kind: d.kind,
        verdict: d.verdict,
        date: d.date,
        description: d.description,
        engineAmountCents: d.engineAmountCents,
        manualAmountCents: d.manualAmountCents,
        deltaCents: d.deltaCents,
        evidence: d.evidence,
      })),
    });
  } catch (error) {
    return safeError(error, "No se ha podido comparar con el cierre manual.");
  }
}
