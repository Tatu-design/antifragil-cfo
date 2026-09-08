import "server-only";
import { DEFAULT_ACCOUNTS, resolveAccount } from "../finance/accounts";
import { summarize } from "../finance/ledger";
import type {
  AttachedDocument,
  Incident,
  LedgerEntry,
  SupportingDocument,
  TreasuryAccount,
} from "../finance/types";
import { issuerFromFileName, type RegisteredDocument } from "../ingest/registry";
import { createClient } from "../supabase/server";
import type { DocumentRepository, LedgerRepository } from "./types";

/**
 * Persistencia en Supabase (PostgreSQL).
 *
 * IMPORTANTE: se usa el cliente **de sesión**, no el privilegiado. Cada consulta
 * viaja como el usuario autenticado, así que RLS es quien decide qué puede leer
 * y escribir. Si mañana hay varios usuarios, la seguridad ya está en la base de
 * datos y no depende de que el código se acuerde de filtrar.
 *
 * La idempotencia tampoco depende de este código: las restricciones UNIQUE del
 * esquema son las que impiden duplicar documentos, movimientos e incidencias.
 */

// ── Documentos ──────────────────────────────────────────────────────────────

export function createSupabaseDocumentRepository(): DocumentRepository {
  return {
    name: "supabase",

    async loadPeriodDocuments(period) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("period", period)
        .order("name", { ascending: true });

      if (error) throw new Error(`No se han podido leer los documentos: ${error.message}`);
      return { period, documents: (data ?? []).map(rowToRegistered) };
    },

    async knownHashes(period) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("content_hash")
        .eq("period", period);

      if (error) throw new Error(`No se han podido leer las huellas: ${error.message}`);
      return new Set((data ?? []).map((row) => row.content_hash as string));
    },

    async registerIngest(summary, uploadedBy) {
      const supabase = await createClient();

      const rows = summary.documents
        .filter((document) => document.outcome !== "duplicate" && document.outcome !== "rejected")
        .map((document) => {
          const recognition = document.recognition;
          return {
            period: recognition?.period ?? summary.period,
            content_hash: document.hash,
            storage_path: document.storagePath,
            name: document.fileName,
            mime_type: document.mimeType,
            size_bytes: document.sizeBytes,
            kind: recognition?.kind ?? "unknown",
            account_id: recognition?.accountId ?? null,
            doc_type: recognition?.docType ?? "other",
            issuer: issuerFromFileName(document.fileName),
            amount_cents: recognition?.amountCents ?? null,
            confidence: recognition?.confidence ?? 0,
            inferred_from: recognition?.reasons ?? [],
            needs_review: recognition?.needsReview ?? true,
            review_question: recognition?.question?.message ?? null,
            uploaded_by: uploadedBy,
            uploaded_at: new Date().toISOString(),
          };
        });

      if (rows.length > 0) {
        // (period, content_hash) es UNIQUE: subir el mismo archivo otra vez
        // actualiza la fila existente en lugar de crear una nueva.
        const { error } = await supabase
          .from("documents")
          .upsert(rows, { onConflict: "period,content_hash", ignoreDuplicates: true });
        if (error) throw new Error(`No se han podido registrar los documentos: ${error.message}`);
      }

      // Traza de la carga, aunque no haya entrado ningún documento nuevo.
      await supabase.from("document_uploads").insert({
        period: summary.period,
        received_count: summary.received,
        recognized_count: summary.recognized,
        review_count: summary.needsReview,
        duplicate_count: summary.duplicates,
        rejected_count: summary.rejected,
        uploaded_by: uploadedBy,
      });

      return this.loadPeriodDocuments(summary.period);
    },

    async resolveDocument(period, hash, resolution) {
      const supabase = await createClient();
      const patch: Record<string, unknown> = {
        needs_review: false,
        review_question: null,
        confidence: 1,
      };
      if (resolution.kind) patch.kind = resolution.kind;
      if (resolution.accountId !== undefined) patch.account_id = resolution.accountId;
      if (resolution.docType) patch.doc_type = resolution.docType;

      const { error } = await supabase
        .from("documents")
        .update(patch)
        .eq("period", period)
        .eq("content_hash", hash);

      if (error) throw new Error(`No se ha podido actualizar el documento: ${error.message}`);
      return this.loadPeriodDocuments(period);
    },

    async listPeriodsWithDocuments() {
      const supabase = await createClient();
      const { data, error } = await supabase.from("documents").select("period");
      if (error) return [];
      return [...new Set((data ?? []).map((row) => row.period as string))].sort().reverse();
    },
  };
}

interface DocumentRow {
  content_hash: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  period: string | null;
  kind: string | null;
  account_id: string | null;
  doc_type: string | null;
  amount_cents: number | null;
  confidence: number | null;
  inferred_from: string[] | null;
  needs_review: boolean | null;
  review_question: string | null;
  issuer: string | null;
  doc_date: string | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
}

function rowToRegistered(row: DocumentRow): RegisteredDocument {
  return {
    hash: row.content_hash,
    fileName: row.name,
    mimeType: row.mime_type ?? "application/octet-stream",
    sizeBytes: row.size_bytes ?? 0,
    storagePath: row.storage_path ?? "",
    period: row.period ?? "",
    kind: row.kind ?? "unknown",
    accountId: row.account_id,
    docType: row.doc_type ?? "other",
    amountCents: row.amount_cents,
    confidence: Number(row.confidence ?? 0),
    reasons: row.inferred_from ?? [],
    needsReview: row.needs_review ?? false,
    question: row.review_question,
    uploadedAt: row.uploaded_at ?? "",
    uploadedBy: row.uploaded_by,
  };
}

// ── Ledger ──────────────────────────────────────────────────────────────────

export function createSupabaseLedgerRepository(): LedgerRepository {
  return {
    name: "supabase",

    async loadLedger(period) {
      const supabase = await createClient();

      const [entriesResult, incidentsResult, cardResult, linksResult, documentsResult, accountsResult] =
        await Promise.all([
          supabase.from("ledger_entries").select("*").eq("period", period),
          supabase.from("incidents").select("*").eq("period", period),
          supabase.from("card_settlements").select("*").eq("period", period).maybeSingle(),
          supabase.from("entry_documents").select("*"),
          supabase.from("documents").select("*").eq("period", period),
          supabase.from("treasury_accounts").select("*").eq("active", true),
        ]);

      if (entriesResult.error) {
        throw new Error(`No se ha podido leer el ledger: ${entriesResult.error.message}`);
      }
      const entryRows = entriesResult.data ?? [];
      if (entryRows.length === 0) return null;

      const accounts: TreasuryAccount[] =
        (accountsResult.data ?? []).length > 0
          ? (accountsResult.data ?? []).map((row) => ({
              id: row.id as string,
              label: row.label as string,
              kind: row.kind as TreasuryAccount["kind"],
              legalEntity: row.legal_entity as TreasuryAccount["legalEntity"],
            }))
          : DEFAULT_ACCOUNTS;

      const documentsByHash = new Map(
        (documentsResult.data ?? []).map((row) => [row.content_hash as string, row as DocumentRow]),
      );
      const linksByEntry = new Map<string, AttachedDocument[]>();
      for (const link of linksResult.data ?? []) {
        const document = documentsByHash.get(link.document_hash as string);
        if (!document) continue;
        const attached: AttachedDocument = {
          ref: {
            name: document.name,
            docType: (document.doc_type ?? "other") as AttachedDocument["ref"]["docType"],
            driveFileId: null,
            url: document.storage_path ? `/api/documentos/${document.storage_path}` : null,
            localPath: document.storage_path,
            issuer: document.issuer ?? null,
            date: document.doc_date ?? null,
            amountCents: document.amount_cents,
          },
          method: link.match_method as AttachedDocument["method"],
          score: link.match_score === null ? null : Number(link.match_score),
          reasons: (link.match_reasons ?? []) as string[],
          groupId: (link.group_id ?? null) as string | null,
        };
        const entryId = link.entry_id as string;
        linksByEntry.set(entryId, [...(linksByEntry.get(entryId) ?? []), attached]);
      }

      const entries: LedgerEntry[] = entryRows.map((row) => rowToEntry(row, linksByEntry));
      const incidents: Incident[] = (incidentsResult.data ?? []).map(rowToIncident);

      const usedHashes = new Set(
        (linksResult.data ?? []).map((link) => link.document_hash as string),
      );
      const unmatchedDocuments: SupportingDocument[] = [...documentsByHash.values()]
        .filter((row) => row.kind === "supporting_document" && !usedHashes.has(row.content_hash))
        .map(rowToSupportingDocument);

      return {
        period,
        accounts,
        entries,
        incidents,
        cardSettlement: cardResult.data
          ? {
              period,
              bankTotalCents: Number(cardResult.data.bank_total_cents),
              salesTotalCents: Number(cardResult.data.sales_total_cents),
              differenceCents: Number(cardResult.data.difference_cents),
              reconciled: Boolean(cardResult.data.reconciled),
              bankMovementCount: Number(cardResult.data.bank_movement_count),
              salesLineCount: Number(cardResult.data.sales_line_count),
            }
          : null,
        unmatchedDocuments,
        summary: summarize(entries, incidents, accounts),
      };
    },

    async saveLedger(period, ledger, sourceHashes) {
      const supabase = await createClient();

      // El periodo tiene que existir antes que sus movimientos (FK).
      const { error: periodError } = await supabase
        .from("periods")
        .upsert(
          { period, status: "review", source_hashes: sourceHashes },
          { onConflict: "period" },
        );
      if (periodError) {
        throw new Error(`No se ha podido guardar el periodo: ${periodError.message}`);
      }

      const entryRows = ledger.entries.map((entry) => ({
        id: entry.id,
        period: entry.period,
        account_id: entry.accountId,
        entry_date: entry.date,
        value_date: entry.valueDate,
        direction: entry.direction,
        treasury: entry.treasury,
        amount_cents: entry.amountCents,
        description: entry.description,
        raw_description: entry.rawDescription,
        counterparty: entry.counterparty,
        category: entry.category,
        pnl: entry.pnl,
        classification_status: entry.classificationStatus,
        classification_rule_id: entry.classificationRuleId ?? null,
        reconciliation: entry.reconciliation,
        reconciliation_reason: entry.reconciliationReason ?? null,
        review_status: entry.reviewStatus,
        source_kind: entry.source.kind,
        source_file: entry.source.file,
        source_sheet: entry.source.sheet ?? null,
        source_row: entry.source.row ?? null,
        source_raw: entry.source.raw ?? null,
        aggregates: entry.aggregates ?? null,
        notes: entry.notes ?? null,
      }));

      if (entryRows.length > 0) {
        // El id es determinista: reprocesar actualiza, nunca duplica.
        const { error } = await supabase
          .from("ledger_entries")
          .upsert(entryRows, { onConflict: "id" });
        if (error) throw new Error(`No se han podido guardar los movimientos: ${error.message}`);
      }

      // Las asociaciones se rehacen: la conciliación es un cálculo, no un dato
      // que el usuario haya escrito. Las decisiones humanas viven en el propio
      // movimiento (review_status), y el motor las respeta al reprocesar.
      const entryIds = ledger.entries.map((entry) => entry.id);
      if (entryIds.length > 0) {
        await supabase.from("entry_documents").delete().in("entry_id", entryIds);
      }

      const linkRows = ledger.entries.flatMap((entry) =>
        entry.documents.map((document) => ({
          entry_id: entry.id,
          period: entry.period,
          document_hash: documentHashFor(document),
          match_method: document.method,
          match_score: document.score,
          match_reasons: document.reasons,
          group_id: document.groupId ?? null,
        })),
      ).filter((row) => row.document_hash !== null);

      if (linkRows.length > 0) {
        const { error } = await supabase
          .from("entry_documents")
          .upsert(linkRows, { onConflict: "entry_id,document_hash" });
        if (error) throw new Error(`No se han podido guardar las conciliaciones: ${error.message}`);
      }

      // Las incidencias tienen id determinista: reprocesar no las duplica. Las
      // que ya no aplican se retiran; las resueltas por una persona conservan su
      // estado porque el upsert no toca esas columnas.
      const incidentIds = ledger.incidents.map((incident) => incident.id);
      const staleQuery = supabase.from("incidents").delete().eq("period", period).eq("status", "open");
      await (incidentIds.length > 0 ? staleQuery.not("id", "in", `(${incidentIds.join(",")})`) : staleQuery);

      if (ledger.incidents.length > 0) {
        const { error } = await supabase.from("incidents").upsert(
          ledger.incidents.map((incident) => ({
            id: incident.id,
            period: incident.period,
            type: incident.type,
            severity: incident.severity,
            message: incident.message,
            entry_ids: incident.entryIds,
            details: incident.details ?? null,
            source_file: incident.source?.file ?? null,
            source_sheet: incident.source?.sheet ?? null,
            source_row: incident.source?.row ?? null,
          })),
          { onConflict: "id", ignoreDuplicates: false },
        );
        if (error) throw new Error(`No se han podido guardar las incidencias: ${error.message}`);
      }

      if (ledger.cardSettlement) {
        const card = ledger.cardSettlement;
        const { error } = await supabase.from("card_settlements").upsert(
          {
            period,
            bank_total_cents: card.bankTotalCents,
            sales_total_cents: card.salesTotalCents,
            difference_cents: card.differenceCents,
            reconciled: card.reconciled,
            bank_movement_count: card.bankMovementCount,
            sales_line_count: card.salesLineCount,
            computed_at: new Date().toISOString(),
          },
          { onConflict: "period" },
        );
        if (error) throw new Error(`No se ha podido guardar el datáfono: ${error.message}`);
      }
    },

    async loadProcessedSources(period) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("periods")
        .select("source_hashes")
        .eq("period", period)
        .maybeSingle();
      return (data?.source_hashes as string[] | null) ?? null;
    },

    async listProcessedPeriods() {
      const supabase = await createClient();
      const { data, error } = await supabase.from("ledger_entries").select("period");
      if (error) return [];
      return [...new Set((data ?? []).map((row) => row.period as string))].sort().reverse();
    },
  };
}

/**
 * Huella del documento asociado.
 *
 * Los documentos se referencian por su huella de contenido. Un adjunto sin
 * huella (el Excel de ventas consolidado del datáfono, que es una fuente y no
 * un justificante subido) no genera fila de conciliación.
 */
function documentHashFor(document: AttachedDocument): string | null {
  const path = document.ref.localPath;
  if (!path) return null;
  const match = /([0-9a-f]{64})/.exec(path);
  return match ? match[1] : null;
}

interface EntryRow {
  id: string;
  period: string;
  account_id: string;
  entry_date: string;
  value_date: string | null;
  direction: LedgerEntry["direction"];
  treasury: LedgerEntry["treasury"];
  amount_cents: number;
  description: string;
  raw_description: string;
  counterparty: string | null;
  category: string | null;
  pnl: string | null;
  classification_status: LedgerEntry["classificationStatus"];
  classification_rule_id: string | null;
  reconciliation: LedgerEntry["reconciliation"];
  reconciliation_reason: string | null;
  review_status: LedgerEntry["reviewStatus"];
  source_kind: string;
  source_file: string;
  source_sheet: string | null;
  source_row: number | null;
  source_raw: string | null;
  aggregates: string[] | null;
  notes: string[] | null;
}

function rowToEntry(row: EntryRow, links: Map<string, AttachedDocument[]>): LedgerEntry {
  return {
    id: row.id,
    period: row.period,
    date: row.entry_date,
    valueDate: row.value_date,
    direction: row.direction,
    accountId: row.account_id,
    treasury: row.treasury,
    amountCents: Number(row.amount_cents),
    description: row.description,
    rawDescription: row.raw_description,
    counterparty: row.counterparty,
    category: row.category,
    pnl: row.pnl,
    classificationStatus: row.classification_status,
    classificationRuleId: row.classification_rule_id,
    reconciliation: row.reconciliation,
    reconciliationReason: row.reconciliation_reason,
    documents: links.get(row.id) ?? [],
    source: {
      kind: row.source_kind as LedgerEntry["source"]["kind"],
      file: row.source_file,
      accountId: row.account_id,
      sheet: row.source_sheet,
      row: row.source_row,
      raw: row.source_raw,
    },
    reviewStatus: row.review_status,
    aggregates: row.aggregates ?? undefined,
    notes: row.notes ?? undefined,
  };
}

interface IncidentRow {
  id: string;
  period: string;
  type: Incident["type"];
  severity: Incident["severity"];
  message: string;
  entry_ids: string[] | null;
  details: Record<string, unknown> | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
}

function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    period: row.period,
    message: row.message,
    entryIds: row.entry_ids ?? [],
    details: row.details ?? undefined,
    source: row.source_file
      ? {
          kind: "supporting_document",
          file: row.source_file,
          sheet: row.source_sheet,
          row: row.source_row,
        }
      : undefined,
  };
}

function rowToSupportingDocument(row: DocumentRow): SupportingDocument {
  const docType = (row.doc_type ?? "other") as SupportingDocument["docType"];
  return {
    id: row.content_hash,
    docType,
    issuer: row.issuer ?? issuerFromFileName(row.name),
    reference: null,
    date: row.doc_date ?? (row.period ? `${row.period}-01` : ""),
    amountCents: row.amount_cents,
    period: row.period,
    document: {
      name: row.name,
      docType,
      driveFileId: null,
      url: row.storage_path ? `/api/documentos/${row.storage_path}` : null,
      localPath: row.storage_path,
      issuer: row.issuer ?? null,
      amountCents: row.amount_cents,
    },
    source: { kind: "supporting_document", file: row.name, raw: row.storage_path },
  };
}

/** Cuenta resuelta, para informes. Reexportado por comodidad. */
export { resolveAccount };
