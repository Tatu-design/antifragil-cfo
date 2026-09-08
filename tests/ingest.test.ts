/**
 * Tests de la carga de documentos.
 *
 * Lo que se protege aquí es la promesa de UX: arrastrar 40 archivos, que el
 * sistema deduzca qué es cada uno, que no duplique nada y que solo pregunte
 * cuando de verdad no puede saberlo.
 */

import { describe, expect, it } from "vitest";
import { ACCOUNT_CASH, ACCOUNT_SC_BANK, ACCOUNT_SL_BANK } from "../lib/finance/accounts";
import { contentHash, storagePath } from "../lib/ingest/hash";
import { ingestFiles, summaryHeadline, type IncomingFile } from "../lib/ingest/ingest";
import { isAcceptedFile, recognizeFile } from "../lib/ingest/recognize";
import type { DocumentStorage } from "../lib/ingest/storage";

const PERIOD = "2026-09";

/** Almacén en memoria: los tests no tocan disco ni Supabase. */
function memoryStorage(): DocumentStorage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    name: "memory",
    files,
    async put(path, bytes) {
      if (files.has(path)) return { storagePath: path, alreadyExisted: true };
      files.set(path, bytes);
      return { storagePath: path, alreadyExisted: false };
    },
    async signedUrl(path) {
      return `memory://${path}`;
    },
    async read(path) {
      return files.get(path) ?? null;
    },
  };
}

function file(fileName: string, mimeType: string, content = "contenido"): IncomingFile {
  return { fileName, mimeType, bytes: new TextEncoder().encode(content) };
}

const PDF = "application/pdf";
const CSV = "text/csv";

describe("reconocimiento automático", () => {
  const recognize = (name: string, mime = PDF, sheets?: Parameters<typeof recognizeFile>[0]["sheets"]) =>
    recognizeFile({ fileName: name, mimeType: mime, sizeBytes: 1000, sheets }, PERIOD);

  it("reconoce facturas por el prefijo de la convención documental", () => {
    const result = recognize("G_Proveedor Digital Septiembre 26 (2183).pdf");

    expect(result.kind).toBe("supporting_document");
    expect(result.docType).toBe("invoice");
    expect(result.period).toBe("2026-09");
    expect(result.amountCents).toBe(2183);
    expect(result.needsReview).toBe(false);
  });

  it("reconoce nóminas, impuestos y Seguridad Social, no solo facturas", () => {
    expect(recognize("G_Nomina Persona A Septiembre 26.pdf").docType).toBe("payroll");
    expect(recognize("Modelo 303 3T 2026.pdf").docType).toBe("tax");
    expect(recognize("RLC Seguridad Social septiembre 26.pdf").docType).toBe("social_security");
  });

  it("reconoce las fuentes de movimientos por su nombre", () => {
    expect(recognize("I_Ventas Clinica Banco Septiembre 26.xlsx").kind).toBe("clinic_bank_sales");
    expect(recognize("I_Ventas Clinica Cash Septiembre 26.xlsx").kind).toBe("clinic_cash_sales");

    const cash = recognize("Cuenta de cash Antifragil.xlsx");
    expect(cash.kind).toBe("cash_account");
    expect(cash.accountId).toBe(ACCOUNT_CASH);
  });

  it("reconoce un extracto por su estructura aunque el nombre no lo diga", () => {
    const rows = [
      ["Fecha", "Concepto", "Importe", "Saldo"],
      ["01/09/2026", "PAGO DEMO", "-10,00", "990,00"],
    ];
    const result = recognize("descarga_2026.csv", CSV, [{ name: "hoja", rows }]);

    expect(result.kind).toBe("bank_statement");
    expect(result.reasons.join(" ")).toContain("estructura tabular");
  });

  it("detecta la cuenta cuando el nombre identifica la entidad", () => {
    expect(recognize("Extracto SL septiembre 2026.xlsx").accountId).toBe(ACCOUNT_SL_BANK);
    expect(recognize("Extracto SC septiembre 2026.xlsx").accountId).toBe(ACCOUNT_SC_BANK);
  });

  it("pregunta la cuenta en vez de adivinarla cuando no puede saberla", () => {
    const result = recognize("Extracto septiembre 2026.xlsx");

    expect(result.kind).toBe("bank_statement");
    expect(result.accountId).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.question?.type).toBe("account");
  });

  it("deja en revisión lo que no puede identificar, en vez de inventarlo", () => {
    const result = recognize("IMG_20260915_112233.pdf");

    expect(result.needsReview).toBe(true);
    expect(result.question?.type).toBe("kind");
    expect(result.kind).toBe("unknown");
  });

  it("acepta PDF, XLSX y CSV; rechaza el resto", () => {
    expect(isAcceptedFile("factura.pdf", PDF)).toBe(true);
    expect(isAcceptedFile("ventas.xlsx", "application/octet-stream")).toBe(true);
    expect(isAcceptedFile("extracto.csv", CSV)).toBe(true);
    expect(isAcceptedFile("foto.png", "image/png")).toBe(false);
    expect(isAcceptedFile("notas.docx", "application/msword")).toBe(false);
  });
});

describe("carga de un lote", () => {
  it("procesa muchos archivos de una vez y devuelve un resumen", async () => {
    const storage = memoryStorage();
    const files = [
      file("G_Proveedor Digital Septiembre 26 (2183).pdf", PDF, "a"),
      file("G_Nomina Persona A Septiembre 26.pdf", PDF, "b"),
      file("Modelo 303 3T 2026.pdf", PDF, "c"),
      file("Extracto septiembre 2026.xlsx", "application/octet-stream", "d"),
      file("IMG_0421.pdf", PDF, "e"),
      file("foto.png", "image/png", "f"),
    ];

    const summary = await ingestFiles(files, { period: PERIOD, storage });

    expect(summary.received).toBe(6);
    expect(summary.recognized).toBe(3);
    expect(summary.needsReview).toBe(2); // extracto sin cuenta + archivo sin identificar
    expect(summary.rejected).toBe(1); // el png
    expect(summary.duplicates).toBe(0);
  });

  it("resume la carga en el lenguaje del usuario", async () => {
    const storage = memoryStorage();
    const summary = await ingestFiles(
      [file("G_Factura A septiembre 26.pdf", PDF, "1"), file("IMG_1.pdf", PDF, "2")],
      { period: PERIOD, storage },
    );

    const headline = summaryHeadline(summary);
    expect(headline[0]).toBe("2 documentos recibidos");
    expect(headline).toContain("1 reconocido");
    expect(headline).toContain("1 necesita revisión");
  });

  it("permite forzar la cuenta cuando el usuario responde", async () => {
    const storage = memoryStorage();
    const summary = await ingestFiles([file("Extracto septiembre 2026.xlsx", "application/octet-stream")], {
      period: PERIOD,
      storage,
      forcedAccountId: ACCOUNT_SC_BANK,
    });

    expect(summary.documents[0].outcome).toBe("recognized");
    expect(summary.documents[0].recognition?.accountId).toBe(ACCOUNT_SC_BANK);
  });
});

describe("idempotencia de la carga", () => {
  it("no duplica el mismo archivo subido dos veces", async () => {
    const storage = memoryStorage();
    const doc = file("G_Factura A septiembre 26.pdf", PDF, "mismo contenido");

    const first = await ingestFiles([doc], { period: PERIOD, storage });
    const second = await ingestFiles([doc], {
      period: PERIOD,
      storage,
      knownHashes: new Set(first.documents.map((d) => d.hash)),
    });

    expect(first.recognized).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(second.recognized).toBe(0);
    expect(storage.files.size).toBe(1);
  });

  it("detecta el duplicado aunque el archivo llegue con otro nombre", async () => {
    const storage = memoryStorage();
    const original = file("G_Factura A septiembre 26.pdf", PDF, "idéntico");
    const renamed = file("G_Factura A septiembre 26 (1).pdf", PDF, "idéntico");

    await ingestFiles([original], { period: PERIOD, storage });
    const second = await ingestFiles([renamed], { period: PERIOD, storage });

    // El almacén ya lo tenía: mismo contenido, misma ruta.
    expect(second.duplicates).toBe(1);
    expect(storage.files.size).toBe(1);
  });

  it("detecta duplicados dentro del mismo lote", async () => {
    const storage = memoryStorage();
    const doc = file("G_Factura A septiembre 26.pdf", PDF, "repetido");

    const summary = await ingestFiles([doc, doc, doc], { period: PERIOD, storage });

    expect(summary.recognized).toBe(1);
    expect(summary.duplicates).toBe(2);
  });

  it("almacena por huella de contenido, no por nombre", () => {
    const bytes = new TextEncoder().encode("contenido");
    const hash = contentHash(bytes);

    expect(storagePath(PERIOD, hash, "Factura.PDF")).toBe(`${PERIOD}/${hash}.pdf`);
    expect(contentHash(bytes)).toBe(hash);
  });
});

describe("archivos problemáticos", () => {
  it("rechaza el archivo vacío sin romper el lote", async () => {
    const storage = memoryStorage();
    const summary = await ingestFiles(
      [
        { fileName: "vacio.pdf", mimeType: PDF, bytes: new Uint8Array() },
        file("G_Factura A septiembre 26.pdf", PDF, "ok"),
      ],
      { period: PERIOD, storage },
    );

    expect(summary.rejected).toBe(1);
    expect(summary.recognized).toBe(1);
    expect(summary.documents[0].error).toContain("vacío");
  });
});
