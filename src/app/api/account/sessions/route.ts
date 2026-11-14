import { auth } from "@/lib/auth";
import { recordAccountSecurityEvent } from "@/domain/service";
import { sessionRevocationSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionRecord = {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Session tokens are bearer credentials. They are read here so the browser can
 * revoke a session by id, and they never leave this process: the response carries
 * an id, coarse device/network hints and timestamps only.
 */
function coarseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  return value.includes(":") ? "IPv6 address" : null;
}

function deviceSummary(value: string | null | undefined): string {
  if (!value) return "Unknown device";
  const browser = /firefox/i.test(value) ? "Firefox"
    : /edg/i.test(value) ? "Edge"
    : /chrome|chromium/i.test(value) ? "Chrome"
    : /safari/i.test(value) ? "Safari"
    : "Browser";
  const platform = /android/i.test(value) ? "Android"
    : /iphone|ipad|ios/i.test(value) ? "iOS"
    : /windows/i.test(value) ? "Windows"
    : /mac os|macintosh/i.test(value) ? "macOS"
    : /linux/i.test(value) ? "Linux"
    : "unknown platform";
  return `${browser} on ${platform}`;
}

async function loadSessions(request: Request): Promise<{ sessions: SessionRecord[]; currentId: string | null }> {
  const [sessions, current] = await Promise.all([
    auth.api.listSessions({ headers: request.headers }) as Promise<SessionRecord[]>,
    auth.api.getSession({ headers: request.headers }),
  ]);
  return { sessions, currentId: current?.session?.id ?? null };
}

export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request.headers);
    const { sessions, currentId } = await loadSessions(request);
    return json({
      sessions: sessions.map((session) => ({
        id: session.id,
        device: deviceSummary(session.userAgent),
        network: coarseIp(session.ipAddress),
        createdAt: session.createdAt,
        lastUsedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        current: session.id === currentId,
      })),
      identity: { id: identity.id, email: identity.email, name: identity.name },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "session-revocation", userMax: 20, ipMax: 40 });
    const body = await readJson(request, sessionRevocationSchema);
    const { sessions, currentId } = await loadSessions(request);

    if ("scope" in body) {
      const others = sessions.filter((session) => session.id !== currentId);
      await auth.api.revokeOtherSessions({ headers: request.headers });
      await recordAccountSecurityEvent(identity, "account.sessions_revoked", { scope: "others", revoked: others.length });
      return json({ revoked: others.length, scope: "others" as const });
    }

    const target = sessions.find((session) => session.id === body.sessionId);
    if (!target) throw new HttpError(404, "That session is not active on this account.", "SESSION_NOT_FOUND");
    if (target.id === currentId) {
      throw new HttpError(400, "Use sign out to end the session you are using now.", "SESSION_IS_CURRENT");
    }
    await auth.api.revokeSession({ body: { token: target.token }, headers: request.headers });
    await recordAccountSecurityEvent(identity, "account.session_revoked", { sessionId: target.id });
    return json({ revoked: 1, scope: "one" as const });
  } catch (error) {
    return fail(error);
  }
}
