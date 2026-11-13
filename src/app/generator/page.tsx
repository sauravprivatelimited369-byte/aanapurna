import { RoleDashboard } from "@/components/role-dashboard";
import { requireDashboardRole } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Generator dashboard" };

export default async function GeneratorDashboardPage() {
  const identity = await requireDashboardRole("generator");
  return <RoleDashboard identity={identity} role="generator" current="/generator" />;
}
