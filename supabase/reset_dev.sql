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

-- Schema-level grants.
grant all on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to public;

-- Default privileges for objects created LATER inside `public`. Without
-- these, the `service_role` (used by the backend) cannot read tables that
-- migrations create, even though it can read the schema itself.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Restore the search_path default Supabase expects.
alter database postgres set search_path to "$user", public, extensions;
