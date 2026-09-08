-- ============================================================================
-- Antifrágil CFO — Almacenamiento de documentos
-- ----------------------------------------------------------------------------
-- Migración 0002. Bucket PRIVADO para los archivos originales: facturas,
-- nóminas, impuestos, extractos y hojas de ventas.
--
-- PRINCIPIO: los archivos financieros no se sirven nunca por URL pública. El
-- acceso pasa siempre por el servidor, que comprueba la sesión y la pertenencia
-- a `cfo_members` antes de firmar una URL de vida corta.
--
-- Conocer la ruta de un archivo (o su SHA-256) NO da acceso a él.
-- ============================================================================

-- ============================================================================
-- 1 · BUCKET PRIVADO
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
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- 2 · POLÍTICAS DE ACCESO
-- ============================================================================
-- Mismas reglas que el resto de datos financieros: solo miembros. La aplicación
-- sube y descarga con el cliente de sesión del usuario, así que estas políticas
-- son la barrera real y no dependen de que el código se porte bien.

create policy documentos_read on storage.objects
  for select
  using (bucket_id = 'documentos' and public.is_cfo_member());

create policy documentos_insert on storage.objects
  for insert
  with check (bucket_id = 'documentos' and public.can_edit_cfo());

-- Sin políticas de UPDATE ni DELETE a propósito: cada objeto se nombra por la
-- huella de su contenido, así que un documento nunca cambia. Sustituir un
-- justificante es subir otro, no reescribir el anterior.
