/**
 * Test del recorrido completo: archivos en disco → inspección → ledger.
 *
 * Escribe CSV sintéticos de las tres tesorerías en una carpeta temporal y
 * comprueba que el motor los descubre, los interpreta, conserva la cuenta de
 * origen y concilia. Es la prueba de que `npm run cfo -- analyze` hará lo
 * correcto con archivos reales una vez validados los mapeos de columnas.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK } from "../lib/finance/accounts";
import { buildPeriodLedger } from "../lib/finance/ledger";
import { inspectPeriod, type InspectionResult } from "../lib/inspect/inspect";
import { buildPeriodInput } from "../lib/sources/adapters";

const PERIOD = "2026-09";

let root: string;
let inspection: InspectionResult;

const BANK_SL_CSV = [
  "Fecha;Fecha valor;Concepto;Importe;Saldo",
  "03/09/2026;03/09/2026;PAGO TARJETA PROVEEDOR DIGITAL SL;-21,83;1.000,00",
  "05/09/2026;05/09/2026;LIQUIDACION DE REMESAS DE COMERCIO;1.200,00;2.200,00",
  "12/09/2026;12/09/2026;TRANSFERENCIA RECIBIDA CLIENTE DEMO;500,00;2.700,00",
  "25/09/2026;25/09/2026;TRASPASO A CUENTA PROPIA;-300,00;2.400,00",
  "30/09/2026;30/09/2026;COMISION MANTENIMIENTO;-12,00;2.388,00",
  "02/10/2026;02/10/2026;PAGO FUERA DE PERIODO;-50,00;2.338,00",
  "TOTAL;;;1.316,17;",
].join("\n");

const BANK_SC_CSV = [
  "Fecha;Concepto;Importe",
  "20/09/2026;AEAT MODELO 303 DEMO;-350,00",
].join("\n");

const CASH_CSV = [
  "Fecha;Concepto;Importe;Categoria;P&L",
  "10/09/2026;ENTRENADOR DEMO sesiones septiembre;-400,00;Entrenadores;Personal Directo",
  "28/09/2026;Retirada de caja;-250,00;;",
].join("\n");

const CLINIC_BANK_CSV = [
  "Fecha;Concepto;Importe",
  "04/09/2026;Sesion demo;600,00",
  "19/09/2026;Bono demo;600,00",
].join("\n");

const CLINIC_CASH_CSV = [
  "Fecha;Concepto;Importe",
  "06/09/2026;Sesion demo efectivo;45,00",
  "18/09/2026;Sesion demo efectivo;55,00",
].join("\n");

const DOCUMENTS_CSV = [
  "Fecha;Proveedor;Numero factura;Importe",
  "02/09/2026;PROVEEDOR DIGITAL SL;FD-2026-0901;21,83",
  "19/09/2026;AEAT MODELO 303 DEMO;303;350,00",
].join("\n");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "antifragil-cfo-test-"));
  const periodRoot = path.join(root, "inputs", PERIOD);

  for (const folder of ["bank_sl", "bank_sc", "cash_account", "clinic_bank", "clinic_cash", "documents"]) {
    await mkdir(path.join(periodRoot, folder), { recursive: true });
  }

  await writeFile(path.join(periodRoot, "bank_sl", "extracto.synthetic.csv"), BANK_SL_CSV, "utf8");
  await writeFile(path.join(periodRoot, "bank_sc", "extracto.synthetic.csv"), BANK_SC_CSV, "utf8");
  await writeFile(path.join(periodRoot, "cash_account", "cash.synthetic.csv"), CASH_CSV, "utf8");
  await writeFile(path.join(periodRoot, "clinic_bank", "ventas-banco.synthetic.csv"), CLINIC_BANK_CSV, "utf8");
  await writeFile(path.join(periodRoot, "clinic_cash", "ventas-cash.synthetic.csv"), CLINIC_CASH_CSV, "utf8");
  await writeFile(path.join(periodRoot, "documents", "documentos.synthetic.csv"), DOCUMENTS_CSV, "utf8");

  inspection = await inspectPeriod(periodRoot, PERIOD);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("inspección de archivos reales en disco", () => {
  it("descubre los archivos y deduce tipo y cuenta por la carpeta", () => {
    expect(inspection.discovery.files).toHaveLength(6);

    const bankFiles = inspection.discovery.files.filter((f) => f.kind === "bank_statement");
    expect(bankFiles.map((f) => f.accountId).sort()).toEqual([ACCOUNT_SC_BANK, ACCOUNT_SL_BANK]);
    expect(
      inspection.discovery.files.find((f) => f.kind === "cash_account")?.accountId,
    ).toBe(ACCOUNT_CASH);
  });

  it("reconoce las columnas del extracto sin posiciones fijas", () => {
    const bank = inspection.files.find((f) => f.file.accountId === ACCOUNT_SL_BANK);
    const sheet = bank?.sheets[0];

    expect(sheet?.columnMap.byRole.date).toBe(0);
    expect(sheet?.columnMap.byRole.concept).toBe(2);
    expect(sheet?.columnMap.byRole.amount).toBe(3);
    expect(sheet?.dataRowCount).toBe(6); // 6 movimientos; la fila TOTAL se descarta
  });
});

describe("construcción del ledger desde los archivos", () => {
  it("aplica todas las reglas de una pasada y conserva las cuentas", () => {
    const adaptation = buildPeriodInput(inspection);
    const ledger = buildPeriodLedger(adaptation.input);

    // El movimiento de octubre no entra y se reporta.
    expect(ledger.incidents.some((i) => i.type === "SOURCE_ERROR")).toBe(true);
    expect(ledger.entries.some((e) => e.description.includes("FUERA DE PERIODO"))).toBe(false);

    // Las tres tesorerías conviven en el mismo ledger.
    expect(ledger.summary.byAccount[ACCOUNT_SL_BANK].movementCount).toBeGreaterThan(0);
    expect(ledger.summary.byAccount[ACCOUNT_SC_BANK].movementCount).toBe(1);
    expect(ledger.summary.byAccount[ACCOUNT_CASH].movementCount).toBeGreaterThan(0);

    // Datáfono conciliado y consolidado.
    expect(ledger.cardSettlement?.reconciled).toBe(true);
    expect(ledger.entries.filter((e) => e.aggregates !== undefined)).toHaveLength(1);

    // Ingresos: datáfono 1.200 + transferencia 500 + ventas cash 100.
    expect(ledger.summary.incomeCents).toBe(180000);
    // Gastos: 21,83 + 12 (SL) + 350 (SC) + 400 (cash). Traspaso y retirada fuera.
    expect(ledger.summary.expenseCents).toBe(78383);

    // Conciliación documental por importe y emisor, en dos cuentas distintas.
    expect(
      ledger.entries.find((e) => e.description.includes("PROVEEDOR DIGITAL"))?.reconciliation,
    ).toBe("reconciled");
    expect(ledger.entries.find((e) => e.description.includes("MODELO 303"))?.reconciliation).toBe(
      "reconciled",
    );

    // La comisión no requiere documento: estado final, no excepción.
    expect(ledger.entries.find((e) => e.description.includes("COMISION"))?.reconciliation).toBe(
      "not_document_required",
    );

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
