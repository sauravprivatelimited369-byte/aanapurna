export type DatabaseUrlName =
  | "DATABASE_URL"
  | "AUTH_DATABASE_URL"
  | "WORKER_DATABASE_URL"
  | "MIGRATION_DATABASE_URL";

/**
 * Optionally rewrite a Supabase direct (IPv6-only) PostgreSQL URL to the shared
 * session pooler (IPv4). This is needed on Vercel build/runtime networks that
 * have no IPv6 route. The rewrite uses non-secret host/project settings only;
 * passwords stay in the original encrypted environment variables and are never
 * logged. Set DATABASE_URL_REWRITE_TO_POOLER=true with SUPABASE_POOLER_HOST and
 * SUPABASE_PROJECT_REF to enable it.
 */
export function databaseUrl(name: DatabaseUrlName): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (process.env.DATABASE_URL_REWRITE_TO_POOLER !== "true") return raw;

  const host = process.env.SUPABASE_POOLER_HOST;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!host || !projectRef) {
    throw new Error("SUPABASE_POOLER_HOST and SUPABASE_PROJECT_REF are required when DATABASE_URL_REWRITE_TO_POOLER=true.");
  }
  const port = process.env.DATABASE_POOLER_PORT ?? "5432";
  if (!/^\d+$/.test(port)) throw new Error("DATABASE_POOLER_PORT must be a numeric port.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid PostgreSQL URL.`);
  }
  const role = decodeURIComponent(url.username);
  if (!role || role.includes(".") || url.hostname === host) return raw;
  url.hostname = host;
  url.port = port;
  url.username = `${role}.${projectRef}`;
  return url.toString();
}

export function databaseConnectionTimeoutMillis(): number {
  const raw = process.env.DATABASE_CONNECT_TIMEOUT_MS;
  const value = raw ? Number(raw) : 30_000;
  return Number.isFinite(value) && value >= 1_000 ? value : 30_000;
}
