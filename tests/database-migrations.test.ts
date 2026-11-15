import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationFiles = [
  "20261112081810_foundation.sql",
  "20261112083546_onboarding_and_private_documents.sql",
  "20261112085024_private_locations_and_delivery_snapshots.sql",
  "20261112090428_helper_reviews_and_policy_authorship.sql",
  "20261112092216_support_data_request_reviews.sql",
  "20261112103924_better_auth_rate_limit_id.sql",
  "20261112164011_better_auth_rate_limit_text_id.sql",
  "20261112165901_public_impact_summary.sql",
  "20261113073000_fix_donation_helper_rls.sql",
  "20261113074000_arrival_inspection_gate.sql",
  "20261113190000_auth_registration_and_guards.sql",
  "20261114120000_revoke_public_api_privileges.sql",
  "20261114150000_recall_records_and_worker_heartbeat.sql",
  "20261115090000_helper_dispatch_and_escalation.sql",
  "20261115120000_two_factor_for_privileged_accounts.sql",
  "20261115140000_transit_limits_and_self_collection.sql",
  "20261115180000_owner_attestations_and_launch_gate.sql",
  "20261115193000_readiness_escalation.sql",
  "20261115203000_joka_directory.sql",
  "20261115213000_directory_phone_consent.sql",
  "20261115230000_food_safety_attestation_and_recovery.sql",
  "20261116090000_data_retention_and_holds.sql",
  "20261116120000_privacy_subject_rights.sql",
];

let database: PGlite;

async function applyAllMigrations() {
  for (const file of migrationFiles) {
    if (file === "20261112103924_better_auth_rate_limit_id.sql") {
      await database.exec("INSERT INTO public.rate_limit (key, count, last_request) VALUES ('migration-preserve', 2, 123456789)");
    }
    const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await database.exec(migration.replaceAll("--> statement-breakpoint", "\n"));
  }
}

async function withRole<T>(
  role: "annapurna_app" | "annapurna_worker",
  userId: string | null,
  callback: () => Promise<T>,
): Promise<T> {
  await database.exec(`SET ROLE ${role}`);
  await database.exec("BEGIN");
  if (userId !== null) await database.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  try {
    const value = await callback();
    await database.exec("COMMIT");
    return value;
  } catch (error) {
    await database.exec("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await database.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE ROLE annapurna_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE annapurna_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE annapurna_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
    CREATE SCHEMA graphile_worker AUTHORIZATION annapurna_worker;
    GRANT USAGE ON SCHEMA public TO annapurna_app, annapurna_auth, annapurna_worker;
  `);
  await applyAllMigrations();
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("PostgreSQL migration and authorization contracts", () => {
  it("preserves Better Auth rate-limit rows while adding its expected ID column", async () => {
    const result = await database.query<{ id: string; key: string; count: number; last_request: number; key_is_unique: boolean }>(`
      SELECT rate_limit.id, rate_limit.key, rate_limit.count, rate_limit.last_request,
        EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.rate_limit'::regclass
            AND conname = 'rate_limit_key_unique' AND contype = 'u') AS key_is_unique
      FROM public.rate_limit WHERE rate_limit.key = 'migration-preserve'
    `);
    expect(result.rows[0]).toMatchObject({
      key: "migration-preserve",
      count: 2,
      last_request: 123456789,
      key_is_unique: true,
    });
    expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accepts the non-UUID string IDs Better Auth writes to its rate-limit table", async () => {
    await database.query(`
      INSERT INTO public.rate_limit (id, key, count, last_request)
      VALUES ('better-auth-generated-string-id', 'better-auth-generated-key', 1, 1794500000000)
    `);
    const result = await database.query<{ id: string }>(
      "SELECT id FROM public.rate_limit WHERE key = 'better-auth-generated-key'",
    );
    expect(result.rows).toEqual([{ id: "better-auth-generated-string-id" }]);
  });

  it("applies every migration and enables row-level security on all business tables", async () => {
    const result = await database.query<{ rls_tables: number; required_functions: number }>(`
      SELECT
        (SELECT count(*)::int FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relrowsecurity) AS rls_tables,
        (SELECT count(DISTINCT function_info.proname)::int FROM pg_proc function_info
          JOIN pg_namespace namespace ON namespace.oid = function_info.pronamespace
          WHERE namespace.nspname = 'public' AND function_info.proname IN (
            'app_consume_delivery_code','app_mark_user_verified','app_find_receiver_candidates',
            'app_notify_organization_members','app_notify_user','app_worker_reserve_outbox_batch',
            'app_worker_defer_outbox','app_worker_mark_outbox_sent','app_worker_mark_outbox_failed',
            'app_guard_user_profile_status',
            'app_notify_platform_roles','app_current_agreement_version'
          )) AS required_functions
    `);
    // Migration 20 adds two forced-RLS tables (partner agreements, recovery intake) and two required
    // functions; both floors rise so removing either fails the suite rather than passing silently.
    expect(result.rows[0]?.rls_tables).toBeGreaterThanOrEqual(25);
    expect(result.rows[0]?.required_functions).toBe(12);
  });

  it("adds recall records as append-only, policy-protected evidence with one open recall per donation", async () => {
    const catalog = await database.query<{
      rls_enabled: boolean;
      policies: number;
      has_delete_policy: boolean;
      unique_open_index: boolean;
      check_constraints: number;
      app_can_insert: boolean;
      app_can_delete: boolean;
    }>(`
      SELECT
        cls.relrowsecurity AS rls_enabled,
        (SELECT count(*)::int FROM pg_policy policy WHERE policy.polrelid = 'public.recall_records'::regclass) AS policies,
        EXISTS (SELECT 1 FROM pg_policy policy
          WHERE policy.polrelid = 'public.recall_records'::regclass AND policy.polcmd = 'd') AS has_delete_policy,
        EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'recall_records_one_open_per_donation'
            AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%status = %') AS unique_open_index,
        (SELECT count(*)::int FROM pg_constraint
          WHERE conrelid = 'public.recall_records'::regclass AND contype = 'c') AS check_constraints,
        has_table_privilege('annapurna_app', 'public.recall_records', 'INSERT') AS app_can_insert,
        has_table_privilege('annapurna_app', 'public.recall_records', 'DELETE') AS app_can_delete
      FROM pg_class cls WHERE cls.oid = 'public.recall_records'::regclass
    `);
    expect(catalog.rows[0]).toMatchObject({
      rls_enabled: true,
      policies: 3,
      has_delete_policy: false,
      unique_open_index: true,
      app_can_insert: true,
      app_can_delete: false,
    });
    expect(catalog.rows[0]?.check_constraints).toBeGreaterThanOrEqual(4);
  });

  it("lets the worker publish a heartbeat but keeps the table out of public reach", async () => {
    const privileges = await database.query<{
      app_select: boolean;
      app_insert: boolean;
      worker_insert: boolean;
      worker_update: boolean;
      public_select: boolean;
    }>(`
      SELECT
        has_table_privilege('annapurna_app', 'public.service_health', 'SELECT') AS app_select,
        has_table_privilege('annapurna_app', 'public.service_health', 'INSERT') AS app_insert,
        has_table_privilege('annapurna_worker', 'public.service_health', 'INSERT') AS worker_insert,
        has_table_privilege('annapurna_worker', 'public.service_health', 'UPDATE') AS worker_update,
        has_table_privilege('public', 'public.service_health', 'SELECT') AS public_select
    `);
    expect(privileges.rows[0]).toMatchObject({
      app_select: true,
      app_insert: false,
      worker_insert: true,
      worker_update: true,
      public_select: false,
    });

    await withRole("annapurna_worker", null, async () => {
      await database.query(
        "INSERT INTO public.service_health (service, status, details) VALUES ('worker', 'ok', '{\"event\":\"started\"}'::jsonb)",
      );
      const row = await database.query<{ service: string; status: string }>(
        "SELECT service, status FROM public.service_health WHERE service = 'worker'",
      );
      expect(row.rows).toEqual([{ service: "worker", status: "ok" }]);
    });
  });

  it("limits an app-role session to its own profile and denies profile privilege escalation", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('alice', 'Alice', 'alice@example.test', true),
        ('bob', 'Bob', 'bob@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status, display_name) VALUES
        ('alice', 'active', 'Alice'),
        ('bob', 'active', 'Bob');
    `);

    await withRole("annapurna_app", "alice", async () => {
      const visible = await database.query<{ user_id: string }>("SELECT user_id FROM public.user_profiles ORDER BY user_id");
      expect(visible.rows.map((row) => row.user_id)).toEqual(["alice"]);
      await database.exec("SAVEPOINT unauthorized_profile_change");
      await expect(database.query("UPDATE public.user_profiles SET account_status = 'active' WHERE user_id = 'bob'")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT unauthorized_profile_change");
      const role = await database.query<{ bypass_rls: boolean }>(`
        SELECT rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user
      `);
      expect(role.rows[0]?.bypass_rls).toBe(false);
    });
  });

  it("keeps registration intake private, immutable to the app role, and prevents self-activation", async () => {
    await database.exec(`
      INSERT INTO public.registration_profiles
        (user_id, requested_role, phone, organization_name, organization_type, address_line, city_or_district, profile_notes)
      VALUES ('alice', 'generator', '+91 00000 00000', 'Fixture Generator', 'generator', '12 Test Street', 'Rourkela', 'Fixture registration profile');
    `);

    await withRole("annapurna_app", "alice", async () => {
      const own = await database.query<{ user_id: string; phone: string }>(
        "SELECT user_id, phone FROM public.registration_profiles",
      );
      expect(own.rows).toEqual([{ user_id: "alice", phone: "+91 00000 00000" }]);

      await database.exec("SAVEPOINT registration_guards");
      await expect(database.query("UPDATE public.registration_profiles SET phone = 'changed' WHERE user_id = 'alice'")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT registration_guards");

      await database.exec("SAVEPOINT profile_status_guards");
      await expect(database.query("UPDATE public.user_profiles SET account_status = 'suspended' WHERE user_id = 'alice'")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT profile_status_guards");

      await database.exec("SAVEPOINT platform_role_guards");
      await expect(database.query("INSERT INTO public.platform_roles (user_id, role, reason) VALUES ('alice','operations_admin','self-escalation attempt')")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT platform_role_guards");

      await database.exec("SAVEPOINT other_profile_guards");
      await expect(database.query("INSERT INTO public.registration_profiles (user_id, requested_role, phone, address_line, city_or_district, profile_notes) VALUES ('bob','helper','+91 11111 11111','13 Test Street','Rourkela','Cross-user attempt')")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT other_profile_guards");
    });

    await withRole("annapurna_app", "bob", async () => {
      const visible = await database.query<{ user_id: string }>("SELECT user_id FROM public.registration_profiles");
      expect(visible.rows).toEqual([]);
    });
  });

  it("requires separate human authorship and Safety Officer approval for policy activation", async () => {
    await database.exec(`
      INSERT INTO public.platform_roles (user_id, role, reason)
        VALUES ('alice', 'safety_officer', 'Test-only reviewer role for migration assertions'),
               ('bob', 'safety_officer', 'Test-only reviewer role for migration assertions');
      INSERT INTO public.policy_versions (version, status, rules, created_by)
        VALUES ('test-policy-1', 'draft', '{"allowedCategories":["produce"]}'::jsonb, 'alice');
    `);

    await withRole("annapurna_app", "alice", async () => {
      await database.query("SELECT set_config('app.domain_transition', 'true', true)");
      await database.exec("SAVEPOINT self_approval");
      await expect(database.query(`
        UPDATE public.policy_versions
        SET status = 'approved', approved_by = 'alice', approved_at = now(), effective_from = now()
        WHERE version = 'test-policy-1'
      `)).rejects.toThrow(/distinct authorised human reviewer/);
      await database.exec("ROLLBACK TO SAVEPOINT self_approval");
    });

    await withRole("annapurna_app", "bob", async () => {
      await database.query("SELECT set_config('app.domain_transition', 'true', true)");
      await database.query(`
        UPDATE public.policy_versions
        SET status = 'approved', approved_by = 'bob', approved_at = now(), effective_from = now()
        WHERE version = 'test-policy-1'
      `);
      const approved = await database.query<{ status: string; created_by: string; approved_by: string }>(
        "SELECT status, created_by, approved_by FROM public.policy_versions WHERE version = 'test-policy-1'",
      );
      expect(approved.rows[0]).toMatchObject({ status: "approved", created_by: "alice", approved_by: "bob" });
    });
  });

  it("exposes only a narrow aggregate impact function to the app runtime", async () => {
    const access = await database.query<{ app_execute: boolean; worker_execute: boolean }>(`
      SELECT
        has_function_privilege('annapurna_app', 'public.app_public_impact()', 'EXECUTE') AS app_execute,
        has_function_privilege('annapurna_worker', 'public.app_public_impact()', 'EXECUTE') AS worker_execute
    `);
    expect(access.rows[0]).toEqual({ app_execute: true, worker_execute: false });

    await withRole("annapurna_app", null, async () => {
      const impact = await database.query<{
        verified_servings: string | number;
        verified_deliveries: string | number;
        verified_organizations: string | number;
        active_helpers: string | number;
        verified_generators: string | number;
      }>("SELECT * FROM public.app_public_impact()");
      const metrics = impact.rows[0];
      expect(metrics).toBeDefined();
      expect(Object.fromEntries(Object.entries(metrics!).map(([key, value]) => [key, Number(value)]))).toEqual({
        verified_servings: 0,
        verified_deliveries: 0,
        verified_organizations: 0,
        active_helpers: 0,
        verified_generators: 0,
      });
    });
  });

  it("aggregates synthetic verified fixture rows without inferring other recorded units", async () => {
    // These deterministic records exist only in the disposable PGlite migration test.
    await database.exec("BEGIN");
    try {
      await database.exec(`
        INSERT INTO public."user" (id, name, email, email_verified) VALUES
          ('impact-generator', 'Fixture generator', 'impact-generator@example.test', true),
          ('impact-receiver', 'Fixture receiver', 'impact-receiver@example.test', true),
          ('impact-helper-active', 'Fixture active Helper', 'impact-helper-active@example.test', true),
          ('impact-helper-pending', 'Fixture pending Helper', 'impact-helper-pending@example.test', true),
          ('impact-reviewer', 'Fixture reviewer', 'impact-reviewer@example.test', true);

        INSERT INTO public.organizations (
          id, name, type, status, operating_address, city_or_district,
          contact_name, contact_email, created_by, reviewed_by, reviewed_at
        ) VALUES
          ('00000000-0000-0000-0000-000000000101', 'Fixture verified Generator', 'generator', 'verified', 'Fixture only', 'Fixture only', 'Test contact', 'impact-generator@example.test', 'impact-generator', 'impact-reviewer', now()),
          ('00000000-0000-0000-0000-000000000102', 'Fixture verified Receiver', 'receiver', 'verified', 'Fixture only', 'Fixture only', 'Test contact', 'impact-receiver@example.test', 'impact-receiver', 'impact-reviewer', now()),
          ('00000000-0000-0000-0000-000000000103', 'Fixture unverified Generator', 'generator', 'draft', 'Fixture only', 'Fixture only', 'Test contact', 'impact-generator@example.test', 'impact-generator', NULL, NULL);

        INSERT INTO public.helper_profiles (user_id, status, training_acknowledged_at, approved_by, approved_at) VALUES
          ('impact-helper-active', 'active', now(), 'impact-reviewer', now()),
          ('impact-helper-pending', 'pending', now(), NULL, NULL);

        INSERT INTO public.donations (
          id, generator_organization_id, receiver_organization_id, created_by,
          name, category, food_type, quantity, unit, prepared_at, best_before_at,
          pickup_earliest_at, pickup_latest_at, storage_instructions, pickup_city, policy_version, status
        ) VALUES
          ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-generator', 'Fixture servings A', 'produce', 'vegetarian', 12.500, 'servings', now() - interval '1 hour', now() + interval '4 hours', now() + interval '15 minutes', now() + interval '45 minutes', 'Fixture only', 'Fixture only', 'fixture-policy', 'delivered'),
          ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-generator', 'Fixture boxes', 'produce', 'vegetarian', 7, 'boxes', now() - interval '1 hour', now() + interval '4 hours', now() + interval '15 minutes', now() + interval '45 minutes', 'Fixture only', 'Fixture only', 'fixture-policy', 'delivered'),
          ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-generator', 'Fixture servings B', 'produce', 'vegetarian', 2.750, 'servings', now() - interval '1 hour', now() + interval '4 hours', now() + interval '15 minutes', now() + interval '45 minutes', 'Fixture only', 'Fixture only', 'fixture-policy', 'delivered');

        INSERT INTO public.donation_offers (id, donation_id, receiver_organization_id, expires_at) VALUES
          ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000102', now() + interval '1 hour'),
          ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', now() + interval '1 hour'),
          ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102', now() + interval '1 hour');

        INSERT INTO public.delivery_jobs (
          id, donation_id, offer_id, generator_organization_id, receiver_organization_id,
          helper_user_id, status, collected_at, delivered_at
        ) VALUES
          ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 'delivered', now() - interval '15 minutes', now()),
          ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 'delivered', now() - interval '15 minutes', now()),
          ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 'delivered', now() - interval '15 minutes', now());
      `);
      await database.query("SELECT set_config('app.user_id', $1, true)", ["impact-helper-active"]);
      await database.exec(`
        INSERT INTO public.delivery_receipts (
          reference, donation_id, delivery_job_id, generator_organization_id,
          receiver_organization_id, helper_user_id, quantity, unit, collected_at, delivered_at
        ) VALUES
          ('fixture-receipt-servings-a', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 12.500, 'servings', now() - interval '15 minutes', now()),
          ('fixture-receipt-boxes', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 7, 'boxes', now() - interval '15 minutes', now()),
          ('fixture-receipt-servings-b', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'impact-helper-active', 2.750, 'servings', now() - interval '15 minutes', now());
      `);
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }

    await withRole("annapurna_app", null, async () => {
      const impact = await database.query<{
        verified_servings: string | number;
        verified_deliveries: string | number;
        verified_organizations: string | number;
        active_helpers: string | number;
        verified_generators: string | number;
      }>("SELECT * FROM public.app_public_impact()");
      const metrics = impact.rows[0];
      expect(metrics).toBeDefined();
      expect(Object.fromEntries(Object.entries(metrics!).map(([key, value]) => [key, Number(value)]))).toEqual({
        verified_servings: 15.25,
        verified_deliveries: 3,
        verified_organizations: 2,
        active_helpers: 1,
        verified_generators: 1,
      });
    });
  });

  it("keeps the worker out of direct outbox access and exposes only its atomic function API", async () => {
    const inserted = await database.query<{ id: string }>(`
      INSERT INTO public.email_outbox (recipient, kind, encrypted_payload, message_id)
      VALUES ('worker@example.test', 'verification', 'v1.a.b.c', '<worker-test@example.test>')
      RETURNING id
    `);
    const outboxId = inserted.rows[0]!.id;

    await withRole("annapurna_worker", null, async () => {
      await database.exec("SAVEPOINT direct_outbox_read");
      await expect(database.query("SELECT id FROM public.email_outbox")).rejects.toThrow();
      await database.exec("ROLLBACK TO SAVEPOINT direct_outbox_read");
      const reserved = await database.query<{ id: string; attempts: number; status?: string }>(
        "SELECT id, attempts FROM public.app_worker_reserve_outbox_batch($1, $2)",
        [8, 20],
      );
      expect(reserved.rows).toHaveLength(1);
      expect(reserved.rows[0]).toMatchObject({ id: outboxId, attempts: 1 });
      const sent = await database.query<{ sent: boolean }>(
        "SELECT public.app_worker_mark_outbox_sent($1::uuid) AS sent",
        [outboxId],
      );
      expect(sent.rows[0]?.sent).toBe(true);
    });

    const access = await database.query<{ can_select: boolean; can_execute: boolean; bypass_rls: boolean }>(`
      SELECT
        has_table_privilege('annapurna_worker', 'public.email_outbox', 'SELECT') AS can_select,
        has_function_privilege('annapurna_worker', 'public.app_worker_reserve_outbox_batch(integer,integer)', 'EXECUTE') AS can_execute,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'annapurna_worker') AS bypass_rls
    `);
    expect(access.rows[0]).toEqual({ can_select: false, can_execute: true, bypass_rls: false });
  });
});

describe("Supabase PostgREST roles", () => {
  it("lose every table and function privilege when the hardening migration runs", async () => {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE supabase_admin NOLOGIN;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        GRANT ALL ON FUNCTIONS TO anon, authenticated;
    `);
    const before = await database.query<{ tables: number; functions: number }>(`
      SELECT
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname IN ('anon', 'authenticated'))) AS tables,
        (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname IN ('anon', 'authenticated'))) AS functions
    `);
    expect(before.rows[0]!.tables).toBeGreaterThan(0);
    expect(before.rows[0]!.functions).toBeGreaterThan(0);

    const hardening = await readFile(
      new URL("../drizzle/20261114120000_revoke_public_api_privileges.sql", import.meta.url),
      "utf8",
    );
    await database.exec(hardening.replaceAll("--> statement-breakpoint", "\n"));

    const after = await database.query<{
      tables: number;
      functions: number;
      defaults: number;
      app_can_read: boolean;
    }>(`
      SELECT
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname IN ('anon', 'authenticated'))) AS tables,
        (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proacl IS NOT NULL
            AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                        WHERE r.rolname IN ('anon', 'authenticated'))) AS functions,
        (SELECT count(*)::int FROM pg_default_acl d
          CROSS JOIN LATERAL aclexplode(d.defaclacl) a
          JOIN pg_roles g ON g.oid = a.grantee
          JOIN pg_namespace n ON n.oid = d.defaclnamespace
          WHERE n.nspname = 'public' AND g.rolname IN ('anon', 'authenticated')) AS defaults,
        has_table_privilege('annapurna_app', 'public.donations', 'SELECT') AS app_can_read
    `);
    expect(after.rows[0]).toEqual({ tables: 0, functions: 0, defaults: 0, app_can_read: true });
  });
});

describe("Helper dispatch and backlog escalation", () => {
  const area = "00000000-0000-0000-0000-000000000301";
  const otherArea = "00000000-0000-0000-0000-000000000302";
  const generator = "00000000-0000-0000-0000-000000000311";
  const receiver = "00000000-0000-0000-0000-000000000312";
  const donation = "00000000-0000-0000-0000-000000000321";
  const offer = "00000000-0000-0000-0000-000000000331";
  const job = "00000000-0000-0000-0000-000000000341";

  beforeAll(async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('dispatch-ops', 'Dispatch operations', 'dispatch-ops@example.test', true),
        ('dispatch-helper', 'Dispatch helper', 'dispatch-helper@example.test', true),
        ('dispatch-helper-other-area', 'Other area helper', 'dispatch-helper-2@example.test', true),
        ('dispatch-helper-suspended', 'Suspended helper', 'dispatch-helper-3@example.test', true),
        ('dispatch-outsider', 'Ordinary member', 'dispatch-outsider@example.test', true);

      INSERT INTO public.user_profiles (user_id, account_status, display_name) VALUES
        ('dispatch-ops', 'active', 'Dispatch operations'),
        ('dispatch-helper', 'active', 'Dispatch helper'),
        ('dispatch-helper-other-area', 'active', 'Other area helper'),
        ('dispatch-helper-suspended', 'active', 'Suspended helper'),
        ('dispatch-outsider', 'active', 'Ordinary member');

      INSERT INTO public.platform_roles (user_id, role, reason) VALUES
        ('dispatch-ops', 'operations_admin', 'Fixture operations administrator');

      INSERT INTO public.service_areas (id, label, country_code, timezone, active) VALUES
        ('${area}', 'Fixture dispatch area', 'IN', 'Asia/Kolkata', true),
        ('${otherArea}', 'Fixture other area', 'IN', 'Asia/Kolkata', true);

      INSERT INTO public.organizations (
        id, name, type, status, service_area_id, operating_address, city_or_district,
        contact_name, contact_email, created_by, reviewed_by, reviewed_at
      ) VALUES
        ('${generator}', 'Fixture dispatch Generator', 'generator', 'verified', '${area}', 'Fixture only', 'Fixture only', 'Test contact', 'dispatch-ops@example.test', 'dispatch-ops', 'dispatch-ops', now()),
        ('${receiver}', 'Fixture dispatch Receiver', 'receiver', 'verified', '${area}', 'Fixture only', 'Fixture only', 'Test contact', 'dispatch-ops@example.test', 'dispatch-ops', 'dispatch-ops', now());

      INSERT INTO public.helper_profiles (user_id, status, service_area_id) VALUES
        ('dispatch-helper', 'active', '${area}'),
        ('dispatch-helper-other-area', 'active', '${otherArea}'),
        ('dispatch-helper-suspended', 'suspended', '${area}');

      INSERT INTO public.donations (
        id, generator_organization_id, receiver_organization_id, service_area_id, created_by,
        name, category, food_type, quantity, unit, prepared_at, best_before_at,
        pickup_earliest_at, pickup_latest_at, storage_instructions, pickup_city, policy_version, status
      ) VALUES (
        '${donation}', '${generator}', '${receiver}', '${area}', 'dispatch-ops',
        'Fixture dispatch meal', 'produce', 'vegetarian', 10, 'servings', now() - interval '1 hour',
        now() + interval '4 hours', now() - interval '10 minutes', now() + interval '40 minutes',
        'Fixture only', 'Fixture only', 'fixture-policy', 'reserved'
      );

      INSERT INTO public.donation_offers (id, donation_id, receiver_organization_id, status, expires_at)
      VALUES ('${offer}', '${donation}', '${receiver}', 'accepted', now() + interval '1 hour');

      INSERT INTO public.delivery_jobs (
        id, donation_id, offer_id, generator_organization_id, receiver_organization_id, status, created_at
      ) VALUES (
        '${job}', '${donation}', '${offer}', '${generator}', '${receiver}', 'open', now() - interval '45 minutes'
      );
    `);
  });

  it("adds the escalation bookkeeping columns without granting them to the app role", async () => {
    const columns = await database.query<{ table_name: string; column_name: string; app_can_update: boolean }>(`
      SELECT table_name, column_name,
        has_column_privilege('annapurna_app', format('public.%I', table_name), column_name, 'UPDATE') AS app_can_update
      FROM information_schema.columns
      WHERE (table_name = 'delivery_jobs' AND column_name = 'escalated_at')
         OR (table_name = 'private_documents' AND column_name = 'expiry_notified_at')
      ORDER BY table_name
    `);
    expect(columns.rows).toHaveLength(2);
    expect(columns.rows.every((row) => row.app_can_update === false)).toBe(true);
  });

  it("grants the new functions to the roles that need them and to nobody else", async () => {
    const grants = await database.query<{
      signature: string;
      app: boolean;
      worker: boolean;
      public_execute: boolean;
    }>(`
      SELECT p.oid::regprocedure::text AS signature,
        has_function_privilege('annapurna_app', p.oid, 'EXECUTE') AS app,
        has_function_privilege('annapurna_worker', p.oid, 'EXECUTE') AS worker,
        EXISTS (SELECT 1 FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
                WHERE r.rolname = 'public' AND a.privilege_type = 'EXECUTE') AS public_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('app_notify_area_helpers', 'app_escalate_delivery_backlog')
      ORDER BY p.proname
    `);
    expect(grants.rows).toHaveLength(2);
    const byName = new Map(grants.rows.map((row) => [row.signature.split("(")[0], row]));
    expect(byName.get("app_escalate_delivery_backlog")).toMatchObject({ app: true, worker: true, public_execute: false });
    expect(byName.get("app_notify_area_helpers")).toMatchObject({ app: true, worker: false, public_execute: false });
  });

  it("notifies only active, approved Helpers in the donation's service area", async () => {
    await withRole("annapurna_app", "dispatch-ops", async () => {
      const result = await database.query<{ count: number }>(
        `SELECT public.app_notify_area_helpers($1::uuid, 'delivery.available', 'A delivery needs a Helper', 'Fixture body', $2) AS count`,
        [donation, `/app/deliveries/${job}`],
      );
      expect(Number(result.rows[0]?.count)).toBe(1);
    });

    const recipients = await database.query<{ user_id: string }>(`
      SELECT user_id FROM public.notifications WHERE kind = 'delivery.available' ORDER BY user_id
    `);
    expect(recipients.rows.map((row) => row.user_id)).toEqual(["dispatch-helper"]);
  });

  it("refuses the Helper fan-out for a caller with no relationship to the donation", async () => {
    await expect(
      withRole("annapurna_app", "dispatch-outsider", async () => {
        await database.query(
          `SELECT public.app_notify_area_helpers($1::uuid, 'delivery.available', 'A delivery needs a Helper', 'Fixture body', $2)`,
          [donation, `/app/deliveries/${job}`],
        );
      }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("escalates an unclaimed job to operations exactly once", async () => {
    const first = await withRole("annapurna_worker", null, async () => {
      const result = await database.query<{ unclaimed_jobs: number; expiring_documents: number }>(
        "SELECT * FROM public.app_escalate_delivery_backlog(30, 14)",
      );
      return result.rows[0]!;
    });
    expect(Number(first.unclaimed_jobs)).toBe(1);
    expect(Number(first.expiring_documents)).toBe(0);

    const escalated = await database.query<{ escalated_at: string | null }>(
      "SELECT escalated_at FROM public.delivery_jobs WHERE id = $1", [job],
    );
    expect(escalated.rows[0]?.escalated_at).not.toBeNull();

    const second = await withRole("annapurna_worker", null, async () => {
      const result = await database.query<{ unclaimed_jobs: number }>(
        "SELECT * FROM public.app_escalate_delivery_backlog(30, 14)",
      );
      return result.rows[0]!;
    });
    expect(Number(second.unclaimed_jobs)).toBe(0);
  });

  it("refuses a signed-in caller who is not an operations or safety human", async () => {
    await expect(
      withRole("annapurna_app", "dispatch-outsider", async () => {
        await database.query("SELECT * FROM public.app_escalate_delivery_backlog(30, 14)");
      }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("keeps the operations release transition narrow", async () => {
    const transitions = await database.query<{ source: string }>(`
      SELECT pg_get_functiondef('public.app_guard_delivery_update()'::regprocedure) AS source
    `);
    const source = transitions.rows[0]?.source ?? "";
    // The only permitted route back to `open` requires a cleared Helper and a
    // platform operations role; ordinary open/assigned/collected paths remain.
    expect(source).toMatch(/NEW\.status::text = 'open'[\s\S]*NEW\.helper_user_id IS NULL[\s\S]*app_has_platform_role/);
  });
});

describe("Second factor storage", () => {
  it("keeps two-factor secrets away from the application role", async () => {
    const privileges = await database.query<{
      app_select: boolean;
      app_insert: boolean;
      auth_select: boolean;
      auth_insert: boolean;
      auth_delete: boolean;
      rls: boolean;
    }>(`
      SELECT
        has_table_privilege('annapurna_app', 'public.two_factor', 'SELECT') AS app_select,
        has_table_privilege('annapurna_app', 'public.two_factor', 'INSERT') AS app_insert,
        has_table_privilege('annapurna_auth', 'public.two_factor', 'SELECT') AS auth_select,
        has_table_privilege('annapurna_auth', 'public.two_factor', 'INSERT') AS auth_insert,
        has_table_privilege('annapurna_auth', 'public.two_factor', 'DELETE') AS auth_delete,
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.two_factor'::regclass) AS rls
    `);
    expect(privileges.rows[0]).toEqual({
      app_select: false,
      app_insert: false,
      auth_select: true,
      auth_insert: true,
      auth_delete: true,
      rls: true,
    });
  });

  it("adds the per-user enrolment flag the sign-in flow reads", async () => {
    const column = await database.query<{ data_type: string; column_default: string; is_nullable: string }>(`
      SELECT data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'two_factor_enabled'
    `);
    expect(column.rows[0]).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
    expect(column.rows[0]?.column_default).toContain("false");
  });

  it("restricts a two-factor row to its owner under row-level security", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('2fa-owner', 'Factor owner', '2fa-owner@example.test', true),
        ('2fa-other', 'Other account', '2fa-other@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('2fa-owner', 'active'), ('2fa-other', 'active');
      INSERT INTO public.two_factor (id, user_id, secret, backup_codes) VALUES
        ('2fa-row', '2fa-owner', 'encrypted-secret', 'hashed-codes');
    `);
    // The app role holds no privilege at all, so even a policy cannot expose it.
    await expect(withRole("annapurna_app", "2fa-other", async () => {
      await database.query("SELECT secret FROM public.two_factor");
    })).rejects.toThrow(/permission denied/i);
  });
});

describe("Transit limits and receiver self-collection", () => {
  it("forces row-level security so the owner is not exempt", async () => {
    const tables = await database.query<{ relname: string; forced: boolean }>(`
      SELECT c.relname, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      ORDER BY c.relname
    `);
    expect(tables.rows.length).toBeGreaterThan(20);
    expect(tables.rows.filter((row) => !row.forced)).toEqual([]);
  });

  it("seeds a gazetteer so a city name is enough to estimate a distance", async () => {
    const places = await database.query<{ count: string; normalized: string }>(`
      SELECT count(*)::text AS count, min(normalized_name) AS normalized FROM public.geo_places
    `);
    expect(Number(places.rows[0]?.count)).toBeGreaterThan(30);
    const match = await database.query<{ latitude: string }>(`
      SELECT latitude FROM public.geo_places WHERE normalized_name = 'cuttack'
    `);
    expect(Number(match.rows[0]?.latitude)).toBeCloseTo(20.46, 1);
  });

  it("defaults every delivery to a Helper and records an unmeasured route honestly", async () => {
    const columns = await database.query<{ column_default: string | null; is_nullable: string }>(`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'delivery_jobs'
        AND column_name IN ('collection_mode', 'transit_distance_km', 'transit_eta_minutes')
      ORDER BY column_name
    `);
    expect(columns.rows[0]?.column_default).toContain("helper_delivery");
    expect(columns.rows[1]?.is_nullable).toBe("YES");
    expect(columns.rows[2]?.is_nullable).toBe("YES");
  });

  it("lets the application write only the transit columns it needs", async () => {
    const privileges = await database.query<{
      mode: boolean; distance: boolean; eta: boolean; exception_reason: boolean;
    }>(`
      SELECT
        has_column_privilege('annapurna_app', 'public.delivery_jobs', 'collection_mode', 'UPDATE') AS mode,
        has_column_privilege('annapurna_app', 'public.delivery_jobs', 'transit_distance_km', 'UPDATE') AS distance,
        has_column_privilege('annapurna_app', 'public.delivery_jobs', 'transit_eta_minutes', 'UPDATE') AS eta,
        has_column_privilege('annapurna_app', 'public.delivery_jobs', 'escalated_at', 'UPDATE') AS exception_reason
    `);
    expect(privileges.rows[0]).toEqual({ mode: true, distance: true, eta: true, exception_reason: false });
  });

  it("treats a receiver collecting its own food as the assigned collector", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('receiver-self', 'Receiver staff', 'receiver-self@example.test', true),
        ('stranger', 'Stranger', 'stranger@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('receiver-self', 'active'), ('stranger', 'active');
      INSERT INTO public.organizations (id, name, type, status, operating_address, city_or_district, contact_name, contact_email, created_by)
      VALUES ('00000000-0000-4000-8000-0000000000a1', 'Self Receiver', 'receiver', 'verified', 'Address', 'Cuttack', 'Contact', 'c@example.test', 'receiver-self');
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES ('00000000-0000-4000-8000-0000000000a1', 'receiver-self', 'operator', 'active');
    `);
    const membership = await withRole("annapurna_app", "receiver-self", async () =>
      database.query<{ member: boolean }>(`
        SELECT public.app_has_org_role('00000000-0000-4000-8000-0000000000a1', ARRAY['owner','manager','operator']) AS member
      `));
    expect(membership.rows[0]?.member).toBe(true);

    // A stranger holds no role there, and without an assignment the predicate stays false for both.
    const stranger = await withRole("annapurna_app", "stranger", async () => database.query<{ member: boolean }>(`
      SELECT public.app_has_org_role('00000000-0000-4000-8000-0000000000a1', ARRAY['owner','manager','operator']) AS member
    `));
    expect(stranger.rows[0]?.member).toBe(false);

    const definition = await database.query<{ prosrc: string }>(`
      SELECT prosrc FROM pg_proc WHERE proname = 'app_is_active_assigned_helper'
    `);
    expect(definition.rows[0]?.prosrc).toContain("receiver_collection");
    expect(definition.rows[0]?.prosrc).toContain("app_has_org_role");
  });

  it("refuses a partial arrival inspection and records a complete one", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('inspect-gen', 'Generator', 'inspect-gen@example.test', true),
        ('inspect-rec', 'Receiver', 'inspect-rec@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('inspect-gen', 'active'), ('inspect-rec', 'active');
      INSERT INTO public.organizations (id, name, type, status, operating_address, city_or_district, contact_name, contact_email, created_by)
      VALUES ('00000000-0000-4000-8000-0000000000b1', 'Inspect Gen', 'generator', 'verified', 'Address', 'Cuttack', 'Contact', 'g@example.test', 'inspect-gen'),
             ('00000000-0000-4000-8000-0000000000b2', 'Inspect Rec', 'receiver', 'verified', 'Address', 'Cuttack', 'Contact', 'r@example.test', 'inspect-rec');
      INSERT INTO public.donations (id, generator_organization_id, pickup_city, created_by, name, category, food_type,
        quantity, unit, prepared_at, best_before_at, pickup_earliest_at, pickup_latest_at, storage_instructions, policy_version)
      VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'Cuttack', 'inspect-gen',
        'Meals', 'cooked', 'vegetarian', 10, 'servings', now() - interval '1 hour', now() + interval '6 hours',
        now() - interval '10 minutes', now() + interval '4 hours', 'Keep hot', '0.1.0');
      INSERT INTO public.donation_offers (id, donation_id, receiver_organization_id, status, expires_at)
      VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b2', 'accepted', now() + interval '1 hour');
      INSERT INTO public.delivery_jobs (id, donation_id, offer_id, generator_organization_id, receiver_organization_id, status, collected_at)
      VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'collected', now() - interval '5 minutes');
      ALTER TABLE public.delivery_jobs DISABLE TRIGGER delivery_arrival_inspection_guard;
      UPDATE public.delivery_jobs SET arrived_at = now() - interval '2 minutes', arrival_reported_by = 'inspect-rec'
        WHERE id = '00000000-0000-4000-8000-0000000000e1';
      ALTER TABLE public.delivery_jobs ENABLE TRIGGER delivery_arrival_inspection_guard;
    `);

    // The trigger is the outer guard: a caller who is not this delivery's receiving organisation is
    // refused before the shape of what they wrote is even considered. That ordering is deliberate -
    // the rejection says "not yours", not "your data looks odd".
    await expect(database.query(
      `UPDATE public.delivery_jobs SET inspection_seal_intact = true WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
    )).rejects.toThrow(/only the receiving organisation may record inspection/);

    // Behind it, the CHECK constraints are what stop a partial or impossible inspection existing at
    // all, even if the trigger were dropped by a future migration. Exercise them directly.
    await database.exec(`ALTER TABLE public.delivery_jobs DISABLE TRIGGER delivery_arrival_inspection_guard;`);

    // One check alone is a fragment of an inspection, not an inspection.
    await expect(database.query(
      `UPDATE public.delivery_jobs SET inspection_seal_intact = true WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
    )).rejects.toThrow(/delivery_inspection_checks_together/);

    await expect(database.query(
      `UPDATE public.delivery_jobs SET inspection_seal_intact = true, inspection_packaging_intact = true,
         inspection_label_matched = true, inspection_within_window = true, inspection_temperature_c = 900
       WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
    )).rejects.toThrow(/delivery_inspection_temperature_range/);

    // A photo fingerprint has to be a fingerprint.
    await expect(database.query(
      `UPDATE public.delivery_jobs SET inspection_photo_sha256 = 'not-a-hash' WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
    )).rejects.toThrow(/delivery_inspection_photo_hash_format/);

    // A real handover: frozen, chilled or hot-holding readings all fit inside the sanity bound.
    await database.query(
      `UPDATE public.delivery_jobs SET inspection_seal_intact = true, inspection_packaging_intact = true,
         inspection_label_matched = true, inspection_within_window = true, inspection_temperature_c = 63.5,
         inspection_photo_sha256 = $1
       WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
      ["a".repeat(64)],
    );
    const stored = await database.query<{ temperature: string; seal: boolean }>(
      `SELECT inspection_temperature_c::text AS temperature, inspection_seal_intact AS seal
       FROM public.delivery_jobs WHERE id = '00000000-0000-4000-8000-0000000000e1'`,
    );
    expect(stored.rows[0]).toEqual({ temperature: "63.50", seal: true });
    await database.exec(`ALTER TABLE public.delivery_jobs ENABLE TRIGGER delivery_arrival_inspection_guard;`);
  });

  it("requires harm to be described and a closure to say what changed", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES ('harm-user', 'Reporter', 'harm@example.test', true);
      INSERT INTO public.donations (id, generator_organization_id, pickup_city, created_by, name, category, food_type,
        quantity, unit, prepared_at, best_before_at, pickup_earliest_at, pickup_latest_at, storage_instructions, policy_version)
      VALUES ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', 'Cuttack', 'harm-user',
        'Meals 2', 'cooked', 'vegetarian', 10, 'servings', now() - interval '1 hour', now() + interval '6 hours',
        now() - interval '10 minutes', now() + interval '4 hours', 'Keep hot', '0.1.0');
    `);
    await expect(database.query(`
      INSERT INTO public.food_safety_incidents (donation_id, reported_by, incident_type, severity, description, harm_reported)
      VALUES ('00000000-0000-4000-8000-0000000000c2', 'harm-user', 'other', 'high', 'Something happened', true)
    `)).rejects.toThrow(/food_safety_incidents_harm_detail_check/);

    await database.exec(`
      INSERT INTO public.food_safety_incidents (id, donation_id, reported_by, incident_type, severity, description, harm_reported, harm_details)
      VALUES ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000c2', 'harm-user', 'other', 'high',
        'Reported by a receiver', true, 'Two people reported stomach pain');
    `);
    // "We looked into it" is not a closure. Something has to be different afterwards.
    await expect(database.query(`
      UPDATE public.food_safety_incidents
      SET status = 'closed', resolution = 'Reviewed and nothing further found', closed_by = 'harm-user', closed_at = now()
      WHERE id = '00000000-0000-4000-8000-0000000000f2'
    `)).rejects.toThrow(/food_safety_incidents_closure_corrective/);

    await database.query(`
      UPDATE public.food_safety_incidents
      SET status = 'closed', resolution = 'Reviewed in full', closed_by = 'harm-user', closed_at = now(),
          corrective_action = 'Cold-holding requirement added to the policy and re-briefed to every kitchen'
      WHERE id = '00000000-0000-4000-8000-0000000000f2'
    `);
  });

  it("keeps insurance declarations paired and agreements immutable", async () => {
    await expect(database.query(
      `UPDATE public.organizations SET insurance_policy_reference = 'POL-1'
       WHERE id = '00000000-0000-4000-8000-0000000000b1'`,
    )).rejects.toThrow(/organizations_insurance_paired/);

    await expect(database.query(
      `UPDATE public.organizations SET insurance_policy_reference = 'POL-1', insurance_expires_on = current_date - 1
       WHERE id = '00000000-0000-4000-8000-0000000000b1'`,
    )).rejects.toThrow(/organizations_insurance_not_backdated/);

    await database.query(
      `UPDATE public.organizations SET insurance_policy_reference = 'POL-1', insurance_expires_on = current_date + 90
       WHERE id = '00000000-0000-4000-8000-0000000000b1'`,
    );

    await database.query(
      `INSERT INTO public.partner_agreement_acceptances (organization_id, version, accepted_by, content_sha256)
       VALUES ('00000000-0000-4000-8000-0000000000b1', '2026-11-15', 'inspect-gen', $1)`,
      ["b".repeat(64)],
    );
    await expect(database.query(
      `INSERT INTO public.partner_agreement_acceptances (organization_id, version, accepted_by, content_sha256)
       VALUES ('00000000-0000-4000-8000-0000000000b1', '2026-11-15', 'inspect-gen', $1)`,
      ["c".repeat(64)],
    )).rejects.toThrow(/partner_agreement_org_version_uq/);

    // An acceptance is evidence: no grant to rewrite it exists for the runtime role.
    const grants = await database.query<{ can_update: boolean; can_delete: boolean }>(`
      SELECT has_table_privilege('annapurna_app', 'public.partner_agreement_acceptances', 'UPDATE') AS can_update,
             has_table_privilege('annapurna_app', 'public.partner_agreement_acceptances', 'DELETE') AS can_delete
    `);
    expect(grants.rows[0]).toEqual({ can_update: false, can_delete: false });
  });

  it("reports partner coverage and the agreement as unmet until partners hold them", async () => {
    const empty = await database.query<Record<string, boolean>>("SELECT * FROM public.app_launch_readiness()");
    // Migration 22 appended two columns. Pinning the exact list means adding a third requires
    // deliberately editing this test, which is the point: a readiness check that grows silently is
    // a readiness check nobody reads.
    expect(Object.keys(empty.rows[0] ?? {}).sort()).toEqual([
      "data_protection_contact", "grievance_window", "insurance", "legal_entity", "on_call",
      "partner_agreement", "partner_insurance", "penetration_test", "subject_rights",
    ]);
    // Verified partners exist in this fixture and at least one has not accepted the agreement, so
    // the gate must not claim coverage it cannot show.
    expect(empty.rows[0]?.partner_agreement).toBe(false);

    const version = await database.query<{ app_current_agreement_version: string }>(
      "SELECT public.app_current_agreement_version()",
    );
    expect(version.rows[0]?.app_current_agreement_version).toBe("2026-11-15");

    // A full agreement + insurance declaration on every verified partner closes those two gates.
    await database.query(`
      UPDATE public.organizations
      SET agreement_version = public.app_current_agreement_version(), agreement_accepted_at = now()
      WHERE status::text = 'verified'
    `);
    const covered = await database.query<{ partner_agreement: boolean; partner_insurance: boolean }>(
      "SELECT partner_agreement, partner_insurance FROM public.app_launch_readiness()",
    );
    expect(covered.rows[0]?.partner_agreement).toBe(true);
    // Insurance is only on one of the verified organisations, so cover is still incomplete.
    expect(covered.rows[0]?.partner_insurance).toBe(false);
  });

  it("lets any signed-in person reach the roles accountable for harm, and nobody else", async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('safety-lead', 'Safety lead', 'safety@example.test', true),
        ('ops-lead', 'Ops lead', 'ops@example.test', true),
        ('outsider', 'Outsider', 'outsider@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('safety-lead', 'active'), ('ops-lead', 'active'), ('outsider', 'active');
      INSERT INTO public.platform_roles (user_id, role, reason) VALUES
        ('safety-lead', 'safety_officer', 'Fixture: named safety officer for an escalation test'),
        ('ops-lead', 'operations_admin', 'Fixture: named operations lead for an escalation test');
    `);

    // Earlier fixtures in this file appoint their own administrators, so the assertion is that every
    // active holder of the named roles received it - counted, not assumed to be exactly two.
    const expected = await database.query<{ recipients: number }>(`
      SELECT count(DISTINCT grant_row.user_id)::int AS recipients
      FROM public.platform_roles grant_row
      JOIN public.user_profiles profile ON profile.user_id = grant_row.user_id
      WHERE grant_row.role::text IN ('operations_admin','safety_officer')
        AND profile.account_status::text = 'active'
    `);
    const delivered = await withRole("annapurna_app", "outsider", async () =>
      database.query<{ delivered: number }>(`
        SELECT public.app_notify_platform_roles(
          ARRAY['operations_admin','safety_officer'], 'safety.harm_reported',
          'Suspected harm to a person reported', 'Incident needs attention', '/admin#incidents'
        ) AS delivered
      `));
    expect(Number(delivered.rows[0]?.delivered)).toBe(Number(expected.rows[0]?.recipients));
    expect(Number(delivered.rows[0]?.delivered)).toBeGreaterThan(0);

    // A role name outside the known set is refused rather than silently ignored.
    await expect(withRole("annapurna_app", "outsider", async () =>
      database.query(`SELECT public.app_notify_platform_roles(ARRAY['superuser'], 'x', 'x', 'x', '/admin')`),
    )).rejects.toThrow(/unknown platform role/);

    // An anonymous caller cannot inject a notification with no account behind it.
    await expect(withRole("annapurna_app", null, async () =>
      database.query(`SELECT public.app_notify_platform_roles(ARRAY['safety_officer'], 'x', 'Title', 'Body', '/admin')`),
    )).rejects.toThrow(/not authorized/);
  });

  it("accepts a locked-out request from nobody, and shows it only to staff", async () => {
    // The intake is unauthenticated by necessity. What protects it is that the insert needs a domain
    // transition, the filer can read nothing back, and the queue is visible only to platform roles.
    const inserted = await withRole("annapurna_app", null, async () => {
      await database.query("SELECT set_config('app.domain_transition', 'true', true)");
      return database.query(`
        INSERT INTO public.account_recovery_requests (reference, email, detail, status)
        VALUES ('AL-REC-2026-FIXTURE01', 'locked-out@example.test', 'Changed email provider and cannot sign in', 'submitted')
      `);
    });
    expect(inserted.rowCount).toBe(1);

    const anonymousRead = await withRole("annapurna_app", "00000000-0000-0000-0000-000000000000", async () =>
      database.query<{ count: number }>("SELECT count(*)::int AS count FROM public.account_recovery_requests"));
    expect(anonymousRead.rows[0]?.count).toBe(0);

    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('recovery-staff', 'Ops', 'recovery-staff@example.test', true),
        ('recovery-plain', 'Plain user', 'recovery-plain@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('recovery-staff', 'active'), ('recovery-plain', 'active');
      INSERT INTO public.platform_roles (user_id, role, reason)
      VALUES ('recovery-staff', 'operations_admin', 'Fixture: queue reader');
    `);

    const staffRead = await withRole("annapurna_app", "recovery-staff", async () =>
      database.query<{ count: number }>("SELECT count(*)::int AS count FROM public.account_recovery_requests"));
    expect(Number(staffRead.rows[0]?.count)).toBeGreaterThan(0);

    const plainRead = await withRole("annapurna_app", "recovery-plain", async () =>
      database.query<{ count: number }>("SELECT count(*)::int AS count FROM public.account_recovery_requests"));
    expect(plainRead.rows[0]?.count).toBe(0);

    // A resolution cannot exist without its author, its time and the status that implies them.
    await expect(database.query(`
      UPDATE public.account_recovery_requests
      SET status = 'resolved', resolution = 'Link issued after an identity check by phone'
      WHERE reference = 'AL-REC-2026-FIXTURE01'
    `)).rejects.toThrow(/account_recovery_resolution_fields_check/);
  });
});

/**
 * Migration 21's controls, exercised as the application role rather than by reading its source.
 * The point of these is the part most likely to be wrong in a way nobody notices: that a legal hold
 * actually stops a deletion, and that the row count in the preview is the count that then happens.
 */
describe("retention controls in the database", () => {
  beforeAll(async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('retention-held', 'Held', 'retention-held@example.test', true),
        ('retention-free', 'Free', 'retention-free@example.test', true),
        ('retention-admin', 'Admin', 'retention-admin@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status) VALUES
        ('retention-held', 'active'), ('retention-free', 'active'), ('retention-admin', 'active');
      INSERT INTO public.notifications (user_id, kind, title, body, created_at) VALUES
        ('retention-held', 'test', 'held old', 'body', now() - interval '400 days'),
        ('retention-free', 'test', 'free old', 'body', now() - interval '400 days'),
        ('retention-free', 'test', 'free new', 'body', now());
    `);
  });

  it("ships exactly one settings row and refuses a second", async () => {
    const rows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.data_retention_settings",
    );
    expect(rows.rows[0]?.count).toBe(1);
    await expect(
      database.query("INSERT INTO public.data_retention_settings (id) VALUES (2)"),
    ).rejects.toThrow(/data_retention_settings_singleton/);
  });

  it("refuses a window outside the audit floor", async () => {
    await expect(
      database.query("UPDATE public.data_retention_settings SET audit_years = 0 WHERE id = 1"),
    ).rejects.toThrow(/data_retention_settings_windows/);
  });

  it("refuses a hold whose declared scope contradicts the column it fills", async () => {
    await expect(database.query(`
      INSERT INTO public.retention_holds (scope_type, user_id, organization_id, reason, placed_by)
      VALUES ('user', 'retention-held', gen_random_uuid(), 'Scope does not match the row', 'retention-admin')
    `)).rejects.toThrow(/retention_holds_scope_matches/);
  });

  it("refuses a release that leaves out who released it or why", async () => {
    await database.query(`
      INSERT INTO public.retention_holds (scope_type, user_id, reason, placed_by)
      VALUES ('user', 'retention-held', 'Litigation hold, counsel reference LX-44', 'retention-admin')
    `);
    await expect(database.query(`
      UPDATE public.retention_holds SET released_at = now() WHERE user_id = 'retention-held'
    `)).rejects.toThrow(/retention_holds_release_complete/);
  });

  it("previews the same counts it then applies, and lets a hold win both times", async () => {
    const preview = await database.query<{ category: string; affected_rows: number; skipped_by_hold: number }>(
      "SELECT category, affected_rows, skipped_by_hold FROM public.app_apply_retention(true)",
    );
    const previewNotifications = preview.rows.find((row) => row.category === "notifications");
    // Two old rows qualify, but one belongs to a held person and is counted as skipped.
    expect(Number(previewNotifications?.affected_rows)).toBe(1);
    expect(Number(previewNotifications?.skipped_by_hold)).toBe(1);

    // The preview must not have deleted anything.
    const before = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.notifications WHERE title LIKE '%old%'",
    );
    expect(before.rows[0]?.count).toBe(2);

    const applied = await database.query<{ category: string; affected_rows: number; skipped_by_hold: number }>(
      "SELECT category, affected_rows, skipped_by_hold FROM public.app_apply_retention(false)",
    );
    const appliedNotifications = applied.rows.find((row) => row.category === "notifications");
    expect(Number(appliedNotifications?.affected_rows)).toBe(1);
    expect(Number(appliedNotifications?.skipped_by_hold)).toBe(1);

    const survivors = await database.query<{ title: string }>(
      "SELECT title FROM public.notifications WHERE title LIKE '%old%' ORDER BY title",
    );
    // The held person's row survives; the unheld person's does not. This is the whole promise.
    expect(survivors.rows.map((row) => row.title)).toEqual(["held old"]);
  });

  it("records what it did, including the rows it deliberately skipped", async () => {
    const log = await database.query<{ category: string; dry_run: boolean; skipped_by_hold: number }>(
      "SELECT category, dry_run, skipped_by_hold FROM public.data_scrub_log ORDER BY executed_at",
    );
    expect(log.rows.some((row) => row.dry_run)).toBe(true);
    expect(log.rows.some((row) => !row.dry_run)).toBe(true);
    expect(log.rows.some((row) => Number(row.skipped_by_hold) > 0)).toBe(true);
  });

  it("keeps audit rows and only scrubs their free text past the window", async () => {
    await database.query(`
      INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
      VALUES ('retention-free', 'test.ancient', 'user', 'retention-free', 'An old note',
              '{"note":"someone private"}'::jsonb, now() - interval '8 years');
    `);
    await database.query("SELECT * FROM public.app_apply_retention(false)");
    const row = await database.query<{ action: string; details: unknown; reason: string | null }>(
      "SELECT action, details, reason FROM public.audit_events WHERE action = 'test.ancient'",
    );
    // The row is still there — the trail survives — but the private note inside it is gone.
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.details).toEqual({});
    expect(row.rows[0]?.reason).toBe("[scrubbed]");
  });

  it("redacts a person without deleting the accountability around them", async () => {
    const result = await database.query<{
      redacted_users: number;
      redacted_accounts: number;
      redacted_notifications: number;
    }>("SELECT * FROM public.app_redact_user('retention-free', 'Erasure request DR-2026-004 fulfilled')");
    expect(Number(result.rows[0]?.redacted_users)).toBe(1);

    const person = await database.query<{ name: string; email: string }>(
      "SELECT name, email FROM public.\"user\" WHERE id = 'retention-free'",
    );
    expect(person.rows[0]?.name).toBe("Redacted account");
    expect(person.rows[0]?.email).toContain("@invalid");

    // The erasure itself is audited: an erasure nobody can see is indistinguishable from data loss.
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.audit_events WHERE action = 'identity.redacted' AND entity_id = 'retention-free'",
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it("refuses a redaction with no reason recorded", async () => {
    await expect(
      database.query("SELECT * FROM public.app_redact_user('retention-held', 'short')"),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it("stops the application role from deleting a hold or rewriting the log", async () => {
    // Seeded as the owner: the application role holds no INSERT on platform_roles, which is the point.
    await database.query(`
      INSERT INTO public.platform_roles (user_id, role, reason)
      VALUES ('retention-admin', 'security_admin', 'Fixture: retention operator')
    `);
    // The log is read-only for the application: there is no DELETE policy and no grant.
    await expect(
      withRole("annapurna_app", "retention-admin", async () =>
        database.query("DELETE FROM public.data_scrub_log"),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
    // A hold is never destroyed; releasing it is the only exit.
    await expect(
      withRole("annapurna_app", "retention-admin", async () =>
        database.query("DELETE FROM public.retention_holds"),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it("gives a person with no platform role no sight of retention state", async () => {
    const result = await withRole("annapurna_app", "retention-free", async () =>
      database.query<{ count: number }>("SELECT count(*)::int AS count FROM public.data_retention_settings"),
    );
    expect(result.rows[0]?.count).toBe(0);
  });
});

/**
 * The append-only guarantee is the one control a retention feature is most likely to weaken by
 * accident. These tests exist to make sure it stayed a guarantee: a scrub may remove information
 * and nothing else, and an audit row can never be deleted or rewritten.
 */
describe("the audit trail stays append-only after migration 21", () => {
  const rewrite = (sqlText: string) =>
    database.transaction(async (tx) => {
      await tx.exec("SELECT set_config('app.retention_scrub', 'true', true)");
      await tx.exec(sqlText);
    });

  it("refuses an update that does not declare itself a retention scrub", async () => {
    await expect(
      database.query("UPDATE public.audit_events SET details = '{\"x\":1}'::jsonb"),
    ).rejects.toThrow(/append-only records cannot be changed or deleted/);
  });

  it("refuses a content rewrite even when the scrub flag is set", async () => {
    await expect(
      rewrite("UPDATE public.audit_events SET details = '{\"secret\":\"rewritten\"}'::jsonb"),
    ).rejects.toThrow(/may only empty audit details/);
  });

  it("refuses to change who did what, even inside a scrub", async () => {
    await expect(
      rewrite("UPDATE public.audit_events SET action = 'something.else' WHERE action = 'identity.redacted'"),
    ).rejects.toThrow(/append-only|may not alter/);
  });

  it("refuses a delete even when the scrub flag is set", async () => {
    await expect(
      rewrite("DELETE FROM public.audit_events"),
    ).rejects.toThrow(/append-only records cannot be changed or deleted/);
  });

  it("still allows the one narrowing change the retention window needs", async () => {
    await rewrite("UPDATE public.audit_events SET details = '{}'::jsonb, reason = '[scrubbed]'");
    const result = await database.query<{ details: unknown }>(
      "SELECT details FROM public.audit_events WHERE action = 'identity.redacted'",
    );
    expect(result.rows[0]?.details).toEqual({});
  });
});

/**
 * Migration 22: the three promises that were previously prose.
 *
 * Each test here corresponds to a sentence that used to be a claim and is now a constraint. The
 * erasure test is the important one: before migration 22 an operator could mark an erasure request
 * `completed` having done nothing at all, and the person would be told their data was erased.
 */
describe("privacy subject rights", () => {
  const person = "subject-rights-person";
  const operator = "subject-rights-operator";

  beforeAll(async () => {
    await database.exec(`
      INSERT INTO public."user" (id, name, email, email_verified) VALUES
        ('subject-rights-person', 'Meera Nair', 'meera.nair@example.test', true),
        ('subject-rights-operator', 'Ops Lead', 'privacy-ops@example.test', true);
      INSERT INTO public.user_profiles (user_id, account_status, display_name) VALUES
        ('subject-rights-person', 'active', 'Meera'),
        ('subject-rights-operator', 'active', 'Ops');
      INSERT INTO public.platform_roles (user_id, role, reason) VALUES
        ('subject-rights-operator', 'security_admin', 'Fixture: privacy operator');
      INSERT INTO public.notifications (user_id, kind, title, body) VALUES
        ('subject-rights-person', 'test', 'A notification', 'with a body');
      INSERT INTO public.data_requests (user_id, request_type, description, status) VALUES
        ('subject-rights-person', 'erasure', 'Please erase my account', 'submitted');
    `);
  });

  it("refuses to mark an erasure complete without a redaction behind it", async () => {
    await expect(database.query(
      "UPDATE public.data_requests SET status = 'completed', completed_at = now() WHERE user_id = $1 AND request_type = 'erasure'",
      [person],
    )).rejects.toThrow(/data_requests_erasure_requires_redaction/);
  });

  it("allows every other request type to complete without a redaction", async () => {
    await database.query(`
      INSERT INTO public.data_requests (user_id, request_type, description, status, completed_at)
      VALUES ($1, 'access', 'Send me my data', 'completed', now())
    `, [person]);
    const rows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.data_requests WHERE user_id = $1 AND request_type = 'access'",
      [person],
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it("produces an export that contains the person's own rows and nothing else", async () => {
    const result = await database.query<{ document: Record<string, unknown> }>(
      "SELECT public.app_export_person($1) AS document", [person],
    );
    const document = result.rows[0]?.document as Record<string, unknown> & {
      account: { email: string };
      notifications: unknown[];
      privacyRequests: unknown[];
      about: { whatThisIsNot: string };
    };
    expect(document.account.email).toBe("meera.nair@example.test");
    expect(document.notifications).toHaveLength(1);
    // The erasure request and the completed access request are both in the person's own record.
    expect(document.privacyRequests.length).toBeGreaterThanOrEqual(2);
    // The document says what it is not, rather than implying it is the whole truth.
    expect(document.about.whatThisIsNot).toMatch(/free text/);
  });

  it("records the export as a disclosure, because an export is one", async () => {
    const rows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.audit_events WHERE action = 'privacy.export_generated' AND entity_id = $1",
      [person],
    );
    expect(Number(rows.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it("refuses to export an account that does not exist instead of returning an empty document", async () => {
    await expect(database.query("SELECT public.app_export_person('no-such-person')"))
      .rejects.toThrow(/no account exists/);
  });

  it("lets a person correct their own display name but nothing that belongs to somebody else", async () => {
    await database.query("UPDATE public.user_profiles SET display_name = 'Meera N.' WHERE user_id = $1", [person]);
    await database.query("SELECT public.app_record_profile_correction($1, 'display_name')", [person]);

    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.audit_events WHERE action = 'privacy.self_correction' AND entity_id = $1",
      [person],
    );
    expect(Number(audit.rows[0]?.count)).toBe(1);

    // The audited list is an allow-list of one, enforced in the function.
    await expect(database.query("SELECT public.app_record_profile_correction($1, 'account_status')", [person]))
      .rejects.toThrow(/not self-service correctable/);
  });

  it("gives the application role no way to change an account status through the profile grant", async () => {
    const grants = await database.query<{ can_update_status: boolean; can_update_name: boolean }>(`
      SELECT has_column_privilege('annapurna_app', 'public.user_profiles', 'account_status', 'UPDATE') AS can_update_status,
             has_column_privilege('annapurna_app', 'public.user_profiles', 'display_name', 'UPDATE') AS can_update_name
    `);
    expect(grants.rows[0]).toEqual({ can_update_status: false, can_update_name: true });
  });

  it("measures how long a complaint has waited, and calls it overdue past the window", async () => {
    await database.query("UPDATE public.data_requests SET created_at = now() - interval '10 days' WHERE user_id = $1", [person]);
    const result = await database.query<{ open_requests: number; overdue_requests: number; oldest_overdue_hours: number }>(
      "SELECT * FROM public.app_overdue_privacy_requests(72)",
    );
    expect(Number(result.rows[0]?.overdue_requests)).toBeGreaterThanOrEqual(1);
    expect(Number(result.rows[0]?.oldest_overdue_hours)).toBeGreaterThan(200);
  });

  it("treats an unrecorded window as unmade rather than assuming a default", async () => {
    const window = await database.query<{ hours: number | null }>(
      "SELECT public.app_privacy_response_window_hours() AS hours",
    );
    expect(window.rows[0]?.hours).toBeNull();

    const readiness = await database.query<{ grievance_window: boolean; subject_rights: boolean }>(
      "SELECT grievance_window, subject_rights FROM public.app_launch_readiness()",
    );
    // No window recorded, so the grievance gate cannot be met — whatever the request queue looks like.
    expect(readiness.rows[0]?.grievance_window).toBe(false);
    // The subject-rights machinery is present from the schema alone.
    expect(readiness.rows[0]?.subject_rights).toBe(true);
  });

  it("goes green once a window is recorded and nothing has waited past it", async () => {
    await database.query(`
      INSERT INTO public.platform_attestations (key, label, value, recorded_by, evidence_reference)
      VALUES ('support_response_window', 'Privacy response window', '{"hours": 720}'::jsonb, $1, 'Two operators, not a service level')
    `, [operator]);
    const readiness = await database.query<{ grievance_window: boolean }>(
      "SELECT grievance_window FROM public.app_launch_readiness()",
    );
    // A 720-hour window comfortably covers the 10-day-old fixture.
    expect(readiness.rows[0]?.grievance_window).toBe(true);

    // Tighten the window below the age of the open request and the gate reopens by itself.
    await database.query(`
      UPDATE public.platform_attestations SET value = '{"hours": 1}'::jsonb WHERE key = 'support_response_window'
    `);
    const reopened = await database.query<{ grievance_window: boolean }>(
      "SELECT grievance_window FROM public.app_launch_readiness()",
    );
    expect(reopened.rows[0]?.grievance_window).toBe(false);
  });

  it("performs the redaction when the erasure is finally completed properly", async () => {
    const redacted = await database.query<{ redacted_users: number; redacted_notifications: number }>(
      "SELECT * FROM public.app_redact_user($1, 'Erasure request DR-2026-011, identity verified by phone')",
      [person],
    );
    expect(Number(redacted.rows[0]?.redacted_users)).toBe(1);

    // Only now can the request move to completed, and it carries the redaction it performed.
    await database.query(`
      UPDATE public.data_requests
      SET status = 'completed', completed_at = now(), redacted_at = now(), redacted_by = $2,
          redaction_detail = '{"redactedUsers": 1}'::jsonb,
          resolution = 'Erasure request DR-2026-011 fulfilled after an identity check.'
      WHERE user_id = $1 AND request_type = 'erasure'
    `, [person, operator]);

    const request = await database.query<{ status: string; redacted_at: string | null }>(
      "SELECT status, redacted_at FROM public.data_requests WHERE user_id = $1 AND request_type = 'erasure'",
      [person],
    );
    expect(request.rows[0]?.status).toBe("completed");
    expect(request.rows[0]?.redacted_at).not.toBeNull();

    const account = await database.query<{ name: string; email: string }>(
      "SELECT name, email FROM public.\"user\" WHERE id = $1", [person],
    );
    expect(account.rows[0]?.name).toBe("Redacted account");
    expect(account.rows[0]?.email).toContain("@invalid");
  });
});
