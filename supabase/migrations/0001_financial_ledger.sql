-- ============================================================================
-- Antifrágil CFO — Esquema inicial
-- ----------------------------------------------------------------------------
-- Migración 0001. Modelo completo: control de acceso, cuentas de tesorería,
-- periodos, cargas, documentos, movimientos, conciliaciones, incidencias,
-- reglas de clasificación, comparaciones de cierre y auditoría.
--
-- MISIÓN DE ESTA ETAPA: conciliar los movimientos reales de tesorería (banco SL,
-- banco SC y caja) con su documentación justificativa, y dejar las excepciones
-- listas para revisión desde la interfaz.
--
-- MODELO DE SEGURIDAD: toda la información es financiera y privada.
--   · RLS activo en TODAS las tablas desde el primer día.
--   · El acceso se concede por pertenencia a `cfo_members`, no por ser un
--     usuario cualquiera de Supabase Auth. Registrarse no da acceso a nada.
--   · Sin políticas de DELETE: los datos financieros no se borran desde la
--     aplicación. Corregir es escribir, no hacer desaparecer el rastro.
--   · La aplicación opera con el cliente de sesión del usuario, así que estas
--     políticas son la barrera real, no un adorno.
--
-- IDEMPOTENCIA: no depende del código TypeScript. Las restricciones UNIQUE de
-- este archivo son las que impiden duplicar documentos, movimientos,
-- conciliaciones e incidencias al reprocesar un mes.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1 · CONTROL DE ACCESO
-- ============================================================================
-- Patrón elegido: lista blanca de miembros.
--
-- Es lo más simple que cumple el requisito. Los datos son de la empresa, no de
-- una persona, así que todos los miembros ven lo mismo y no hace falta
-- `owner_user_id` ni workspaces. Un usuario nuevo de Auth NO obtiene acceso
-- automático: hasta que alguien inserta su fila aquí, RLS le devuelve cero
-- filas en todas partes. Añadir usuarios después no obliga a rehacer nada.

create table public.cfo_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'viewer',
  created_at  timestamptz not null default now(),

  constraint cfo_members_role_check check (role in ('owner', 'editor', 'viewer'))
);

comment on table public.cfo_members is
  'Lista blanca de acceso. Sin fila aquí, RLS bloquea absolutamente todo.';

-- SECURITY DEFINER para poder consultar la pertenencia desde las políticas de
-- otras tablas sin entrar en recursión con las políticas de esta.
create or replace function public.is_cfo_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.cfo_members m where m.user_id = auth.uid());
$$;

create or replace function public.can_edit_cfo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cfo_members m
    where m.user_id = auth.uid() and m.role in ('owner', 'editor')
  );
$$;

-- ============================================================================
-- 2 · CUENTAS DE TESORERÍA
-- ============================================================================
-- Tres orígenes de movimiento convergen en un único ledger, pero cada apunte
-- conserva su cuenta: sin eso no se puede cuadrar cada tesorería por separado.

create table public.treasury_accounts (
  id            text primary key,
  label         text not null,
  kind          text not null,
  legal_entity  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint treasury_kind_check check (kind in ('bank', 'cash')),
  constraint treasury_entity_check check (legal_entity in ('SL', 'SC', 'OTHER'))
);

insert into public.treasury_accounts (id, label, kind, legal_entity) values
  ('sl_bank', 'Banco SL', 'bank', 'SL'),
  ('sc_bank', 'Banco SC', 'bank', 'SC'),
  ('cash',    'Caja Antifrágil', 'cash', 'SL');

-- ============================================================================
-- 3 · PERIODOS
-- ============================================================================

create table public.periods (
  period        text primary key,
  status        text not null default 'open',
  -- Huellas de las fuentes de movimientos del último procesado. Es lo que
  -- permite decidir si la siguiente pasada puede ser incremental.
  source_hashes text[] not null default '{}',
  opened_at     timestamptz not null default now(),
  processed_at  timestamptz,
  closed_at     timestamptz,
  notes         text,

  constraint periods_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint periods_status_check check (status in ('open', 'processing', 'review', 'closed'))
);

-- ============================================================================
-- 4 · CARGAS DE DOCUMENTOS
-- ============================================================================
-- Traza de cada lote arrastrado a la interfaz: quién subió qué y cuándo.

create table public.document_uploads (
  id               uuid primary key default gen_random_uuid(),
  period           text not null,
  received_count   integer not null default 0,
  recognized_count integer not null default 0,
  review_count     integer not null default 0,
  duplicate_count  integer not null default 0,
  rejected_count   integer not null default 0,
  uploaded_by      uuid references auth.users (id),
  created_at       timestamptz not null default now(),

  constraint uploads_period_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

create index document_uploads_period_idx on public.document_uploads (period);

-- ============================================================================
-- 5 · DOCUMENTOS
-- ============================================================================
-- Metadata de cada archivo subido. Los bytes viven en el bucket privado de
-- Storage; aquí está todo lo demás.

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  period          text not null,
  -- Huella SHA-256 del contenido. Es la IDENTIDAD del documento: el mismo
  -- archivo con otro nombre es el mismo documento.
  content_hash    text not null,
  -- Ruta en el bucket privado. Determinista: periodo/huella.extensión.
  storage_path    text not null,
  name            text not null,
  mime_type       text,
  size_bytes      bigint,
  -- Qué papel juega: justificante, extracto, cuenta de cash, ventas de clínica…
  kind            text not null default 'unknown',
  account_id      text references public.treasury_accounts (id),
  doc_type        text not null default 'other',
  issuer          text,
  reference       text,
  doc_date        date,
  amount_cents    bigint,
  -- Confianza del reconocimiento automático y señales que lo justificaron.
  confidence      numeric(3, 2) not null default 0,
  inferred_from   text[] not null default '{}',
  -- Pendiente de que una persona confirme algo (qué es, o de qué cuenta).
  needs_review    boolean not null default false,
  review_question text,
  -- Reservado para la integración con Drive, aplazada.
  drive_file_id   text unique,
  uploaded_by     uuid references auth.users (id),
  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- ⭐ La regla que hace idempotente la carga: subir dos veces el mismo archivo
  -- al mismo periodo no puede crear dos documentos.
  constraint documents_unique_per_period unique (period, content_hash),
  constraint documents_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint documents_period_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint documents_kind_check check (kind in (
    'supporting_document', 'bank_statement', 'cash_account',
    'clinic_bank_sales', 'clinic_cash_sales', 'manual', 'unknown'
  )),
  constraint documents_type_check check (doc_type in (
    'invoice', 'payroll', 'tax', 'social_security', 'receipt',
    'sales_sheet', 'bank_statement', 'contract', 'other'
  )),
  constraint documents_confidence_check check (confidence >= 0 and confidence <= 1),
  -- Un extracto sin cuenta es precisamente lo que hay que preguntar: se admite,
  -- pero entonces tiene que estar marcado para revisión.
  constraint documents_statement_needs_account
    check (kind <> 'bank_statement' or account_id is not null or needs_review)
);

create index documents_period_idx on public.documents (period);
create index documents_kind_idx on public.documents (period, kind);
create index documents_review_idx on public.documents (needs_review) where needs_review;

-- ============================================================================
-- 6 · LEDGER
-- ============================================================================

create table public.ledger_entries (
  -- Id determinista calculado por el motor (ver lib/finance/dedupe.ts):
  -- fuente + periodo + cuenta + fecha + importe + concepto + ordinal.
  -- Es texto y no uuid precisamente para que reprocesar produzca el MISMO id y
  -- el upsert actualice en lugar de duplicar.
  id                      text primary key,
  period                  text not null references public.periods (period) on delete restrict,
  account_id              text not null references public.treasury_accounts (id),
  entry_date              date not null,
  value_date              date,
  direction               text not null,
  treasury                text not null,
  -- Importe en céntimos, con signo real. Nunca en coma flotante.
  amount_cents            bigint not null,
  description             text not null,
  raw_description         text not null,
  counterparty            text,
  category                text,
  pnl                     text,
  classification_status   text not null default 'pending',
  classification_rule_id  text,
  reconciliation          text not null default 'pending',
  reconciliation_reason   text,
  review_status           text not null default 'imported',
  source_kind             text not null,
  source_file             text not null,
  source_sheet            text,
  source_row              integer,
  source_raw              text,
  -- Ids de los movimientos consolidados en este apunte (caso datáfono).
  aggregates              text[],
  notes                   text[],
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint ledger_direction_check check (direction in ('income', 'expense', 'internal')),
  constraint ledger_treasury_check check (treasury in ('bank', 'cash')),
  constraint ledger_classification_check
    check (classification_status in ('pending', 'rule', 'manual', 'not_applicable')),
  constraint ledger_reconciliation_check
    check (reconciliation in ('pending', 'reconciled', 'missing_document', 'ambiguous', 'not_document_required')),
  constraint ledger_review_check
    check (review_status in ('imported', 'needs_review', 'reviewed', 'approved')),
  -- Regla de negocio escrita en la base de datos, no solo en el código: un
  -- movimiento interno de tesorería nunca lleva clasificación de P&L.
  constraint ledger_internal_has_no_pnl
    check (direction <> 'internal' or (category is null and pnl is null)),
  -- Si no requiere documento, hay que decir por qué.
  constraint ledger_not_required_has_reason
    check (reconciliation <> 'not_document_required' or reconciliation_reason is not null)
);

create index ledger_period_idx on public.ledger_entries (period);
create index ledger_account_idx on public.ledger_entries (account_id, entry_date);
create index ledger_review_idx on public.ledger_entries (review_status) where review_status = 'needs_review';
create index ledger_unreconciled_idx on public.ledger_entries (reconciliation)
  where reconciliation in ('missing_document', 'ambiguous');

-- ============================================================================
-- 7 · CONCILIACIONES
-- ============================================================================
-- Relación N:M con evidencia. Soporta las cuatro cardinalidades del motor:
-- 1↔1, 1↔N, N↔1 y agregado de periodo (datáfono).

create table public.entry_documents (
  entry_id      text not null references public.ledger_entries (id) on delete cascade,
  period        text not null,
  document_hash text not null,
  -- Cómo se estableció la asociación, para poder auditarla meses después.
  match_method  text not null default 'manual',
  match_score   numeric(4, 3),
  match_reasons text[],
  -- Agrupa los movimientos o documentos que forman una misma conciliación.
  group_id      text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id),

  -- Una nueva ejecución no puede generar asociaciones duplicadas.
  primary key (entry_id, document_hash),
  -- El documento tiene que existir en ese mismo periodo.
  constraint entry_documents_document_fk
    foreign key (period, document_hash)
    references public.documents (period, content_hash) on delete cascade,
  constraint entry_documents_method_check check (match_method in (
    'amount_date_issuer', 'reference_in_concept', 'aggregate_sum', 'aggregate_period', 'manual'
  )),
  constraint entry_documents_score_check
    check (match_score is null or (match_score >= 0 and match_score <= 1))
);

create index entry_documents_document_idx on public.entry_documents (period, document_hash);

-- ============================================================================
-- 8 · INCIDENCIAS
-- ============================================================================
-- El id lo calcula el motor de forma determinista: reprocesar el mismo mes NO
-- crea copias de la misma incidencia.

create table public.incidents (
  id           text primary key,
  period       text not null references public.periods (period) on delete cascade,
  type         text not null,
  severity     text not null default 'warning',
  message      text not null,
  entry_ids    text[] not null default '{}',
  details      jsonb,
  source_file  text,
  source_sheet text,
  source_row   integer,
  status       text not null default 'open',
  resolved_by  uuid references auth.users (id),
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),

  constraint incidents_type_check check (type in (
    'MOVEMENT_WITHOUT_DOCUMENT',
    'DOCUMENT_WITHOUT_MOVEMENT',
    'INCOME_WITHOUT_DOCUMENT',
    'CARD_SETTLEMENT_MISMATCH',
    'AMBIGUOUS_MATCH',
    'DUPLICATE_SUSPECT',
    'UNCLASSIFIED_MOVEMENT',
    'FORMULA_ERROR',
    'SOURCE_ERROR'
  )),
  constraint incidents_severity_check check (severity in ('info', 'warning', 'error')),
  constraint incidents_status_check check (status in ('open', 'in_review', 'resolved', 'accepted'))
);

create index incidents_period_idx on public.incidents (period);
create index incidents_open_idx on public.incidents (period, status) where status = 'open';

-- ============================================================================
-- 9 · CONCILIACIÓN DEL DATÁFONO
-- ============================================================================
-- Una fila por periodo: el contraste agregado banco vs facturación.

create table public.card_settlements (
  period              text primary key references public.periods (period) on delete cascade,
  bank_total_cents    bigint not null,
  sales_total_cents   bigint not null,
  difference_cents    bigint not null,
  reconciled          boolean not null,
  bank_movement_count integer not null default 0,
  sales_line_count    integer not null default 0,
  computed_at         timestamptz not null default now()
);

-- ============================================================================
-- 10 · REGLAS DE CLASIFICACIÓN
-- ============================================================================
-- El modelo queda preparado, pero el workflow de clasificación está APLAZADO
-- por decisión de producto. La tabla arranca vacía a propósito.

create table public.classification_rules (
  id                    text primary key,
  contains              text[] not null,
  excludes              text[] not null default '{}',
  account_id            text references public.treasury_accounts (id),
  applies_to            text not null default 'both',
  category              text not null,
  pnl                   text not null,
  confidence            numeric(3, 2) not null default 1.00,
  enabled               boolean not null default true,
  -- Obligatoria: una regla sin motivo escrito no es auditable.
  note                  text not null,
  -- De qué movimiento se aprendió, cuando nazca de una corrección manual.
  learned_from_entry_id text,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint rules_applies_check check (applies_to in ('expense', 'income', 'both')),
  constraint rules_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint rules_contains_not_empty check (array_length(contains, 1) >= 1)
);

-- ============================================================================
-- 11 · COMPARACIÓN CON CIERRES MANUALES
-- ============================================================================
-- Agosto 2026 se cerró a mano. Es referencia, no verdad infalible: las
-- diferencias nacen como 'pending' y las clasifica una persona.

create table public.close_comparisons (
  id                  uuid primary key default gen_random_uuid(),
  period              text not null references public.periods (period) on delete cascade,
  kind                text not null,
  verdict             text not null default 'pending',
  entry_id            text references public.ledger_entries (id) on delete set null,
  entry_date          date,
  description         text not null,
  engine_amount_cents bigint,
  manual_amount_cents bigint,
  delta_cents         bigint not null,
  evidence            text[],
  resolution_note     text,
  resolved_by         uuid references auth.users (id),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint comparison_kind_check check (kind in ('only_in_engine', 'only_in_manual', 'amount_mismatch')),
  constraint comparison_verdict_check check (verdict in (
    'pending', 'probable_engine_error', 'probable_manual_error', 'criteria_difference'
  ))
);

create index close_comparisons_period_idx on public.close_comparisons (period);

-- ============================================================================
-- 12 · AUDITORÍA
-- ============================================================================

create table public.audit_events (
  id          bigserial primary key,
  actor_id    uuid references auth.users (id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  period      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);

create index audit_entity_idx on public.audit_events (entity, entity_id);
create index audit_period_idx on public.audit_events (period);

-- ============================================================================
-- 13 · ROW LEVEL SECURITY
-- ============================================================================

alter table public.cfo_members          enable row level security;
alter table public.treasury_accounts    enable row level security;
alter table public.periods              enable row level security;
alter table public.document_uploads     enable row level security;
alter table public.documents            enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.entry_documents      enable row level security;
alter table public.incidents            enable row level security;
alter table public.card_settlements     enable row level security;
alter table public.classification_rules enable row level security;
alter table public.close_comparisons    enable row level security;
alter table public.audit_events         enable row level security;

-- Cada usuario puede comprobar su propia pertenencia. Alta y baja de miembros
-- son operaciones de servidor (service_role), nunca del cliente.
create policy cfo_members_self_read on public.cfo_members
  for select using (user_id = auth.uid());

-- Lectura: cualquier miembro. Escritura: solo owner/editor.
-- Sin políticas de DELETE en ninguna tabla, a propósito.
do $$
declare
  t text;
begin
  foreach t in array array[
    'treasury_accounts', 'periods', 'document_uploads', 'documents',
    'ledger_entries', 'entry_documents', 'incidents', 'card_settlements',
    'classification_rules', 'close_comparisons'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select using (public.is_cfo_member());',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (public.can_edit_cfo());',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for update using (public.can_edit_cfo()) with check (public.can_edit_cfo());',
      t || '_update', t
    );
  end loop;
end;
$$;

-- Excepción: el reprocesado retira las asociaciones y las incidencias abiertas
-- que ya no aplican. Es un recálculo del motor, no un borrado de información
-- introducida por una persona (las decisiones humanas viven en el movimiento y
-- en `incidents.status`, que este borrado respeta).
create policy entry_documents_delete on public.entry_documents
  for delete using (public.can_edit_cfo());

create policy incidents_delete_open on public.incidents
  for delete using (public.can_edit_cfo() and status = 'open');

-- La auditoría es de solo lectura para los miembros: la escriben los procesos
-- de servidor. Nadie puede reescribir su propio rastro.
create policy audit_events_read on public.audit_events
  for select using (public.is_cfo_member());

-- ============================================================================
-- 14 · updated_at automático
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ledger_entries_touch
  before update on public.ledger_entries
  for each row execute function public.touch_updated_at();

create trigger classification_rules_touch
  before update on public.classification_rules
  for each row execute function public.touch_updated_at();
