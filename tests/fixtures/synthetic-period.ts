/**
 * Datos SINTÉTICOS para los tests del motor.
 *
 * Nada de aquí es real: ni proveedores, ni importes, ni facturas. Existe para
 * poder probar las reglas financieras sin que ningún dato del negocio entre
 * jamás en el repositorio público.
 *
 * Cubre los casos que el motor debe resolver bien:
 *   1. Gasto bancario con factura         6. Datáfono que no cuadra
 *   2. Gasto bancario sin factura         7. Gasto cash clasificado
 *   3. Factura sin movimiento             8. Retirada de caja (interno)
 *   4. Ingreso bancario sin factura       9. Duplicados
 *   5. Datáfono que cuadra               10. Idempotencia
 */

import type {
  BankMovement,
  CashMovement,
  ClinicSale,
  Invoice,
  PeriodInput,
  SourceRef,
} from "../../lib/finance/types";

export const SYNTHETIC_PERIOD = "2026-08";

function bankSource(row: number): SourceRef {
  return { kind: "bank_statement", file: "extracto-sintetico.csv", sheet: null, row, raw: null };
}

function cashSource(row: number): SourceRef {
  return { kind: "cash_account", file: "cuenta-cash-sintetica.xlsx", sheet: "AGOSTO 26", row, raw: null };
}

function invoiceSource(row: number): SourceRef {
  return { kind: "expense_invoice", file: "facturas-sinteticas.csv", sheet: null, row, raw: null };
}

export function syntheticBankMovements(): BankMovement[] {
  return [
    // Caso 1 · gasto con factura disponible
    {
      date: "2026-08-03",
      valueDate: "2026-08-03",
      concept: "PAGO TARJETA PROVEEDOR DIGITAL SL",
      observations: null,
      amountCents: -2183,
      source: bankSource(2),
    },
    // Caso 2 · gasto sin factura
    {
      date: "2026-08-07",
      valueDate: "2026-08-07",
      concept: "COMPRA MATERIAL DEMO SIN FACTURA",
      observations: null,
      amountCents: -14500,
      source: bankSource(3),
    },
    // Caso 4 · ingreso normal sin documentación
    {
      date: "2026-08-12",
      valueDate: "2026-08-12",
      concept: "TRANSFERENCIA RECIBIDA CLIENTE DEMO",
      observations: null,
      amountCents: 50000,
      source: bankSource(4),
    },
    // Caso 5 · datáfono (dos liquidaciones que suman lo mismo que las ventas)
    {
      date: "2026-08-05",
      valueDate: "2026-08-05",
      concept: "LIQUIDACION DE REMESAS DE COMERCIO",
      observations: null,
      amountCents: 120000,
      source: bankSource(5),
    },
    {
      date: "2026-08-20",
      valueDate: "2026-08-20",
      concept: "LIQUIDACIÓN DE REMESAS DE COMERCIO",
      observations: null,
      amountCents: 80000,
      source: bankSource(6),
    },
    // Movimiento interno en banco: traspaso a otra cuenta propia
    {
      date: "2026-08-25",
      valueDate: "2026-08-25",
      concept: "TRASPASO A CUENTA PROPIA",
      observations: null,
      amountCents: -30000,
      source: bankSource(7),
    },
  ];
}

export function syntheticCashMovements(): CashMovement[] {
  return [
    // Caso 7 · gasto cash con clasificación ya decidida en el documento
    {
      date: "2026-08-10",
      concept: "ENTRENADOR DEMO — sesiones agosto",
      amountCents: -40000,
      category: "Entrenadores",
      pnl: "Personal Directo",
      source: cashSource(4),
    },
    // Caso 8 · retirada de caja: NO es ingreso ni gasto
    {
      date: "2026-08-28",
      concept: "Retirada de caja",
      amountCents: -25000,
      category: null,
      pnl: null,
      source: cashSource(5),
    },
    // Saldo de apertura: tampoco es actividad económica
    {
      date: "2026-08-01",
      concept: "Cantidad inicial en caja",
      amountCents: 10000,
      category: null,
      pnl: null,
      source: cashSource(2),
    },
  ];
}

export function syntheticClinicBankSales(): ClinicSale[] {
  return [
    { date: "2026-08-04", concept: "Sesión fisioterapia demo", amountCents: 60000, source: salesSource(2, "banco") },
    { date: "2026-08-11", concept: "Sesión fisioterapia demo", amountCents: 60000, source: salesSource(3, "banco") },
    { date: "2026-08-19", concept: "Bono demo", amountCents: 80000, source: salesSource(4, "banco") },
  ];
}

export function syntheticClinicCashSales(): ClinicSale[] {
  return [
    { date: "2026-08-06", concept: "Sesión demo efectivo", amountCents: 4500, source: salesSource(2, "cash") },
    { date: "2026-08-18", concept: "Sesión demo efectivo", amountCents: 5500, source: salesSource(3, "cash") },
  ];
}

function salesSource(row: number, kind: "banco" | "cash"): SourceRef {
  return {
    kind: kind === "banco" ? "clinic_bank_sales" : "clinic_cash_sales",
    file: kind === "banco" ? "I_Ventas Clinica Banco sintetico.xlsx" : "I_Ventas Clinica Cash sintetico.xlsx",
    sheet: "Ventas",
    row,
    raw: null,
  };
}

export function syntheticInvoices(): Invoice[] {
  return [
    // Caso 1 · factura que sí corresponde a un pago bancario
    {
      id: "inv-001",
      supplier: "PROVEEDOR DIGITAL SL",
      invoiceNumber: "FD-2026-0801",
      date: "2026-08-02",
      amountCents: 2183,
      document: {
        name: "G_Proveedor Digital agosto 26.pdf",
        driveFileId: null,
        url: null,
        localPath: "expenses/G_Proveedor Digital agosto 26.pdf",
        supplier: "PROVEEDOR DIGITAL SL",
        invoiceNumber: "FD-2026-0801",
        date: "2026-08-02",
        amountCents: 2183,
      },
      source: invoiceSource(2),
    },
    // Caso 3 · factura sin ningún movimiento asociado
    {
      id: "inv-002",
      supplier: "ASESORIA DEMO SL",
      invoiceNumber: "AD-2026-08",
      date: "2026-08-15",
      amountCents: 33000,
      document: {
        name: "G_Asesoria Demo agosto 26.pdf",
        driveFileId: null,
        url: null,
        localPath: "expenses/G_Asesoria Demo agosto 26.pdf",
        supplier: "ASESORIA DEMO SL",
        invoiceNumber: "AD-2026-08",
        date: "2026-08-15",
        amountCents: 33000,
      },
      source: invoiceSource(3),
    },
  ];
}

/** Periodo sintético completo y coherente. El datáfono cuadra exactamente. */
export function syntheticAugust(): PeriodInput {
  return {
    period: SYNTHETIC_PERIOD,
    bankMovements: syntheticBankMovements(),
    cashMovements: syntheticCashMovements(),
    clinicBankSales: syntheticClinicBankSales(),
    clinicCashSales: syntheticClinicCashSales(),
    invoices: syntheticInvoices(),
    incomeDocuments: [],
  };
}
