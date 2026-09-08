/**
 * Modelo de dominio del Financial Ledger de Antifrágil CFO.
 *
 * MISIÓN DE ESTA ETAPA:
 *   Conciliar todos los movimientos reales de tesorería con su documentación
 *   justificativa y dejar las excepciones listas para revisión humana.
 *
 * Principio rector: el ledger representa UNA ÚNICA realidad económica. Las tres
 * tesorerías (banco SL, banco SC y caja) y los documentos de Drive son *fuentes*
 * y *pruebas* de esa realidad, no realidades paralelas que se suman.
 *
 * Todos los importes se manejan en céntimos enteros (ver money.ts).
 * El signo del importe es el del movimiento real: negativo = salida de dinero.
 */

/** Periodo contable en formato YYYY-MM. */
export type Period = string;

/** Naturaleza física de la tesorería. */
export type TreasuryKind = "bank" | "cash";

/** Entidad legal a la que pertenece la cuenta. */
export type LegalEntity = "SL" | "SC" | "OTHER";

/**
 * Cuenta de tesorería concreta.
 *
 * Cada movimiento conserva SIEMPRE la cuenta de la que procede: sin eso no se
 * puede responder "¿cuánto se movió en la SC este mes?", que es una pregunta
 * cotidiana del negocio.
 */
export interface TreasuryAccount {
  /** Identificador estable, usado en ids, informes y carpetas de entrada. */
  id: string;
  label: string;
  kind: TreasuryKind;
  legalEntity: LegalEntity;
}

/**
 * Naturaleza económica del apunte.
 * - income   → ingreso real (entra en P&L).
 * - expense  → gasto real (entra en P&L).
 * - internal → movimiento interno de tesorería. NUNCA entra en P&L.
 */
export type Direction = "income" | "expense" | "internal";

/** Origen del dato. */
export type SourceKind =
  | "bank_statement"
  | "cash_account"
  | "clinic_bank_sales"
  | "clinic_cash_sales"
  | "supporting_document"
  | "manual";

/** Estado de la clasificación contable (categoría + P&L). */
export type ClassificationStatus =
  /** Sin clasificar. Requiere decisión humana. Es el estado por defecto. */
  | "pending"
  /** Aplicada por una regla determinista inequívoca. */
  | "rule"
  /** Introducida o corregida por una persona. */
  | "manual"
  /** No procede clasificar (movimientos internos). */
  | "not_applicable";

/**
 * Estado de la conciliación documental.
 *
 * No todos los movimientos necesitan documento: una comisión bancaria o un
 * traspaso entre cuentas propias no tienen factura y nunca la tendrán. Por eso
 * existe `not_document_required`, que es un estado final legítimo y no una
 * excepción pendiente.
 */
export type ReconciliationStatus =
  /** Todavía no evaluado. */
  | "pending"
  /** Documentación localizada y asociada con evidencia suficiente. */
  | "reconciled"
  /** Debería tener documento justificativo y no se ha encontrado. */
  | "missing_document"
  /** Varios documentos plausibles; ninguno asociado automáticamente. */
  | "ambiguous"
  /** No requiere documento por su naturaleza. Estado final, no excepción. */
  | "not_document_required";

/** Estado del ciclo de revisión humana. */
export type ReviewStatus = "imported" | "needs_review" | "reviewed" | "approved";

/** Estado del periodo contable. */
export type PeriodStatus = "open" | "processing" | "review" | "closed";

/**
 * Referencia exacta a la procedencia de un dato.
 * Toda cifra debe poder rastrearse hasta aquí.
 */
export interface SourceRef {
  kind: SourceKind;
  /** Nombre del archivo o documento de origen. */
  file: string;
  /** Cuenta de tesorería de la que procede, cuando aplica. */
  accountId?: string | null;
  /** Hoja del libro, si aplica. */
  sheet?: string | null;
  /** Fila original 1-indexada, tal y como la ve el usuario en el documento. */
  row?: number | null;
  /** Texto original íntegro de la fila, sin normalizar. */
  raw?: string | null;
}

/**
 * Tipo de documento justificativo.
 *
 * El sistema NO piensa solo en facturas: una nómina, un modelo de impuestos, un
 * recibo de Seguridad Social o un Excel de ventas justifican movimientos igual
 * de bien y con reglas distintas.
 */
export type DocumentType =
  | "invoice"
  | "payroll"
  | "tax"
  | "social_security"
  | "receipt"
  | "sales_sheet"
  | "bank_statement"
  | "contract"
  | "other";

/** Documento justificativo, vivan sus bytes en Drive o en local. */
export interface DocumentRef {
  /** Nombre del archivo tal y como está en Drive o en local. */
  name: string;
  docType?: DocumentType;
  /** ID de Google Drive, si se conoce. Nunca inventar. */
  driveFileId?: string | null;
  /** URL de Drive, si se conoce. Nunca inventar. */
  url?: string | null;
  mimeType?: string | null;
  /** Ruta de carpeta dentro de la raíz financiera de Drive. */
  folderPath?: string | null;
  /** Ruta local, si el documento se ha leído desde disco. */
  localPath?: string | null;
  /** Emisor: proveedor, organismo, entidad… */
  issuer?: string | null;
  /** Nº de factura, de nómina, modelo de impuesto… */
  reference?: string | null;
  /** Fecha del documento en ISO YYYY-MM-DD. */
  date?: string | null;
  /** Importe del documento en céntimos. `null` si aún no se ha extraído. */
  amountCents?: number | null;
}

/** Cómo se ha establecido una asociación movimiento ↔ documento. */
export type MatchMethod =
  /** Importe + fecha + emisor. El caso habitual. */
  | "amount_date_issuer"
  /** La referencia del documento aparece en el concepto del movimiento. */
  | "reference_in_concept"
  /** Varios movimientos suman el importe de un único documento. */
  | "aggregate_sum"
  /** Conciliación agregada especial (datáfono). */
  | "aggregate_period"
  /** Asociación hecha por una persona. */
  | "manual";

/**
 * Documento asociado a un apunte, con la evidencia que respalda la asociación.
 *
 * Guardar la evidencia es lo que permite auditar meses después por qué el motor
 * decidió que esa factura correspondía a ese pago.
 */
export interface AttachedDocument {
  ref: DocumentRef;
  method: MatchMethod;
  /** Confianza en [0, 1]. `null` en asociaciones manuales. */
  score: number | null;
  /** Motivos legibles: "importe exacto", "3 días de diferencia"… */
  reasons: string[];
  /** Id del grupo, cuando varios movimientos comparten un mismo documento. */
  groupId?: string | null;
}

/** Apunte del ledger: la unidad atómica de realidad económica. */
export interface LedgerEntry {
  /** Identificador estable y determinista. Ver dedupe.ts. */
  id: string;
  period: Period;
  /** Fecha contable en ISO YYYY-MM-DD. */
  date: string;
  /** Fecha valor en ISO, si la fuente la aporta. */
  valueDate?: string | null;
  direction: Direction;
  /** Cuenta concreta de origen: banco SL, banco SC o caja. */
  accountId: string;
  /** Naturaleza de esa cuenta, para agregaciones rápidas. */
  treasury: TreasuryKind;
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
  /** Regla que aplicó la clasificación, si la hubo. */
  classificationRuleId?: string | null;
  reconciliation: ReconciliationStatus;
  /** Por qué no requiere documento, cuando ese es su estado. */
  reconciliationReason?: string | null;
  documents: AttachedDocument[];
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
  /** Cuenta de la que procede. */
  accountId: string;
  source: SourceRef;
}

/** Fila de la Cuenta de cash Antifrágil ya normalizada. */
export interface CashMovement {
  date: string;
  concept: string;
  amountCents: number;
  accountId: string;
  /** Categoría ya asignada en el documento de cash, si existe. */
  category?: string | null;
  /** P&L ya asignado en el documento de cash, si existe. */
  pnl?: string | null;
  source: SourceRef;
}

/**
 * Documento justificativo indexado y disponible para conciliar.
 *
 * Sustituye al antiguo concepto de "factura": el motor trata igual una factura,
 * una nómina, un impuesto o un recibo, cambiando solo las reglas de matching.
 */
export interface SupportingDocument {
  id: string;
  docType: DocumentType;
  /** Proveedor, organismo o entidad emisora. */
  issuer: string;
  /** Nº de factura, nómina o modelo. */
  reference?: string | null;
  date: string;
  /** Importe en céntimos, positivo. `null` si no se ha podido extraer. */
  amountCents: number | null;
  document: DocumentRef;
  source: SourceRef;
  /** Periodo al que se asigna el documento, si se conoce. */
  period?: Period | null;
}

/** Línea de un Excel de ventas de clínica (banco o cash). */
export interface ClinicSale {
  date: string;
  concept: string;
  /** Importe en céntimos, positivo. */
  amountCents: number;
  source: SourceRef;
}

/** Tipos de incidencia. El canal formal de "no lo puedo decidir yo". */
export type IncidentType =
  | "MOVEMENT_WITHOUT_DOCUMENT"
  | "DOCUMENT_WITHOUT_MOVEMENT"
  | "INCOME_WITHOUT_DOCUMENT"
  | "CARD_SETTLEMENT_MISMATCH"
  | "AMBIGUOUS_MATCH"
  | "DUPLICATE_SUSPECT"
  | "UNCLASSIFIED_MOVEMENT"
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
  /** Cuentas de tesorería activas en el periodo. */
  accounts: TreasuryAccount[];
  bankMovements: BankMovement[];
  cashMovements: CashMovement[];
  clinicBankSales: ClinicSale[];
  clinicCashSales: ClinicSale[];
  /** Índice documental disponible para conciliar (Drive o local). */
  documents: SupportingDocument[];
}

/** Resultado completo del motor para un periodo. */
export interface PeriodLedger {
  period: Period;
  accounts: TreasuryAccount[];
  entries: LedgerEntry[];
  incidents: Incident[];
  cardSettlement: CardSettlementReconciliation | null;
  /** Documentos indexados que no han podido asociarse a ningún movimiento. */
  unmatchedDocuments: SupportingDocument[];
  summary: PeriodSummary;
}

/** Métricas del periodo. Deliberadamente limitadas al MVP. */
export interface PeriodSummary {
  incomeCents: number;
  expenseCents: number;
  /** Ingresos - gastos. Flujo neto de caja del periodo. */
  netCents: number;
  entryCount: number;
  internalMovementCount: number;
  /** Movimientos por cuenta de tesorería. */
  byAccount: Record<string, AccountSummary>;
  /** % de movimientos que requieren documento y lo tienen (o no lo requieren). */
  reconciledPct: number;
  /** Movimientos en alguna cola de revisión. */
  pendingReviewCount: number;
  pendingClassificationCount: number;
  /** Importe de movimientos sin justificar (missing_document + ambiguous). */
  unjustifiedAmountCents: number;
  byCategory: Record<string, number>;
  byPnl: Record<string, number>;
  incidentCountByType: Record<string, number>;
}

export interface AccountSummary {
  accountId: string;
  label: string;
  kind: TreasuryKind;
  legalEntity: LegalEntity;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  movementCount: number;
}
