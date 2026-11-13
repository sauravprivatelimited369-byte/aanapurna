import { RoleDashboard } from "@/components/role-dashboard";
import { requireDashboardRole } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receiver dashboard" };

export default async function ReceiverDashboardPage() {
  const identity = await requireDashboardRole("receiver");
  return <RoleDashboard identity={identity} role="receiver" current="/receiver" />;
}
