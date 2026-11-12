import { runMigrations } from "graphile-worker";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/db/schema";

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  const workerConnectionString = process.env.WORKER_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required; never run production migrations with the app runtime role.");
  if (!workerConnectionString) throw new Error("WORKER_DATABASE_URL is required to install worker migrations using its least-privilege role.");

  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    application_name: "annapurna-link-migrator",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  let temporaryWorkerCreateGrant = false;
  let databaseIdentifier: string | null = null;

  try {
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
    await runMigrations({ connectionString: workerConnectionString, schema: "graphile_worker" });
    console.info(JSON.stringify({ level: "info", event: "database.migrations_applied", workerSchema: "graphile_worker" }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "database.migration_failed", message: error instanceof Error ? error.message : "unknown" }));
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
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "database.migration_failed", message: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
