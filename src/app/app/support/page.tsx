import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SupportPanel } from "@/components/support-panel";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Support and privacy requests" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const memberships = identity.memberships.map(({ organizationId, organizationName }) => ({ organizationId, organizationName }));
  return <AppShell identity={identity} current="/app/support"><div className="app-page-head"><div><span className="app-eyebrow">Help and account rights</span><h1>Support &amp; privacy.</h1><p>Request help or ask for a review of your personal data. A request is not a promise of a particular legal outcome.</p></div></div><SupportPanel memberships={memberships} /></AppShell>;
}
