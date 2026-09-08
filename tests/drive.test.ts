/**
 * Tests del índice documental de Drive.
 *
 * Se usa un cliente falso: lo que se prueba es la navegación acotada al
 * periodo, la deducción de metadatos y la idempotencia, no la API de Google.
 */

import { describe, expect, it } from "vitest";
import {
  folderMatchesPeriod,
  indexFile,
  syncPeriodDocuments,
  toSupportingDocuments,
} from "../lib/drive/index-documents";
import type { DriveClient, DriveFile } from "../lib/drive/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Árbol de Drive sintético con la estructura Año → Trimestre → Tipo → Mes. */
const TREE: Record<string, DriveFile[]> = {
  root: [
    { id: "y2026", name: "2026", mimeType: FOLDER_MIME },
    { id: "y2025", name: "2025", mimeType: FOLDER_MIME },
  ],
  y2026: [
    { id: "q3", name: "DocumentacionAF-Q32026", mimeType: FOLDER_MIME },
    { id: "q1", name: "DocumentacionAF-Q12026", mimeType: FOLDER_MIME },
  ],
  q3: [
    { id: "facturas", name: "2. Facturas", mimeType: FOLDER_MIME },
    { id: "extractos", name: "1. Extractos", mimeType: FOLDER_MIME },
  ],
  facturas: [
    { id: "sep", name: "6. Septiembre", mimeType: FOLDER_MIME },
    { id: "ago", name: "5. Agosto", mimeType: FOLDER_MIME },
  ],
  extractos: [],
  sep: [],
  ago: [],
  y2025: [],
  q1: [],
};

const FILES: Record<string, DriveFile[]> = {
  sep: [
    {
      id: "file-1",
      name: "G_Proveedor Digital Septiembre 26 (2183).pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/file-1/view",
      modifiedTime: "2026-09-30T10:00:00Z",
      size: 12345,
    },
    {
      id: "file-2",
      name: "G_Nomina Persona A Septiembre 26.pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/file-2/view",
    },
    {
      id: "file-3",
      name: "I_Ventas Clinica Banco Septiembre 26.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ],
  ago: [
    { id: "file-old", name: "G_Otro Agosto 26.pdf", mimeType: "application/pdf" },
  ],
};

const client: DriveClient = {
  async listFolders(parentId) {
    return (TREE[parentId] ?? []).filter((f) => f.mimeType === FOLDER_MIME);
  },
  async listFiles(parentId) {
    return FILES[parentId] ?? [];
  },
};

describe("navegación acotada al periodo", () => {
  it("entra solo en la rama del periodo, no en todo Drive", async () => {
    const result = await syncPeriodDocuments(client, {
      rootFolderId: "root",
      period: "2026-09",
      now: () => new Date("2026-10-01T00:00:00Z"),
    });

    const paths = result.visitedFolders.map((f) => f.path);
    expect(paths).toContain("2026/DocumentacionAF-Q32026/2. Facturas/6. Septiembre");
    // No se entra en otro año, ni en otro trimestre, ni en otro mes.
    expect(paths.some((p) => p.includes("2025"))).toBe(false);
    expect(paths.some((p) => p.includes("Q12026"))).toBe(false);
    expect(paths.some((p) => p.includes("Agosto"))).toBe(false);
    expect(result.documents.map((d) => d.driveFileId).sort()).toEqual(["file-1", "file-2", "file-3"]);
  });

  it("descarta carpetas de otro año, trimestre o mes", () => {
    expect(folderMatchesPeriod("2026", "2026-09")).toBe(true);
    expect(folderMatchesPeriod("2025", "2026-09")).toBe(false);
    expect(folderMatchesPeriod("DocumentacionAF-Q32026", "2026-09")).toBe(true);
    expect(folderMatchesPeriod("DocumentacionAF-Q12026", "2026-09")).toBe(false);
    expect(folderMatchesPeriod("6. Septiembre", "2026-09")).toBe(true);
    expect(folderMatchesPeriod("5. Agosto", "2026-09")).toBe(false);
    // Nivel intermedio genérico: se entra.
    expect(folderMatchesPeriod("2. Facturas", "2026-09")).toBe(true);
  });

  it("es idempotente: dos sincronizaciones producen el mismo índice", async () => {
    const options = {
      rootFolderId: "root",
      period: "2026-09",
      now: () => new Date("2026-10-01T00:00:00Z"),
    };
    const first = await syncPeriodDocuments(client, options);
    const second = await syncPeriodDocuments(client, options);

    expect(second.documents).toEqual(first.documents);
    // La clave estable es el id de Drive.
    expect(new Set(first.documents.map((d) => d.driveFileId)).size).toBe(first.documents.length);
  });
});

describe("deducción de metadatos", () => {
  const syncedAt = "2026-10-01T00:00:00.000Z";

  it("deduce tipo documental, periodo, emisor e importe cuando puede", () => {
    const doc = indexFile(
      FILES.sep[0],
      "2026/DocumentacionAF-Q32026/2. Facturas/6. Septiembre",
      "2026-09",
      syncedAt,
    );

    expect(doc.docType).toBe("invoice");
    expect(doc.period).toBe("2026-09");
    expect(doc.amountCents).toBe(2183);
    expect(doc.issuer).toContain("Proveedor Digital");
    expect(doc.inferredFrom.length).toBeGreaterThan(0);
  });

  it("reconoce nóminas y hojas de ventas, no solo facturas", () => {
    const payroll = indexFile(FILES.sep[1], "2026/.../6. Septiembre", "2026-09", syncedAt);
    const sales = indexFile(FILES.sep[2], "2026/.../6. Septiembre", "2026-09", syncedAt);

    expect(payroll.docType).toBe("payroll");
    expect(sales.docType).toBe("sales_sheet");
  });

  it("deja el importe en null cuando no aparece: nunca lo inventa", () => {
    const doc = indexFile(FILES.sep[1], "2026/.../6. Septiembre", "2026-09", syncedAt);
    expect(doc.amountCents).toBeNull();
  });

  it("convierte el índice en documentos conciliables conservando el enlace", () => {
    const documents = toSupportingDocuments([
      indexFile(FILES.sep[0], "2026/.../6. Septiembre", "2026-09", syncedAt),
    ]);

    expect(documents[0].id).toBe("file-1");
    expect(documents[0].document.driveFileId).toBe("file-1");
    expect(documents[0].document.url).toContain("drive.google.com");
    expect(documents[0].amountCents).toBe(2183);
  });
});
