import { NextResponse, type NextRequest } from "next/server";
import { isValidPeriod } from "@/lib/finance/period";
import { processPeriod } from "@/lib/ingest/process-period";

/**
 * Procesa el mes con lo que hay subido.
 *
 * El usuario pulsa "Procesar" y no tiene que saber si el sistema reconstruye el
 * periodo o solo reintenta las incidencias pendientes: eso lo decide el motor.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ period: string }> },
) {
  const { period } = await params;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "Periodo inválido." }, { status: 400 });
  }

  try {
    const result = await processPeriod(period);
    const summary = result.ledger.summary;

    return NextResponse.json({
      mode: result.mode,
      movements: summary.entryCount,
      reconciledPct: summary.reconciledPct,
      pendingReview: summary.pendingReviewCount,
      resolved: result.resolvedCount,
      skipped: result.skipped,
      problemCount: result.problemCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al procesar el periodo." },
      { status: 500 },
    );
  }
}
