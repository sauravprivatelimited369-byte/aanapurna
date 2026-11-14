import { RoleDashboard } from "@/components/role-dashboard";
import { requireDashboardRole } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Helper dashboard" };

export default async function HelperDashboardPage() {
  const identity = await requireDashboardRole("helper");
  return <RoleDashboard identity={identity} role="helper" current="/helper" />;
}
