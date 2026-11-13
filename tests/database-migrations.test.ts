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

async function withRole(role: "annapurna_app" | "annapurna_worker", userId: string | null, callback: () => Promise<void>) {
  await database.exec(`SET ROLE ${role}`);
  await database.exec("BEGIN");
  if (userId !== null) await database.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  try {
    await callback();
    await database.exec("COMMIT");
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
            'app_guard_user_profile_status'
          )) AS required_functions
    `);
    expect(result.rows[0]?.rls_tables).toBeGreaterThanOrEqual(23);
    expect(result.rows[0]?.required_functions).toBe(10);
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
