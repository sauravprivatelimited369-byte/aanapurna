-- Supabase creates `anon` and `authenticated` PostgREST roles and grants them
-- broad privileges by default (including on tables created later by `postgres`).
-- This application never uses PostgREST, Realtime or Supabase Auth: it connects
-- with its own least-privilege roles (`annapurna_app`, `annapurna_auth`,
-- `annapurna_worker`, `annapurna_migrator`). Leaving the PostgREST roles with
-- table and function rights would expose `session`, `account` and `user` rows —
-- and therefore session tokens and password hashes — to anyone holding the
-- publishable API key, and would let them call SECURITY DEFINER helpers.
--
-- Every statement below is guarded so the migration also applies to plain
-- PostgreSQL (local Docker, CI and the embedded test database), where those
-- roles do not exist.
DO $$
DECLARE
  schema_name text;
  role_name text;
  owner_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['public', 'drizzle', 'graphile_worker'] LOOP
    CONTINUE WHEN to_regnamespace(schema_name) IS NULL;
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', schema_name, role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', schema_name, role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', schema_name, role_name);
    END LOOP;
  END LOOP;

  -- Future objects must not inherit the same grants, otherwise the next
  -- deployment re-opens the exposure. Default privileges are stored per owning
  -- role, so every plausible owner is covered: `postgres` (this application's
  -- migration role, and the owner of all of its objects) and `supabase_admin`
  -- (which owns Supabase's own default privileges). The latter can only be
  -- changed by a member of that role (or a superuser), so an insufficient-
  -- privilege failure there is reported and skipped rather than aborting the
  -- migration.
  FOREACH owner_name IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_name);
    FOREACH schema_name IN ARRAY ARRAY['public', 'drizzle', 'graphile_worker'] LOOP
      CONTINUE WHEN to_regnamespace(schema_name) IS NULL;
      FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);
        BEGIN
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', owner_name, schema_name, role_name);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', owner_name, schema_name, role_name);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I', owner_name, schema_name, role_name);
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'skipping default privileges for role % in schema %: insufficient privilege', owner_name, schema_name;
        END;
      END LOOP;
    END LOOP;
  END LOOP;
END
$$;
