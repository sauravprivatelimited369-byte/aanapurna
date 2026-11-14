import { Pool } from "pg";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "../src/lib/database-config";



function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const parts = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) parts.push(`cause: ${cause.message}`);
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string") parts.push(`code: ${code}`);
  return parts.join(" | ");
}

async function main(): Promise<void> {
  const connectionString = databaseUrl("DATABASE_URL");
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    application_name: "annapurna-link-db-check",
    ssl: databaseSslOptions(connectionString),
  });

  try {
    const result = await pool.query<{
      current_user: string;
      bypass_rls: boolean;
      rls_tables: number;
      required_functions: number;
      migrations: number;
      exposed_tables: number;
      exposed_functions: number;
    }>(`
      SELECT current_user,
        role.rolbypassrls AS bypass_rls,
        (SELECT count(*)::int FROM pg_class table_info
          JOIN pg_namespace namespace ON namespace.oid = table_info.relnamespace
          WHERE namespace.nspname = 'public'
            AND table_info.relkind = 'r' AND table_info.relrowsecurity) AS rls_tables,
        (SELECT count(*)::int FROM pg_proc function_info
          JOIN pg_namespace namespace ON namespace.oid = function_info.pronamespace
          WHERE namespace.nspname = 'public'
            AND function_info.proname IN (
              'app_consume_delivery_code','app_mark_user_verified','app_find_receiver_candidates',
              'app_notify_organization_members','app_notify_user','app_worker_reserve_outbox_batch',
              'app_worker_defer_outbox','app_worker_mark_outbox_sent','app_worker_mark_outbox_failed',
              'app_guard_user_profile_status'
            )) AS required_functions,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
        -- Supabase's public PostgREST roles must not reach application objects.
        -- Tables with RLS disabled (auth and internal tables) would otherwise be
        -- fully readable and writable with the publishable API key.
        (SELECT count(*)::int FROM pg_class table_info
          JOIN pg_namespace namespace ON namespace.oid = table_info.relnamespace
          WHERE namespace.nspname IN ('public', 'drizzle', 'graphile_worker')
            AND table_info.relkind = 'r' AND table_info.relacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(table_info.relacl) acl
                        JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
                        WHERE grantee_role.rolname IN ('anon', 'authenticated'))) AS exposed_tables,
        (SELECT count(*)::int FROM pg_proc function_info
          JOIN pg_namespace namespace ON namespace.oid = function_info.pronamespace
          WHERE namespace.nspname = 'public' AND function_info.proacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(function_info.proacl) acl
                        JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
                        WHERE grantee_role.rolname IN ('anon', 'authenticated'))) AS exposed_functions
      FROM pg_roles role WHERE role.rolname = current_user
    `);
    const row = result.rows[0];
    if (!row) throw new Error("The database role could not be identified.");
    const problems: string[] = [];
    if (row.bypass_rls) problems.push("runtime database role has BYPASSRLS");
    if (row.rls_tables < 23) problems.push(`expected at least 23 RLS-protected tables, found ${row.rls_tables}`);
    if (row.required_functions !== 10) problems.push(`expected required database functions, found ${row.required_functions}/10`);
    if (row.migrations < 12) problems.push(`expected at least 12 applied migrations, found ${row.migrations}`);
    if (row.exposed_tables > 0) problems.push(`Supabase public API roles can reach ${row.exposed_tables} application table(s); apply 20261114120000_revoke_public_api_privileges`);
    if (row.exposed_functions > 0) problems.push(`Supabase public API roles can execute ${row.exposed_functions} application function(s); apply 20261114120000_revoke_public_api_privileges`);
    console.info(JSON.stringify({
      level: problems.length ? "error" : "info",
      event: "database.configuration_check",
      databaseRole: row.current_user,
      rowLevelSecurityTables: row.rls_tables,
      requiredFunctions: row.required_functions,
      appliedMigrations: row.migrations,
      publicApiExposedTables: row.exposed_tables,
      publicApiExposedFunctions: row.exposed_functions,
      problems,
    }));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "database.configuration_check_failed", message: describeError(error) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "database.configuration_check_failed", message: describeError(error) }));
  process.exitCode = 1;
});
