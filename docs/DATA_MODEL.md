# Modelo de datos

El núcleo es el **Financial Ledger**: una única tabla de apuntes que representa la
realidad económica del negocio. Todo lo demás (documentos, incidencias, reglas,
importaciones) cuelga de ahí. El Cash Flow no es una tabla: es una vista calculada.

Esquema SQL: [supabase/migrations/0001_financial_ledger.sql](../supabase/migrations/0001_financial_ledger.sql)
Tipos TypeScript: [lib/finance/types.ts](../lib/finance/types.ts)

---

## Mapa

```text
periods (YYYY-MM)
   │
   ├── imports ............. cada lectura de fuentes, con hash del archivo
   │
   ├── ledger_entries ⭐ .... los apuntes
   │      │
   │      └── entry_documents ──► documents (metadatos de Drive/local)
   │
   ├── incidents ........... lo que el motor no puede decidir solo
   │
   ├── card_settlements .... conciliación agregada del datáfono (1 fila/mes)
   │
   └── audit_events ........ quién cambió qué y cuándo

classification_rules ....... reglas deterministas de categoría y P&L
cfo_members ................ lista blanca de acceso (base de todo el RLS)
```

---

## `ledger_entries` — la tabla central

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | text (PK) | **Hash determinista**, no UUID. Es lo que hace posible la idempotencia |
| `period` | text | `YYYY-MM`, con restricción de formato |
| `entry_date` / `value_date` | date | Fecha contable y fecha valor |
| `direction` | text | `income` · `expense` · `internal` |
| `treasury` | text | `bank` · `cash` |
| `amount_cents` | bigint | Céntimos con signo real. Nunca decimal flotante |
| `description` | text | Concepto legible |
| `raw_description` | text | Concepto original íntegro, sin tocar |
| `counterparty` | text | Contraparte estimada |
| `category` / `pnl` | text | `null` = pendiente de decisión humana |
| `classification_status` | text | `pending` · `rule` · `manual` · `not_applicable` |
| `classification_rule_id` | text | Qué regla lo clasificó, si fue una regla |
| `reconciliation` | text | `matched` · `missing_document` · `ambiguous` · `unmatched` · `not_applicable` |
| `review_status` | text | `imported` · `needs_review` · `reviewed` · `approved` |
| `source_kind/file/sheet/row/raw` | — | **Trazabilidad exacta**: archivo, hoja, fila y texto original |
| `aggregates` | text[] | Ids de los movimientos consolidados (caso datáfono) |
| `notes` | text[] | Explicaciones del motor para quien revisa |
| `import_id` | uuid | Ejecución que lo introdujo |

### Reglas escritas en la base de datos

No basta con que el código se porte bien; PostgreSQL también lo impide:

```sql
-- Un movimiento interno no puede llevar clasificación de P&L (D36/D37)
constraint ledger_internal_has_no_pnl
  check (direction <> 'internal' or (category is null and pnl is null))
```

Más las restricciones de dominio de `direction`, `treasury`, `classification_status`,
`reconciliation` y `review_status`, y el formato de `period`.

---

## Por qué el id es un hash y no un UUID

Un UUID nuevo en cada ejecución convierte cualquier reprocesado en una duplicación.
El id se calcula así:

```text
sha256( source_kind | period | fecha | importe_cents | concepto_normalizado | ordinal )
```

- **Mismo archivo, misma ejecución dos veces** → mismos ids → el upsert no duplica nada.
- **Dos cargos reales idénticos el mismo día** → el ordinal (0, 1, 2…) los distingue de forma estable, y ambos existen.

El ordinal se asigna por orden de aparición en la fuente, que para un mismo archivo
es siempre el mismo. Ver [lib/finance/dedupe.ts](../lib/finance/dedupe.ts).

---

## `documents` y `entry_documents`

Drive sigue siendo el repositorio documental (D21). Aquí viven **metadatos y enlaces**,
no copias de los archivos (D22):

- `drive_file_id` (único), `url`, `local_path`
- `supplier`, `invoice_number`, `doc_date`, `amount_cents`

La relación con los apuntes es N:M, y guarda **cómo se estableció**: `match_reason`
y `match_score`. Así un match automático se puede auditar meses después.

> Si no se conoce la URL de Drive, el campo queda `null`. Nunca se inventa un enlace.

---

## `incidents`

Ids también deterministas: reprocesar el mes no genera incidencias duplicadas.
Ciclo de vida: `open` → `in_review` → `resolved` / `accepted`, con `resolved_by`,
`resolved_at` y `resolution` para dejar constancia de la decisión.

Los ocho tipos están en [FINANCIAL_RULES.md](./FINANCIAL_RULES.md#12-catálogo-de-incidencias).

---

## `classification_rules`

```text
id · contains[] · excludes[] · treasury · applies_to · category · pnl
confidence · enabled · note (obligatoria) · created_by
```

Una regla sin `note` no es auditable, así que la columna es `NOT NULL`.
Una corrección manual repetida puede convertirse en regla (D30), y esa regla
explica por sí misma por qué existe.

**La tabla arranca vacía**: hasta validar la taxonomía histórica, todo queda pendiente.

---

## Seguridad (RLS)

| Tabla | Lectura | Escritura |
|-------|---------|-----------|
| `cfo_members` | Solo la propia fila | Solo servidor (`service_role`) |
| Resto de tablas de datos | Cualquier miembro | Solo `owner` / `editor` |
| `audit_events` | Cualquier miembro | Solo servidor |

**No hay políticas de DELETE en ninguna tabla.** Los datos financieros no se borran
desde la aplicación: corregir es escribir un cambio, no hacer desaparecer el rastro.

Las funciones `is_cfo_member()` y `can_edit_cfo()` son `SECURITY DEFINER` para poder
consultar la lista de miembros sin recursión de políticas.

---

## Lo que todavía no está

- Tabla de contrapartes normalizadas (proveedores). Se creará cuando el histórico diga cuántas hay y cómo se agrupan.
- Categorías y P&L como tablas propias: hoy son texto. Se normalizarán al migrar la taxonomía histórica (Fase 2), no antes.
- Balances: fuera del MVP por decisión explícita (D41).
