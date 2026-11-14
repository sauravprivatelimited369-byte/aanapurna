import { auth } from "@/lib/auth";
import { recordAccountSecurityEvent } from "@/domain/service";
import { changePasswordSchema } from "@/domain/validation";
import { fail, assertSameOrigin, json, readJson } from "@/lib/http";
import { HttpError } from "@/lib/http";
import { requireIdentity } from "@/lib/identity";
import { enforceMutationRateLimit } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Password change for a signed-in account. The account is identified by the
 * session cookie, never by a user id in the request body, and the current
 * password is required so a stolen session cannot silently take the account over.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request.headers);
    await enforceMutationRateLimit({ request, userId: identity.id, bucket: "password-change", userMax: 5, ipMax: 10 });
    const body = await readJson(request, changePasswordSchema);

    try {
      await auth.api.changePassword({
        body: {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          revokeOtherSessions: body.revokeOtherSessions,
        },
        headers: request.headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("invalid") || message.includes("password")) {
        throw new HttpError(400, "The current password is not correct.", "CURRENT_PASSWORD_INVALID");
      }
      throw error;
    }

    await recordAccountSecurityEvent(identity, "account.password_changed", {
      revokeOtherSessions: body.revokeOtherSessions,
    });
    return json({ status: "changed" as const, otherSessionsRevoked: body.revokeOtherSessions });
  } catch (error) {
    return fail(error);
  }
}
