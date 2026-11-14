import { runMigrations } from "graphile-worker";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/db/schema";
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
  const connectionString = databaseUrl("MIGRATION_DATABASE_URL");
  const workerConnectionString = databaseUrl("WORKER_DATABASE_URL");
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required; never run production migrations with the app runtime role.");
  if (!workerConnectionString) throw new Error("WORKER_DATABASE_URL is required to install worker migrations using its least-privilege role.");

  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    application_name: "annapurna-link-migrator",
    ssl: databaseSslOptions(connectionString),
  });
  const workerPool = new Pool({
    connectionString: workerConnectionString,
    max: 2,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    application_name: "annapurna-link-worker-migrator",
    ssl: databaseSslOptions(workerConnectionString),
  });
  let temporaryWorkerCreateGrant = false;
  let databaseIdentifier: string | null = null;

  try {
    const identity = await pool.query<{ current_user: string; can_create: boolean; database: string }>(
      "SELECT current_user, has_database_privilege(current_user, current_database(), 'CREATE') AS can_create, current_database() AS database",
    );
    console.info(JSON.stringify({
      level: "info",
      event: "database.migration_identity",
      databaseRole: identity.rows[0]?.current_user,
      canCreateSchema: identity.rows[0]?.can_create,
      database: identity.rows[0]?.database,
      connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    }));
    const migrationDb = drizzle(pool, { schema });
    await migrate(migrationDb, { migrationsFolder: "./drizzle" });

    const permission = await pool.query<{ can_create: boolean }>(
      "SELECT has_database_privilege('annapurna_worker', current_database(), 'CREATE') AS can_create",
    );
    if (!permission.rows[0]?.can_create) {
      const database = await pool.query<{ database_identifier: string }>(
        "SELECT quote_ident(current_database()) AS database_identifier",
      );
      databaseIdentifier = database.rows[0]!.database_identifier;
      await pool.query(`GRANT CREATE ON DATABASE ${databaseIdentifier} TO annapurna_worker`);
      temporaryWorkerCreateGrant = true;
    }

    // Graphile Worker normally migrates as the runtime role. Run its DDL here,
    // before app startup, so the worker never needs lasting database CREATE rights.
    await runMigrations({ pgPool: workerPool, schema: "graphile_worker" });
    console.info(JSON.stringify({ level: "info", event: "database.migrations_applied", workerSchema: "graphile_worker" }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "database.migration_failed", message: describeError(error) }));
    process.exitCode = 1;
  } finally {
    if (temporaryWorkerCreateGrant && databaseIdentifier) {
      try {
        await pool.query(`REVOKE CREATE ON DATABASE ${databaseIdentifier} FROM annapurna_worker`);
      } catch (error) {
        console.error(JSON.stringify({ level: "error", event: "worker.database_create_revoke_failed", message: error instanceof Error ? error.message : "unknown" }));
        process.exitCode = 1;
      }
    }
    await workerPool.end();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "database.migration_failed", message: describeError(error) }));
  process.exitCode = 1;
});
