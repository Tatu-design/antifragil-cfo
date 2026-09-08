/**
 * Construcción del Financial Ledger de un periodo.
 *
 * Aquí convergen las tres tesorerías (banco SL, banco SC y caja) en un único
 * ledger, cada apunte conservando su cuenta de origen, y aquí se aplican las
 * reglas financieras que el negocio ya tenía.
 *
 * Reglas no negociables implementadas en este módulo:
 *   1. Las liquidaciones de datáfono NO entran una a una: se consolidan en una
 *      única línea de ingreso (evita doble contabilización con las ventas).
 *   2. Las ventas cash de clínica proceden de su Excel, no de las retiradas.
 *   3. Retiradas, traspasos y saldos iniciales son movimientos internos.
 *   4. Un documento sin movimiento NO se convierte en gasto.
 *   5. Ningún movimiento se clasifica sin una regla explícita e inequívoca.
 */

import { resolveAccount } from "./accounts";
import { ACCOUNT_CASH } from "./accounts";
import { reconcileCardSettlements, splitCardSettlements } from "./card-settlements";
import { assignOccurrences, findDuplicateSuspects, stableEntryId, stableHash } from "./dedupe";
import { countByType, createIncident, dedupeIncidents } from "./incidents";
import { detectInternalMovement } from "./internal";
import { DEFAULT_MATCH_CONFIG, type MatchConfig } from "./matching";
import { formatCents, sumCents } from "./money";
import { assertValidPeriod, isInPeriod, periodLabel } from "./period";
import { reconcilePeriod } from "./reconciliation";
import { classify, EMPTY_RULEBOOK, inheritClassification, type RuleBook } from "./rules";
import type {
  AccountSummary,
  AttachedDocument,
  DocumentRef,
  Incident,
  LedgerEntry,
  Period,
  PeriodInput,
  PeriodLedger,
  PeriodSummary,
  SourceRef,
  SupportingDocument,
  TreasuryAccount,
  TreasuryKind,
} from "./types";

export interface BuildOptions {
  /** Catálogo de reglas de clasificación. Por defecto: ninguna (todo pendiente). */
  ruleBook?: RuleBook;
  matchConfig?: MatchConfig;
  /** Etiqueta de la línea consolidada de datáfono. */
  clinicBankIncomeLabel?: string;
  /** Etiqueta de la línea consolidada de ventas en efectivo. */
  clinicCashIncomeLabel?: string;
}

const DEFAULTS = {
  clinicBankIncomeLabel: "Clínica / Fisioterapia Playamar — Banco",
  clinicCashIncomeLabel: "Clínica / Fisioterapia Playamar — Cash",
};

export function buildPeriodLedger(input: PeriodInput, options: BuildOptions = {}): PeriodLedger {
  const period = assertValidPeriod(input.period);
  const accounts = input.accounts;
  const ruleBook = options.ruleBook ?? EMPTY_RULEBOOK;
  const matchConfig = options.matchConfig ?? DEFAULT_MATCH_CONFIG;
  const clinicBankLabel = options.clinicBankIncomeLabel ?? DEFAULTS.clinicBankIncomeLabel;
  const clinicCashLabel = options.clinicCashIncomeLabel ?? DEFAULTS.clinicCashIncomeLabel;

  const incidents: Incident[] = [];
  const entries: LedgerEntry[] = [];

  // ── 0 · Higiene de fuentes ────────────────────────────────────────────────
  // Lo que cae fuera del periodo no se procesa en silencio: se reporta.
  const bankInPeriod = filterByPeriod(input.bankMovements, period, incidents);
  const cashInPeriod = filterByPeriod(input.cashMovements, period, incidents);

  // ── 1 · Datáfono de clínica (consolidado, nunca movimiento a movimiento) ──
  const { settlements, others: ordinaryBank } = splitCardSettlements(bankInPeriod);
  const cardSettlement =
    settlements.length > 0 || input.clinicBankSales.length > 0
      ? reconcileCardSettlements(period, settlements, input.clinicBankSales)
      : null;

  if (settlements.length > 0) {
    const salesDocument = documentFromSource(input.clinicBankSales[0]?.source);
    const aggregatedIds = settlements.map((m) =>
      stableHash(["bank_statement", period, m.accountId, m.date, m.amountCents, m.concept]),
    );
    const notes = [
      `Consolida ${settlements.length} liquidación(es) de remesas de comercio del extracto.`,
      "Las ventas individuales del Excel NO generan ingresos adicionales: son el mismo ingreso.",
    ];

    if (input.clinicBankSales.length === 0) {
      incidents.push(
        createIncident({
          type: "SOURCE_ERROR",
          period,
          message:
            "Hay liquidaciones de datáfono en el banco pero no se ha localizado el Excel de ventas de clínica cobradas por banco. No se puede conciliar el datáfono.",
          details: { totalBanco: sumCents(settlements.map((m) => m.amountCents)) },
        }),
      );
      notes.push("Sin Excel de ventas banco: importe sin contrastar.");
    } else if (cardSettlement && !cardSettlement.reconciled) {
      incidents.push(
        createIncident({
          type: "CARD_SETTLEMENT_MISMATCH",
          period,
          message: `El datáfono no cuadra en ${periodLabel(period)}: banco ${formatCents(
            cardSettlement.bankTotalCents,
          )} vs facturación clínica ${formatCents(
            cardSettlement.salesTotalCents,
          )} (diferencia ${formatCents(cardSettlement.differenceCents)}).`,
          details: {
            totalBanco: cardSettlement.bankTotalCents,
            totalFacturacion: cardSettlement.salesTotalCents,
            diferencia: cardSettlement.differenceCents,
            movimientosBanco: cardSettlement.bankMovementCount,
            lineasVenta: cardSettlement.salesLineCount,
          },
        }),
      );
      notes.push(
        `Descuadre pendiente de revisión: ${formatCents(cardSettlement.differenceCents)}. Las cifras NO se han ajustado.`,
      );
    }

    // Se reconoce el importe efectivamente cobrado en banco. Si difiere de la
    // facturación, la diferencia queda como incidencia, nunca como ajuste.
    const settlementAccount = settlements[0]?.accountId ?? accounts[0]?.id ?? "sl_bank";
    entries.push(
      makeEntry({
        kind: "bank_statement",
        period,
        accounts,
        accountId: settlementAccount,
        date: lastDateOf(settlements) ?? `${period}-01`,
        direction: "income",
        amountCents: sumCents(settlements.map((m) => m.amountCents)),
        description: clinicBankLabel,
        rawDescription: "LIQUIDACIÓN DE REMESAS DE COMERCIO (consolidado del mes)",
        counterparty: "Clínica Antifrágil (datáfono)",
        category: null,
        pnl: null,
        classificationStatus: "pending",
        reconciliation: "reconciled",
        documents: salesDocument
          ? [
              {
                ref: salesDocument,
                method: "aggregate_period",
                score: cardSettlement?.reconciled ? 1 : 0.5,
                reasons: [
                  "conciliación agregada mensual del datáfono",
                  cardSettlement?.reconciled
                    ? "banco y facturación cuadran"
                    : "banco y facturación NO cuadran: ver incidencia",
                ],
              },
            ]
          : [],
        source: {
          kind: "bank_statement",
          file: settlements[0]?.source.file ?? "extracto bancario",
          accountId: settlementAccount,
          raw: `${settlements.length} movimientos consolidados`,
        },
        reviewStatus: cardSettlement?.reconciled ? "imported" : "needs_review",
        occurrence: 0,
        aggregates: aggregatedIds,
        notes,
      }),
    );
  } else if (input.clinicBankSales.length > 0) {
    incidents.push(
      createIncident({
        type: "CARD_SETTLEMENT_MISMATCH",
        period,
        message:
          "Existen ventas de clínica cobradas por banco pero no se ha detectado ninguna liquidación de remesas de comercio en el extracto.",
        details: {
          totalFacturacion: sumCents(input.clinicBankSales.map((s) => Math.abs(s.amountCents))),
        },
      }),
    );
  }

  // ── 2 · Resto de movimientos bancarios (todas las cuentas) ────────────────
  const bankWithOccurrence = assignOccurrences(ordinaryBank, (m) =>
    stableHash([m.accountId, m.date, m.amountCents, m.concept]),
  );

  for (const { item: movement, occurrence } of bankWithOccurrence) {
    const internal = detectInternalMovement(movement.concept);

    if (internal.isInternal) {
      entries.push(
        makeEntry({
          kind: "bank_statement",
          period,
          accounts,
          accountId: movement.accountId,
          date: movement.date,
          valueDate: movement.valueDate,
          direction: "internal",
          amountCents: movement.amountCents,
          description: movement.concept,
          rawDescription: movement.concept,
          category: null,
          pnl: null,
          classificationStatus: "not_applicable",
          reconciliation: "pending",
          documents: [],
          source: movement.source,
          reviewStatus: "imported",
          occurrence,
          notes: [internal.reason ?? "Movimiento interno de tesorería."],
        }),
      );
      continue;
    }

    const direction = movement.amountCents < 0 ? "expense" : "income";
    const classification = classify(movement.concept, {
      ruleBook,
      treasury: "bank",
      direction,
    });

    entries.push(
      makeEntry({
        kind: "bank_statement",
        period,
        accounts,
        accountId: movement.accountId,
        date: movement.date,
        valueDate: movement.valueDate,
        direction,
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.observations
          ? `${movement.concept} | ${movement.observations}`
          : movement.concept,
        category: classification.category,
        pnl: classification.pnl,
        classificationStatus: classification.status,
        classificationRuleId: classification.ruleId ?? null,
        reconciliation: "pending",
        documents: [],
        source: movement.source,
        reviewStatus: classification.status === "pending" ? "needs_review" : "imported",
        occurrence,
        notes: [classification.reason],
      }),
    );
  }

  // ── 3 · Cuenta de cash ────────────────────────────────────────────────────
  const cashWithOccurrence = assignOccurrences(cashInPeriod, (m) =>
    stableHash([m.accountId, m.date, m.amountCents, m.concept]),
  );

  for (const { item: movement, occurrence } of cashWithOccurrence) {
    const internal = detectInternalMovement(movement.concept);
    const isIncomeSigned = movement.amountCents > 0;

    // Un cobro en efectivo anotado en la cuenta de cash es, casi siempre, el
    // reflejo de ventas que ya se reconocen desde su propio Excel. Reconocerlo
    // aquí sería doble contabilización: se registra como interno y se avisa.
    if (internal.isInternal || isIncomeSigned) {
      const reason = internal.isInternal
        ? (internal.reason ?? "Movimiento interno de tesorería.")
        : "Entrada de efectivo en caja: no se reconoce como ingreso. El ingreso de clínica procede del Excel de ventas cash.";

      const entry = makeEntry({
        kind: "cash_account",
        period,
        accounts,
        accountId: movement.accountId,
        date: movement.date,
        direction: "internal",
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.concept,
        category: null,
        pnl: null,
        classificationStatus: "not_applicable",
        reconciliation: "pending",
        documents: [],
        source: movement.source,
        reviewStatus: internal.isInternal ? "imported" : "needs_review",
        occurrence,
        notes: [reason],
      });
      entries.push(entry);

      if (!internal.isInternal) {
        incidents.push(
          createIncident({
            type: "DUPLICATE_SUSPECT",
            severity: "info",
            period,
            message: `Entrada de efectivo en la cuenta de cash no reconocida como ingreso para evitar doble contabilización: "${movement.concept}".`,
            entryIds: [entry.id],
            details: { importe: movement.amountCents },
            source: movement.source,
          }),
        );
      }
      continue;
    }

    const classification = inheritClassification(
      movement.category,
      movement.pnl,
      "Cuenta de cash Antifrágil",
    );

    entries.push(
      makeEntry({
        kind: "cash_account",
        period,
        accounts,
        accountId: movement.accountId,
        date: movement.date,
        direction: "expense",
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.concept,
        category: classification.category,
        pnl: classification.pnl,
        classificationStatus: classification.status,
        reconciliation: "pending",
        documents: [],
        source: movement.source,
        reviewStatus: classification.status === "pending" ? "needs_review" : "imported",
        occurrence,
        notes: [classification.reason],
      }),
    );
  }

  // ── 4 · Ventas de clínica cobradas en efectivo ────────────────────────────
  if (input.clinicCashSales.length > 0) {
    const document = documentFromSource(input.clinicCashSales[0]?.source);
    entries.push(
      makeEntry({
        kind: "clinic_cash_sales",
        period,
        accounts,
        accountId: ACCOUNT_CASH,
        date: lastDateOf(input.clinicCashSales) ?? `${period}-01`,
        direction: "income",
        amountCents: sumCents(input.clinicCashSales.map((s) => Math.abs(s.amountCents))),
        description: clinicCashLabel,
        rawDescription: `Ventas de clínica cobradas en efectivo (${input.clinicCashSales.length} líneas)`,
        counterparty: "Clínica Antifrágil (efectivo)",
        category: null,
        pnl: null,
        classificationStatus: "pending",
        reconciliation: "reconciled",
        documents: document
          ? [
              {
                ref: document,
                method: "aggregate_period",
                score: 1,
                reasons: ["consolidado del Excel de ventas en efectivo del mes"],
              },
            ]
          : [],
        source: {
          kind: "clinic_cash_sales",
          file: input.clinicCashSales[0]?.source.file ?? "ventas clínica cash",
          accountId: ACCOUNT_CASH,
          raw: `${input.clinicCashSales.length} líneas consolidadas`,
        },
        reviewStatus: "imported",
        occurrence: 0,
        notes: [
          "Ingreso obtenido del Excel de ventas en efectivo, no de las retiradas de caja.",
          "La retirada posterior de ese efectivo es tesorería, no un segundo ingreso.",
        ],
      }),
    );
  }

  // ── 5 · Conciliación documental ───────────────────────────────────────────
  const reconciled = reconcilePeriod(entries, input.documents, matchConfig);
  const finalEntries = reconciled.entries;

  for (const entry of finalEntries) {
    if (entry.reconciliation !== "missing_document") continue;
    const isIncome = entry.direction === "income";
    incidents.push(
      createIncident({
        type: isIncome ? "INCOME_WITHOUT_DOCUMENT" : "MOVEMENT_WITHOUT_DOCUMENT",
        // Un gasto en efectivo suele justificarse con el propio documento de
        // caja: se informa, pero no con la gravedad de un movimiento bancario.
        severity: entry.treasury === "cash" && !isIncome ? "info" : "warning",
        period,
        message: `${isIncome ? "Ingreso" : "Movimiento"} sin documento justificativo: "${
          entry.description
        }" (${formatCents(entry.amountCents)}) en ${accountLabel(accounts, entry.accountId)}.`,
        entryIds: [entry.id],
        details: {
          importe: entry.amountCents,
          fecha: entry.date,
          cuenta: entry.accountId,
        },
        source: entry.source,
      }),
    );
  }

  for (const { entry, candidates } of reconciled.ambiguous) {
    incidents.push(
      createIncident({
        type: "AMBIGUOUS_MATCH",
        period,
        message: `Varios documentos encajan con "${entry.description}" (${formatCents(
          entry.amountCents,
        )}). No se ha asociado ninguno.`,
        entryIds: [entry.id],
        details: {
          candidatos: candidates.map((c) => ({
            documento: c.document.document.name,
            emisor: c.document.issuer,
            score: Number(c.score.toFixed(3)),
          })),
        },
        source: entry.source,
      }),
    );
  }

  // ── 6 · Documentos sin movimiento (nunca se convierten en gasto) ──────────
  for (const document of reconciled.unmatchedDocuments) {
    incidents.push(
      createIncident({
        type: "DOCUMENT_WITHOUT_MOVEMENT",
        period,
        message: `Documento sin movimiento localizado: ${document.issuer} ${
          document.amountCents === null ? "(importe no extraído)" : formatCents(document.amountCents)
        } (${document.date}). No se ha creado ningún movimiento.`,
        details: {
          emisor: document.issuer,
          tipo: document.docType,
          importe: document.amountCents,
          documento: document.document.name,
          referencia: document.reference ?? null,
        },
        source: document.source,
        key: document.id,
      }),
    );
  }

  // ── 7 · Movimientos sin clasificar ────────────────────────────────────────
  const unclassified = finalEntries.filter(
    (e) => e.direction !== "internal" && e.classificationStatus === "pending",
  );
  if (unclassified.length > 0) {
    incidents.push(
      createIncident({
        type: "UNCLASSIFIED_MOVEMENT",
        severity: "info",
        period,
        message: `${unclassified.length} movimiento(s) pendientes de clasificar (categoría y P&L).`,
        entryIds: unclassified.map((e) => e.id),
        details: { importeTotal: sumCents(unclassified.map((e) => Math.abs(e.amountCents))) },
        key: "unclassified",
      }),
    );
  }

  // ── 8 · Sospechas de duplicado ────────────────────────────────────────────
  for (const group of findDuplicateSuspects(finalEntries)) {
    incidents.push(
      createIncident({
        type: "DUPLICATE_SUSPECT",
        period,
        message: `${group.length} apuntes idénticos el ${group[0].date}: "${group[0].description}" (${formatCents(
          group[0].amountCents,
        )}). Puede ser real o un duplicado.`,
        entryIds: group.map((e) => e.id),
        details: { importe: group[0].amountCents, ocurrencias: group.length },
      }),
    );
  }

  const finalIncidents = dedupeIncidents(incidents);

  return {
    period,
    accounts,
    entries: finalEntries,
    incidents: finalIncidents,
    cardSettlement,
    unmatchedDocuments: reconciled.unmatchedDocuments,
    summary: summarize(finalEntries, finalIncidents, accounts),
  };
}

// ── Utilidades internas ─────────────────────────────────────────────────────

interface MakeEntryInput {
  kind: SourceRef["kind"];
  period: Period;
  accounts: TreasuryAccount[];
  accountId: string;
  date: string;
  valueDate?: string | null;
  direction: LedgerEntry["direction"];
  amountCents: number;
  description: string;
  rawDescription: string;
  counterparty?: string | null;
  category: string | null;
  pnl: string | null;
  classificationStatus: LedgerEntry["classificationStatus"];
  classificationRuleId?: string | null;
  reconciliation: LedgerEntry["reconciliation"];
  documents: AttachedDocument[];
  source: SourceRef;
  reviewStatus: LedgerEntry["reviewStatus"];
  occurrence: number;
  aggregates?: string[];
  notes?: string[];
}

function makeEntry(input: MakeEntryInput): LedgerEntry {
  const account = resolveAccount(input.accounts, input.accountId);
  return {
    id: stableEntryId({
      kind: input.kind,
      period: input.period,
      accountId: input.accountId,
      date: input.date,
      amountCents: input.amountCents,
      description: input.description,
      occurrence: input.occurrence,
    }),
    period: input.period,
    date: input.date,
    valueDate: input.valueDate ?? null,
    direction: input.direction,
    accountId: account.id,
    treasury: account.kind,
    amountCents: input.amountCents,
    description: input.description,
    rawDescription: input.rawDescription,
    counterparty: input.counterparty ?? null,
    category: input.category,
    pnl: input.pnl,
    classificationStatus: input.classificationStatus,
    classificationRuleId: input.classificationRuleId ?? null,
    reconciliation: input.reconciliation,
    reconciliationReason: null,
    documents: input.documents,
    source: input.source,
    reviewStatus: input.reviewStatus,
    aggregates: input.aggregates,
    notes: input.notes,
  };
}

function filterByPeriod<T extends { date: string; source: SourceRef }>(
  items: T[],
  period: Period,
  incidents: Incident[],
): T[] {
  const inside: T[] = [];
  for (const item of items) {
    if (isInPeriod(item.date, period)) {
      inside.push(item);
      continue;
    }
    incidents.push(
      createIncident({
        type: "SOURCE_ERROR",
        severity: "warning",
        period,
        message: `Movimiento con fecha ${item.date}, fuera del periodo ${period}. No se ha incorporado.`,
        source: item.source,
        key: `${item.source.kind}:${item.source.accountId ?? ""}:${item.date}:${item.source.row ?? ""}`,
      }),
    );
  }
  return inside;
}

function documentFromSource(source: SourceRef | undefined): DocumentRef | null {
  if (!source?.file) return null;
  return {
    name: source.file,
    docType: "sales_sheet",
    driveFileId: null,
    url: null,
    localPath: source.file,
  };
}

function lastDateOf(items: Array<{ date: string }>): string | null {
  const dates = items.map((i) => i.date).filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

function accountLabel(accounts: TreasuryAccount[], accountId: string): string {
  return resolveAccount(accounts, accountId).label;
}

/**
 * Métricas del periodo, deliberadamente limitadas al MVP.
 *
 * Cash Flow operativo, EBITDA y balances quedan fuera a propósito: primero hay
 * que demostrar que los movimientos y su documentación son correctos.
 */
export function summarize(
  entries: LedgerEntry[],
  incidents: Incident[],
  accounts: TreasuryAccount[],
): PeriodSummary {
  const economic = entries.filter((e) => e.direction !== "internal");
  const incomeCents = sumCents(
    economic.filter((e) => e.direction === "income").map((e) => Math.abs(e.amountCents)),
  );
  const expenseCents = sumCents(
    economic.filter((e) => e.direction === "expense").map((e) => Math.abs(e.amountCents)),
  );

  const byAccount: Record<string, AccountSummary> = {};
  const ensureAccount = (accountId: string): AccountSummary => {
    if (!byAccount[accountId]) {
      const account = resolveAccount(accounts, accountId);
      byAccount[accountId] = {
        accountId,
        label: account.label,
        kind: account.kind as TreasuryKind,
        legalEntity: account.legalEntity,
        incomeCents: 0,
        expenseCents: 0,
        netCents: 0,
        movementCount: 0,
      };
    }
    return byAccount[accountId];
  };
  for (const account of accounts) ensureAccount(account.id);

  const byCategory: Record<string, number> = {};
  const byPnl: Record<string, number> = {};

  for (const entry of entries) {
    const summary = ensureAccount(entry.accountId);
    summary.movementCount += 1;
    if (entry.direction === "internal") continue;

    const magnitude = Math.abs(entry.amountCents);
    if (entry.direction === "income") summary.incomeCents += magnitude;
    else summary.expenseCents += magnitude;
    summary.netCents = summary.incomeCents - summary.expenseCents;

    if (entry.direction === "expense") {
      const category = entry.category ?? "PENDIENTE";
      const pnl = entry.pnl ?? "PENDIENTE";
      byCategory[category] = (byCategory[category] ?? 0) + magnitude;
      byPnl[pnl] = (byPnl[pnl] ?? 0) + magnitude;
    }
  }

  // Un movimiento cuenta como conciliado si tiene documento o si, por su
  // naturaleza, no lo necesita. Los internos entran en el cálculo: también
  // forman parte de "todo lo que hay que dejar resuelto".
  const settled = entries.filter(
    (e) => e.reconciliation === "reconciled" || e.reconciliation === "not_document_required",
  ).length;
  const reconciledPct = entries.length === 0 ? 0 : Math.round((settled / entries.length) * 1000) / 10;

  const unjustified = entries.filter(
    (e) => e.reconciliation === "missing_document" || e.reconciliation === "ambiguous",
  );

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    entryCount: entries.length,
    internalMovementCount: entries.filter((e) => e.direction === "internal").length,
    byAccount,
    reconciledPct,
    pendingReviewCount: entries.filter((e) => e.reviewStatus === "needs_review").length,
    pendingClassificationCount: economic.filter((e) => e.classificationStatus === "pending").length,
    unjustifiedAmountCents: sumCents(unjustified.map((e) => Math.abs(e.amountCents))),
    byCategory,
    byPnl,
    incidentCountByType: countByType(incidents),
  };
}

/** Documentos indexados que el motor no ha podido casar, para los informes. */
export type UnmatchedDocuments = SupportingDocument[];
