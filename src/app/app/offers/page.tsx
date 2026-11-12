import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listOffers } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Food offers" };
export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  let offers;
  try { offers = await listOffers(identity); } catch { offers = null; }
  return <AppShell identity={identity} current="/app/offers"><div className="app-page-head"><div><span className="app-eyebrow">Receiver workspace</span><h1>Offers to review.</h1><p>Check capability, available capacity and the collection window before responding.</p></div></div>
    {offers === null ? <div className="inline-notice">Offers could not be loaded. Refresh to retry.</div> : offers.length ? <div className="app-grid">{offers.map((offer) => <article className="app-card app-card--span-6" key={offer.id}><div className="app-card-title"><div><h2>{offer.name}</h2><p>{offer.category} · {offer.foodType.replaceAll("_", " ")}</p></div><span className={`status-pill status-pill--${offer.status}`}>{offer.status}</span></div><p className="form-hint">{offer.quantity} {offer.unit} · pickup area {offer.pickupCity} · reply by {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(offer.expiresAt)}</p><Link href={`/app/offers/${offer.id}`} className="button button--secondary button--small" style={{ marginTop: 15 }}>Review offer <span aria-hidden="true">↗</span></Link></article>)}</div> : <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">↗</span><strong>No offers yet</strong><p>Offers appear here when a matching donation is shared with your verified organisation.</p><Link className="app-card-link" href="/app/onboarding" style={{ display: "inline-block", marginTop: 12 }}>Check onboarding ↗</Link></div></div>}
  </AppShell>;
}
