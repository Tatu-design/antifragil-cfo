/**
 * Construcción del Financial Ledger de un periodo (D19/D20).
 *
 * Este módulo es el que decide qué es ingreso, qué es gasto, qué es movimiento
 * interno y qué se consolida. Es el punto donde se aplican las reglas
 * financieras que el negocio ya tenía y que aquí quedan escritas y testeadas.
 *
 * Reglas no negociables implementadas aquí:
 *   1. Las liquidaciones de datáfono NO entran una a una: se consolidan en una
 *      única línea de ingreso (evita doble contabilización con las ventas).
 *   2. Las ventas cash de clínica proceden de su Excel, no de las retiradas.
 *   3. Retiradas, traspasos y saldos iniciales son movimientos internos.
 *   4. Una factura sin movimiento NO se convierte en gasto.
 *   5. Ningún gasto bancario nuevo se clasifica sin una regla explícita.
 */

import {
  reconcileCardSettlements,
  splitCardSettlements,
} from "./card-settlements";
import { assignOccurrences, findDuplicateSuspects, stableEntryId, stableHash } from "./dedupe";
import { countByType, createIncident, dedupeIncidents } from "./incidents";
import { detectInternalMovement } from "./internal";
import {
  DEFAULT_MATCH_CONFIG,
  findInvoicesWithoutMovement,
  matchEntryToInvoices,
  reconcileExpensesWithInvoices,
  type MatchConfig,
} from "./matching";
import { formatCents, sumCents } from "./money";
import { assertValidPeriod, isInPeriod, periodLabel } from "./period";
import { classify, EMPTY_RULEBOOK, inheritClassification, type RuleBook } from "./rules";
import type {
  DocumentRef,
  Incident,
  LedgerEntry,
  Period,
  PeriodInput,
  PeriodLedger,
  PeriodSummary,
  SourceRef,
  Treasury,
} from "./types";

export interface BuildOptions {
  /** Catálogo de reglas de clasificación. Por defecto: ninguna (todo pendiente). */
  ruleBook?: RuleBook;
  matchConfig?: MatchConfig;
  /** Etiqueta de la línea consolidada de datáfono en el Cash Flow. */
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
  const ruleBook = options.ruleBook ?? EMPTY_RULEBOOK;
  const matchConfig = options.matchConfig ?? DEFAULT_MATCH_CONFIG;
  const clinicBankLabel = options.clinicBankIncomeLabel ?? DEFAULTS.clinicBankIncomeLabel;
  const clinicCashLabel = options.clinicCashIncomeLabel ?? DEFAULTS.clinicCashIncomeLabel;

  const incidents: Incident[] = [];
  const entries: LedgerEntry[] = [];

  // ── 0 · Higiene de fuentes ────────────────────────────────────────────────
  // Lo que cae fuera del periodo no se procesa en silencio: se reporta.
  const bankInPeriod = filterByPeriod(input.bankMovements, period, "bank_statement", incidents);
  const cashInPeriod = filterByPeriod(input.cashMovements, period, "cash_account", incidents);

  // ── 1 · Datáfono de clínica (consolidado, nunca movimiento a movimiento) ──
  const { settlements, others: ordinaryBank } = splitCardSettlements(bankInPeriod);
  const cardSettlement =
    settlements.length > 0 || input.clinicBankSales.length > 0
      ? reconcileCardSettlements(period, settlements, input.clinicBankSales)
      : null;

  if (settlements.length > 0) {
    const salesDocument = documentFromSource(input.clinicBankSales[0]?.source);
    const aggregatedIds = settlements.map((m) =>
      stableHash(["bank_statement", period, m.date, m.amountCents, m.concept]),
    );
    const notes = [
      `Consolida ${settlements.length} liquidación(es) de remesas de comercio del extracto.`,
      "Las facturas individuales de venta NO generan ingresos adicionales: son el mismo ingreso.",
    ];

    if (input.clinicBankSales.length === 0) {
      // Falta la fuente de contraste: es un problema de fuentes, no un descuadre.
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
    const totalCents = sumCents(settlements.map((m) => m.amountCents));
    entries.push(
      makeEntry({
        kind: "bank_statement",
        period,
        date: lastDateOf(settlements) ?? `${period}-01`,
        direction: "income",
        treasury: "bank",
        amountCents: totalCents,
        description: clinicBankLabel,
        rawDescription: "LIQUIDACIÓN DE REMESAS DE COMERCIO (consolidado del mes)",
        counterparty: "Clínica Antifrágil (datáfono)",
        category: null,
        pnl: null,
        classificationStatus: "pending",
        reconciliation: cardSettlement?.reconciled ? "matched" : "unmatched",
        documents: salesDocument ? [salesDocument] : [],
        source: {
          kind: "bank_statement",
          file: settlements[0]?.source.file ?? "extracto bancario",
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

  // ── 2 · Resto de movimientos bancarios ────────────────────────────────────
  const bankWithOccurrence = assignOccurrences(ordinaryBank, (m) =>
    stableHash([m.date, m.amountCents, m.concept]),
  );

  for (const { item: movement, occurrence } of bankWithOccurrence) {
    const internal = detectInternalMovement(movement.concept);

    if (internal.isInternal) {
      entries.push(
        makeEntry({
          kind: "bank_statement",
          period,
          date: movement.date,
          valueDate: movement.valueDate,
          direction: "internal",
          treasury: "bank",
          amountCents: movement.amountCents,
          description: movement.concept,
          rawDescription: movement.concept,
          category: null,
          pnl: null,
          classificationStatus: "not_applicable",
          reconciliation: "not_applicable",
          documents: [],
          source: movement.source,
          reviewStatus: "imported",
          occurrence,
          notes: [internal.reason ?? "Movimiento interno de tesorería."],
        }),
      );
      continue;
    }

    const isExpense = movement.amountCents < 0;
    const direction = isExpense ? "expense" : "income";
    const classification = classify(movement.concept, {
      ruleBook,
      treasury: "bank",
      direction,
    });

    entries.push(
      makeEntry({
        kind: "bank_statement",
        period,
        date: movement.date,
        valueDate: movement.valueDate,
        direction,
        treasury: "bank",
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.observations
          ? `${movement.concept} | ${movement.observations}`
          : movement.concept,
        counterparty: null,
        category: classification.category,
        pnl: classification.pnl,
        classificationStatus: classification.status,
        reconciliation: "unmatched",
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
    stableHash([m.date, m.amountCents, m.concept]),
  );

  for (const { item: movement, occurrence } of cashWithOccurrence) {
    const internal = detectInternalMovement(movement.concept);
    const isIncomeSigned = movement.amountCents > 0;

    // Un cobro en efectivo anotado en la cuenta de cash es, casi siempre, el
    // reflejo de ventas que ya se reconocen desde su propio Excel. Reconocerlo
    // aquí sería doble contabilización, así que se registra como interno y se
    // deja constancia para revisión humana.
    if (internal.isInternal || isIncomeSigned) {
      const reason = internal.isInternal
        ? (internal.reason ?? "Movimiento interno de tesorería.")
        : "Entrada de efectivo en caja: no se reconoce como ingreso. El ingreso de clínica procede del Excel de ventas cash.";

      const entry = makeEntry({
        kind: "cash_account",
        period,
        date: movement.date,
        direction: "internal",
        treasury: "cash",
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.concept,
        category: null,
        pnl: null,
        classificationStatus: "not_applicable",
        reconciliation: "not_applicable",
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
        date: movement.date,
        direction: "expense",
        treasury: "cash",
        amountCents: movement.amountCents,
        description: movement.concept,
        rawDescription: movement.concept,
        category: classification.category,
        pnl: classification.pnl,
        classificationStatus: classification.status,
        reconciliation: "unmatched",
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
    const totalCents = sumCents(input.clinicCashSales.map((s) => Math.abs(s.amountCents)));
    const document = documentFromSource(input.clinicCashSales[0]?.source);
    entries.push(
      makeEntry({
        kind: "clinic_cash_sales",
        period,
        date: lastDateOf(input.clinicCashSales) ?? `${period}-01`,
        direction: "income",
        treasury: "cash",
        amountCents: totalCents,
        description: clinicCashLabel,
        rawDescription: `Ventas de clínica cobradas en efectivo (${input.clinicCashSales.length} líneas)`,
        counterparty: "Clínica Antifrágil (efectivo)",
        category: null,
        pnl: null,
        classificationStatus: "pending",
        reconciliation: "matched",
        documents: document ? [document] : [],
        source: {
          kind: "clinic_cash_sales",
          file: input.clinicCashSales[0]?.source.file ?? "ventas clínica cash",
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

  // ── 5 · Conciliación de gastos contra facturas ────────────────────────────
  const reconciled = reconcileExpensesWithInvoices(entries, input.invoices, matchConfig);
  const finalEntries = reconciled.entries;

  for (const entry of finalEntries) {
    if (entry.direction !== "expense") continue;
    if (entry.reconciliation === "missing_document") {
      incidents.push(
        createIncident({
          type: "EXPENSE_WITHOUT_INVOICE",
          // Un gasto cash suele justificarse con el propio documento de caja:
          // se informa, pero no se trata con la misma gravedad que en banco.
          severity: entry.treasury === "cash" ? "info" : "warning",
          period,
          message: `Gasto sin factura localizada: "${entry.description}" (${formatCents(entry.amountCents)}).`,
          entryIds: [entry.id],
          details: { importe: entry.amountCents, fecha: entry.date, tesoreria: entry.treasury },
          source: entry.source,
        }),
      );
    }
  }

  for (const { entry, candidates } of reconciled.ambiguous) {
    incidents.push(
      createIncident({
        type: "AMBIGUOUS_MATCH",
        period,
        message: `Varias facturas encajan con "${entry.description}" (${formatCents(entry.amountCents)}). No se ha asociado ninguna.`,
        entryIds: [entry.id],
        details: {
          candidatos: candidates.map((c) => ({
            factura: c.invoice.document.name,
            proveedor: c.invoice.supplier,
            score: Number(c.score.toFixed(3)),
          })),
        },
        source: entry.source,
      }),
    );
  }

  // ── 6 · Facturas sin movimiento (nunca se convierten en gasto) ────────────
  for (const invoice of findInvoicesWithoutMovement(
    reconciled.unmatchedInvoices,
    finalEntries,
    matchConfig,
  )) {
    incidents.push(
      createIncident({
        type: "INVOICE_WITHOUT_MOVEMENT",
        period,
        message: `Factura sin movimiento localizado: ${invoice.supplier} ${formatCents(
          invoice.amountCents,
        )} (${invoice.date}). No se ha creado ningún gasto.`,
        details: {
          proveedor: invoice.supplier,
          importe: invoice.amountCents,
          documento: invoice.document.name,
          numeroFactura: invoice.invoiceNumber ?? null,
        },
        source: invoice.source,
        key: invoice.id,
      }),
    );
  }

  // ── 7 · Ingresos bancarios sin documentación ──────────────────────────────
  const incomeEntries = finalEntries.filter(
    (e) => e.direction === "income" && e.source.kind === "bank_statement" && !e.aggregates,
  );
  for (const entry of incomeEntries) {
    const outcome = matchEntryToInvoices(entry, input.incomeDocuments, matchConfig);
    if (outcome.status === "matched") {
      entry.reconciliation = "matched";
      entry.documents = [...entry.documents, outcome.candidate.invoice.document];
      continue;
    }
    entry.reconciliation = outcome.status === "ambiguous" ? "ambiguous" : "missing_document";
    entry.reviewStatus = "needs_review";
    incidents.push(
      createIncident({
        type: "INCOME_WITHOUT_INVOICE",
        period,
        message: `Ingreso bancario sin factura localizada: "${entry.description}" (${formatCents(entry.amountCents)}).`,
        entryIds: [entry.id],
        details: { importe: entry.amountCents, fecha: entry.date },
        source: entry.source,
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

  return {
    period,
    entries: finalEntries,
    incidents: dedupeIncidents(incidents),
    cardSettlement,
    summary: summarize(finalEntries, dedupeIncidents(incidents)),
  };
}

// ── Utilidades internas ─────────────────────────────────────────────────────

interface MakeEntryInput {
  kind: SourceRef["kind"];
  period: Period;
  date: string;
  valueDate?: string | null;
  direction: LedgerEntry["direction"];
  treasury: Treasury;
  amountCents: number;
  description: string;
  rawDescription: string;
  counterparty?: string | null;
  category: string | null;
  pnl: string | null;
  classificationStatus: LedgerEntry["classificationStatus"];
  reconciliation: LedgerEntry["reconciliation"];
  documents: DocumentRef[];
  source: SourceRef;
  reviewStatus: LedgerEntry["reviewStatus"];
  occurrence: number;
  aggregates?: string[];
  notes?: string[];
}

function makeEntry(input: MakeEntryInput): LedgerEntry {
  return {
    id: stableEntryId({
      kind: input.kind,
      period: input.period,
      date: input.date,
      amountCents: input.amountCents,
      description: input.description,
      occurrence: input.occurrence,
    }),
    period: input.period,
    date: input.date,
    valueDate: input.valueDate ?? null,
    direction: input.direction,
    treasury: input.treasury,
    amountCents: input.amountCents,
    description: input.description,
    rawDescription: input.rawDescription,
    counterparty: input.counterparty ?? null,
    category: input.category,
    pnl: input.pnl,
    classificationStatus: input.classificationStatus,
    reconciliation: input.reconciliation,
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
  kind: SourceRef["kind"],
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
        key: `${kind}:${item.date}:${item.source.row ?? ""}`,
      }),
    );
  }
  return inside;
}

function documentFromSource(source: SourceRef | undefined): DocumentRef | null {
  if (!source?.file) return null;
  return {
    name: source.file,
    driveFileId: null,
    url: null,
    localPath: source.file,
  };
}

function lastDateOf(items: Array<{ date: string }>): string | null {
  const dates = items.map((i) => i.date).filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

function summarize(entries: LedgerEntry[], incidents: Incident[]): PeriodSummary {
  const economic = entries.filter((e) => e.direction !== "internal");
  const incomeCents = sumCents(
    economic.filter((e) => e.direction === "income").map((e) => Math.abs(e.amountCents)),
  );
  const expenseCents = sumCents(
    economic.filter((e) => e.direction === "expense").map((e) => Math.abs(e.amountCents)),
  );

  const byTreasury: PeriodSummary["byTreasury"] = {
    bank: { incomeCents: 0, expenseCents: 0 },
    cash: { incomeCents: 0, expenseCents: 0 },
  };
  const byCategory: Record<string, number> = {};
  const byPnl: Record<string, number> = {};
  let withInvoiceCents = 0;
  let withoutInvoiceCents = 0;

  for (const entry of economic) {
    const magnitude = Math.abs(entry.amountCents);
    if (entry.direction === "income") byTreasury[entry.treasury].incomeCents += magnitude;
    else byTreasury[entry.treasury].expenseCents += magnitude;

    if (entry.direction === "expense") {
      const category = entry.category ?? "PENDIENTE";
      const pnl = entry.pnl ?? "PENDIENTE";
      byCategory[category] = (byCategory[category] ?? 0) + magnitude;
      byPnl[pnl] = (byPnl[pnl] ?? 0) + magnitude;
      if (entry.documents.length > 0) withInvoiceCents += magnitude;
      else withoutInvoiceCents += magnitude;
    }
  }

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    internalMovementCount: entries.filter((e) => e.direction === "internal").length,
    entryCount: entries.length,
    pendingClassificationCount: economic.filter((e) => e.classificationStatus === "pending").length,
    incidentCountByType: countByType(incidents),
    byTreasury,
    byCategory,
    byPnl,
    withInvoiceCents,
    withoutInvoiceCents,
  };
}
