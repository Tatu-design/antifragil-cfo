/**
 * Incidencias: el canal formal de "esto no lo puedo decidir yo".
 *
 * Toda ambigüedad financiera termina aquí en lugar de resolverse con una
 * suposición. Las incidencias son deterministas: reprocesar el mismo mes
 * produce las mismas incidencias con los mismos ids (D26).
 */

import { stableHash } from "./dedupe";
import { formatCents } from "./money";
import type {
  Incident,
  IncidentSeverity,
  IncidentType,
  Period,
  SourceRef,
} from "./types";

export interface IncidentDraft {
  type: IncidentType;
  severity?: IncidentSeverity;
  period: Period;
  message: string;
  entryIds?: string[];
  details?: Record<string, unknown>;
  source?: SourceRef;
  /** Discriminante extra para el id, cuando el mensaje no basta. */
  key?: string;
}

const DEFAULT_SEVERITY: Record<IncidentType, IncidentSeverity> = {
  EXPENSE_WITHOUT_INVOICE: "warning",
  INVOICE_WITHOUT_MOVEMENT: "warning",
  INCOME_WITHOUT_INVOICE: "warning",
  CARD_SETTLEMENT_MISMATCH: "error",
  AMBIGUOUS_MATCH: "warning",
  DUPLICATE_SUSPECT: "warning",
  FORMULA_ERROR: "error",
  SOURCE_ERROR: "error",
};

export function createIncident(draft: IncidentDraft): Incident {
  const entryIds = [...(draft.entryIds ?? [])].sort();
  return {
    id: stableHash([draft.type, draft.period, draft.key ?? draft.message, ...entryIds]),
    type: draft.type,
    severity: draft.severity ?? DEFAULT_SEVERITY[draft.type],
    period: draft.period,
    message: draft.message,
    entryIds,
    details: draft.details,
    source: draft.source,
  };
}

/** Elimina incidencias repetidas conservando la primera aparición. */
export function dedupeIncidents(incidents: Incident[]): Incident[] {
  const byId = new Map<string, Incident>();
  for (const incident of incidents) {
    if (!byId.has(incident.id)) byId.set(incident.id, incident);
  }
  return [...byId.values()];
}

/** Recuento por tipo, para el resumen del periodo. */
export function countByType(incidents: Incident[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const incident of incidents) {
    counts[incident.type] = (counts[incident.type] ?? 0) + 1;
  }
  return counts;
}

/** Texto legible de una incidencia, para los informes de auditoría. */
export function describeIncident(incident: Incident): string {
  const parts = [`[${incident.severity.toUpperCase()}] ${incident.type} — ${incident.message}`];
  if (incident.source?.file) {
    const location = [
      incident.source.file,
      incident.source.sheet ? `hoja "${incident.source.sheet}"` : null,
      incident.source.row ? `fila ${incident.source.row}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    parts.push(`  Origen: ${location}`);
  }
  if (incident.details && Object.keys(incident.details).length > 0) {
    const rendered = Object.entries(incident.details)
      .map(([key, value]) => `${key}: ${renderDetail(value)}`)
      .join(" · ");
    parts.push(`  Detalle: ${rendered}`);
  }
  return parts.join("\n");
}

function renderDetail(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 100) {
    // Los enteros grandes del dominio son céntimos; se muestran como importe.
    return formatCents(value);
  }
  if (Array.isArray(value)) return `${value.length} elemento(s)`;
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
