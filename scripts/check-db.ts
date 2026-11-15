import { Pool } from "pg";

/**
 * The functions this deployment cannot work without, by name.
 *
 * The expected count used to be a literal beside the list, and the two drifted: the list grew to 37 and
 * the constant still said 36, so a *healthy* deployment failed its own configuration check and the
 * Vercel build stopped. A number that has to be kept in step with a list by hand is a number that will
 * fall out of step. The list is the source of truth now, and the count is measured from it.
 */
const REQUIRED_FUNCTIONS = [
  "app_consume_delivery_code",
  "app_mark_user_verified",
  "app_find_receiver_candidates",
  "app_notify_organization_members",
  "app_notify_user",
  "app_worker_reserve_outbox_batch",
  "app_worker_defer_outbox",
  "app_worker_mark_outbox_sent",
  "app_worker_mark_outbox_failed",
  "app_guard_user_profile_status",
  "app_notify_area_helpers",
  "app_escalate_delivery_backlog",
  "app_launch_readiness",
  "app_on_call_coverage",
  "app_public_data_protection_contact",
  "app_legal_entity",
  "app_on_call_person",
  "app_escalate_platform_readiness",
  "app_public_directory",
  "app_notify_platform_roles",
  "app_current_agreement_version",
  "app_apply_retention",
  "app_redact_user",
  "app_guard_audit_mutation",
  "app_export_person",
  "app_record_profile_correction",
  "app_overdue_privacy_requests",
  "app_overdue_support_cases",
  "app_privacy_response_window_hours",
  "app_public_response_window_contact",
  "app_org_coordinates",
  "app_normalize_place",
  "app_notification_recipients",
  "app_push_targets",
  "app_unpushed_notifications",
  "app_mark_push_delivered",
  "app_revoke_push_subscription",
  "app_register_push_subscription",
  "app_claim_push_batch",
  "app_push_targets_for",
  "app_finish_push_batch",
] as const;

/**
 * Functions that hand out, or act on, the credentials that address a person's device.
 *
 * They exist for the sender, which connects as the worker role. The role that serves web requests must
 * not be able to run any of them: two of them once treated "no session user" as "this is the worker",
 * and a request handler that forgets to set its session is exactly the mistake row-level security is
 * there to make harmless. Checked here, by the role itself, so the build fails if a grant returns.
 */
const WORKER_ONLY_DEVICE_FUNCTIONS = [
  "app_push_targets",
  "app_push_targets_for",
  "app_revoke_push_subscription",
  "app_claim_push_batch",
  "app_finish_push_batch",
  "app_unpushed_notifications",
  "app_mark_push_delivered",
] as const;
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
      web_reachable_device_functions: number;
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
            AND function_info.proname = ANY($1::text[])) AS required_functions,
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
                        WHERE grantee_role.rolname IN ('anon', 'authenticated'))) AS exposed_functions,
        (SELECT count(*)::int FROM pg_proc function_info
          JOIN pg_namespace namespace ON namespace.oid = function_info.pronamespace
          WHERE namespace.nspname = 'public'
            AND function_info.proname = ANY($2::text[])
            AND has_function_privilege(current_user, function_info.oid, 'EXECUTE')) AS web_reachable_device_functions
      FROM pg_roles role WHERE role.rolname = current_user
    `, [[...REQUIRED_FUNCTIONS], [...WORKER_ONLY_DEVICE_FUNCTIONS]]);
    const row = result.rows[0];
    if (!row) throw new Error("The database role could not be identified.");
    const problems: string[] = [];
    if (row.bypass_rls) problems.push("runtime database role has BYPASSRLS");
    // Migration 20 added two forced-RLS tables (partner agreements, recovery intake). The floor is
    // deliberately below the current count, so dropping forced RLS from an existing table still
    // fails the check rather than hiding inside a coincidence.
    if (row.rls_tables < 31) problems.push(`expected at least 31 RLS-protected tables, found ${row.rls_tables}`);
    // Exact rather than a floor: a missing function here is a silently broken feature, not a degraded
    // one. The expected value comes from the list itself, because a literal beside it drifted once and
    // failed a healthy deployment.
    if (row.required_functions !== REQUIRED_FUNCTIONS.length) problems.push(`expected required database functions, found ${row.required_functions}/${REQUIRED_FUNCTIONS.length}`);
    if (row.migrations < 28) problems.push(`expected at least 28 applied migrations, found ${row.migrations}`);
    if (row.web_reachable_device_functions > 0) problems.push(`the web database role can execute ${row.web_reachable_device_functions} worker-only device function(s); apply 20261117120000_push_delivery_without_a_worker`);
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
      webReachableDeviceFunctions: row.web_reachable_device_functions,
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
