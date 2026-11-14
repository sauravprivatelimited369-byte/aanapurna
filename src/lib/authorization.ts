import "server-only";
import { redirect } from "next/navigation";
import { getAccountState, getIdentity, hadSessionCookie, type Identity } from "@/lib/identity";

/** Trusted, server-derived dashboard destinations. Never derived from a URL or browser state. */
export type DashboardRole = "admin" | "generator" | "receiver" | "helper" | "pending";

export function resolvePrimaryRole(identity: Identity): DashboardRole {
  // Platform roles are granted only by the restricted server-side bootstrap.
  if (identity.platformRoles.length > 0) return "admin";

  const hasVerifiedOrganisation = (type: "generator" | "receiver") => identity.memberships.some((membership) =>
    membership.status === "active" &&
    membership.organizationType === type &&
    membership.organizationStatus === "verified",
  );

  if (hasVerifiedOrganisation("generator")) return "generator";
  if (hasVerifiedOrganisation("receiver")) return "receiver";
  if (identity.helperStatus === "active") return "helper";
  return "pending";
}

export function dashboardHref(role: DashboardRole): string {
  switch (role) {
    case "admin": return "/admin";
    case "generator": return "/generator";
    case "receiver": return "/receiver";
    case "helper": return "/helper";
    default: return "/account/pending";
  }
}

/**
 * A user can hold more than one approved role (for example, Admin plus an
 * active Generator membership). Every approved dashboard is allowed; a user
 * without that specific role is sent to their server-derived primary dashboard.
 * The role list itself always comes from the trusted backend identity.
 */
export function hasDashboardRole(identity: Identity, required: Exclude<DashboardRole, "pending">): boolean {
  const approved = new Set<Exclude<DashboardRole, "pending">>();
  if (identity.platformRoles.length > 0) approved.add("admin");
  for (const membership of identity.memberships) {
    if (membership.status !== "active" || membership.organizationStatus !== "verified") continue;
    if (membership.organizationType === "generator") approved.add("generator");
    if (membership.organizationType === "receiver") approved.add("receiver");
  }
  if (identity.helperStatus === "active") approved.add("helper");
  return approved.has(required);
}

/** Server-side gate for every protected page. Redirects are safe, fixed paths. */
export async function requireDashboardRole(required: Exclude<DashboardRole, "pending">): Promise<Identity> {
  const state = await getAccountState();
  if (state.state === "anonymous") redirect(await hadSessionCookie() ? "/login?reason=session-expired" : "/login");
  if (state.state === "suspended") redirect("/account/suspended");
  if (state.state === "unverified") redirect("/verify-email");

  const identity = await getIdentity();
  if (!identity) redirect("/login?reason=session-expired");

  if (!hasDashboardRole(identity, required)) redirect(dashboardHref(resolvePrimaryRole(identity)));
  return identity;
}

/** Used by /auth/continue after login to send the user to the correct dashboard. */
export async function resolvePostLoginDestination(): Promise<string> {
  const state = await getAccountState();
  if (state.state === "anonymous") return await hadSessionCookie() ? "/login?reason=session-expired" : "/login";
  if (state.state === "suspended") return "/account/suspended";
  if (state.state === "unverified") return "/verify-email";
  const identity = await getIdentity();
  if (!identity) return "/login?reason=session-expired";
  return dashboardHref(resolvePrimaryRole(identity));
}
