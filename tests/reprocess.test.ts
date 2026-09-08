/**
 * Tests del reprocesado incremental.
 *
 * El caso que protegen: septiembre tiene movimientos sin justificar, mañana
 * aparecen las facturas que faltaban, se arrastran sobre el mes y el sistema
 * resuelve solo esas incidencias — sin rehacer ni duplicar lo demás.
 */

import { describe, expect, it } from "vitest";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { reprocessPending } from "../lib/finance/reprocess";
import type { LedgerEntry, SupportingDocument } from "../lib/finance/types";
import { syntheticDocuments, syntheticPeriod } from "./fixtures/synthetic-period";

/** Ledger de partida: sin el documento que justifica el material comprado. */
function ledgerWithMissingDocument() {
  const input = syntheticPeriod();
  return buildPeriodLedger(input);
}

/** La factura que mañana aparece y justifica el material de 145,00 €. */
function lateInvoice(): SupportingDocument {
  return {
    id: "doc-late",
    docType: "invoice",
    issuer: "MATERIAL DEMO",
    reference: "MD-2026-09",
    date: "2026-09-07",
    amountCents: 14500,
    period: "2026-09",
    document: {
      name: "G_Material Demo septiembre 26.pdf",
      docType: "invoice",
      driveFileId: null,
      url: null,
      issuer: "MATERIAL DEMO",
      date: "2026-09-07",
      amountCents: 14500,
    },
    source: { kind: "supporting_document", file: "G_Material Demo septiembre 26.pdf" },
  };
}

function find(entries: LedgerEntry[], needle: string): LedgerEntry | undefined {
  return entries.find((e) => e.description.toLowerCase().includes(needle.toLowerCase()));
}

describe("reprocesado incremental", () => {
  it("resuelve la incidencia con el documento que llega tarde", () => {
    const ledger = ledgerWithMissingDocument();
    const before = find(ledger.entries, "MATERIAL DEMO");
    expect(before?.reconciliation).toBe("missing_document");

    const result = reprocessPending(ledger, [...syntheticDocuments(), lateInvoice()]);
    const after = find(result.ledger.entries, "MATERIAL DEMO");

    expect(after?.reconciliation).toBe("reconciled");
    expect(after?.documents[0].ref.name).toContain("Material Demo");
    expect(result.resolvedEntryIds).toContain(after!.id);
  });

  it("no toca los movimientos que ya estaban resueltos", () => {
    const ledger = ledgerWithMissingDocument();
    const digitalBefore = find(ledger.entries, "PROVEEDOR DIGITAL");
    const comisionBefore = find(ledger.entries, "COMISION");

    const result = reprocessPending(ledger, [...syntheticDocuments(), lateInvoice()]);
    const digitalAfter = find(result.ledger.entries, "PROVEEDOR DIGITAL");
    const comisionAfter = find(result.ledger.entries, "COMISION");

    expect(digitalAfter).toEqual(digitalBefore);
    expect(comisionAfter).toEqual(comisionBefore);
    // La mayoría del periodo queda intacta: es reprocesado, no reconstrucción.
    expect(result.untouchedCount).toBeGreaterThan(result.ledger.entries.length / 2);
  });

  it("no duplica movimientos ni cambia sus identificadores", () => {
    const ledger = ledgerWithMissingDocument();
    const result = reprocessPending(ledger, [...syntheticDocuments(), lateInvoice()]);

    expect(result.ledger.entries).toHaveLength(ledger.entries.length);
    expect(result.ledger.entries.map((e) => e.id).sort()).toEqual(
      ledger.entries.map((e) => e.id).sort(),
    );
  });

  it("respeta lo que una persona ya ha revisado o aprobado", () => {
    const ledger = ledgerWithMissingDocument();
    const decided = {
      ...ledger,
      entries: ledger.entries.map((entry) =>
        entry.description.includes("MATERIAL DEMO")
          ? {
              ...entry,
              reviewStatus: "approved" as const,
              reconciliation: "not_document_required" as const,
              reconciliationReason: "Confirmado: no existe documento.",
            }
          : entry,
      ),
    };

    const result = reprocessPending(decided, [...syntheticDocuments(), lateInvoice()]);
    const entry = find(result.ledger.entries, "MATERIAL DEMO");

    // La decisión humana manda sobre el documento que aparece después.
    expect(entry?.reconciliation).toBe("not_document_required");
    expect(entry?.documents).toHaveLength(0);
  });

  it("no reutiliza un documento que ya justifica otro movimiento", () => {
    const ledger = ledgerWithMissingDocument();
    const result = reprocessPending(ledger, [...syntheticDocuments(), lateInvoice()]);

    const names = result.ledger.entries.flatMap((e) => e.documents.map((d) => d.ref.name));
    expect(new Set(names).size).toBe(names.length - countGroupedDuplicates(result.ledger.entries));
  });

  it("actualiza las métricas de conciliación tras resolver", () => {
    const ledger = ledgerWithMissingDocument();
    const result = reprocessPending(ledger, [...syntheticDocuments(), lateInvoice()]);

    expect(result.ledger.summary.reconciledPct).toBeGreaterThan(ledger.summary.reconciledPct);
    expect(result.ledger.summary.unjustifiedAmountCents).toBeLessThan(
      ledger.summary.unjustifiedAmountCents,
    );
  });

  it("informa de qué sigue sin resolverse", () => {
    const ledger = ledgerWithMissingDocument();
    const result = reprocessPending(ledger, syntheticDocuments());

    // Sin documentos nuevos, lo que faltaba sigue faltando y se dice cuál es.
    expect(result.resolvedEntryIds).toHaveLength(0);
    expect(result.stillUnresolvedEntryIds.length).toBeGreaterThan(0);
  });

  it("no hace nada cuando no hay nada abierto", () => {
    const ledger = ledgerWithMissingDocument();
    const closed = {
      ...ledger,
      entries: ledger.entries.map((entry) => ({
        ...entry,
        reconciliation: "reconciled" as const,
      })),
    };

    const result = reprocessPending(closed, [lateInvoice()]);

    expect(result.untouchedCount).toBe(closed.entries.length);
    expect(result.resolvedEntryIds).toHaveLength(0);
  });
});

/** Los documentos compartidos por un grupo (una nómina, dos cargos) se repiten. */
function countGroupedDuplicates(entries: LedgerEntry[]): number {
  const groups = new Map<string, number>();
  for (const entry of entries) {
    for (const doc of entry.documents) {
      if (!doc.groupId) continue;
      groups.set(doc.groupId, (groups.get(doc.groupId) ?? 0) + 1);
    }
  }
  return [...groups.values()].reduce((acc, count) => acc + (count - 1), 0);
}
