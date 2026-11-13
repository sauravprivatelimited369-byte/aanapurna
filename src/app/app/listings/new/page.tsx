import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ListingForm } from "@/components/listing-form";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Create a listing" };
export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const organizations = identity.memberships
    .filter((membership) => membership.organizationType === "generator" && membership.organizationStatus === "verified")
    .map((membership) => ({ id: membership.organizationId, name: membership.organizationName }));
  return <AppShell identity={identity} current="/app/listings/new"><div className="app-page-head"><div><span className="app-eyebrow">Generator workspace</span><h1>Create a food listing.</h1><p>Share clear, accurate information so eligible partners can make an informed decision.</p></div></div><div className="inline-notice"><strong>Human approval matters.</strong> This application records your declarations; it does not inspect, certify or determine that food is safe.</div><ListingForm organizations={organizations} enabled={process.env.OPERATIONS_ENABLED === "true"} /></AppShell>;
}
