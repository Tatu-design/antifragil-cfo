-- ============================================================================
-- Antifrágil CFO — Almacenamiento de documentos
-- ----------------------------------------------------------------------------
-- Migración 0002. Bucket PRIVADO para los documentos justificativos, extractos
-- y hojas de ventas que el usuario sube desde la interfaz.
--
-- PRINCIPIO: los archivos financieros nunca se sirven por URL pública. El
-- acceso pasa siempre por el servidor, que comprueba la sesión y genera una
-- URL firmada de vida corta.
-- ============================================================================

-- ============================================================================
-- 1 · BUCKET
-- ============================================================================
-- `public = false` es lo que impide que un enlace filtrado dé acceso perpetuo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos',
  'documentos',
  false,
  26214400, -- 25 MB por archivo
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- ============================================================================
-- 2 · POLÍTICAS DE ACCESO
-- ============================================================================
-- Solo los miembros del CFO pueden leer los documentos, y solo desde una sesión
-- autenticada. La subida la hace el servidor con service_role, que salta RLS.

create policy documentos_read on storage.objects
  for select
  using (bucket_id = 'documentos' and public.is_cfo_member());

create policy documentos_insert on storage.objects
  for insert
  with check (bucket_id = 'documentos' and public.can_edit_cfo());

-- Sin políticas de UPDATE ni DELETE a propósito: el nombre de cada objeto es la
-- huella de su contenido, así que un documento nunca cambia. Sustituir un
-- justificante es subir otro, no reescribir el anterior.

-- ============================================================================
-- 3 · REGISTRO DE CARGAS
-- ============================================================================
-- Cada lote arrastrado a la interfaz queda registrado: cuántos archivos se
-- recibieron, cuántos se reconocieron y cuántos eran duplicados. Es la
-- trazabilidad de "quién subió qué y cuándo".

create table public.document_uploads (
  id               uuid primary key default gen_random_uuid(),
  period           text not null,
  received_count   integer not null default 0,
  recognized_count integer not null default 0,
  review_count     integer not null default 0,
  duplicate_count  integer not null default 0,
  rejected_count   integer not null default 0,
  uploaded_by      uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create index document_uploads_period_idx on public.document_uploads (period);

alter table public.document_uploads enable row level security;

create policy document_uploads_read on public.document_uploads
  for select using (public.is_cfo_member());

create policy document_uploads_insert on public.document_uploads
  for insert with check (public.can_edit_cfo());
