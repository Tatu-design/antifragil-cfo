/**
 * Tests de las reglas financieras del motor.
 *
 * Cada test corresponde a un caso que el negocio necesita que salga bien. Si
 * uno de estos falla, el mes NO puede darse por bueno.
 */

import { describe, expect, it } from "vitest";
import { buildCashFlowView } from "../lib/finance/cashflow";
import { mergeEntries } from "../lib/finance/dedupe";
import { buildPeriodLedger } from "../lib/finance/ledger";
import type { Incident, LedgerEntry } from "../lib/finance/types";
import {
  SYNTHETIC_PERIOD,
  syntheticAugust,
  syntheticClinicBankSales,
} from "./fixtures/synthetic-period";

function incidentsOfType(incidents: Incident[], type: string): Incident[] {
  return incidents.filter((i) => i.type === type);
}

function findEntry(entries: LedgerEntry[], needle: string): LedgerEntry | undefined {
  return entries.find((e) => e.description.toLowerCase().includes(needle.toLowerCase()));
}

describe("Caso 1 · gasto bancario con factura", () => {
  it("asocia la factura y marca el gasto como conciliado", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "PROVEEDOR DIGITAL");

    expect(entry).toBeDefined();
    expect(entry?.direction).toBe("expense");
    expect(entry?.reconciliation).toBe("matched");
    expect(entry?.documents).toHaveLength(1);
    expect(entry?.documents[0].name).toContain("Proveedor Digital");
  });

  it("no clasifica el gasto por su cuenta: queda pendiente de decisión humana", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "PROVEEDOR DIGITAL");

    expect(entry?.category).toBeNull();
    expect(entry?.pnl).toBeNull();
    expect(entry?.classificationStatus).toBe("pending");
  });
});

describe("Caso 2 · gasto bancario sin factura", () => {
  it("genera EXPENSE_WITHOUT_INVOICE y deja el gasto en el ledger", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "MATERIAL DEMO SIN FACTURA");

    expect(entry?.reconciliation).toBe("missing_document");
    expect(entry?.reviewStatus).toBe("needs_review");

    const incidents = incidentsOfType(ledger.incidents, "EXPENSE_WITHOUT_INVOICE");
    expect(incidents.length).toBeGreaterThanOrEqual(1);
    expect(incidents.some((i) => i.entryIds.includes(entry!.id))).toBe(true);
  });
});

describe("Caso 3 · factura sin movimiento", () => {
  it("reporta la incidencia y NO crea ningún gasto por la factura", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const incidents = incidentsOfType(ledger.incidents, "INVOICE_WITHOUT_MOVEMENT");

    expect(incidents).toHaveLength(1);
    expect(incidents[0].message).toContain("ASESORIA DEMO SL");

    // La factura es de 330,00 €: no debe existir ningún apunte con ese importe.
    const created = ledger.entries.filter((e) => Math.abs(e.amountCents) === 33000);
    expect(created).toHaveLength(0);
  });
});

describe("Caso 4 · ingreso bancario sin factura", () => {
  it("genera INCOME_WITHOUT_INVOICE para el ingreso no datáfono", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const incidents = incidentsOfType(ledger.incidents, "INCOME_WITHOUT_INVOICE");

    expect(incidents).toHaveLength(1);
    expect(incidents[0].message).toContain("CLIENTE DEMO");
  });

  it("no marca como incidencia la línea consolidada de datáfono", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const incidents = incidentsOfType(ledger.incidents, "INCOME_WITHOUT_INVOICE");
    const cardEntry = findEntry(ledger.entries, "Playamar — Banco");

    expect(cardEntry).toBeDefined();
    expect(incidents.some((i) => i.entryIds.includes(cardEntry!.id))).toBe(false);
  });
});

describe("Caso 5 · datáfono que cuadra", () => {
  it("concilia banco contra facturación y consolida en UNA sola línea", () => {
    const ledger = buildPeriodLedger(syntheticAugust());

    expect(ledger.cardSettlement?.bankTotalCents).toBe(200000);
    expect(ledger.cardSettlement?.salesTotalCents).toBe(200000);
    expect(ledger.cardSettlement?.differenceCents).toBe(0);
    expect(ledger.cardSettlement?.reconciled).toBe(true);

    const cardEntries = ledger.entries.filter((e) => e.aggregates !== undefined);
    expect(cardEntries).toHaveLength(1);
    expect(cardEntries[0].amountCents).toBe(200000);
    expect(cardEntries[0].aggregates).toHaveLength(2);
    expect(incidentsOfType(ledger.incidents, "CARD_SETTLEMENT_MISMATCH")).toHaveLength(0);
  });

  it("no introduce las liquidaciones individuales como ingresos separados", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const individual = ledger.entries.filter((e) =>
      e.rawDescription.includes("LIQUIDACION DE REMESAS") && e.aggregates === undefined,
    );
    expect(individual).toHaveLength(0);
  });
});

describe("Caso 6 · datáfono que no cuadra", () => {
  it("reporta la diferencia sin ajustar ninguna cifra", () => {
    const input = syntheticAugust();
    // Se elimina una venta de 600,00 €: la facturación deja de cuadrar.
    input.clinicBankSales = syntheticClinicBankSales().slice(1);

    const ledger = buildPeriodLedger(input);

    expect(ledger.cardSettlement?.bankTotalCents).toBe(200000);
    expect(ledger.cardSettlement?.salesTotalCents).toBe(140000);
    expect(ledger.cardSettlement?.differenceCents).toBe(60000);
    expect(ledger.cardSettlement?.reconciled).toBe(false);

    const incidents = incidentsOfType(ledger.incidents, "CARD_SETTLEMENT_MISMATCH");
    expect(incidents).toHaveLength(1);
    expect(incidents[0].severity).toBe("error");

    // El importe reconocido sigue siendo el cobrado en banco, sin ajustes.
    const cardEntry = ledger.entries.find((e) => e.aggregates !== undefined);
    expect(cardEntry?.amountCents).toBe(200000);
    expect(cardEntry?.reviewStatus).toBe("needs_review");
  });
});

describe("Caso 7 · gasto pagado en efectivo", () => {
  it("entra en el ledger como gasto cash conservando su clasificación", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "ENTRENADOR DEMO");

    expect(entry?.direction).toBe("expense");
    expect(entry?.treasury).toBe("cash");
    expect(entry?.amountCents).toBe(-40000);
    expect(entry?.category).toBe("Entrenadores");
    expect(entry?.pnl).toBe("Personal Directo");
    expect(entry?.classificationStatus).toBe("manual");
  });

  it("incorpora las ventas cash desde su Excel, no desde las retiradas", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "Playamar — Cash");

    expect(entry?.direction).toBe("income");
    expect(entry?.treasury).toBe("cash");
    expect(entry?.amountCents).toBe(10000);
  });
});

describe("Caso 8 · retirada de caja", () => {
  it("no la convierte en ingreso ni en gasto", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const entry = findEntry(ledger.entries, "Retirada de caja");

    expect(entry).toBeDefined();
    expect(entry?.direction).toBe("internal");
    expect(entry?.classificationStatus).toBe("not_applicable");
  });

  it("deja los movimientos internos fuera del resultado del periodo", () => {
    const ledger = buildPeriodLedger(syntheticAugust());

    // Ingresos = datáfono 2.000 + transferencia 500 + ventas cash 100.
    expect(ledger.summary.incomeCents).toBe(260000);
    // Gastos = 21,83 + 145 + 400 (cash). Ni retirada, ni traspaso, ni apertura.
    expect(ledger.summary.expenseCents).toBe(56683);
    // Traspaso bancario, retirada de caja y saldo de apertura.
    expect(ledger.summary.internalMovementCount).toBe(3);

    const internalAmounts = ledger.entries
      .filter((e) => e.direction === "internal")
      .map((e) => Math.abs(e.amountCents));
    expect(internalAmounts).toContain(25000); // retirada de caja
    expect(internalAmounts).toContain(30000); // traspaso bancario
    expect(internalAmounts).toContain(10000); // cantidad inicial
  });
});

describe("Caso 9 · prevención de duplicados", () => {
  it("señala como sospechosos dos apuntes idénticos sin borrarlos", () => {
    const input = syntheticAugust();
    const repeated = { ...input.bankMovements[1], source: { ...input.bankMovements[1].source, row: 99 } };
    input.bankMovements = [...input.bankMovements, repeated];

    const ledger = buildPeriodLedger(input);
    const duplicates = incidentsOfType(ledger.incidents, "DUPLICATE_SUSPECT").filter(
      (i) => i.entryIds.length === 2,
    );

    expect(duplicates).toHaveLength(1);
    // Los dos apuntes siguen existiendo: la decisión de borrar es humana.
    const same = ledger.entries.filter((e) => e.amountCents === -14500);
    expect(same).toHaveLength(2);
    expect(same[0].id).not.toBe(same[1].id);
  });

  it("no reconoce dos veces el mismo ingreso de datáfono", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    const view = buildCashFlowView(ledger);
    const clinicIncome = view.income.filter((l) => l.concept.includes("Playamar"));

    // Una línea de banco y una de cash. Nunca una por cada factura o liquidación.
    expect(clinicIncome).toHaveLength(2);
    expect(view.totals.incomeCents).toBe(260000);
  });

  it("no reconoce como ingreso la entrada de efectivo anotada en la cuenta de cash", () => {
    const input = syntheticAugust();
    input.cashMovements = [
      ...input.cashMovements,
      {
        date: "2026-08-19",
        concept: "Cobro sesiones efectivo",
        amountCents: 10000,
        category: null,
        pnl: null,
        source: { kind: "cash_account", file: "cuenta-cash-sintetica.xlsx", sheet: "AGOSTO 26", row: 9, raw: null },
      },
    ];

    const ledger = buildPeriodLedger(input);
    const entry = findEntry(ledger.entries, "Cobro sesiones efectivo");

    expect(entry?.direction).toBe("internal");
    // El ingreso cash sigue siendo solo el del Excel de ventas: 100,00 €.
    expect(ledger.summary.byTreasury.cash.incomeCents).toBe(10000);
  });
});

describe("Caso 10 · idempotencia", () => {
  it("produce exactamente los mismos ids al ejecutar dos veces", () => {
    const first = buildPeriodLedger(syntheticAugust());
    const second = buildPeriodLedger(syntheticAugust());

    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
    expect(second.incidents.map((i) => i.id)).toEqual(first.incidents.map((i) => i.id));
    expect(second.summary).toEqual(first.summary);
  });

  it("al fusionar dos ejecuciones no duplica apuntes", () => {
    const first = buildPeriodLedger(syntheticAugust());
    const second = buildPeriodLedger(syntheticAugust());
    const { merged, added, updated } = mergeEntries(first.entries, second.entries);

    expect(merged).toHaveLength(first.entries.length);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(first.entries.length);
  });

  it("conserva la clasificación manual al reprocesar el mes", () => {
    const first = buildPeriodLedger(syntheticAugust());
    const classified = first.entries.map((entry) =>
      entry.description.includes("PROVEEDOR DIGITAL")
        ? {
            ...entry,
            category: "Recursos Digitales",
            pnl: "Opex Estructura",
            classificationStatus: "manual" as const,
            reviewStatus: "approved" as const,
          }
        : entry,
    );

    const second = buildPeriodLedger(syntheticAugust());
    const { merged } = mergeEntries(classified, second.entries);
    const entry = findEntry(merged, "PROVEEDOR DIGITAL");

    expect(entry?.category).toBe("Recursos Digitales");
    expect(entry?.pnl).toBe("Opex Estructura");
    expect(entry?.reviewStatus).toBe("approved");
  });

  it("mantiene el periodo declarado en todos los apuntes", () => {
    const ledger = buildPeriodLedger(syntheticAugust());
    expect(ledger.entries.every((e) => e.period === SYNTHETIC_PERIOD)).toBe(true);
  });
});
