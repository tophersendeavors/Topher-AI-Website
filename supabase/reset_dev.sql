-- =============================================================================
-- Reset the public schema — destructive! Only run this on a fresh dev
-- Supabase project, or if a migration failed partway through and you need
-- to start the schema setup from scratch.
--
-- This drops every user-created table/type/function in `public` and leaves
-- Supabase's `auth`, `storage`, `realtime`, etc. schemas untouched.
-- =============================================================================

drop schema if exists public cascade;
create schema public;

grant all on schema public to postgres;
grant all on schema public to anon;
grant all on schema public to authenticated;
grant all on schema public to service_role;
grant all on schema public to public;

-- Restore the search_path default Supabase expects.
alter database postgres set search_path to "$user", public, extensions;
