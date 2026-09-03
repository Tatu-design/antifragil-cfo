/**
 * Identidad estable e idempotencia (D26/D27).
 *
 * Regla: procesar dos veces el mismo mes con las mismas fuentes debe producir
 * EXACTAMENTE los mismos identificadores. Así una reimportación es un upsert
 * sobre las mismas filas y nunca una duplicación.
 *
 * El id NO depende de:
 *   - el orden en que se leyeron los archivos,
 *   - la hora de ejecución,
 *   - ninguna secuencia autoincremental.
 *
 * El id SÍ depende de la identidad económica del apunte: fuente, periodo,
 * fecha, importe, concepto normalizado y ordinal de repetición.
 */

import { createHash } from "node:crypto";
import { normalizeText } from "./text";
import type { LedgerEntry, SourceKind } from "./types";

/** Hash hexadecimal corto y determinista de una lista de componentes. */
export function stableHash(parts: Array<string | number | null | undefined>): string {
  const payload = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

export interface StableIdInput {
  kind: SourceKind;
  period: string;
  date: string;
  amountCents: number;
  description: string;
  /**
   * Ordinal para movimientos económicamente idénticos dentro del mismo día y
   * fuente. Dos cargos reales iguales el mismo día son dos apuntes legítimos y
   * distintos, y deben conservar ids distintos y estables.
   */
  occurrence: number;
}

export function stableEntryId(input: StableIdInput): string {
  return stableHash([
    input.kind,
    input.period,
    input.date,
    input.amountCents,
    normalizeText(input.description),
    input.occurrence,
  ]);
}

/**
 * Asigna el ordinal de repetición a un conjunto de elementos.
 *
 * Los elementos se agrupan por su clave económica y dentro de cada grupo se
 * numeran 0, 1, 2... El orden dentro del grupo es el de aparición en la fuente,
 * que para un mismo archivo es siempre el mismo.
 */
export function assignOccurrences<T>(
  items: T[],
  keyOf: (item: T) => string,
): Array<{ item: T; occurrence: number }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = keyOf(item);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { item, occurrence };
  });
}

/**
 * Fusiona apuntes nuevos sobre apuntes ya existentes respetando idempotencia.
 *
 * - Un apunte cuyo id ya existe NO se duplica: se actualiza conservando el
 *   trabajo humano (clasificación manual y estado de revisión aprobado).
 * - Un apunte nuevo se añade.
 * - Los apuntes existentes que ya no aparecen en la fuente se conservan y se
 *   devuelven aparte: borrarlos en silencio sería un cambio financiero opaco.
 */
export function mergeEntries(
  existing: LedgerEntry[],
  incoming: LedgerEntry[],
): { merged: LedgerEntry[]; added: string[]; updated: string[]; orphaned: string[] } {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const incomingIds = new Set(incoming.map((e) => e.id));
  const added: string[] = [];
  const updated: string[] = [];

  for (const entry of incoming) {
    const prev = byId.get(entry.id);
    if (!prev) {
      byId.set(entry.id, entry);
      added.push(entry.id);
      continue;
    }
    // Se preserva la decisión humana sobre la del motor.
    const humanClassified = prev.classificationStatus === "manual";
    byId.set(entry.id, {
      ...entry,
      category: humanClassified ? prev.category : entry.category,
      pnl: humanClassified ? prev.pnl : entry.pnl,
      classificationStatus: humanClassified ? prev.classificationStatus : entry.classificationStatus,
      reviewStatus:
        prev.reviewStatus === "approved" || prev.reviewStatus === "reviewed"
          ? prev.reviewStatus
          : entry.reviewStatus,
    });
    updated.push(entry.id);
  }

  const orphaned = existing.filter((e) => !incomingIds.has(e.id)).map((e) => e.id);
  return { merged: [...byId.values()], added, updated, orphaned };
}

/**
 * Detecta posibles duplicados dentro de un mismo conjunto de apuntes.
 *
 * No borra nada: dos cargos idénticos el mismo día pueden ser reales. Solo
 * señala el caso para que una persona lo confirme (incidencia DUPLICATE_SUSPECT).
 */
export function findDuplicateSuspects(entries: LedgerEntry[]): LedgerEntry[][] {
  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (entry.direction === "internal") continue;
    const key = stableHash([
      entry.date,
      entry.amountCents,
      normalizeText(entry.description),
      entry.treasury,
    ]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
