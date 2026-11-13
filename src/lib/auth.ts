import "server-only";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { authDb, withUserContext } from "@/db";
import { enqueueAuthEmail } from "@/email/outbox";

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
const trustedOrigins = isProduction
  ? (appUrl ? [appUrl] : [])
  : ["http://localhost:3000", "http://127.0.0.1:3000", "https://*.e2b.app", ...(appUrl ? [appUrl] : [])];

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
    additionalFields: {
      requestedRole: { type: "string", required: false, input: true, returned: true },
    },
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
      "/request-password-reset": { window: 60, max: 5 },
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
          const requested = newUser.requestedRole;
          if (requested !== undefined && requested !== null && !["generator", "receiver", "helper"].includes(String(requested))) return false;
        },
        after: async (createdUser) => {
          const candidate = createdUser.requestedRole;
          const role = candidate === "generator" || candidate === "receiver" || candidate === "helper" ? candidate : null;
          await withUserContext(createdUser.id, async (tx) => {
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
              details: { emailVerified: createdUser.emailVerified },
            });
          });
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
          return profile?.status === "active";
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
