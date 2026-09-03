/**
 * Tests de la capa de lectura: importes, fechas y detección de tablas.
 *
 * Un error aquí es un error financiero silencioso (un importe x1000, un mes
 * equivocado), así que se prueba con los formatos que aparecen de verdad en
 * extractos y Excels españoles.
 */

import { describe, expect, it } from "vitest";
import { formatCents, parseAmountToCents } from "../lib/finance/money";
import { excelSerialToISO, parseDateToISO, periodLabel } from "../lib/finance/period";
import { detectInternalMovement } from "../lib/finance/internal";
import { isCardSettlement } from "../lib/finance/card-settlements";
import { detectTable, parseRows } from "../lib/sources/table";
import { detectDelimiter, parseCsv } from "../lib/sources/workbook";
import { sheetMatchesPeriod } from "../lib/sources/adapters";

describe("importes", () => {
  it("interpreta el formato español", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
    expect(parseAmountToCents("-1.234,56 €")).toBe(-123456);
    expect(parseAmountToCents("21,83")).toBe(2183);
    expect(parseAmountToCents("0,00")).toBe(0);
  });

  it("interpreta el formato inglés y los números nativos", () => {
    expect(parseAmountToCents("1,234.56")).toBe(123456);
    expect(parseAmountToCents(21.83)).toBe(2183);
    expect(parseAmountToCents(-145)).toBe(-14500);
  });

  it("acepta el negativo entre paréntesis y el signo detrás", () => {
    expect(parseAmountToCents("(1.234,56)")).toBe(-123456);
    expect(parseAmountToCents("1.234,56-")).toBe(-123456);
  });

  it("devuelve null en lugar de adivinar cuando el valor no es un importe", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("pendiente")).toBeNull();
    expect(parseAmountToCents(null)).toBeNull();
    expect(parseAmountToCents("#REF!")).toBeNull();
  });

  it("formatea en español", () => {
    expect(formatCents(123456)).toBe("1.234,56 €");
    expect(formatCents(-2183)).toBe("-21,83 €");
    expect(formatCents(0)).toBe("0,00 €");
  });
});

describe("fechas", () => {
  it("interpreta el formato español día primero", () => {
    expect(parseDateToISO("05/08/2026")).toBe("2026-08-05");
    expect(parseDateToISO("5-8-26")).toBe("2026-08-05");
    expect(parseDateToISO("2026-08-05")).toBe("2026-08-05");
  });

  it("interpreta los seriales de Excel", () => {
    expect(excelSerialToISO(46239)).toBe("2026-08-05");
    expect(parseDateToISO(46239)).toBe("2026-08-05");
  });

  it("rechaza fechas imposibles", () => {
    expect(parseDateToISO("32/08/2026")).toBeNull();
    expect(parseDateToISO("no es fecha")).toBeNull();
    expect(parseDateToISO("")).toBeNull();
  });

  it("etiqueta el periodo en español", () => {
    expect(periodLabel("2026-08")).toBe("agosto 2026");
  });
});

describe("reglas de reconocimiento", () => {
  it("reconoce las liquidaciones de datáfono con y sin acentos", () => {
    expect(isCardSettlement("LIQUIDACIÓN DE REMESAS DE COMERCIO")).toBe(true);
    expect(isCardSettlement("liquidacion de remesas de comercio 0812")).toBe(true);
    expect(isCardSettlement("TRANSFERENCIA RECIBIDA")).toBe(false);
  });

  it("reconoce los movimientos internos de tesorería", () => {
    expect(detectInternalMovement("Retirada de caja").isInternal).toBe(true);
    expect(detectInternalMovement("TRASPASO A CUENTA PROPIA").isInternal).toBe(true);
    expect(detectInternalMovement("Cantidad inicial en caja").isInternal).toBe(true);
    expect(detectInternalMovement("PAGO PROVEEDOR").isInternal).toBe(false);
  });

  it("empareja las pestañas mensuales con su periodo", () => {
    expect(sheetMatchesPeriod("AGOSTO 26", "2026-08")).toBe(true);
    expect(sheetMatchesPeriod("agosto 2026", "2026-08")).toBe(true);
    expect(sheetMatchesPeriod("JULIO 26", "2026-08")).toBe(false);
  });
});

describe("lectura de tablas", () => {
  const csv = [
    "Fecha;Fecha valor;Concepto;Importe;Saldo",
    "05/08/2026;05/08/2026;PAGO PROVEEDOR DEMO;-21,83;1.000,00",
    "12/08/2026;12/08/2026;TRANSFERENCIA RECIBIDA;500,00;1.500,00",
    "TOTAL;;;478,17;",
  ].join("\n");

  it("detecta el delimitador y las columnas por sinónimos", () => {
    expect(detectDelimiter(csv)).toBe(";");

    const sheet = { name: "test", rows: parseCsv(csv, ";") };
    const map = detectTable(sheet);

    expect(map.headerRowIndex).toBe(0);
    expect(map.byRole.date).toBe(0);
    expect(map.byRole.valueDate).toBe(1);
    expect(map.byRole.concept).toBe(2);
    expect(map.byRole.amount).toBe(3);
    expect(map.confidence).toBeGreaterThan(0);
  });

  it("interpreta las filas y descarta la de totales", () => {
    const sheet = { name: "test", rows: parseCsv(csv, ";") };
    const rows = parseRows(sheet, detectTable(sheet));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rowNumber: 2, date: "2026-08-05", amountCents: -2183 });
    expect(rows[1]).toMatchObject({ date: "2026-08-12", amountCents: 50000 });
    expect(rows.every((r) => r.problems.length === 0)).toBe(true);
  });

  it("resuelve el formato de columnas debe/haber", () => {
    const debitCredit = [
      "Fecha;Concepto;Debe;Haber",
      "05/08/2026;PAGO PROVEEDOR;21,83;",
      "12/08/2026;COBRO CLIENTE;;500,00",
    ].join("\n");

    const sheet = { name: "test", rows: parseCsv(debitCredit, ";") };
    const rows = parseRows(sheet, detectTable(sheet));

    expect(rows[0].amountCents).toBe(-2183);
    expect(rows[1].amountCents).toBe(50000);
  });

  it("señala las filas con errores de fórmula heredados del documento", () => {
    const broken = ["Fecha;Concepto;Importe", "05/08/2026;PAGO;#REF!"].join("\n");
    const sheet = { name: "test", rows: parseCsv(broken, ";") };
    const rows = parseRows(sheet, detectTable(sheet));

    expect(rows[0].problems).toContain("importe ilegible");
    expect(rows[0].problems.some((p) => p.includes("fórmula"))).toBe(true);
  });
});
