import { NextResponse, type NextRequest } from "next/server";
import { isValidPeriod } from "@/lib/finance/period";
import { resolveDocument } from "@/lib/ingest/registry";

/**
 * Resuelve la duda pendiente sobre un documento.
 *
 * Solo dos cosas: de qué cuenta es un extracto, o qué es un archivo que no se
 * ha podido identificar. Cualquier otra corrección se hará cuando se diseñe el
 * flujo de clasificación, que está deliberadamente aplazado.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set([
  "supporting_document",
  "bank_statement",
  "cash_account",
  "clinic_bank_sales",
  "clinic_cash_sales",
]);

const ALLOWED_ACCOUNTS = new Set(["sl_bank", "sc_bank", "cash"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ period: string; hash: string }> },
) {
  const { period, hash } = await params;
  if (!isValidPeriod(period)) {
    return NextResponse.json({ error: "Periodo inválido." }, { status: 400 });
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  }

  let body: { kind?: unknown; accountId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind : undefined;
  const accountId = typeof body.accountId === "string" ? body.accountId : undefined;

  if (kind && !ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "Tipo de documento no válido." }, { status: 400 });
  }
  if (accountId && !ALLOWED_ACCOUNTS.has(accountId)) {
    return NextResponse.json({ error: "Cuenta no válida." }, { status: 400 });
  }
  if (!kind && !accountId) {
    return NextResponse.json({ error: "No se ha indicado nada que resolver." }, { status: 400 });
  }

  // Indicar la cuenta implica que es un extracto: se deja coherente.
  const resolution = accountId ? { accountId, kind: kind ?? "bank_statement" } : { kind };
  const registry = await resolveDocument(period, hash, resolution);

  return NextResponse.json({
    pending: registry.documents.filter((d) => d.needsReview).length,
  });
}
