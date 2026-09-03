/**
 * Modelo de dominio del Financial Ledger de Antifrágil CFO.
 *
 * Principio rector (SYSTEM_VISION D19/D53): el ledger representa UNA ÚNICA
 * realidad económica. Banco, cash, facturas y ventas de clínica son *fuentes*
 * y *documentos* de esa realidad, no realidades paralelas que se suman.
 *
 * Todos los importes se manejan en céntimos enteros (ver money.ts).
 * El signo del importe es el del movimiento real: negativo = salida de dinero.
 */

/** Periodo contable en formato YYYY-MM. */
export type Period = string;

/** Dónde vive el dinero. */
export type Treasury = "bank" | "cash";

/**
 * Naturaleza económica del apunte.
 * - income   → ingreso real (entra en P&L).
 * - expense  → gasto real (entra en P&L).
 * - internal → movimiento interno de tesorería (D36/D37). NUNCA entra en P&L.
 */
export type Direction = "income" | "expense" | "internal";

/** Origen documental del apunte. */
export type SourceKind =
  | "bank_statement"
  | "cash_account"
  | "clinic_bank_sales"
  | "clinic_cash_sales"
  | "expense_invoice"
  | "income_document"
  | "manual";

/** Estado de la clasificación contable (categoría + P&L). */
export type ClassificationStatus =
  /** Sin clasificar. Requiere decisión humana. Es el estado por defecto. */
  | "pending"
  /** Aplicada por una regla determinista con confianza suficiente (D29). */
  | "rule"
  /** Introducida o corregida por una persona (D30). */
  | "manual"
  /** No procede clasificar (movimientos internos). */
  | "not_applicable";

/** Estado de la conciliación documental. */
export type ReconciliationStatus =
  | "matched"
  | "missing_document"
  | "ambiguous"
  | "unmatched"
  | "not_applicable";

/** Estado del ciclo de revisión humana. */
export type ReviewStatus = "imported" | "needs_review" | "reviewed" | "approved";

/** Estado del periodo contable. */
export type PeriodStatus = "open" | "processing" | "review" | "closed";

/**
 * Referencia exacta a la procedencia de un dato.
 * Requisito de auditoría D49: toda cifra debe poder rastrearse hasta aquí.
 */
export interface SourceRef {
  kind: SourceKind;
  /** Nombre del archivo o documento de origen. */
  file: string;
  /** Hoja del libro, si aplica. */
  sheet?: string | null;
  /** Fila original 1-indexada, tal y como la ve el usuario en el documento. */
  row?: number | null;
  /** Texto original íntegro de la fila, sin normalizar. */
  raw?: string | null;
}

/** Documento asociado a un apunte (factura, ticket, Excel de ventas...). */
export interface DocumentRef {
  /** Nombre del archivo tal y como está en Drive o en local. */
  name: string;
  /** ID de Google Drive, si se conoce. Nunca inventar (regla de enlaces). */
  driveFileId?: string | null;
  /** URL de Drive, si se conoce. Nunca inventar. */
  url?: string | null;
  /** Ruta local, si el documento se ha leído desde disco. */
  localPath?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  /** Fecha del documento en ISO YYYY-MM-DD. */
  date?: string | null;
  /** Importe del documento en céntimos. */
  amountCents?: number | null;
}

/** Apunte del ledger: la unidad atómica de realidad económica. */
export interface LedgerEntry {
  /** Identificador estable y determinista. Ver dedupe.ts. Base de D26. */
  id: string;
  period: Period;
  /** Fecha contable en ISO YYYY-MM-DD. */
  date: string;
  /** Fecha valor en ISO, si la fuente la aporta. */
  valueDate?: string | null;
  direction: Direction;
  treasury: Treasury;
  /** Importe en céntimos, con signo real (negativo = salida). */
  amountCents: number;
  /** Descripción normalizada y legible. */
  description: string;
  /** Concepto original, literal, sin tocar. Trazabilidad. */
  rawDescription: string;
  counterparty?: string | null;
  /** Categoría de gasto/ingreso. null = pendiente de decisión humana. */
  category: string | null;
  /** Clasificación P&L. null = pendiente de decisión humana. */
  pnl: string | null;
  classificationStatus: ClassificationStatus;
  reconciliation: ReconciliationStatus;
  documents: DocumentRef[];
  source: SourceRef;
  reviewStatus: ReviewStatus;
  /**
   * Apunte consolidado: agrupa varios movimientos de origen en una sola línea
   * (caso datáfono). aggregates lista los ids de origen consolidados.
   */
  aggregates?: string[];
  /** Notas del motor dirigidas al revisor humano. */
  notes?: string[];
}

/** Movimiento bancario ya normalizado, antes de convertirse en apunte. */
export interface BankMovement {
  date: string;
  valueDate?: string | null;
  concept: string;
  observations?: string | null;
  amountCents: number;
  source: SourceRef;
}

/** Fila de la Cuenta de cash Antifrágil ya normalizada. */
export interface CashMovement {
  date: string;
  concept: string;
  amountCents: number;
  /** Categoría ya asignada en el documento de cash, si existe. */
  category?: string | null;
  /** P&L ya asignado en el documento de cash, si existe. */
  pnl?: string | null;
  source: SourceRef;
}

/** Factura de gasto (o documento de ingreso) indexada. */
export interface Invoice {
  id: string;
  supplier: string;
  invoiceNumber?: string | null;
  date: string;
  /** Importe en céntimos, positivo (magnitud del documento). */
  amountCents: number;
  document: DocumentRef;
  source: SourceRef;
}

/** Línea de un Excel de ventas de clínica (banco o cash). */
export interface ClinicSale {
  date: string;
  concept: string;
  /** Importe en céntimos, positivo. */
  amountCents: number;
  source: SourceRef;
}

/** Tipos de incidencia. Son el canal de "no lo sé con seguridad, revísalo tú". */
export type IncidentType =
  | "EXPENSE_WITHOUT_INVOICE"
  | "INVOICE_WITHOUT_MOVEMENT"
  | "INCOME_WITHOUT_INVOICE"
  | "CARD_SETTLEMENT_MISMATCH"
  | "AMBIGUOUS_MATCH"
  | "DUPLICATE_SUSPECT"
  | "FORMULA_ERROR"
  | "SOURCE_ERROR";

export type IncidentSeverity = "info" | "warning" | "error";

export interface Incident {
  /** Id determinista: repetir la ejecución no duplica incidencias. */
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  period: Period;
  message: string;
  /** Apuntes del ledger implicados. */
  entryIds: string[];
  /** Datos estructurados de apoyo (importes, candidatos, diferencias...). */
  details?: Record<string, unknown>;
  source?: SourceRef;
}

/** Resultado de la conciliación agregada del datáfono. */
export interface CardSettlementReconciliation {
  period: Period;
  /** Suma de las liquidaciones de remesas de comercio del banco. */
  bankTotalCents: number;
  /** Suma del Excel de ventas de clínica cobradas por banco/datáfono. */
  salesTotalCents: number;
  /** bank - sales. Cero = conciliado. Nunca se fuerza a cero. */
  differenceCents: number;
  reconciled: boolean;
  /** Nº de movimientos bancarios de liquidación detectados. */
  bankMovementCount: number;
  /** Nº de líneas de venta consideradas. */
  salesLineCount: number;
}

/** Entrada completa del motor para construir un periodo. */
export interface PeriodInput {
  period: Period;
  bankMovements: BankMovement[];
  cashMovements: CashMovement[];
  clinicBankSales: ClinicSale[];
  clinicCashSales: ClinicSale[];
  invoices: Invoice[];
  /** Documentos justificativos de ingresos no datáfono. */
  incomeDocuments: Invoice[];
}

/** Resultado completo del motor para un periodo. */
export interface PeriodLedger {
  period: Period;
  entries: LedgerEntry[];
  incidents: Incident[];
  cardSettlement: CardSettlementReconciliation | null;
  summary: PeriodSummary;
}

export interface PeriodSummary {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  internalMovementCount: number;
  entryCount: number;
  pendingClassificationCount: number;
  incidentCountByType: Record<string, number>;
  byTreasury: Record<Treasury, { incomeCents: number; expenseCents: number }>;
  byCategory: Record<string, number>;
  byPnl: Record<string, number>;
  withInvoiceCents: number;
  withoutInvoiceCents: number;
}
