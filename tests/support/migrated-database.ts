import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/**
 * A real PostgreSQL with every migration applied, for tests that need the database to say no.
 *
 * The order comes from the migration journal, not from a list kept beside each test: a list in a test
 * file is a list somebody forgets to extend, and then the test passes against a schema that is not the
 * one being shipped.
 */
export async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE annapurna_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE annapurna_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE annapurna_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
    CREATE SCHEMA graphile_worker AUTHORIZATION annapurna_worker;
    GRANT USAGE ON SCHEMA public TO annapurna_app, annapurna_auth, annapurna_worker;
  `);
  const journal = JSON.parse(
    await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const migration = await readFile(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
    await database.exec(migration.replaceAll("--> statement-breakpoint", "\n"));
  }
  return database;
}

export type DatabaseRole = "annapurna_app" | "annapurna_worker" | "annapurna_auth";

/**
 * Run `callback` in one transaction as a runtime role, optionally with a session user.
 *
 * `userId: null` is the interesting case: the role with nothing saying who is asking, which is what a
 * request handler that forgets its context looks like to the database.
 */
export async function asRole<T>(
  database: PGlite,
  role: DatabaseRole,
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

/**
 * The connection a sender holds: every statement runs as the worker role, each in its own transaction.
 *
 * That it is the worker *role* matters. A superuser would be allowed to call anything, and a test that
 * passes as a superuser says nothing about whether the grants are right.
 */
export function workerPool(database: PGlite): Pick<Pool, "query"> {
  return {
    query: (async (text: string, params?: unknown[]) => {
      await database.exec("SET ROLE annapurna_worker");
      try {
        const result = await database.query(text, params);
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      } finally {
        await database.exec("RESET ROLE");
      }
    }) as Pool["query"],
  };
}
