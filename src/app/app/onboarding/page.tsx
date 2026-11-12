import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OnboardingPanel } from "@/components/onboarding-panel";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Partner onboarding" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  return <AppShell identity={identity} current="/app/onboarding"><div className="app-page-head"><div><span className="app-eyebrow">Partner access</span><h1>Start with a review.</h1><p>Share only what is needed to request access. Documents and approvals happen through a controlled process.</p></div></div><OnboardingPanel initialRole={identity.requestedRole ?? "generator"} /></AppShell>;
}
