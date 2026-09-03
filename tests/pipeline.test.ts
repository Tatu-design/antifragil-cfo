/**
 * Test del recorrido completo: archivos en disco → inspección → ledger.
 *
 * Escribe CSV sintéticos en una carpeta temporal y comprueba que el motor los
 * descubre, los interpreta y aplica las reglas financieras sin intervención.
 * Es la prueba de que `npm run cfo -- analyze` hará lo correcto con archivos
 * reales una vez validados los mapeos de columnas.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { inspectPeriod, type InspectionResult } from "../lib/inspect/inspect";
import { buildPeriodInput } from "../lib/sources/adapters";

const PERIOD = "2026-08";

let root: string;
let inspection: InspectionResult;

const BANK_CSV = [
  "Fecha;Fecha valor;Concepto;Importe;Saldo",
  "03/08/2026;03/08/2026;PAGO TARJETA PROVEEDOR DIGITAL SL;-21,83;1.000,00",
  "05/08/2026;05/08/2026;LIQUIDACION DE REMESAS DE COMERCIO;1.200,00;2.200,00",
  "12/08/2026;12/08/2026;TRANSFERENCIA RECIBIDA CLIENTE DEMO;500,00;2.700,00",
  "25/08/2026;25/08/2026;TRASPASO A CUENTA PROPIA;-300,00;2.400,00",
  "02/09/2026;02/09/2026;PAGO FUERA DE PERIODO;-50,00;2.350,00",
  "TOTAL;;;1.328,17;",
].join("\n");

const CASH_CSV = [
  "Fecha;Concepto;Importe;Categoria;P&L",
  "10/08/2026;ENTRENADOR DEMO sesiones agosto;-400,00;Entrenadores;Personal Directo",
  "28/08/2026;Retirada de caja;-250,00;;",
].join("\n");

const CLINIC_BANK_CSV = [
  "Fecha;Concepto;Importe",
  "04/08/2026;Sesion demo;600,00",
  "19/08/2026;Bono demo;600,00",
].join("\n");

const CLINIC_CASH_CSV = [
  "Fecha;Concepto;Importe",
  "06/08/2026;Sesion demo efectivo;45,00",
  "18/08/2026;Sesion demo efectivo;55,00",
].join("\n");

const EXPENSE_INDEX_CSV = [
  "Fecha;Proveedor;Numero factura;Importe",
  "02/08/2026;PROVEEDOR DIGITAL SL;FD-2026-0801;21,83",
].join("\n");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "antifragil-cfo-test-"));
  const periodRoot = path.join(root, "inputs", PERIOD);

  for (const folder of ["bank", "cash_account", "clinic_bank", "clinic_cash", "expenses"]) {
    await mkdir(path.join(periodRoot, folder), { recursive: true });
  }

  await writeFile(path.join(periodRoot, "bank", "extracto.synthetic.csv"), BANK_CSV, "utf8");
  await writeFile(path.join(periodRoot, "cash_account", "cash.synthetic.csv"), CASH_CSV, "utf8");
  await writeFile(path.join(periodRoot, "clinic_bank", "ventas-banco.synthetic.csv"), CLINIC_BANK_CSV, "utf8");
  await writeFile(path.join(periodRoot, "clinic_cash", "ventas-cash.synthetic.csv"), CLINIC_CASH_CSV, "utf8");
  await writeFile(path.join(periodRoot, "expenses", "facturas.synthetic.csv"), EXPENSE_INDEX_CSV, "utf8");

  inspection = await inspectPeriod(periodRoot, PERIOD);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("inspección de archivos reales en disco", () => {
  it("descubre los archivos y deduce su tipo por la carpeta", () => {
    expect(inspection.discovery.files).toHaveLength(5);
    const kinds = inspection.discovery.files.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      "bank_statement",
      "cash_account",
      "clinic_bank_sales",
      "clinic_cash_sales",
      "expense_invoice",
    ]);
  });

  it("reconoce las columnas del extracto sin posiciones fijas", () => {
    const bank = inspection.files.find((f) => f.file.kind === "bank_statement");
    const sheet = bank?.sheets[0];

    expect(sheet?.columnMap.byRole.date).toBe(0);
    expect(sheet?.columnMap.byRole.concept).toBe(2);
    expect(sheet?.columnMap.byRole.amount).toBe(3);
    expect(sheet?.dataRowCount).toBe(5); // 5 movimientos; la fila TOTAL se descarta
  });
});

describe("construcción del ledger desde los archivos", () => {
  it("aplica todas las reglas financieras de una pasada", () => {
    const adaptation = buildPeriodInput(inspection);
    const ledger = buildPeriodLedger(adaptation.input);

    // El movimiento de septiembre no entra y se reporta.
    expect(ledger.incidents.some((i) => i.type === "SOURCE_ERROR")).toBe(true);
    expect(ledger.entries.some((e) => e.description.includes("FUERA DE PERIODO"))).toBe(false);

    // Datáfono: 1.200 en banco frente a 1.200 de ventas → conciliado y consolidado.
    expect(ledger.cardSettlement?.bankTotalCents).toBe(120000);
    expect(ledger.cardSettlement?.salesTotalCents).toBe(120000);
    expect(ledger.cardSettlement?.reconciled).toBe(true);

    // Ingresos: datáfono 1.200 + transferencia 500 + ventas cash 100.
    expect(ledger.summary.incomeCents).toBe(180000);
    // Gastos: 21,83 (banco) + 400 (cash). El traspaso y la retirada no cuentan.
    expect(ledger.summary.expenseCents).toBe(42183);
    expect(ledger.summary.internalMovementCount).toBe(2);

    // El gasto bancario encuentra su factura en el índice de facturas.
    const digital = ledger.entries.find((e) => e.description.includes("PROVEEDOR DIGITAL"));
    expect(digital?.reconciliation).toBe("matched");

    // El gasto cash conserva la clasificación que ya traía el documento.
    const trainer = ledger.entries.find((e) => e.description.includes("ENTRENADOR DEMO"));
    expect(trainer?.category).toBe("Entrenadores");
    expect(trainer?.pnl).toBe("Personal Directo");
  });

  it("es idempotente al repetir la lectura de los mismos archivos", async () => {
    const first = buildPeriodLedger(buildPeriodInput(inspection).input);
    const second = buildPeriodLedger(
      buildPeriodInput(await inspectPeriod(path.join(root, "inputs", PERIOD), PERIOD)).input,
    );

    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
  });
});
