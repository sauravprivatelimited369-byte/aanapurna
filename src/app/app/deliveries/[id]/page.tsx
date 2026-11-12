import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DeliveryActions } from "@/components/delivery-actions";
import { getDeliveryDetail } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Delivery details" };
export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }> };
function date(value: Date | null | undefined) { return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(value) : "Not recorded"; }

export default async function DeliveryDetailPage({ params }: PageProps) {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  const { id } = await params;
  let job;
  try { job = await getDeliveryDetail(identity, id); } catch { notFound(); }
  if (!job) notFound();
  return <AppShell identity={identity} current="/app/deliveries"><div className="app-page-head"><div><Link className="app-card-link" href="/app/deliveries">← Back to deliveries</Link><h1 style={{ marginTop: 9 }}>{job.name}</h1><p>{job.category} · {job.quantity} {job.unit} · {job.pickupCity}</p></div><span className={`status-pill status-pill--${job.status}`}>{job.status.replaceAll("_", " ")}</span></div>
    <div className="app-grid">
      <section className="app-card app-card--span-7"><div className="app-card-title"><div><h2>Delivery details</h2><p>Only details permitted for your role are shown.</p></div></div><div className="data-list">
        <div className="data-row"><span className="data-main"><strong>Food type</strong></span><span>{job.foodType.replaceAll("_", " ")}</span></div>
        <div className="data-row"><span className="data-main"><strong>Collection window</strong></span><span>{date(job.pickupEarliestAt)} — {date(job.pickupLatestAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Best-before</strong></span><span>{date(job.bestBeforeAt)}</span></div>
        {job.preparedAt && <div className="data-row"><span className="data-main"><strong>Prepared</strong></span><span>{date(job.preparedAt)}</span></div>}
        {job.ingredients && <div className="data-row"><span className="data-main"><strong>Ingredients</strong></span><span>{job.ingredients}</span></div>}
        {job.allergens.length > 0 && <div className="data-row"><span className="data-main"><strong>Known allergens</strong></span><span>{job.allergens.join(", ")}</span></div>}
        {job.storageInstructions && <div className="data-row"><span className="data-main"><strong>Handling instructions</strong></span><span>{job.storageInstructions}</span></div>}
        {job.temperatureRequirement && <div className="data-row"><span className="data-main"><strong>Temperature note</strong></span><span>{job.temperatureRequirement}</span></div>}
        {job.pickupAddress && <div className="data-row"><span className="data-main"><strong>Pickup address</strong></span><span>{job.pickupAddress}</span></div>}
        {job.pickupInstructions && <div className="data-row"><span className="data-main"><strong>Pickup instructions</strong></span><span>{job.pickupInstructions}</span></div>}
        {job.receiverName && <div className="data-row"><span className="data-main"><strong>Receiver</strong></span><span>{job.receiverName}{job.receiverCity ? ` · ${job.receiverCity}` : ""}</span></div>}
        {job.receiverAddress && <div className="data-row"><span className="data-main"><strong>Delivery address</strong></span><span>{job.receiverAddress}</span></div>}
        {job.receiverContactName && <div className="data-row"><span className="data-main"><strong>Receiving contact</strong></span><span>{job.receiverContactName}</span></div>}
        <div className="data-row"><span className="data-main"><strong>Collection recorded</strong></span><span>{date(job.collectedAt)}</span></div>
        <div className="data-row"><span className="data-main"><strong>Arrival recorded</strong></span><span>{date(job.deliveredAt)}</span></div>
      </div><div className="inline-notice"><strong>Declaration only.</strong> These details do not mean the food has been independently inspected or certified safe.</div></section>
      <section className="app-card app-card--span-5"><div className="app-card-title"><div><h2>Next step</h2><p>Follow the approved operating procedure.</p></div></div><DeliveryActions jobId={job.id} canClaim={job.canClaim} canPickup={job.canPickup} canVerify={job.canVerify} canViewCode={job.canViewCode} canReportIncident={job.canReportIncident} />{job.receipt && <div className="inline-notice"><strong>Receipt {job.receipt.reference}</strong><br />Verified on {date(job.receipt.deliveredAt)} · {job.receipt.quantity} {job.receipt.unit}</div>}</section>
      <section className="app-card app-card--full"><div className="app-card-title"><div><h2>Custody record</h2><p>Important handovers and incident actions are append-only.</p></div></div>{job.timeline.length ? <div className="data-list">{job.timeline.map((event, index) => <div className="data-row" key={`${event.eventType}-${index}`}><span className="data-main"><strong>{event.eventType.replaceAll(".", " · ").replaceAll("_", " ")}</strong><small>{date(event.occurredAt)}</small></span></div>)}</div> : <div className="empty-state"><div><strong>No custody events yet</strong><p>Events are added when the delivery changes state.</p></div></div>}</section>
    </div>
  </AppShell>;
}
