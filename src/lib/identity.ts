import "server-only";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { withUserContext } from "@/db";
import { helperProfiles, organizationMemberships, organizations, platformRoles, userProfiles } from "@/db/schema";
import { HttpError } from "@/lib/http";

export type PlatformRoleName = "operations_admin" | "support_agent" | "safety_officer" | "security_admin";
export type Identity = {
  id: string;
  name: string;
  email: string;
  platformRoles: PlatformRoleName[];
  memberships: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    organizationType: "generator" | "receiver";
    organizationStatus: string;
    role: "owner" | "manager" | "operator" | "viewer";
    status: "pending" | "active" | "suspended" | "removed";
  }>;
  requestedRole: "generator" | "receiver" | "helper" | null;
  helperStatus: "pending" | "active" | "suspended" | "rejected" | null;
};

export async function getIdentity(requestHeaders?: Headers): Promise<Identity | null> {
  const request = requestHeaders ?? await headers();
  const session = await auth.api.getSession({ headers: request });
  if (!session) return null;

  return withUserContext(session.user.id, async (tx) => {
    const [profile] = await tx.select({
      status: userProfiles.accountStatus,
      requestedRole: userProfiles.requestedRole,
    }).from(userProfiles).where(eq(userProfiles.userId, session.user.id)).limit(1);
    if (!profile || profile.status !== "active") return null;

    const roleRows = await tx.select({ role: platformRoles.role })
      .from(platformRoles)
      .where(eq(platformRoles.userId, session.user.id));
    const [helperProfile] = await tx.select({ status: helperProfiles.status })
      .from(helperProfiles)
      .where(eq(helperProfiles.userId, session.user.id))
      .limit(1);
    const membershipRows = await tx.select({
      id: organizationMemberships.id,
      organizationId: organizationMemberships.organizationId,
      organizationName: organizations.name,
      organizationType: organizations.type,
      organizationStatus: organizations.status,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
    })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(and(
        eq(organizationMemberships.userId, session.user.id),
        eq(organizationMemberships.status, "active"),
      ));

    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      platformRoles: roleRows.map(({ role }) => role),
      memberships: membershipRows,
      requestedRole: profile.requestedRole,
      helperStatus: helperProfile?.status ?? null,
    };
  });
}

export async function requireIdentity(requestHeaders?: Headers): Promise<Identity> {
  const identity = await getIdentity(requestHeaders);
  if (!identity) throw new HttpError(401, "Sign in with a verified account to continue.", "AUTHENTICATION_REQUIRED");
  return identity;
}

/**
 * Distinguish an expired session from a suspended or unverified account. This
 * reads the real Better Auth session plus the profile row every time; it never
 * trusts a browser-supplied role or status.
 */
export type AccountState = "anonymous" | "suspended" | "unverified" | "active";

export async function getAccountState(requestHeaders?: Headers): Promise<{
  state: AccountState;
  userId: string | null;
}> {
  const request = requestHeaders ?? await headers();
  const session = await auth.api.getSession({ headers: request });
  if (!session) return { state: "anonymous", userId: null };

  const [profile] = await withUserContext(session.user.id, (tx) =>
    tx.select({ status: userProfiles.accountStatus })
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1),
  );

  if (!profile || ["suspended", "locked", "deactivated"].includes(profile.status)) {
    return { state: "suspended", userId: session.user.id };
  }
  if (!session.user.emailVerified || profile.status === "pending") {
    return { state: "unverified", userId: session.user.id };
  }
  return { state: "active", userId: session.user.id };
}

export async function isPlatformRole(userId: string, role: PlatformRoleName): Promise<boolean> {
  return withUserContext(userId, async (tx) => {
    const [match] = await tx.select({ id: platformRoles.id })
      .from(platformRoles)
      .where(and(eq(platformRoles.userId, userId), eq(platformRoles.role, role)))
      .limit(1);
    return Boolean(match);
  });
}

export function hasAnyRole(identity: Identity, roles: PlatformRoleName[]): boolean {
  return identity.platformRoles.some((role) => roles.includes(role));
}

export function canAccessOrganization(identity: Identity, organizationId: string, minimumRoles?: string[]): boolean {
  return identity.memberships.some((membership) =>
    membership.organizationId === organizationId &&
    membership.status === "active" &&
    (!minimumRoles || minimumRoles.includes(membership.role)),
  );
}
