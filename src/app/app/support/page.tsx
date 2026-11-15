import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SupportPanel } from "@/components/support-panel";
import { getIdentity } from "@/lib/identity";
import { readOnCallCoverage } from "@/lib/published-contacts";

export const metadata: Metadata = { title: "Support and privacy requests" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const memberships = identity.memberships.map(({ organizationId, organizationName }) => ({ organizationId, organizationName }));
  // A response window is shown only when somebody is actually on call, and it can never exceed the
  // recorded coverage. SUPPORT_RESPONSE_HOURS is now a maximum, not a promise: the rota decides.
  const configured = Number(process.env.SUPPORT_RESPONSE_HOURS ?? "");
  const capHours = Number.isInteger(configured) && configured >= 1 && configured <= 168 ? configured : 168;
  const coverage = await readOnCallCoverage();
  const responseWindowHours = coverage.coveredNow && coverage.hoursAhead > 0
    ? Math.max(1, Math.min(capHours, Math.floor(coverage.hoursAhead)))
    : null;
  return <AppShell identity={identity} current="/app/support"><div className="app-page-head"><div><span className="app-eyebrow">Help and account rights</span><h1>Support &amp; privacy.</h1><p>Request help or ask for a review of your personal data. A request is not a promise of a particular legal outcome.</p></div></div><SupportPanel memberships={memberships} responseWindowHours={responseWindowHours} /></AppShell>;
}
