import { NextResponse } from "next/server";
import { Pool } from "pg";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "@/lib/database-config";
import { verifyGithubOidcToken, fetchGithubJwks } from "@/worker/github-oidc";
import { drainEmailOutboxOnce } from "@/worker/outbox-drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Runs one batch of the email outbox drain, for schedulers that cannot host a
 * long-lived process (this Vercel deployment cannot run the Graphile Worker).
 *
 * Authorization is deliberately credential-free: the caller must present a
 * GitHub Actions OIDC token proving it is this repository's `worker-drain`
 * workflow on an allowed ref. Alternatively an operator can set
 * `WORKER_TRIGGER_TOKEN` and send it as a bearer token, which is useful for
 * other schedulers.
 *
 * The route never returns email content, recipients or SMTP details.
 */

const ALLOWED_REPOSITORY = "sauravprivatelimited369-byte/aanapurna";
const ALLOWED_REFS = ["refs/heads/main", "refs/heads/arena/5b937561-aanapurna"];
const AUDIENCE = "annapurna-link-worker";

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

async function authorize(request: Request): Promise<{ ok: true; via: string } | { ok: false; status: number; reason: string }> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, reason: "missing-bearer-token" };

  const operatorToken = process.env.WORKER_TRIGGER_TOKEN;
  if (operatorToken && operatorToken.length >= 32) {
    const { timingSafeEqual, createHash } = await import("node:crypto");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (timingSafeEqual(digest(token), digest(operatorToken))) return { ok: true, via: "operator-token" };
  }

  // GitHub OIDC tokens are long JWTs; only attempt verification for those.
  if (token.split(".").length === 3) {
    let keys;
    try {
      keys = await fetchGithubJwks();
    } catch {
      return { ok: false, status: 503, reason: "signing-keys-unavailable" };
    }
    const result = verifyGithubOidcToken(token, {
      repository: ALLOWED_REPOSITORY,
      refs: ALLOWED_REFS,
      audience: AUDIENCE,
      keys,
    });
    if (result.ok) return { ok: true, via: "github-oidc" };
    return { ok: false, status: 401, reason: result.reason };
  }

  return { ok: false, status: 401, reason: "invalid-bearer-token" };
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.ok) {
    return json({ status: "unauthorized", reason: authorization.reason }, authorization.status);
  }

  const url = databaseUrl("WORKER_DATABASE_URL");
  if (!url) return json({ status: "unavailable", reason: "worker-database-not-configured" }, 503);

  const pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    idleTimeoutMillis: 10_000,
    application_name: "annapurna-link-drain-route",
    ssl: databaseSslOptions(url),
  });
  try {
    const result = await drainEmailOutboxOnce(pool);
    return json({
      status: result.delivered ? "ok" : "deferred",
      schedule: "one-batch",
      via: authorization.via,
      ...result,
    }, 200);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "worker.drain_failed",
      message: error instanceof Error ? error.message : "unknown",
    }));
    return json({ status: "error", reason: "drain-failed" }, 500);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export function GET() {
  return json({ status: "method-not-allowed" }, 405);
}
