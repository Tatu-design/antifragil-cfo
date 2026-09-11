/**
 * Tests de la lectura del cierre manual.
 *
 * La parte delicada es el SIGNO: en un Cash Flow los gastos suelen escribirse
 * en positivo bajo un bloque "GASTOS", mientras que el motor los guarda en
 * negativo. Si eso se lee mal, todas las comparaciones salen dobladas y
 * parecería que el motor se equivoca cuando el error está en la lectura.
 */

import { describe, expect, it } from "vitest";
import { extractManualClose } from "../lib/ingest/manual-close";
import type { PeriodDocuments } from "../lib/ingest/registry";
import type { DocumentStorage } from "../lib/ingest/storage";

const PERIOD = "2026-08";

function registry(fileName = "Cash Flow GEA 2026.xlsx"): PeriodDocuments {
  return {
    period: PERIOD,
    documents: [
      {
        hash: "a".repeat(64),
        fileName,
        mimeType: "text/csv",
        sizeBytes: 100,
        storagePath: `${PERIOD}/${"a".repeat(64)}.csv`,
        period: PERIOD,
        kind: "manual",
        accountId: null,
        docType: "other",
        amountCents: null,
        confidence: 0.9,
        reasons: [],
        needsReview: false,
        question: null,
        uploadedAt: new Date().toISOString(),
        uploadedBy: null,
      },
    ],
  };
}

/** Almacén en memoria que devuelve el CSV indicado. */
function storageWith(content: string | null): DocumentStorage {
  return {
    name: "memory",
    async put(storagePath) {
      return { storagePath, alreadyExisted: false };
    },
    async signedUrl() {
      return null;
    },
    async read() {
      return content === null ? null : new TextEncoder().encode(content);
    },
  };
}

/** El nombre del archivo determina la pestaña en un CSV: se usa el del archivo. */
const CIERRE_AGOSTO = [
  "Fecha;Concepto;Importe",
  "GASTOS;;",
  "03/08/2026;PAGO PROVEEDOR DIGITAL;21,83",
  "10/08/2026;NOMINA PERSONA A;1.000,00",
  "INGRESOS;;",
  "05/08/2026;Clinica Playamar Banco;2.000,00",
  "12/08/2026;TRANSFERENCIA CLIENTE;500,00",
].join("\n");

describe("lectura del cierre manual", () => {
  it("extrae las líneas de la pestaña del periodo", async () => {
    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(CIERRE_AGOSTO),
    );

    expect(result.lines).toHaveLength(4);
    expect(result.source?.file).toContain("Cash Flow");
  });

  it("normaliza el signo: un gasto escrito en positivo pasa a negativo", async () => {
    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(CIERRE_AGOSTO),
    );

    const proveedor = result.lines.find((l) => l.description.includes("PROVEEDOR"));
    const nomina = result.lines.find((l) => l.description.includes("NOMINA"));

    // Estaban bajo el bloque GASTOS y venían sin signo.
    expect(proveedor?.amountCents).toBe(-2183);
    expect(nomina?.amountCents).toBe(-100000);
  });

  it("deja los ingresos en positivo", async () => {
    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(CIERRE_AGOSTO),
    );

    const clinica = result.lines.find((l) => l.description.includes("Playamar"));
    const transferencia = result.lines.find((l) => l.description.includes("TRANSFERENCIA"));

    expect(clinica?.amountCents).toBe(200000);
    expect(transferencia?.amountCents).toBe(50000);
  });

  it("respeta el signo cuando ya viene puesto", async () => {
    const conSigno = [
      "Fecha;Concepto;Importe",
      "GASTOS;;",
      "03/08/2026;PAGO YA NEGATIVO;-21,83",
    ].join("\n");

    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(conSigno),
    );

    // No se invierte dos veces: quien lo escribió con signo sabía lo que hacía.
    expect(result.lines[0].amountCents).toBe(-2183);
  });

  it("conserva la fila de origen para la trazabilidad", async () => {
    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(CIERRE_AGOSTO),
    );

    expect(result.lines.every((l) => typeof l.sourceRow === "number")).toBe(true);
  });
});

describe("cuando algo falta o no se entiende", () => {
  it("avisa si no se ha subido ningún cierre manual", async () => {
    const result = await extractManualClose(
      { period: PERIOD, documents: [] },
      storageWith(CIERRE_AGOSTO),
    );

    expect(result.lines).toHaveLength(0);
    expect(result.warnings[0]).toContain("No se ha subido");
  });

  it("avisa si el archivo no está en el almacén", async () => {
    const result = await extractManualClose(registry(), storageWith(null));

    expect(result.lines).toHaveLength(0);
    expect(result.warnings[0]).toContain("no está en el almacén");
  });

  it("avisa si no hay pestaña del periodo, en vez de leer otro mes", async () => {
    // El nombre del CSV hace de nombre de hoja: este es de julio.
    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 julio 26.csv"),
      storageWith(CIERRE_AGOSTO),
    );

    expect(result.lines).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("ninguna pestaña para 2026-08");
  });

  it("avisa si no reconoce la tabla, en vez de inventarse líneas", async () => {
    const ilegible = ["Resumen del mes", "no hay cabeceras aquí", "ni columnas"].join("\n");

    const result = await extractManualClose(
      registry("Cash Flow GEA 2026 agosto 26.csv"),
      storageWith(ilegible),
    );

    expect(result.lines).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/no se ha reconocido ninguna tabla/i);
  });
});
