/**
 * Datos SINTÉTICOS para los tests del motor.
 *
 * Nada de aquí es real: ni proveedores, ni importes, ni documentos. Existe para
 * probar las reglas financieras sin que ningún dato del negocio entre jamás en
 * el repositorio público.
 *
 * Cubre la misión actual: tres tesorerías (banco SL, banco SC y caja) que
 * convergen en un ledger, y documentación justificativa de varios tipos
 * (factura, nómina, impuesto), no solo facturas.
 */

import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK, DEFAULT_ACCOUNTS } from "../../lib/finance/accounts";
import type {
  BankMovement,
  CashMovement,
  ClinicSale,
  PeriodInput,
  SourceRef,
  SupportingDocument,
} from "../../lib/finance/types";

export const SYNTHETIC_PERIOD = "2026-09";

function bankSource(accountId: string, row: number): SourceRef {
  return {
    kind: "bank_statement",
    file: `extracto-${accountId}-sintetico.csv`,
    accountId,
    sheet: null,
    row,
    raw: null,
  };
}

function cashSource(row: number): SourceRef {
  return {
    kind: "cash_account",
    file: "cuenta-cash-sintetica.xlsx",
    accountId: ACCOUNT_CASH,
    sheet: "SEPTIEMBRE 26",
    row,
    raw: null,
  };
}

function documentSource(row: number): SourceRef {
  return { kind: "supporting_document", file: "documentos-sinteticos.csv", sheet: null, row, raw: null };
}

export function syntheticBankMovements(): BankMovement[] {
  return [
    // Gasto en la SL con factura disponible
    {
      date: "2026-09-03",
      valueDate: "2026-09-03",
      concept: "PAGO TARJETA PROVEEDOR DIGITAL SL",
      observations: null,
      amountCents: -2183,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 2),
    },
    // Gasto en la SL sin ningún documento
    {
      date: "2026-09-07",
      valueDate: "2026-09-07",
      concept: "COMPRA MATERIAL DEMO SIN DOCUMENTO",
      observations: null,
      amountCents: -14500,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 3),
    },
    // Gasto que NO requiere documento
    {
      date: "2026-09-30",
      valueDate: "2026-09-30",
      concept: "COMISION MANTENIMIENTO",
      observations: null,
      amountCents: -1200,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 4),
    },
    // Ingreso normal sin documentación
    {
      date: "2026-09-12",
      valueDate: "2026-09-12",
      concept: "TRANSFERENCIA RECIBIDA CLIENTE DEMO",
      observations: null,
      amountCents: 50000,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 5),
    },
    // Datáfono: dos liquidaciones que suman lo mismo que las ventas
    {
      date: "2026-09-05",
      valueDate: "2026-09-05",
      concept: "LIQUIDACION DE REMESAS DE COMERCIO",
      observations: null,
      amountCents: 120000,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 6),
    },
    {
      date: "2026-09-20",
      valueDate: "2026-09-20",
      concept: "LIQUIDACIÓN DE REMESAS DE COMERCIO",
      observations: null,
      amountCents: 80000,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 7),
    },
    // Movimiento interno en la SL
    {
      date: "2026-09-25",
      valueDate: "2026-09-25",
      concept: "TRASPASO A CUENTA PROPIA",
      observations: null,
      amountCents: -30000,
      accountId: ACCOUNT_SL_BANK,
      source: bankSource(ACCOUNT_SL_BANK, 8),
    },

    // ── Cuenta de la SC ────────────────────────────────────────────────────
    // Nómina pagada en dos cargos: un único documento justifica ambos
    {
      date: "2026-09-10",
      valueDate: "2026-09-10",
      concept: "NOMINA DEMO PERSONA A",
      observations: null,
      amountCents: -60000,
      accountId: ACCOUNT_SC_BANK,
      source: bankSource(ACCOUNT_SC_BANK, 2),
    },
    {
      date: "2026-09-11",
      valueDate: "2026-09-11",
      concept: "NOMINA DEMO PERSONA A COMPLEMENTO",
      observations: null,
      amountCents: -40000,
      accountId: ACCOUNT_SC_BANK,
      source: bankSource(ACCOUNT_SC_BANK, 3),
    },
    // Impuesto con su documento
    {
      date: "2026-09-20",
      valueDate: "2026-09-20",
      concept: "AEAT MODELO 303 DEMO",
      observations: null,
      amountCents: -35000,
      accountId: ACCOUNT_SC_BANK,
      source: bankSource(ACCOUNT_SC_BANK, 4),
    },
  ];
}

export function syntheticCashMovements(): CashMovement[] {
  return [
    // Gasto cash con clasificación ya decidida en el documento de caja
    {
      date: "2026-09-10",
      concept: "ENTRENADOR DEMO — sesiones septiembre",
      amountCents: -40000,
      accountId: ACCOUNT_CASH,
      category: "Entrenadores",
      pnl: "Personal Directo",
      source: cashSource(4),
    },
    // Retirada de caja: NO es ingreso ni gasto
    {
      date: "2026-09-28",
      concept: "Retirada de caja",
      amountCents: -25000,
      accountId: ACCOUNT_CASH,
      category: null,
      pnl: null,
      source: cashSource(5),
    },
    // Saldo de apertura: tampoco es actividad económica
    {
      date: "2026-09-01",
      concept: "Cantidad inicial en caja",
      amountCents: 10000,
      accountId: ACCOUNT_CASH,
      category: null,
      pnl: null,
      source: cashSource(2),
    },
  ];
}

export function syntheticClinicBankSales(): ClinicSale[] {
  return [
    { date: "2026-09-04", concept: "Sesión fisioterapia demo", amountCents: 60000, source: salesSource(2, "banco") },
    { date: "2026-09-11", concept: "Sesión fisioterapia demo", amountCents: 60000, source: salesSource(3, "banco") },
    { date: "2026-09-19", concept: "Bono demo", amountCents: 80000, source: salesSource(4, "banco") },
  ];
}

export function syntheticClinicCashSales(): ClinicSale[] {
  return [
    { date: "2026-09-06", concept: "Sesión demo efectivo", amountCents: 4500, source: salesSource(2, "cash") },
    { date: "2026-09-18", concept: "Sesión demo efectivo", amountCents: 5500, source: salesSource(3, "cash") },
  ];
}

function salesSource(row: number, kind: "banco" | "cash"): SourceRef {
  return {
    kind: kind === "banco" ? "clinic_bank_sales" : "clinic_cash_sales",
    file:
      kind === "banco"
        ? "I_Ventas Clinica Banco sintetico.xlsx"
        : "I_Ventas Clinica Cash sintetico.xlsx",
    sheet: "Ventas",
    row,
    raw: null,
  };
}

export function syntheticDocuments(): SupportingDocument[] {
  return [
    // Factura que corresponde a un pago bancario de la SL
    {
      id: "doc-001",
      docType: "invoice",
      issuer: "PROVEEDOR DIGITAL SL",
      reference: "FD-2026-0901",
      date: "2026-09-02",
      amountCents: 2183,
      document: {
        name: "G_Proveedor Digital septiembre 26.pdf",
        docType: "invoice",
        driveFileId: "drive-001",
        url: "https://drive.google.com/file/d/drive-001/view",
        issuer: "PROVEEDOR DIGITAL SL",
        reference: "FD-2026-0901",
        date: "2026-09-02",
        amountCents: 2183,
      },
      source: documentSource(2),
    },
    // Factura sin ningún movimiento asociado
    {
      id: "doc-002",
      docType: "invoice",
      issuer: "ASESORIA DEMO SL",
      reference: "AD-2026-09",
      date: "2026-09-15",
      amountCents: 33000,
      document: {
        name: "G_Asesoria Demo septiembre 26.pdf",
        docType: "invoice",
        driveFileId: "drive-002",
        url: null,
        issuer: "ASESORIA DEMO SL",
        reference: "AD-2026-09",
        date: "2026-09-15",
        amountCents: 33000,
      },
      source: documentSource(3),
    },
    // Nómina: un documento que justifica DOS cargos bancarios
    {
      id: "doc-003",
      docType: "payroll",
      issuer: "NOMINA DEMO PERSONA A",
      reference: null,
      date: "2026-09-09",
      amountCents: 100000,
      document: {
        name: "G_Nomina Demo Persona A septiembre 26.pdf",
        docType: "payroll",
        driveFileId: "drive-003",
        url: null,
        issuer: "NOMINA DEMO PERSONA A",
        date: "2026-09-09",
        amountCents: 100000,
      },
      source: documentSource(4),
    },
    // Impuesto
    {
      id: "doc-004",
      docType: "tax",
      issuer: "AEAT MODELO 303 DEMO",
      reference: "303",
      date: "2026-09-19",
      amountCents: 35000,
      document: {
        name: "G_Modelo 303 septiembre 26.pdf",
        docType: "tax",
        driveFileId: "drive-004",
        url: null,
        issuer: "AEAT MODELO 303 DEMO",
        reference: "303",
        date: "2026-09-19",
        amountCents: 35000,
      },
      source: documentSource(5),
    },
  ];
}

/** Periodo sintético completo y coherente. El datáfono cuadra exactamente. */
export function syntheticPeriod(): PeriodInput {
  return {
    period: SYNTHETIC_PERIOD,
    accounts: DEFAULT_ACCOUNTS,
    bankMovements: syntheticBankMovements(),
    cashMovements: syntheticCashMovements(),
    clinicBankSales: syntheticClinicBankSales(),
    clinicCashSales: syntheticClinicCashSales(),
    documents: syntheticDocuments(),
  };
}
