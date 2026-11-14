import { describe, expect, it } from "vitest";
import { dashboardHref, hasDashboardRole, resolvePrimaryRole } from "../src/lib/authorization";
import type { Identity } from "../src/lib/identity";

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.test",
    platformRoles: [],
    memberships: [],
    requestedRole: "generator",
    helperStatus: null,
    ...overrides,
  };
}

function membership(type: "generator" | "receiver", overrides: Record<string, unknown> = {}) {
  return {
    id: `membership-${type}`,
    organizationId: `org-${type}`,
    organizationName: `Test ${type}`,
    organizationType: type,
    organizationStatus: "verified",
    role: "owner" as const,
    status: "active" as const,
    ...overrides,
  };
}

describe("trusted role routing", () => {
  it("maps trusted roles to fixed dashboard paths", () => {
    expect(dashboardHref("admin")).toBe("/admin");
    expect(dashboardHref("generator")).toBe("/generator");
    expect(dashboardHref("receiver")).toBe("/receiver");
    expect(dashboardHref("helper")).toBe("/helper");
    expect(dashboardHref("pending")).toBe("/account/pending");
  });

  it("does not treat a requested role, pending membership or unverified organisation as approval", () => {
    expect(resolvePrimaryRole(identity())).toBe("pending");
    expect(resolvePrimaryRole(identity({ memberships: [membership("generator", { status: "pending" })] }))).toBe("pending");
    expect(resolvePrimaryRole(identity({ memberships: [membership("generator", { organizationStatus: "pending" })] }))).toBe("pending");
    expect(resolvePrimaryRole(identity({ helperStatus: "pending" }))).toBe("pending");
  });

  it("resolves a primary role from backend approvals", () => {
    expect(resolvePrimaryRole(identity({ platformRoles: ["operations_admin"] }))).toBe("admin");
    expect(resolvePrimaryRole(identity({ memberships: [membership("generator")] }))).toBe("generator");
    expect(resolvePrimaryRole(identity({ memberships: [membership("receiver")] }))).toBe("receiver");
    expect(resolvePrimaryRole(identity({ helperStatus: "active" }))).toBe("helper");
  });

  it("allows every approved dashboard for a multi-role user without granting an unapproved one", () => {
    const multi = identity({
      platformRoles: ["operations_admin"],
      memberships: [membership("generator"), membership("receiver")],
      helperStatus: "active",
    });
    expect(resolvePrimaryRole(multi)).toBe("admin");
    for (const role of ["admin", "generator", "receiver", "helper"] as const) {
      expect(hasDashboardRole(multi, role)).toBe(true);
    }
    const generatorOnly = identity({ memberships: [membership("generator")] });
    expect(hasDashboardRole(generatorOnly, "generator")).toBe(true);
    expect(hasDashboardRole(generatorOnly, "admin")).toBe(false);
    expect(hasDashboardRole(generatorOnly, "receiver")).toBe(false);
    expect(hasDashboardRole(generatorOnly, "helper")).toBe(false);
  });
});
