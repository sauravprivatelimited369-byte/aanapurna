import { NextResponse } from "next/server";
import { Pool } from "pg";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "@/lib/database-config";
import { verifyGithubOidcToken, fetchGithubJwks } from "@/worker/github-oidc";
import { drainEmailOutboxOnce } from "@/worker/outbox-drain";
import { runEscalationSweep, runReadinessSweep } from "@/worker/escalation";
import { drainPushOnce, type PushDrainResult } from "@/worker/push-drain";
import { SCHEDULED_DRAIN_KEY, tryRecordDeliverySighting } from "@/worker/heartbeat";
import { requestInlineDelivery } from "@/worker/inline-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// This route's own work - a batch of mail, two sweeps, a bounded push pass - and then the pass it asks
// for once it has answered, which may take twenty seconds more and counts towards the same limit.
export const maxDuration = 60;

/**
 * Runs one batch of the email outbox drain, the escalation sweeps and one pass of
 * device notifications, for schedulers that cannot host a long-lived process (this
 * Vercel deployment cannot run the Graphile Worker).
 *
 * This is the recovery path, not the delivery path. The schedule that calls it has
 * been observed to fire hours apart, so anything a person is waiting for is sent
 * straight after the request that queued it (see `@/worker/inline-delivery`). What
 * this route adds is a second chance for whatever that missed, and the only sender
 * for the notifications the sweeps below write, which no web request triggers.
 *
 * Authorization is deliberately credential-free: the caller must present a
 * GitHub Actions OIDC token proving it is this repository's `worker-drain`
 * workflow on an allowed ref. Alternatively an operator can set
 * `WORKER_TRIGGER_TOKEN` and send it as a bearer token, which is useful for
 * other schedulers.
 *
 * The route never returns email content, recipients, SMTP details, device endpoints
 * or notification text: counts only.
 */

const ALLOWED_REPOSITORY = "sauravprivatelimited369-byte/aanapurna";
const ALLOWED_REFS = ["refs/heads/main"];
const ALLOWED_WORKFLOW = `${ALLOWED_REPOSITORY}/.github/workflows/worker-drain.yml@refs/heads/main`;
const ALLOWED_EVENTS = ["schedule", "workflow_dispatch"];
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
      workflowRef: ALLOWED_WORKFLOW,
      eventNames: ALLOWED_EVENTS,
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
    // This deployment cannot host the long-lived worker, so the same scheduled
    // invocation also runs the backlog sweep. An escalation failure must not
    // make the mail drain look failed: it is reported separately.
    let escalation: { status: "ok"; unclaimedJobs: number; expiringDocuments: number } | { status: "error" };
    try {
      const sweep = await runEscalationSweep(pool);
      escalation = { status: "ok", ...sweep };
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "worker.escalation_failed",
        message: error instanceof Error ? error.message : "unknown",
      }));
      escalation = { status: "error" };
    }
    // Whole-register readiness: lapsing declarations and a rota with nobody on it. Reported
    // separately for the same reason.
    let readiness: { status: "ok"; expiringDeclarations: number; coverageGaps: number } | { status: "error" };
    try {
      readiness = { status: "ok", ...(await runReadinessSweep(pool)) };
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "worker.readiness_sweep_failed",
        message: error instanceof Error ? error.message : "unknown",
      }));
      readiness = { status: "error" };
    }
    // Last, because the two sweeps above are what write the notifications nobody else will send:
    // an unclaimed delivery or a lapsing declaration is exactly what somebody should be told about
    // on the device in their pocket. Bounded so a stalled push service cannot run out the clock:
    // the worst case for one device is a timeout, a pause and one more timeout, started no later
    // than the budget - seventeen seconds of this route's sixty.
    let push: ({ status: "ok" } & PushDrainResult) | { status: "error" };
    try {
      push = { status: "ok", ...(await drainPushOnce(pool, { budgetMs: 6_000, requestTimeoutMs: 5_000, retryDelayMs: 1_000 })) };
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "worker.push_drain_failed",
        message: error instanceof Error ? error.message : "unknown",
      }));
      push = { status: "error" };
    }
    // When a scheduler last got here, for `/api/health`. The schedule has been seen to fire hours
    // apart, and nothing a person could look at said so.
    await tryRecordDeliverySighting(pool, SCHEDULED_DRAIN_KEY, {
      mailSent: result.sent,
      mailFailed: result.failed,
      pushDelivered: push.status === "ok" ? push.delivered : null,
      pushFailed: push.status === "ok" ? push.failed : null,
    });
    // And once this has answered, one more pass, the way every other request does it. It takes up
    // whatever the bounded passes above left behind, and it is the standing check that this host
    // still runs work after a response - which is what delivery rests on between two calls here.
    requestInlineDelivery();
    return json({
      status: result.delivered ? "ok" : "deferred",
      schedule: "one-batch",
      via: authorization.via,
      ...result,
      escalation,
      readiness,
      push,
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
