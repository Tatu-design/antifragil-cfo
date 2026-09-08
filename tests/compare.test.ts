/**
 * Tests de la comparación contra el cierre manual.
 *
 * Lo que se protege aquí es una postura, no solo un cálculo: el motor no
 * presume que el cierre manual sea correcto, ni que lo sea él. Aísla las
 * diferencias, aporta evidencia y deja el veredicto en manos de una persona.
 */

import { describe, expect, it } from "vitest";
import { compareWithManualClose, type ManualLine } from "../lib/finance/compare";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { syntheticPeriod } from "./fixtures/synthetic-period";

function manualCloseFromEngine(): ManualLine[] {
  // Cierre manual "perfecto": mismas líneas económicas que produce el motor.
  const ledger = buildPeriodLedger(syntheticPeriod());
  return ledger.entries
    .filter((e) => e.direction !== "internal")
    .map((e, index) => ({
      date: e.date,
      description: e.description,
      amountCents: e.amountCents,
      sourceRow: index + 2,
    }));
}

describe("comparación motor vs cierre manual", () => {
  it("no reporta diferencias cuando ambos coinciden", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const result = compareWithManualClose(ledger, manualCloseFromEngine());

    expect(result.differences).toHaveLength(0);
    expect(result.totals.incomeDeltaCents).toBe(0);
    expect(result.totals.expenseDeltaCents).toBe(0);
  });

  it("no compara movimientos internos: no aparecen en un cierre", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const result = compareWithManualClose(ledger, manualCloseFromEngine());

    const internos = ledger.entries.filter((e) => e.direction === "internal");
    expect(internos.length).toBeGreaterThan(0);
    expect(result.differences.some((d) => d.description.includes("Retirada de caja"))).toBe(false);
  });

  it("aísla lo que solo está en el motor", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const manual = manualCloseFromEngine().filter((l) => !l.description.includes("MODELO 303"));
    const result = compareWithManualClose(ledger, manual);

    const diff = result.differences.find((d) => d.description.includes("MODELO 303"));
    expect(diff?.kind).toBe("only_in_engine");
    expect(diff?.verdict).toBe("pending");
    expect(diff?.evidence.join(" ")).toContain("Origen:");
  });

  it("aísla lo que solo está en el cierre manual", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const manual = [
      ...manualCloseFromEngine(),
      { date: "2026-09-14", description: "APUNTE SOLO DEL CIERRE MANUAL", amountCents: -9900, sourceRow: 99 },
    ];
    const result = compareWithManualClose(ledger, manual);

    const diff = result.differences.find((d) => d.description.includes("SOLO DEL CIERRE"));
    expect(diff?.kind).toBe("only_in_manual");
    expect(diff?.verdict).toBe("pending");
    expect(diff?.engineAmountCents).toBeNull();
  });

  it("detecta importes distintos sin decidir quién se equivoca", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const manual = manualCloseFromEngine().map((line) =>
      line.description.includes("PROVEEDOR DIGITAL") ? { ...line, amountCents: -2000 } : line,
    );
    const result = compareWithManualClose(ledger, manual);

    const diff = result.differences.find((d) => d.description.includes("PROVEEDOR DIGITAL"));
    expect(diff?.kind).toBe("amount_mismatch");
    expect(diff?.engineAmountCents).toBe(-2183);
    expect(diff?.manualAmountCents).toBe(-2000);
    expect(diff?.deltaCents).toBe(-183);
    // La clave: NO concluye. El veredicto lo pone una persona.
    expect(diff?.verdict).toBe("pending");
  });

  it("toda diferencia nace como pendiente de decisión humana", () => {
    const ledger = buildPeriodLedger(syntheticPeriod());
    const manual = manualCloseFromEngine().slice(0, 2);
    const result = compareWithManualClose(ledger, manual);

    expect(result.differences.length).toBeGreaterThan(0);
    expect(result.differences.every((d) => d.verdict === "pending")).toBe(true);
  });
});
