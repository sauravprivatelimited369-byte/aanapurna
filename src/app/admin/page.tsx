import { RoleDashboard } from "@/components/role-dashboard";
import { requireDashboardRole } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration" };

export default async function AdminDashboardPage() {
  const identity = await requireDashboardRole("admin");
  return <RoleDashboard identity={identity} role="admin" current="/admin" />;
}
