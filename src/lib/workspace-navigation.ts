import {
  Bell,
  Building2,
  ChefHat,
  ClipboardList,
  House,
  LifeBuoy,
  ListChecks,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type { Identity } from "@/lib/identity";

export type WorkspaceLink = { href: string; label: string; Icon: LucideIcon; section: string };

type WorkspaceNavigationIdentity = Pick<Identity, "memberships" | "helperStatus" | "platformRoles">;

export function getWorkspaceNavigation(identity: WorkspaceNavigationIdentity): { links: WorkspaceLink[]; mobilePaths: string[] } {
  const activeMemberships = identity.memberships.filter((membership) => membership.status === "active");
  const hasGenerator = activeMemberships.some((membership) => membership.organizationType === "generator");
  const hasReceiver = activeMemberships.some((membership) => membership.organizationType === "receiver");
  const hasHelper = identity.helperStatus === "active";
  const hasPlatformAccess = identity.platformRoles.length > 0;
  const approvedMemberships = activeMemberships.filter((membership) => membership.organizationStatus === "verified");
  const hasApprovedGenerator = approvedMemberships.some((membership) => membership.organizationType === "generator");
  const hasApprovedReceiver = approvedMemberships.some((membership) => membership.organizationType === "receiver");

  const links: WorkspaceLink[] = [
    { href: "/app", label: "Overview", Icon: House, section: "Workspace" },
    ...(hasApprovedGenerator ? [{ href: "/generator", label: "Generator dashboard", Icon: UtensilsCrossed, section: "Your dashboards" }] : []),
    ...(hasApprovedReceiver ? [{ href: "/receiver", label: "Receiver dashboard", Icon: ChefHat, section: "Your dashboards" }] : []),
    ...(hasHelper ? [{ href: "/helper", label: "Helper dashboard", Icon: Truck, section: "Your dashboards" }] : []),
    ...(hasPlatformAccess ? [{ href: "/admin", label: "Admin console", Icon: ListChecks, section: "Restricted" }] : []),
    ...(hasGenerator ? [
      { href: "/app/listings", label: "Food listings", Icon: UtensilsCrossed, section: "Food coordination" },
      { href: "/app/listings/new", label: "Create a listing", Icon: ClipboardList, section: "Food coordination" },
    ] : []),
    ...(hasReceiver ? [{ href: "/app/offers", label: "Food offers", Icon: ChefHat, section: "Food coordination" }] : []),
    ...(hasHelper || hasGenerator || hasReceiver ? [{ href: "/app/deliveries", label: "Deliveries", Icon: Truck, section: "Food coordination" }] : []),
    { href: "/app/onboarding", label: "Partner setup", Icon: Building2, section: "Your account" },
    { href: "/app/notifications", label: "Notifications", Icon: Bell, section: "Your account" },
    { href: "/app/support", label: "Support & privacy", Icon: LifeBuoy, section: "Your account" },
    ...(hasPlatformAccess ? [{ href: "/app/operations", label: "Operations & review", Icon: ListChecks, section: "Restricted" }] : []),
  ];

  let mobilePaths: string[];
  if (hasPlatformAccess) {
    mobilePaths = ["/app", "/app/operations", "/app/notifications", "/app/support"];
  } else if (hasGenerator && hasReceiver) {
    mobilePaths = ["/app", "/app/listings", "/app/offers", "/app/notifications"];
  } else if (hasGenerator) {
    mobilePaths = ["/app", "/app/listings", "/app/deliveries", "/app/notifications"];
  } else if (hasReceiver) {
    mobilePaths = ["/app", "/app/offers", "/app/deliveries", "/app/notifications"];
  } else if (hasHelper) {
    mobilePaths = ["/app", "/app/deliveries", "/app/notifications", "/app/support"];
  } else {
    mobilePaths = ["/app", "/app/onboarding", "/app/notifications", "/app/support"];
  }

  return { links, mobilePaths };
}
