import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OfferActions } from "@/components/offer-actions";
import { getOfferDetail } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Review food offer" };
export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }> };
function showDate(value: Date | null) { return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(value) : "Not recorded"; }

export default async function OfferDetailPage({ params }: PageProps) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id } = await params;
  let offer;
  try { offer = await getOfferDetail(identity, id); } catch { notFound(); }
  if (!offer) notFound();
  const membership = identity.memberships.find((item) => item.organizationId === offer.receiverOrganizationId);
  const canRespond = membership && ["owner", "manager", "operator"].includes(membership.role);
  const isOpen = offer.isOpen;
  const disabled = process.env.OPERATIONS_ENABLED !== "true" || !canRespond || !isOpen;
  return <AppShell identity={identity} current="/app/offers"><div className="app-page-head"><div><Link className="app-card-link" href="/app/offers">← Back to offers</Link><h1 style={{ marginTop: 9 }}>{offer.name}</h1><p>{offer.category} · {offer.quantity} {offer.unit} · {offer.pickupCity}{offer.pickupState ? `, ${offer.pickupState}` : ""}</p></div><span className={`status-pill status-pill--${offer.status}`}>{offer.status}</span></div>
    <div className="app-grid">
      <section className="app-card app-card--span-7"><div className="app-card-title"><div><h2>What has been declared</h2><p>Review all available details. You are responsible for your own acceptance checks.</p></div></div><div className="data-list">
        <div className="data-row"><span className="data-main"><strong>Food type</strong></span><span>{offer.foodType.replaceAll("_", " ")}</span></div>
        <div className="data-row"><span className="data-main"><strong>Prepared at</strong></span><span>{showDate(offer.preparedAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Packed at</strong></span><span>{showDate(offer.packedAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Best-before</strong></span><span>{showDate(offer.bestBeforeAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Collection window</strong></span><span>{showDate(offer.pickupEarliestAt)} — {showDate(offer.pickupLatestAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Known allergens</strong></span><span>{offer.allergens.length ? offer.allergens.join(", ") : "Not declared"}</span></div>
        <div className="data-row"><span className="data-main"><strong>Ingredients</strong></span><span>{offer.ingredients || "Not recorded"}</span></div>
        <div className="data-row"><span className="data-main"><strong>Storage / handling</strong></span><span>{offer.storageInstructions}</span></div>
        {offer.temperatureRequirement && <div className="data-row"><span className="data-main"><strong>Temperature note</strong></span><span>{offer.temperatureRequirement}</span></div>}
      </div><div className="inline-notice"><strong>Not an inspection.</strong> This screen contains Generator declarations; it is not independent food-safety verification. The exact pickup address is shared after a Receiver accepts.</div></section>
      <section className="app-card app-card--span-5"><div className="app-card-title"><div><h2>Your response</h2><p>Offer reply deadline: {showDate(offer.expiresAt)}</p></div></div>{isOpen ? <OfferActions offerId={offer.id} disabled={disabled} /> : <div className="empty-state"><div><strong>This offer is closed</strong><p>It has expired, been accepted elsewhere, or already received a response.</p></div></div>}</section>
    </div>
  </AppShell>;
}
