-- ============================================================================
-- Antifrágil CFO — Esquema inicial del Financial Ledger
-- ----------------------------------------------------------------------------
-- Migración 0001. Modelo central: periodos, apuntes, documentos, incidencias,
-- reglas de clasificación e importaciones.
--
-- MODELO DE SEGURIDAD (D47/D48): toda la información es financiera y privada.
-- RLS está activo en todas las tablas desde el primer día. El acceso se concede
-- a usuarios autenticados presentes en `cfo_members`. La service_role nunca se
-- expone al navegador y solo se usa desde el servidor.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1 · CONTROL DE ACCESO
-- ============================================================================

-- Personas autorizadas a ver y operar la información financiera.
-- Un usuario de auth.users sin fila aquí no ve absolutamente nada.
create table public.cfo_members (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'viewer',
  created_at  timestamptz not null default now(),

  constraint cfo_members_role_check check (role in ('owner', 'editor', 'viewer'))
);

comment on table public.cfo_members is
  'Lista blanca de acceso a los datos financieros. Sin fila aquí, RLS lo bloquea todo.';

-- Helpers usados por las políticas. SECURITY DEFINER para poder consultar la
-- tabla de miembros sin entrar en recursión de políticas.
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
-- 2 · PERIODOS
-- ============================================================================

create table public.periods (
  id          uuid primary key default gen_random_uuid(),
  -- Formato YYYY-MM. Es la clave natural del mes contable.
  period      text not null unique,
  status      text not null default 'open',
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  notes       text,

  constraint periods_period_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  constraint periods_status_check check (status in ('open', 'processing', 'review', 'closed'))
);

-- ============================================================================
-- 3 · IMPORTACIONES
-- ============================================================================
-- Cada lectura de fuentes queda registrada. Permite responder "¿de dónde salió
-- esta cifra y cuándo entró?" (D49/D50).

create table public.imports (
  id            uuid primary key default gen_random_uuid(),
  period        text not null references public.periods (period) on delete restrict,
  source_kind   text not null,
  file_name     text not null,
  -- Hash del contenido: reimportar el mismo archivo se detecta al instante (D26).
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
-- 4 · LEDGER
-- ============================================================================

create table public.ledger_entries (
  -- Id determinista calculado por el motor (ver lib/finance/dedupe.ts).
  -- Es texto, no uuid, precisamente para que sea reproducible: reprocesar el
  -- mes produce el mismo id y el upsert no duplica nada.
  id                      text primary key,
  period                  text not null references public.periods (period) on delete restrict,
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
  reconciliation          text not null default 'unmatched',
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
    check (reconciliation in ('matched', 'missing_document', 'ambiguous', 'unmatched', 'not_applicable')),
  constraint ledger_review_check
    check (review_status in ('imported', 'needs_review', 'reviewed', 'approved')),
  -- Un movimiento interno no puede llevar clasificación de P&L: es la regla
  -- D36/D37 escrita en la base de datos, no solo en el código.
  constraint ledger_internal_has_no_pnl
    check (direction <> 'internal' or (category is null and pnl is null))
);

create index ledger_period_idx on public.ledger_entries (period);
create index ledger_date_idx on public.ledger_entries (entry_date);
create index ledger_review_idx on public.ledger_entries (review_status) where review_status = 'needs_review';
create index ledger_pending_idx on public.ledger_entries (classification_status) where classification_status = 'pending';

-- ============================================================================
-- 5 · DOCUMENTOS
-- ============================================================================
-- Drive sigue siendo el repositorio documental (D21). Aquí viven los metadatos
-- y el enlace, no una copia del archivo (D22).

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  period          text references public.periods (period) on delete set null,
  name            text not null,
  drive_file_id   text unique,
  url             text,
  local_path      text,
  doc_type        text not null default 'invoice',
  supplier        text,
  invoice_number  text,
  doc_date        date,
  amount_cents    bigint,
  created_at      timestamptz not null default now(),

  constraint documents_type_check
    check (doc_type in ('invoice', 'income_document', 'sales_sheet', 'bank_statement', 'other'))
);

create index documents_period_idx on public.documents (period);

-- Relación N:M: un gasto puede tener varios justificantes y un Excel de ventas
-- respalda una línea consolidada.
create table public.entry_documents (
  entry_id     text not null references public.ledger_entries (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  -- Cómo se estableció la relación: útil para auditar matches automáticos.
  match_reason text,
  match_score  numeric(4, 3),
  created_at   timestamptz not null default now(),

  primary key (entry_id, document_id)
);

-- ============================================================================
-- 6 · INCIDENCIAS
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
    'EXPENSE_WITHOUT_INVOICE',
    'INVOICE_WITHOUT_MOVEMENT',
    'INCOME_WITHOUT_INVOICE',
    'CARD_SETTLEMENT_MISMATCH',
    'AMBIGUOUS_MATCH',
    'DUPLICATE_SUSPECT',
    'FORMULA_ERROR',
    'SOURCE_ERROR'
  )),
  constraint incidents_severity_check check (severity in ('info', 'warning', 'error')),
  constraint incidents_status_check check (status in ('open', 'in_review', 'resolved', 'accepted'))
);

create index incidents_period_idx on public.incidents (period);
create index incidents_open_idx on public.incidents (status) where status = 'open';

-- ============================================================================
-- 7 · CONCILIACIÓN DEL DATÁFONO
-- ============================================================================
-- Una fila por periodo: el contraste agregado banco vs facturación (D32).

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
-- 8 · REGLAS DE CLASIFICACIÓN
-- ============================================================================
-- Deterministas y auditables (D29/D30). Una corrección manual puede convertirse
-- en regla, y toda regla explica por qué existe.

create table public.classification_rules (
  id           text primary key,
  contains     text[] not null,
  excludes     text[] not null default '{}',
  treasury     text,
  applies_to   text not null default 'both',
  category     text not null,
  pnl          text not null,
  confidence   numeric(3, 2) not null default 1.00,
  enabled      boolean not null default true,
  note         text not null,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint rules_treasury_check check (treasury is null or treasury in ('bank', 'cash')),
  constraint rules_applies_check check (applies_to in ('expense', 'income', 'both')),
  constraint rules_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint rules_contains_not_empty check (array_length(contains, 1) >= 1)
);

-- ============================================================================
-- 9 · AUDITORÍA
-- ============================================================================
-- Ningún cambio financiero relevante debe ser silencioso (D50).

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
-- 10 · ROW LEVEL SECURITY
-- ============================================================================

alter table public.cfo_members          enable row level security;
alter table public.periods              enable row level security;
alter table public.imports              enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.documents            enable row level security;
alter table public.entry_documents      enable row level security;
alter table public.incidents            enable row level security;
alter table public.card_settlements     enable row level security;
alter table public.classification_rules enable row level security;
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
    'periods', 'imports', 'ledger_entries', 'documents', 'entry_documents',
    'incidents', 'card_settlements', 'classification_rules'
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
-- 11 · updated_at automático
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
