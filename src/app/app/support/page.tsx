import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SupportPanel } from "@/components/support-panel";
import { getIdentity } from "@/lib/identity";
import { readOnCallCoverage, readPublishedResponseWindow } from "@/lib/published-contacts";
import { currentLocale } from "@/lib/locale-server";

export const metadata: Metadata = { title: "Support and privacy requests" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const memberships = identity.memberships.map(({ organizationId, organizationName }) => ({ organizationId, organizationName }));
  // Two different facts, kept apart on purpose. The committed window is the one an operator recorded
  // as an attestation, and it is the number the privacy page publishes. Whether somebody is reachable
  // right now comes from the rota. Deriving the first from the second used to make this page and
  // /privacy quote different numbers for the same promise, which is worse than quoting none.
  const [coverage, recordedWindow, locale] = await Promise.all([readOnCallCoverage(), readPublishedResponseWindow(), currentLocale()]);
  const responseWindow = {
    committedHours: recordedWindow.hours,
    staffedBy: recordedWindow.staffedBy,
    reachableNow: coverage.coveredNow && coverage.hoursAhead > 0,
    coverageHours: coverage.coveredNow && coverage.hoursAhead > 0 ? Math.floor(coverage.hoursAhead) : 0,
  };
  return <AppShell identity={identity} current="/app/support"><div className="app-page-head"><div><span className="app-eyebrow">Help and account rights</span><h1>Support &amp; privacy.</h1><p>Request help or ask for a review of your personal data. A request is not a promise of a particular legal outcome.</p></div></div><SupportPanel memberships={memberships} responseWindow={responseWindow} locale={locale} /></AppShell>;
}
