# Modelo de datos

El núcleo es el **Financial Ledger**: una tabla de movimientos que representa la
realidad económica de las tres tesorerías. Todo lo demás (documentos, conciliación,
incidencias, reglas) cuelga de ahí.

Esquema SQL: [supabase/migrations/0001_financial_ledger.sql](../supabase/migrations/0001_financial_ledger.sql)
Tipos TypeScript: [lib/finance/types.ts](../lib/finance/types.ts)

---

## Mapa

```text
treasury_accounts (sl_bank · sc_bank · cash)
        │
periods (YYYY-MM)
   │
   ├── imports ............... cada lectura de fuentes, con hash del archivo
   │
   ├── ledger_entries ⭐ ...... los movimientos, cada uno con su cuenta
   │      │
   │      └── entry_documents ──► documents (índice de Drive)
   │             (evidencia: método, score, motivos, grupo)
   │
   ├── incidents ............. lo que el motor no puede decidir solo
   ├── card_settlements ...... conciliación agregada del datáfono (1 fila/mes)
   ├── close_comparisons ..... diferencias motor vs cierre manual
   └── audit_events .......... quién cambió qué y cuándo

drive_syncs .................. registro de cada sincronización con Drive
classification_rules ......... reglas deterministas de categoría y P&L
cfo_members .................. lista blanca de acceso (base de todo el RLS)
```

---

## `treasury_accounts`

Tres filas sembradas por la migración:

| id | label | kind | legal_entity |
|----|-------|------|--------------|
| `sl_bank` | Banco SL | bank | SL |
| `sc_bank` | Banco SC | bank | SC |
| `cash` | Caja Antifrágil | cash | SL |

Los ids son estables porque forman parte del identificador de cada movimiento y del
nombre de las carpetas de entrada. Cambiar un id cambia todos los ids del histórico.

---

## `ledger_entries` — la tabla central

| Campo | Notas |
|-------|-------|
| `id` (PK, text) | **Hash determinista**, no UUID. Base de la idempotencia |
| `period` | `YYYY-MM`, con restricción de formato |
| `account_id` | FK a `treasury_accounts`. **Siempre presente** |
| `treasury` | `bank` / `cash`, para agregaciones rápidas |
| `entry_date` / `value_date` | Fecha contable y fecha valor |
| `direction` | `income` · `expense` · `internal` |
| `amount_cents` | Céntimos con signo real. Nunca decimal flotante |
| `description` / `raw_description` | Concepto legible y concepto original íntegro |
| `category` / `pnl` | `null` = pendiente de decisión humana |
| `classification_status` | `pending` · `rule` · `manual` · `not_applicable` |
| `classification_rule_id` | Qué regla lo clasificó, si fue una regla |
| `reconciliation` | `pending` · `reconciled` · `missing_document` · `ambiguous` · `not_document_required` |
| `reconciliation_reason` | Por qué no requiere documento. **Obligatorio en ese estado** |
| `review_status` | `imported` · `needs_review` · `reviewed` · `approved` |
| `source_*` | Archivo, hoja, fila y texto original: trazabilidad exacta |
| `aggregates` | Ids de los movimientos consolidados (datáfono) |
| `notes` | Explicaciones del motor para quien revisa |

### Reglas escritas en la base de datos

```sql
-- Un movimiento interno no puede llevar clasificación de P&L
constraint ledger_internal_has_no_pnl
  check (direction <> 'internal' or (category is null and pnl is null))

-- Si no requiere documento, hay que decir por qué
constraint ledger_not_required_has_reason
  check (reconciliation <> 'not_document_required' or reconciliation_reason is not null)
```

### Por qué el id es un hash

```text
sha256( source_kind | period | account_id | fecha | importe | concepto_normalizado | ordinal )
```

- **Mismo archivo procesado dos veces** → mismos ids → el upsert no duplica nada.
- **Mismo importe el mismo día en la SL y en la SC** → ids distintos: son movimientos distintos.
- **Dos cargos reales idénticos el mismo día en la misma cuenta** → el ordinal los distingue de forma estable, y ambos existen.

---

## `documents` — índice documental de Drive

Drive guarda los archivos; aquí viven **metadatos y enlaces**, no copias.

| Campo | Notas |
|-------|-------|
| `drive_file_id` (único) | Clave natural del sync: Drive la garantiza estable |
| `doc_type` | `invoice` · `payroll` · `tax` · `social_security` · `receipt` · `sales_sheet` · `bank_statement` · `contract` · `other` |
| `folder_path` | Ruta dentro de la raíz financiera |
| `issuer` · `reference` · `doc_date` · `amount_cents` | Deducidos cuando se puede; `null` si no |
| `inferred_from` | Señales usadas para deducirlos. Auditoría del indexado |
| `synced_at` · `modified_time` · `size_bytes` | Control de sincronización |

`drive_syncs` registra cada sincronización: periodo, carpeta raíz, nº de documentos
y carpetas, problemas y quién la lanzó.

> Si no se conoce la URL o el importe, el campo queda `null`. Nunca se inventa.

---

## `entry_documents` — la conciliación, con su evidencia

Relación N:M, porque las cuatro cardinalidades son reales:

| Campo | Para qué |
|-------|----------|
| `match_method` | `amount_date_issuer` · `reference_in_concept` · `aggregate_sum` · `aggregate_period` · `manual` |
| `match_score` | Confianza 0–1 (`null` si es manual) |
| `match_reasons` | "importe exacto", "3 días de diferencia", "emisor ~0.92" |
| `group_id` | Agrupa los movimientos o documentos de una misma conciliación |

Un documento pertenece a un único grupo: así una misma factura no justifica dos pagos.

---

## `incidents`

Ids deterministas: reprocesar no genera incidencias duplicadas. Ciclo de vida
`open` → `in_review` → `resolved` / `accepted`, con `resolved_by`, `resolved_at` y
`resolution`.

Los nueve tipos están en [FINANCIAL_RULES.md](./FINANCIAL_RULES.md#15-catálogo-de-incidencias).

---

## `classification_rules`

```text
id · contains[] · excludes[] · account_id · applies_to · category · pnl
confidence · enabled · note (obligatoria) · learned_from_entry_id · created_by
```

`learned_from_entry_id` guarda de qué movimiento nació la regla, para el flujo
*"guardar esta decisión para futuros movimientos similares"*. Una regla sin `note`
no es auditable, así que la columna es `NOT NULL`.

**La tabla arranca vacía**: hasta validar la taxonomía histórica, todo queda pendiente.

---

## `close_comparisons`

Diferencias entre el mes reconstruido y el cierre manual:

- `kind`: `only_in_engine` · `only_in_manual` · `amount_mismatch`
- `verdict`: **`pending`** (por defecto) · `probable_engine_error` · `probable_manual_error` · `criteria_difference`
- `evidence[]`, `resolution_note`, `resolved_by`

El veredicto lo pone una persona. El motor nunca se autoproclama correcto.

---

## Seguridad (RLS)

| Tabla | Lectura | Escritura |
|-------|---------|-----------|
| `cfo_members` | Solo la propia fila | Solo servidor (`service_role`) |
| Resto de tablas de datos | Cualquier miembro | Solo `owner` / `editor` |
| `audit_events` | Cualquier miembro | Solo servidor |

**No hay políticas de DELETE en ninguna tabla.** Corregir es escribir un cambio, no
hacer desaparecer el rastro.

---

## Lo que todavía no está

- Contrapartes normalizadas (proveedores) como tabla propia: se creará cuando el histórico diga cuántas hay.
- Categorías y P&L como tablas: hoy son texto; se normalizarán al migrar la taxonomía histórica.
- Cash Flow operativo, EBITDA y balances: fuera del MVP por decisión explícita (D69).
