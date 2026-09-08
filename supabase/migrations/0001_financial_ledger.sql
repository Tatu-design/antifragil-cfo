-- ============================================================================
-- Antifrágil CFO — Esquema inicial del Financial Ledger
-- ----------------------------------------------------------------------------
-- Migración 0001. Modelo central: cuentas de tesorería, periodos, movimientos,
-- índice documental de Drive, conciliaciones, incidencias, reglas y auditoría.
--
-- MISIÓN DE ESTA ETAPA: conciliar todos los movimientos reales de tesorería
-- (banco SL, banco SC y caja) con su documentación justificativa, y dejar las
-- excepciones listas para revisión desde la interfaz.
--
-- MODELO DE SEGURIDAD: toda la información es financiera y privada. RLS está
-- activo en todas las tablas desde el primer día. El acceso se concede a los
-- usuarios presentes en `cfo_members`. La service_role nunca se expone al
-- navegador y solo se usa desde el servidor.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1 · CONTROL DE ACCESO
-- ============================================================================

create table public.cfo_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'viewer',
  created_at  timestamptz not null default now(),

  constraint cfo_members_role_check check (role in ('owner', 'editor', 'viewer'))
);

comment on table public.cfo_members is
  'Lista blanca de acceso a los datos financieros. Sin fila aquí, RLS lo bloquea todo.';

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
  id          uuid primary key default gen_random_uuid(),
  period      text not null unique,
  status      text not null default 'open',
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  notes       text,

  constraint periods_period_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint periods_status_check check (status in ('open', 'processing', 'review', 'closed'))
);

-- ============================================================================
-- 4 · IMPORTACIONES
-- ============================================================================
-- Cada lectura de fuentes queda registrada: permite responder "¿de dónde salió
-- esta cifra y cuándo entró?".

create table public.imports (
  id            uuid primary key default gen_random_uuid(),
  period        text not null references public.periods (period) on delete restrict,
  account_id    text references public.treasury_accounts (id),
  source_kind   text not null,
  file_name     text not null,
  -- Hash del contenido: reimportar el mismo archivo se detecta al instante.
  content_hash  text not null,
  status        text not null default 'uploaded',
  row_count     integer,
  imported_by   uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text,

  constraint imports_status_check check (status in ('uploaded', 'processing', 'processed', 'failed')),
  constraint imports_unique_file unique (period, source_kind, content_hash)
);

create index imports_period_idx on public.imports (period);

-- ============================================================================
-- 5 · LEDGER
-- ============================================================================

create table public.ledger_entries (
  -- Id determinista calculado por el motor (ver lib/finance/dedupe.ts).
  -- Es texto, no uuid, para que sea reproducible: reprocesar el mes produce el
  -- mismo id y el upsert no duplica nada.
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
  import_id               uuid references public.imports (id) on delete set null,
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
  -- Un movimiento interno no puede llevar clasificación de P&L: la regla de
  -- negocio escrita en la base de datos, no solo en el código.
  constraint ledger_internal_has_no_pnl
    check (direction <> 'internal' or (category is null and pnl is null)),
  -- Si no requiere documento, hay que decir por qué.
  constraint ledger_not_required_has_reason
    check (reconciliation <> 'not_document_required' or reconciliation_reason is not null)
);

create index ledger_period_idx on public.ledger_entries (period);
create index ledger_account_idx on public.ledger_entries (account_id, entry_date);
create index ledger_date_idx on public.ledger_entries (entry_date);
create index ledger_review_idx on public.ledger_entries (review_status) where review_status = 'needs_review';
create index ledger_pending_idx on public.ledger_entries (classification_status) where classification_status = 'pending';
create index ledger_unreconciled_idx on public.ledger_entries (reconciliation)
  where reconciliation in ('missing_document', 'ambiguous');

-- ============================================================================
-- 6 · ÍNDICE DOCUMENTAL (Drive)
-- ============================================================================
-- Drive sigue siendo el repositorio de los archivos. Aquí viven metadatos y
-- enlaces, no copias. El motor consulta este índice; nunca recorre Drive.

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  -- Huella SHA-256 del contenido. Es la identidad del documento: subir dos
  -- veces el mismo archivo, aunque cambie de nombre, no crea uno nuevo.
  content_hash    text unique,
  -- Ruta en el bucket privado de Supabase Storage.
  storage_path    text,
  -- Clave natural de la sincronización con Drive (upsert por drive_file_id).
  drive_file_id   text unique,
  period          text references public.periods (period) on delete set null,
  name            text not null,
  url             text,
  mime_type       text,
  folder_path     text,
  local_path      text,
  doc_type        text not null default 'other',
  issuer          text,
  reference       text,
  doc_date        date,
  amount_cents    bigint,
  -- Señales usadas para deducir tipo, emisor e importe. Auditoría del indexado.
  inferred_from   text[],
  -- Confianza del reconocimiento automático y si falta confirmación humana.
  confidence      numeric(3, 2),
  needs_review    boolean not null default false,
  review_question text,
  uploaded_by     uuid references auth.users (id),
  uploaded_at     timestamptz,
  synced_at       timestamptz,
  modified_time   timestamptz,
  size_bytes      bigint,
  created_at      timestamptz not null default now(),

  constraint documents_type_check check (doc_type in (
    'invoice', 'payroll', 'tax', 'social_security', 'receipt',
    'sales_sheet', 'bank_statement', 'contract', 'other'
  ))
);

create index documents_period_idx on public.documents (period);
create index documents_type_idx on public.documents (doc_type);

-- Registro de cada sincronización con Drive.
create table public.drive_syncs (
  id              uuid primary key default gen_random_uuid(),
  period          text not null,
  root_folder_id  text not null,
  document_count  integer not null default 0,
  folder_count    integer not null default 0,
  problems        text[],
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  triggered_by    uuid references auth.users (id)
);

-- Relación N:M con evidencia: un movimiento puede tener varios documentos y un
-- documento puede justificar varios movimientos (nómina pagada en dos cargos).
create table public.entry_documents (
  entry_id     text not null references public.ledger_entries (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  -- Cómo se estableció la relación. Auditar un match automático meses después.
  match_method text not null default 'manual',
  match_score  numeric(4, 3),
  match_reasons text[],
  -- Agrupa los movimientos o documentos que forman una misma conciliación.
  group_id     text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id),

  primary key (entry_id, document_id),
  constraint entry_documents_method_check check (match_method in (
    'amount_date_issuer', 'reference_in_concept', 'aggregate_sum', 'aggregate_period', 'manual'
  ))
);

create index entry_documents_document_idx on public.entry_documents (document_id);

-- ============================================================================
-- 7 · INCIDENCIAS
-- ============================================================================

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
create index incidents_open_idx on public.incidents (status) where status = 'open';

-- ============================================================================
-- 8 · CONCILIACIÓN DEL DATÁFONO
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
-- 9 · REGLAS DE CLASIFICACIÓN
-- ============================================================================
-- Deterministas y auditables. Una corrección manual puede convertirse en regla
-- desde la interfaz ("guardar esta decisión para futuros movimientos"), y toda
-- regla explica por qué existe.

create table public.classification_rules (
  id            text primary key,
  contains      text[] not null,
  excludes      text[] not null default '{}',
  account_id    text references public.treasury_accounts (id),
  applies_to    text not null default 'both',
  category      text not null,
  pnl           text not null,
  confidence    numeric(3, 2) not null default 1.00,
  enabled       boolean not null default true,
  note          text not null,
  -- Movimiento a partir del cual se creó la regla. Trazabilidad del aprendizaje.
  learned_from_entry_id text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint rules_applies_check check (applies_to in ('expense', 'income', 'both')),
  constraint rules_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint rules_contains_not_empty check (array_length(contains, 1) >= 1)
);

-- ============================================================================
-- 10 · COMPARACIÓN CON CIERRES MANUALES
-- ============================================================================
-- Agosto 2026 se cerró a mano. Es referencia, no verdad infalible: las
-- diferencias nacen como 'pending' y las clasifica una persona.

create table public.close_comparisons (
  id               uuid primary key default gen_random_uuid(),
  period           text not null references public.periods (period) on delete cascade,
  kind             text not null,
  verdict          text not null default 'pending',
  entry_id         text references public.ledger_entries (id) on delete set null,
  entry_date       date,
  description      text not null,
  engine_amount_cents bigint,
  manual_amount_cents bigint,
  delta_cents      bigint not null,
  evidence         text[],
  resolution_note  text,
  resolved_by      uuid references auth.users (id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),

  constraint comparison_kind_check check (kind in ('only_in_engine', 'only_in_manual', 'amount_mismatch')),
  constraint comparison_verdict_check check (verdict in (
    'pending', 'probable_engine_error', 'probable_manual_error', 'criteria_difference'
  ))
);

create index close_comparisons_period_idx on public.close_comparisons (period);

-- ============================================================================
-- 11 · AUDITORÍA
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
-- 12 · ROW LEVEL SECURITY
-- ============================================================================

alter table public.cfo_members          enable row level security;
alter table public.treasury_accounts    enable row level security;
alter table public.periods              enable row level security;
alter table public.imports              enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.documents            enable row level security;
alter table public.drive_syncs          enable row level security;
alter table public.entry_documents      enable row level security;
alter table public.incidents            enable row level security;
alter table public.card_settlements     enable row level security;
alter table public.classification_rules enable row level security;
alter table public.close_comparisons    enable row level security;
alter table public.audit_events         enable row level security;

-- Cada usuario puede comprobar su propia pertenencia; la gestión de miembros es
-- una operación de servidor (service_role), nunca del cliente.
create policy cfo_members_self_read on public.cfo_members
  for select using (user_id = auth.uid());

-- Lectura: cualquier miembro. Escritura: solo owner/editor.
do $$
declare
  t text;
begin
  foreach t in array array[
    'treasury_accounts', 'periods', 'imports', 'ledger_entries', 'documents',
    'drive_syncs', 'entry_documents', 'incidents', 'card_settlements',
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
    -- Sin política de DELETE a propósito: los datos financieros no se borran
    -- desde la aplicación. Corregir es escribir, no hacer desaparecer.
  end loop;
end;
$$;

-- La auditoría es de solo lectura para los miembros: la escriben los procesos
-- de servidor. Nadie puede reescribir su propio rastro.
create policy audit_events_read on public.audit_events
  for select using (public.is_cfo_member());

-- ============================================================================
-- 13 · updated_at automático
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
