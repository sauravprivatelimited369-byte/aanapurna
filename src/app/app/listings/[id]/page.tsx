import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getDonationDetail } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Donation details" };
export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }> };

function date(value: Date | null | undefined) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(value) : "Not recorded";
}

export default async function ListingDetailPage({ params }: PageProps) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id } = await params;
  let donation;
  try { donation = await getDonationDetail(identity, id); } catch { notFound(); }
  if (!donation) notFound();
  return <AppShell identity={identity} current="/app/listings"><div className="app-page-head"><div><Link className="app-card-link" href="/app/listings">← Back to listings</Link><h1 style={{ marginTop: 9 }}>{donation.name}</h1><p>{donation.category} · {donation.quantity} {donation.unit}</p></div><span className={`status-pill status-pill--${donation.status}`}>{donation.status.replaceAll("_", " ")}</span></div>
    <div className="app-grid">
      <section className="app-card app-card--span-7"><div className="app-card-title"><div><h2>Food details</h2><p>Policy version {donation.policyVersion}</p></div></div><div className="data-list">
        <div className="data-row"><span className="data-main"><strong>Food type</strong></span><span>{donation.foodType.replaceAll("_", " ")}</span></div>
        <div className="data-row"><span className="data-main"><strong>Preparation</strong></span><span>{date(donation.preparedAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Packing</strong></span><span>{date(donation.packedAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Use-by / best-before</strong></span><span>{date(donation.bestBeforeAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Collection window</strong></span><span>{date(donation.pickupEarliestAt)} — {date(donation.pickupLatestAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Known allergens</strong></span><span>{donation.allergens.length ? donation.allergens.join(", ") : "Not declared"}</span></div>
        <div className="data-row"><span className="data-main"><strong>Ingredients</strong></span><span>{donation.ingredients || "Not recorded"}</span></div>
        <div className="data-row"><span className="data-main"><strong>Storage / handling</strong></span><span>{donation.storageInstructions}</span></div>
        {donation.temperatureRequirement && <div className="data-row"><span className="data-main"><strong>Temperature note</strong></span><span>{donation.temperatureRequirement}</span></div>}
        {donation.pickupAddress && <div className="data-row"><span className="data-main"><strong>Pickup address</strong></span><span>{donation.pickupAddress}</span></div>}
      </div><div className="inline-notice"><strong>Recorded declaration only.</strong> Annapurna Link does not inspect or certify food.</div></section>
      <section className="app-card app-card--span-5"><div className="app-card-title"><div><h2>Custody timeline</h2><p>Append-only handover events.</p></div></div>{donation.timeline.length ? <div className="data-list">{donation.timeline.map((event, index) => <div className="data-row" key={`${event.eventType}-${index}`}><span className="data-main"><strong>{event.eventType.replaceAll(".", " · ").replaceAll("_", " ")}</strong><small>{date(event.occurredAt)}</small></span></div>)}</div> : <div className="empty-state"><div><strong>No custody events</strong><p>History appears as operations progress.</p></div></div>}{donation.receipt && <div className="inline-notice"><strong>Receipt {donation.receipt.reference}</strong><br />Verified delivery: {date(donation.receipt.deliveredAt)} · {donation.receipt.quantity} {donation.receipt.unit}</div>}</section>
    </div>
  </AppShell>;
}
