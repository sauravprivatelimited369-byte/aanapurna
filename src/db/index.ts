import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { NodePgTransaction } from "drizzle-orm/node-postgres";
import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { databaseConnectionTimeoutMillis, databaseUrl } from "@/lib/database-config";

const connectionString = databaseUrl("DATABASE_URL");
const authConnectionString = databaseUrl("AUTH_DATABASE_URL") ?? connectionString;
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !connectionString) throw new Error("DATABASE_URL is required in production.");
if (isProduction && !process.env.AUTH_DATABASE_URL) throw new Error("AUTH_DATABASE_URL must use a separate least-privilege database role in production.");

const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined;
const poolMax = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) throw new Error("DB_POOL_MAX must be an integer between 1 and 50.");

export const pool = new Pool({
  connectionString,
  max: poolMax,
  connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
  idleTimeoutMillis: 30_000,
  application_name: "annapurna-link-web",
  ssl,
});

export const authPool = new Pool({
  connectionString: authConnectionString,
  max: Number(process.env.AUTH_DB_POOL_MAX ?? 5),
  connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
  idleTimeoutMillis: 30_000,
  application_name: "annapurna-link-auth",
  ssl,
});

export const db = drizzle(pool, { schema });
export const authDb = drizzle(authPool, { schema });
export type AppTransaction = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** Set transaction-local identity before any tenant-sensitive query. Pooled connections are reset at commit. */
export async function withUserContext<T>(
  userId: string,
  callback: (tx: AppTransaction) => Promise<T>,
  options: { domainTransition?: boolean } = {},
): Promise<T> {
  if (!userId) throw new Error("A verified user context is required.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    if (options.domainTransition) await tx.execute(sql`select set_config('app.domain_transition', 'true', true)`);
    return callback(tx);
  });
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await pool.query("select 1");
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}
