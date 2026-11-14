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

  -- Future objects created by the migration role must not inherit the same
  -- grants, otherwise the next deployment re-opens the exposure.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
    END LOOP;
  END IF;
END
$$;
