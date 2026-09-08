/**
 * Tests de las reglas financieras del motor.
 *
 * La misión actual es conciliar todos los movimientos reales de tesorería con
 * su documentación justificativa. Estos tests protegen exactamente eso: si uno
 * falla, el mes NO puede darse por bueno.
 */

import { describe, expect, it } from "vitest";
import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK } from "../lib/finance/accounts";
import { mergeEntries } from "../lib/finance/dedupe";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { buildPeriodView } from "../lib/finance/period-view";
import { buildReviewQueue } from "../lib/finance/review-queue";
import type { Incident, LedgerEntry } from "../lib/finance/types";
import {
  SYNTHETIC_PERIOD,
  syntheticClinicBankSales,
  syntheticPeriod,
} from "./fixtures/synthetic-period";

function incidentsOfType(incidents: Incident[], type: string): Incident[] {
  return incidents.filter((i) => i.type === type);
}

function findEntry(entries: LedgerEntry[], needle: string): LedgerEntry | undefined {
  return entries.find((e) => e.description.toLowerCase().includes(needle.toLowerCase()));
}

describe("Multi-cuenta: SL, SC y caja convergen en un único ledger", () => {
  it("conserva la cuenta de origen de cada movimiento", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());

    expect(findEntry(ledger.entries, "PROVEEDOR DIGITAL")?.accountId).toBe(ACCOUNT_SL_BANK);
    expect(findEntry(ledger.entries, "MODELO 303")?.accountId).toBe(ACCOUNT_SC_BANK);
    expect(findEntry(ledger.entries, "ENTRENADOR DEMO")?.accountId).toBe(ACCOUNT_CASH);
    expect(ledger.entries.every((e) => e.accountId !== "")).toBe(true);
  });

  it("resume ingresos, gastos y neto por cuenta", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const sl = ledger.summary.byAccount[ACCOUNT_SL_BANK];
    const sc = ledger.summary.byAccount[ACCOUNT_SC_BANK];
    const cash = ledger.summary.byAccount[ACCOUNT_CASH];

    // SL: datáfono 2.000 + transferencia 500 de ingreso; 21,83 + 145 + 12 de gasto.
    expect(sl.incomeCents).toBe(250000);
    expect(sl.expenseCents).toBe(17883);
    // SC: dos cargos de nómina (1.000) + impuesto (350).
    expect(sc.incomeCents).toBe(0);
    expect(sc.expenseCents).toBe(135000);
    expect(sc.legalEntity).toBe("SC");
    // Caja: ventas cash 100 de ingreso, entrenador 400 de gasto.
    expect(cash.incomeCents).toBe(10000);
    expect(cash.expenseCents).toBe(40000);
  });

  it("distingue dos movimientos idénticos en cuentas distintas", () => {
    const input = syntheticPeriod();
    const original = input.bankMovements[1];
    input.bankMovements = [
      ...input.bankMovements,
      { ...original, accountId: ACCOUNT_SC_BANK, source: { ...original.source, accountId: ACCOUNT_SC_BANK } },
    ];

    const ledger = buildPeriodLedger(input);
    const same = ledger.entries.filter((e) => e.amountCents === -14500);

    expect(same).toHaveLength(2);
    expect(same[0].id).not.toBe(same[1].id);
    // Mismo importe en cuentas distintas no es un duplicado sospechoso.
    expect(incidentsOfType(ledger.incidents, "DUPLICATE_SUSPECT").filter((i) => i.entryIds.length === 2)).toHaveLength(0);
  });
});

describe("Documento justificativo, no solo factura", () => {
  it("concilia un gasto con su factura y guarda la evidencia", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "PROVEEDOR DIGITAL");

    expect(entry?.reconciliation).toBe("reconciled");
    expect(entry?.documents).toHaveLength(1);
    expect(entry?.documents[0].score).toBeGreaterThan(0.5);
    expect(entry?.documents[0].reasons.join(" ")).toContain("importe exacto");
    expect(entry?.documents[0].ref.url).toContain("drive.google.com");
  });

  it("concilia un impuesto con su documento (no es una factura)", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "MODELO 303");

    expect(entry?.reconciliation).toBe("reconciled");
    expect(entry?.documents[0].ref.docType).toBe("tax");
  });

  it("marca como not_document_required lo que nunca tendrá documento", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const comision = findEntry(ledger.entries, "COMISION MANTENIMIENTO");

    expect(comision?.reconciliation).toBe("not_document_required");
    expect(comision?.reconciliationReason).toContain("Comisión bancaria");
    // No es una excepción: no debe aparecer en la cola de revisión por documento.
    const queue = buildReviewQueue(ledger);
    expect(queue.items.some((i) => i.entryId === comision?.id && i.reason === "missing_document")).toBe(false);
  });

  it("trata los movimientos internos como no necesitados de documento", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const traspaso = findEntry(ledger.entries, "TRASPASO A CUENTA PROPIA");

    expect(traspaso?.direction).toBe("internal");
    expect(traspaso?.reconciliation).toBe("not_document_required");
  });

  it("reporta el movimiento sin documento y lo deja en el ledger", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "MATERIAL DEMO SIN DOCUMENTO");

    expect(entry?.reconciliation).toBe("missing_document");
    expect(entry?.reviewStatus).toBe("needs_review");
    expect(
      incidentsOfType(ledger.incidents, "MOVEMENT_WITHOUT_DOCUMENT").some((i) =>
        i.entryIds.includes(entry!.id),
      ),
    ).toBe(true);
  });

  it("reporta el ingreso sin documentación", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const incidents = incidentsOfType(ledger.incidents, "INCOME_WITHOUT_DOCUMENT");

    expect(incidents).toHaveLength(1);
    expect(incidents[0].message).toContain("CLIENTE DEMO");
  });

  it("reporta el documento sin movimiento y NO lo convierte en gasto", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const incidents = incidentsOfType(ledger.incidents, "DOCUMENT_WITHOUT_MOVEMENT");

    expect(incidents).toHaveLength(1);
    expect(incidents[0].message).toContain("ASESORIA DEMO SL");
    expect(ledger.entries.filter((e) => Math.abs(e.amountCents) === 33000)).toHaveLength(0);
  });
});

describe("Matching de varias cardinalidades", () => {
  it("asocia un único documento a los dos cargos que lo pagan", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const nominas = ledger.entries.filter((e) => e.description.includes("NOMINA DEMO"));

    expect(nominas).toHaveLength(2);
    for (const entry of nominas) {
      expect(entry.reconciliation).toBe("reconciled");
      expect(entry.documents[0].method).toBe("aggregate_sum");
      expect(entry.documents[0].ref.docType).toBe("payroll");
    }
    // Ambos comparten el mismo grupo: es un único documento, no dos.
    expect(nominas[0].documents[0].groupId).toBe(nominas[1].documents[0].groupId);
  });

  it("no reutiliza un documento ya usado por otro movimiento", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const usedNames = ledger.entries
      .flatMap((e) => e.documents.map((d) => ({ name: d.ref.name, groupId: d.groupId ?? e.id })));
    const byName = new Map<string, Set<string>>();
    for (const { name, groupId } of usedNames) {
      byName.set(name, (byName.get(name) ?? new Set()).add(groupId));
    }
    // Cada documento pertenece a un único grupo de conciliación.
    for (const groups of byName.values()) expect(groups.size).toBe(1);
  });
});

describe("Datáfono", () => {
  it("concilia por suma mensual y consolida en UNA línea", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());

    expect(ledger.cardSettlement?.bankTotalCents).toBe(200000);
    expect(ledger.cardSettlement?.salesTotalCents).toBe(200000);
    expect(ledger.cardSettlement?.reconciled).toBe(true);

    const consolidated = ledger.entries.filter((e) => e.aggregates !== undefined);
    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].amountCents).toBe(200000);
    expect(consolidated[0].documents[0].method).toBe("aggregate_period");
    expect(
      ledger.entries.filter(
        (e) => e.rawDescription.includes("LIQUIDACION DE REMESAS") && e.aggregates === undefined,
      ),
    ).toHaveLength(0);
  });

  it("reporta la diferencia sin ajustar ninguna cifra", () => {
    const input = syntheticPeriod();
    input.clinicBankSales = syntheticClinicBankSales().slice(1);

    const ledger = buildPeriodLedger(input);

    expect(ledger.cardSettlement?.differenceCents).toBe(60000);
    expect(ledger.cardSettlement?.reconciled).toBe(false);
    expect(incidentsOfType(ledger.incidents, "CARD_SETTLEMENT_MISMATCH")).toHaveLength(1);

    const consolidated = ledger.entries.find((e) => e.aggregates !== undefined);
    expect(consolidated?.amountCents).toBe(200000);
    expect(consolidated?.reviewStatus).toBe("needs_review");

    const queue = buildReviewQueue(ledger);
    expect(queue.counts.card_settlement_mismatch).toBe(1);
  });
});

describe("Cash y movimientos internos", () => {
  it("incorpora el gasto cash conservando su clasificación", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "ENTRENADOR DEMO");

    expect(entry?.direction).toBe("expense");
    expect(entry?.treasury).toBe("cash");
    expect(entry?.category).toBe("Entrenadores");
    expect(entry?.pnl).toBe("Personal Directo");
    expect(entry?.classificationStatus).toBe("manual");
  });

  it("no convierte la retirada de caja en ingreso ni gasto", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "Retirada de caja");

    expect(entry?.direction).toBe("internal");
    expect(entry?.classificationStatus).toBe("not_applicable");
  });

  it("deja los movimientos internos fuera del resultado", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());

    // Ingresos: datáfono 2.000 + transferencia 500 + ventas cash 100.
    expect(ledger.summary.incomeCents).toBe(260000);
    // Gastos: 21,83 + 145 + 12 (SL) + 1.000 + 350 (SC) + 400 (cash).
    expect(ledger.summary.expenseCents).toBe(192883);
    expect(ledger.summary.internalMovementCount).toBe(3);
  });

  it("no reconoce como ingreso la entrada de efectivo de la cuenta de cash", () => {
    const input = syntheticPeriod();
    input.cashMovements = [
      ...input.cashMovements,
      {
        date: "2026-09-19",
        concept: "Cobro sesiones efectivo",
        amountCents: 10000,
        accountId: ACCOUNT_CASH,
        category: null,
        pnl: null,
        source: { kind: "cash_account", file: "cuenta-cash-sintetica.xlsx", accountId: ACCOUNT_CASH, row: 9 },
      },
    ];

    const ledger = buildPeriodLedger(input);
    expect(findEntry(ledger.entries, "Cobro sesiones efectivo")?.direction).toBe("internal");
    // El ingreso cash sigue siendo solo el del Excel de ventas: 100,00 €.
    expect(ledger.summary.byAccount[ACCOUNT_CASH].incomeCents).toBe(10000);
  });

  it("obtiene el ingreso cash del Excel de ventas, no de las retiradas", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "Playamar — Cash");

    expect(entry?.direction).toBe("income");
    expect(entry?.amountCents).toBe(10000);
    expect(entry?.accountId).toBe(ACCOUNT_CASH);
  });
});

describe("Clasificación", () => {
  it("no clasifica por su cuenta: deja pendiente y lo pone en la cola", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const entry = findEntry(ledger.entries, "PROVEEDOR DIGITAL");

    expect(entry?.category).toBeNull();
    expect(entry?.pnl).toBeNull();
    expect(entry?.classificationStatus).toBe("pending");

    const queue = buildReviewQueue(ledger);
    expect(queue.counts.unclassified).toBeGreaterThan(0);
    expect(incidentsOfType(ledger.incidents, "UNCLASSIFIED_MOVEMENT")).toHaveLength(1);
  });
});

describe("Métricas del MVP", () => {
  it("calcula conciliación, pendientes e importe sin justificar", () => {
    const view = buildPeriodView(buildPeriodLedger(syntheticPeriod()));
    const m = view.metrics;

    expect(m.incomeCents).toBe(260000);
    expect(m.expenseCents).toBe(192883);
    expect(m.netCashFlowCents).toBe(67117);
    expect(m.reconciledPct).toBeGreaterThan(0);
    expect(m.reconciledPct).toBeLessThanOrEqual(100);
    // Sin justificar: material 145 + ingreso 500 + gasto cash del entrenador 400.
    expect(m.unjustifiedAmountCents).toBe(104500);
    expect(m.byAccount.length).toBe(3);
  });

  it("no reconoce dos veces el mismo ingreso de clínica", () => {
    const view = buildPeriodView(buildPeriodLedger(syntheticPeriod()));
    const clinic = view.movements.filter((l) => l.description.includes("Playamar"));

    expect(clinic).toHaveLength(2);
    expect(view.metrics.incomeCents).toBe(260000);
  });
});

describe("Cola de revisión", () => {
  it("agrupa exactamente las excepciones que una persona debe mirar", () => {
    const queue = buildReviewQueue(buildPeriodLedger(syntheticPeriod()));

    // Material sin doc, ingreso sin doc y gasto cash sin justificante.
    expect(queue.counts.missing_document).toBe(3);
    expect(queue.counts.document_without_movement).toBe(1);
    expect(queue.counts.unclassified).toBeGreaterThan(0);
    expect(queue.counts.card_settlement_mismatch).toBe(0);
    // La cola se ordena por prioridad: lo más grave primero.
    expect(queue.items[0].priority).toBeLessThanOrEqual(queue.items[queue.items.length - 1].priority);
  });
});

describe("Idempotencia", () => {
  it("produce exactamente los mismos ids al ejecutar dos veces", () => {
    const first = buildPeriodLedger(syntheticPeriod());
    const second = buildPeriodLedger(syntheticPeriod());

    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    expect(second.incidents.map((i) => i.id)).toEqual(first.incidents.map((i) => i.id));
    expect(second.summary).toEqual(first.summary);
  });

  it("al fusionar dos ejecuciones no duplica movimientos", () => {
    const first = buildPeriodLedger(syntheticPeriod());
    const second = buildPeriodLedger(syntheticPeriod());
    const { merged, added, updated } = mergeEntries(first.entries, second.entries);

    expect(merged).toHaveLength(first.entries.length);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(first.entries.length);
  });

  it("conserva la clasificación y la conciliación hechas a mano", () => {
    const first = buildPeriodLedger(syntheticPeriod());
    const reviewed = first.entries.map((entry) =>
      entry.description.includes("MATERIAL DEMO")
        ? {
            ...entry,
            category: "Materiales Clínica",
            pnl: "Opex Directo",
            classificationStatus: "manual" as const,
            reconciliation: "not_document_required" as const,
            reconciliationReason: "Confirmado por Fernando: no hay documento.",
            reviewStatus: "approved" as const,
          }
        : entry,
    );

    const second = buildPeriodLedger(syntheticPeriod());
    const { merged } = mergeEntries(reviewed, second.entries);
    const entry = findEntry(merged, "MATERIAL DEMO");

    expect(entry?.category).toBe("Materiales Clínica");
    expect(entry?.reconciliation).toBe("not_document_required");
    expect(entry?.reviewStatus).toBe("approved");
  });

  it("mantiene el periodo declarado en todos los movimientos", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    expect(ledger.entries.every((e) => e.period === SYNTHETIC_PERIOD)).toBe(true);
  });
});
