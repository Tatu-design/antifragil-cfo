import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PeriodLedger } from "../finance/types";
import type { IngestedDocument } from "../ingest/ingest";
import type { PeriodDocuments, RegisteredDocument } from "../ingest/registry";
import { dataRoot, outputsRoot } from "../paths";
import type { DocumentRepository, LedgerRepository } from "./types";

/**
 * Persistencia en disco local.
 *
 * Solo para desarrollo, tests y depuración con datos sintéticos. NO vale en
 * producción: el disco de una función de Vercel es efímero y no se comparte
 * entre instancias, así que el estado se perdería en cada redeploy.
 *
 * Se conserva porque permite trabajar y probar el motor completo sin depender
 * de una conexión a Supabase.
 */

function manifestPath(period: string): string {
  return path.join(dataRoot(), "documents", period, "manifest.json");
}

export function createLocalDocumentRepository(): DocumentRepository {
  async function load(period: string): Promise<PeriodDocuments> {
    try {
      const content = await readFile(manifestPath(period), "utf8");
      return JSON.parse(content) as PeriodDocuments;
    } catch {
      return { period, documents: [] };
    }
  }

  async function persist(next: PeriodDocuments): Promise<PeriodDocuments> {
    const target = manifestPath(next.period);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  return {
    name: "local",
    loadPeriodDocuments: load,

    async knownHashes(period) {
      const { documents } = await load(period);
      return new Set(documents.map((d) => d.hash));
    },

    async registerIngest(summary, uploadedBy) {
      const current = await load(summary.period);
      const byHash = new Map(current.documents.map((d) => [d.hash, d]));

      for (const document of summary.documents) {
        if (document.outcome === "duplicate" || document.outcome === "rejected") continue;
        if (byHash.has(document.hash)) continue;
        byHash.set(document.hash, toRegistered(document, summary.period, uploadedBy));
      }

      return persist({
        period: summary.period,
        documents: [...byHash.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)),
      });
    },

    async resolveDocument(period, hash, resolution) {
      const current = await load(period);
      return persist({
        period,
        documents: current.documents.map((document) =>
          document.hash === hash
            ? {
                ...document,
                ...(resolution.kind ? { kind: resolution.kind } : {}),
                ...(resolution.accountId !== undefined ? { accountId: resolution.accountId } : {}),
                ...(resolution.docType ? { docType: resolution.docType } : {}),
                needsReview: false,
                question: null,
                reasons: [...document.reasons, "confirmado manualmente"],
                confidence: 1,
              }
            : document,
        ),
      });
    },

    async listPeriodsWithDocuments() {
      return listPeriodFolders("documents");
    },
  };
}

export function createLocalLedgerRepository(): LedgerRepository {
  return {
    name: "local",

    async loadLedger(period) {
      try {
        const content = await readFile(path.join(outputsRoot(period), "ledger.json"), "utf8");
        return JSON.parse(content) as PeriodLedger;
      } catch {
        return null;
      }
    },

    async saveLedger(period, ledger, sourceHashes) {
      const dir = outputsRoot(period);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "ledger.json"), JSON.stringify(ledger, null, 2), "utf8");
      // Qué fuentes produjeron este ledger: decide si la próxima pasada puede
      // ser incremental o hay que reconstruir el mes.
      await writeFile(
        path.join(dir, "sources.json"),
        JSON.stringify({ sourceHashes }, null, 2),
        "utf8",
      );
    },

    async loadProcessedSources(period) {
      try {
        const content = await readFile(path.join(outputsRoot(period), "sources.json"), "utf8");
        return (JSON.parse(content) as { sourceHashes?: string[] }).sourceHashes ?? null;
      } catch {
        return null;
      }
    },

    async listProcessedPeriods() {
      return listPeriodFolders("outputs");
    },
  };
}

function toRegistered(
  document: IngestedDocument,
  period: string,
  uploadedBy: string | null,
): RegisteredDocument {
  const recognition = document.recognition;
  return {
    hash: document.hash,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    storagePath: document.storagePath,
    period: recognition?.period ?? period,
    kind: recognition?.kind ?? "unknown",
    accountId: recognition?.accountId ?? null,
    docType: recognition?.docType ?? "other",
    amountCents: recognition?.amountCents ?? null,
    confidence: recognition?.confidence ?? 0,
    reasons: recognition?.reasons ?? [],
    needsReview: recognition?.needsReview ?? true,
    question: recognition?.question?.message ?? null,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

async function listPeriodFolders(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(dataRoot(), folder), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
