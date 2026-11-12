import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listDonations } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Listings" };
export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  let listings;
  try { listings = await listDonations(identity); } catch { listings = null; }
  const isGenerator = identity.memberships.some((membership) => membership.organizationType === "generator" && membership.organizationStatus === "verified");
  return <AppShell identity={identity} current="/app/listings"><div className="app-page-head"><div><span className="app-eyebrow">Generator workspace</span><h1>Listing history.</h1><p>Listings stay traceable across offers, handovers, refusals and verified receipts.</p></div>{isGenerator && <Link className="button button--primary button--small" href="/app/listings/new">New listing <span aria-hidden="true">↗</span></Link>}</div>
    {listings === null ? <div className="inline-notice">Listings could not be loaded. Refresh to retry.</div> : listings.length ? <div className="app-grid">{listings.map((listing) => <article className="app-card app-card--span-6" key={listing.id}><div className="app-card-title"><div><h2>{listing.name}</h2><p>{listing.category} · {listing.quantity} {listing.unit}</p></div><span className={`status-pill status-pill--${listing.status}`}>{listing.status.replaceAll("_", " ")}</span></div><p className="form-hint">Best before {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(listing.bestBeforeAt)} · policy {listing.policyVersion}</p><Link className="app-card-link" href={`/app/listings/${listing.id}`}>View custody history ↗</Link></article>)}</div> : <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">✳</span><strong>No shared listings</strong><p>Once your Generator organisation is reviewed and operations are enabled, listings will appear here.</p></div></div>}
  </AppShell>;
}
