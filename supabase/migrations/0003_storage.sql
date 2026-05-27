-- =============================================================================
-- Storage buckets (run after dashboard setup; idempotent).
-- =============================================================================

insert into storage.buckets (id, name, public)
  values ('screenplay-exports', 'screenplay-exports', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('production-assets', 'production-assets', false)
  on conflict (id) do nothing;

-- Restrict access: members of the project that owns the file path prefix.
-- Convention: object names are "<project_id>/<filename>".
drop policy if exists storage_exports_member on storage.objects;
create policy storage_exports_member on storage.objects
  for select using (
    bucket_id = 'screenplay-exports'
    and is_project_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists storage_assets_member on storage.objects;
create policy storage_assets_member on storage.objects
  for select using (
    bucket_id = 'production-assets'
    and is_project_member((split_part(name, '/', 1))::uuid)
  );
