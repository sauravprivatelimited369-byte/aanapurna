import "server-only";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { authDb, withUserContext } from "@/db";
import { enqueueAuthEmail } from "@/email/outbox";
import { registrationDetailsSchema } from "@/domain/validation";
import { parseAdditionalOrigins } from "@/lib/production-config";

const isProduction = process.env.NODE_ENV === "production";
const configuredSecret = process.env.AUTH_SECRET;
const globalForAuth = globalThis as typeof globalThis & { __annapurnaDevAuthSecret?: string };
const authSecret = configuredSecret ?? (isProduction
  ? undefined
  : (globalForAuth.__annapurnaDevAuthSecret ??= randomBytes(48).toString("base64url")));

if (isProduction && !configuredSecret) {
  throw new Error("AUTH_SECRET is required in production.");
}

const appUrl = process.env.APP_URL;
// Vercel previews are reached through a per-deployment host rather than the
// project's canonical alias. Trust that exact HTTPS origin in addition to
// APP_URL; never trust a wildcard or a user-supplied host.
const vercelPreviewOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
// Operators can list additional HTTPS origins that must keep accepting form
// posts, for example the previous deployment alias after a domain change.
const additionalOrigins = isProduction
  ? parseAdditionalOrigins(process.env.APP_ADDITIONAL_ORIGINS).origins
  : [];
const trustedOrigins = isProduction
  ? [appUrl, vercelPreviewOrigin, ...additionalOrigins].filter((origin): origin is string => Boolean(origin))
  : ["http://localhost:3000", "http://127.0.0.1:3000", "https://*.e2b.app", ...(appUrl ? [appUrl] : [])];

const optionalIntakeText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Validators run inside Better Auth before a user row is written, not only in the browser. */
const intakeFields = {
  requestedRole: { type: "string" as const, required: false, input: true, returned: true },

  registrationPhone: {
    type: "string" as const, required: true, input: true, returned: false,
    validator: { input: z.string().trim().min(7).max(32).regex(/^[+0-9 ()-]+$/) },
  },
  registrationOrganizationName: {
    type: "string" as const, required: false, input: true, returned: false,
    validator: { input: optionalIntakeText(160) },
  },
  registrationOrganizationType: {
    type: "string" as const, required: false, input: true, returned: false,
    validator: { input: z.enum(["generator", "receiver"]).nullable().optional() },
  },
  registrationAddressLine: {
    type: "string" as const, required: true, input: true, returned: false,
    validator: { input: z.string().trim().min(5).max(500) },
  },
  registrationCityOrDistrict: {
    type: "string" as const, required: true, input: true, returned: false,
    validator: { input: z.string().trim().min(2).max(120) },
  },
  registrationStateOrRegion: {
    type: "string" as const, required: false, input: true, returned: false,
    validator: { input: optionalIntakeText(120) },
  },
  registrationPostalCode: {
    type: "string" as const, required: false, input: true, returned: false,
    validator: { input: optionalIntakeText(20) },
  },
  registrationProfileNotes: {
    type: "string" as const, required: true, input: true, returned: false,
    validator: { input: z.string().trim().min(10).max(1_000) },
  },
} as const;

/** Read the transient intake columns from a raw Better Auth user record. */
function intakeFromUser(record: Record<string, unknown>) {
  return {
    role: record.requestedRole,
    phone: record.registrationPhone,
    organizationName: record.registrationOrganizationName,
    organizationType: record.registrationOrganizationType,
    addressLine: record.registrationAddressLine,
    cityOrDistrict: record.registrationCityOrDistrict,
    stateOrRegion: record.registrationStateOrRegion,
    postalCode: record.registrationPostalCode,
    profileNotes: record.registrationProfileNotes,
  };
}

export const auth = betterAuth({
  appName: "Annapurna Link",
  secret: authSecret,
  ...(appUrl ? { baseURL: appUrl } : {}),
  trustedOrigins,
  database: drizzleAdapter(authDb, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
    transaction: true,
  }),
  user: {
    additionalFields: intakeFields,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => enqueueAuthEmail("password_reset", user.email, url),
  },
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => enqueueAuthEmail("verification", user.email, url),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 12,
    // Consult the database on every request so logout and revocation take effect immediately.
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 40,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 5 },
      "/send-verification-email": { window: 300, max: 3 },
      "/verify-email": { window: 60, max: 10 },
      "/reset-password/*": { window: 60, max: 5 },
    },
  },
  advanced: {
    cookiePrefix: "annapurna",
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          // Server-side allowlist: no public Admin signup, and no privileged
          // status/role fields can be supplied by a browser.
          const intake = intakeFromUser(newUser as Record<string, unknown>);
          if (!registrationDetailsSchema.safeParse(intake).success) return false;
          return true;
        },
        after: async (createdUser) => {
          const record = createdUser as Record<string, unknown>;
          const intake = registrationDetailsSchema.safeParse(intakeFromUser(record));
          const candidate = record.requestedRole;
          const role = candidate === "generator" || candidate === "receiver" || candidate === "helper" ? candidate : null;
          await withUserContext(createdUser.id, async (tx) => {
            if (intake.success) {
              await tx.insert(schema.registrationProfiles).values({
                userId: createdUser.id,
                requestedRole: intake.data.role,
                phone: intake.data.phone,
                organizationName: intake.data.organizationName || null,
                organizationType: intake.data.organizationType ?? null,
                addressLine: intake.data.addressLine,
                cityOrDistrict: intake.data.cityOrDistrict,
                stateOrRegion: intake.data.stateOrRegion || null,
                postalCode: intake.data.postalCode || null,
                profileNotes: intake.data.profileNotes,
                verificationStatus: "submitted",
              }).onConflictDoNothing();
            }
            await tx.insert(schema.userProfiles).values({
              userId: createdUser.id,
              displayName: createdUser.name,
              requestedRole: role,
              accountStatus: "pending",
            }).onConflictDoNothing();
            await tx.insert(schema.auditEvents).values({
              actorUserId: createdUser.id,
              action: "account.created",
              entityType: "user",
              entityId: createdUser.id,
              details: { emailVerified: createdUser.emailVerified, registrationProfileStored: intake.success },
            });
          });
          // Intake details now live behind RLS. Remove the transient copies from
          // the Better Auth-owned table so sensitive profile data is not duplicated.
          await authDb.update(schema.user).set({
            registrationPhone: null,
            registrationOrganizationName: null,
            registrationOrganizationType: null,
            registrationAddressLine: null,
            registrationCityOrDistrict: null,
            registrationStateOrRegion: null,
            registrationPostalCode: null,
            registrationProfileNotes: null,
          }).where(eq(schema.user.id, createdUser.id));
        },
      },
      update: {
        after: async (updatedUser) => {
          if (!updatedUser.emailVerified) return;
          await withUserContext(updatedUser.id, async (tx) => {
            await tx.execute(sql`select public.app_mark_user_verified()`);
          });
        },
      },
    },
    session: {
      create: {
        before: async (newSession) => {
          const [profile] = await withUserContext(newSession.userId, (tx) =>
            tx.select({ status: schema.userProfiles.accountStatus })
              .from(schema.userProfiles)
              .where(eq(schema.userProfiles.userId, newSession.userId))
              .limit(1),
          );
          if (!profile) {
            throw new APIError("FORBIDDEN", { code: "ACCOUNT_NOT_PROVISIONED", message: "This account is not provisioned. Contact support." });
          }
          if (profile.status !== "active") {
            const disabled = ["suspended", "locked", "deactivated"].includes(profile.status);
            throw new APIError("FORBIDDEN", {
              code: disabled ? "ACCOUNT_SUSPENDED" : "EMAIL_NOT_VERIFIED",
              message: disabled
                ? "This account is suspended or disabled. Contact support."
                : "Verify your email address before signing in.",
            });
          }
          return true;
        },
        after: async (newSession) => {
          await withUserContext(newSession.userId, async (tx) => {
            await tx.insert(schema.auditEvents).values({
              actorUserId: newSession.userId,
              action: "session.created",
              entityType: "session",
              entityId: newSession.id,
              details: {},
            });
          });
        },
      },
      delete: {
        after: async (deletedSession) => {
          await withUserContext(deletedSession.userId, async (tx) => {
            await tx.insert(schema.auditEvents).values({
              actorUserId: deletedSession.userId,
              action: "session.revoked",
              entityType: "session",
              entityId: deletedSession.id,
              details: {},
            });
          });
        },
      },
    },
  },
});
