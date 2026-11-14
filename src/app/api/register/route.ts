import { eq } from "drizzle-orm";
import { authDb } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { assertSameOrigin, fail, HttpError, json, readJson } from "@/lib/http";
import { registrationSchema } from "@/domain/validation";
import { getEmailDeliveryStatus } from "@/email/config";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public registration endpoint. It validates every field server-side, blocks
 * duplicate emails, then delegates real account creation and password hashing
 * to Better Auth. It is a thin wrapper, not a second authentication system.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = await readJson(request, registrationSchema);
    const email = input.email.trim().toLowerCase();

    // Two independent, database-backed limits: per network address and per email.
    await enforceRateLimit({
      bucket: "auth:registration:ip",
      subject: getRequestAddressKey(request),
      max: 8,
      windowSeconds: 300,
    });
    await enforceRateLimit({
      bucket: "auth:registration:email",
      subject: email,
      max: 5,
      windowSeconds: 300,
    });

    const existing = await authDb.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (existing.length > 0) {
      throw new HttpError(409, "An account already exists for this email. Sign in or reset your password.", "EMAIL_ALREADY_REGISTERED");
    }

    const result = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email,
        password: input.password,
        requestedRole: input.role,
        registrationPhone: input.phone,
        ...(input.organizationName?.trim() ? { registrationOrganizationName: input.organizationName.trim() } : {}),
        ...(input.organizationType ? { registrationOrganizationType: input.organizationType } : {}),
        registrationAddressLine: input.addressLine,
        registrationCityOrDistrict: input.cityOrDistrict,
        ...(input.stateOrRegion ? { registrationStateOrRegion: input.stateOrRegion } : {}),
        ...(input.postalCode ? { registrationPostalCode: input.postalCode } : {}),
        registrationProfileNotes: input.profileNotes,
        callbackURL: "/verify-email?result=verified",
      },
      headers: request.headers,
    });

    // Better Auth returns a synthetic user for a race-condition duplicate.
    // Confirm the returned ID is a real committed row and that no session
    // token was issued; otherwise fail closed as a duplicate.
    if (!result?.user?.id || result.token) {
      throw new HttpError(409, "An account already exists for this email. Sign in or reset your password.", "EMAIL_ALREADY_REGISTERED");
    }
    const committed = await authDb.select({ id: user.id }).from(user).where(eq(user.id, result.user.id)).limit(1);
    if (committed.length === 0) {
      throw new HttpError(409, "An account already exists for this email. Sign in or reset your password.", "EMAIL_ALREADY_REGISTERED");
    }

    return json({
      status: "created",
      email,
      emailDelivery: getEmailDeliveryStatus(),
      requiresEmailVerification: true,
      next: "/verify-email",
    }, 201);
  } catch (error) {
    return fail(error);
  }
}
