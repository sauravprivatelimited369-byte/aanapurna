import { describe, expect, it } from "vitest";
import { getWorkspaceNavigation } from "@/lib/workspace-navigation";
import type { PlatformRoleName } from "@/lib/identity";

const guestIdentity = { memberships: [], helperStatus: null, platformRoles: [] };
const generatorMembership = {
  id: "fixture-generator-membership",
  organizationId: "fixture-generator-org",
  organizationName: "Fixture Generator",
  organizationType: "generator",
  organizationStatus: "verified",
  role: "owner",
  status: "active",
} as const;
const receiverMembership = {
  ...generatorMembership,
  id: "fixture-receiver-membership",
  organizationId: "fixture-receiver-org",
  organizationName: "Fixture Receiver",
  organizationType: "receiver",
} as const;
const platformRoles: PlatformRoleName[] = ["operations_admin", "support_agent", "safety_officer", "security_admin"];

function hrefs(identity: typeof guestIdentity | Parameters<typeof getWorkspaceNavigation>[0]): string[] {
  return getWorkspaceNavigation(identity).links.map((link) => link.href);
}

describe("workspace navigation permissions", () => {
  it.each(platformRoles)("exposes the restricted operations route for the assigned %s role", (role) => {
    const { links, mobilePaths } = getWorkspaceNavigation({ ...guestIdentity, platformRoles: [role] });
    expect(links.some((link) => link.href === "/app/operations")).toBe(true);
    expect(mobilePaths).toContain("/app/operations");
  });

  it("does not expose restricted operations navigation to a member without a platform role", () => {
    const { links, mobilePaths } = getWorkspaceNavigation(guestIdentity);
    expect(links.some((link) => link.href === "/app/operations")).toBe(false);
    expect(mobilePaths).not.toContain("/app/operations");
  });

  it("shows Generator routes only for an active Generator membership", () => {
    const identity = { ...guestIdentity, memberships: [generatorMembership] };
    const paths = hrefs(identity);
    expect(paths).toEqual(expect.arrayContaining(["/app/listings", "/app/listings/new", "/app/deliveries"]));
    expect(paths).not.toContain("/app/offers");
    expect(paths).not.toContain("/app/operations");
    expect(getWorkspaceNavigation(identity).mobilePaths).toContain("/app/listings");
  });

  it("shows Receiver routes only for an active Receiver membership", () => {
    const identity = { ...guestIdentity, memberships: [receiverMembership] };
    const paths = hrefs(identity);
    expect(paths).toEqual(expect.arrayContaining(["/app/offers", "/app/deliveries"]));
    expect(paths).not.toContain("/app/listings");
    expect(paths).not.toContain("/app/operations");
    expect(getWorkspaceNavigation(identity).mobilePaths).toContain("/app/offers");
  });

  it("shows delivery routes for an active Helper and not for a pending Helper", () => {
    const active = { ...guestIdentity, helperStatus: "active" as const };
    const pending = { ...guestIdentity, helperStatus: "pending" as const };
    expect(hrefs(active)).toContain("/app/deliveries");
    expect(getWorkspaceNavigation(active).mobilePaths).toContain("/app/deliveries");
    expect(hrefs(pending)).not.toContain("/app/deliveries");
  });

  it("does not expose organization work to a pending membership", () => {
    const identity = {
      ...guestIdentity,
      memberships: [{ ...generatorMembership, status: "pending" as const }],
    };
    expect(hrefs(identity)).not.toContain("/app/listings");
    expect(hrefs(identity)).not.toContain("/app/deliveries");
  });
});
