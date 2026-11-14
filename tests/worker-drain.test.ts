import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { drainEmailOutboxOnce } from "@/worker/outbox-drain";

/**
 * The drain is shared by the long-lived worker and the scheduled
 * `/api/worker/drain` route. These tests pin its behaviour against the real
 * migrations: queued rows must survive an unconfigured SMTP deployment instead
 * of being consumed or marked failed.
 */

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
];

let database: PGlite;
/** The drain only calls `query`, which PGlite implements with the same signature. */
const pool = () => database as unknown as Pool;

const savedEnvironment = {
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_URL: process.env.SMTP_URL,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
};

function clearSmtpSettings() {
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_URL;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
}

beforeAll(async () => {
  clearSmtpSettings();
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
  for (const file of migrationFiles) {
    if (file === "20261112103924_better_auth_rate_limit_id.sql") {
      await database.exec("INSERT INTO public.rate_limit (key, count, last_request) VALUES ('migration-preserve', 2, 123456789)");
    }
    const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await database.exec(migration.replaceAll("--> statement-breakpoint", "\n"));
  }
  await database.exec(`
    INSERT INTO public.email_outbox (id, recipient, kind, encrypted_payload, message_id, status, attempts, available_at)
    VALUES (
      '11111111-1111-4111-8111-111111111111',
      'drain-test@example.invalid',
      'verification',
      'not-a-real-ciphertext',
      '<drain-test@annapurna-link.local>',
      'pending',
      0,
      clock_timestamp() - interval '1 hour'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database?.close();
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("email outbox drain", () => {
  it("defers queued rows instead of delivering or failing when SMTP is not configured", async () => {
    const result = await drainEmailOutboxOnce(pool());
    expect(result).toEqual({ delivered: false, reserved: 0, sent: 0, failed: 0 });

    const row = await database.query<{ status: string; attempts: number; last_error: string | null; available_in_future: boolean }>(`
      SELECT status, attempts, last_error, available_at > clock_timestamp() AS available_in_future
      FROM public.email_outbox WHERE id = '11111111-1111-4111-8111-111111111111'
    `);
    expect(row.rows[0]).toEqual({
      status: "pending",
      attempts: 0,
      last_error: "SMTP_NOT_CONFIGURED",
      available_in_future: true,
    });
  });

  it("is idempotent: repeated drains leave the deferred row queued once", async () => {
    await drainEmailOutboxOnce(pool());
    await drainEmailOutboxOnce(pool());
    const rows = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM public.email_outbox
      WHERE id = '11111111-1111-4111-8111-111111111111' AND status = 'pending'
    `);
    expect(rows.rows[0]?.count).toBe(1);
  });
});
