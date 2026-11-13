import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OperationsPanel } from "@/components/operations-panel";
import { adminOverview } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Operations and review" };
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!identity.platformRoles.length) redirect("/app");
  let overview = null;
  try { overview = await adminOverview(identity); } catch { /* the panel reports live API errors */ }
  return <AppShell identity={identity} current="/app/operations"><div className="app-page-head"><div><span className="app-eyebrow">Restricted workspace</span><h1>Operations &amp; review.</h1><p>Human decisions, private partner evidence and audited case records.</p></div></div><OperationsPanel platformRoles={identity.platformRoles} userId={identity.id} initialOverview={overview} /></AppShell>;
}
