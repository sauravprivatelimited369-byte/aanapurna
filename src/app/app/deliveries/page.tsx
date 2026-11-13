import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { listDeliveries } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  let jobs;
  try { jobs = await listDeliveries(identity); } catch { jobs = null; }
  return <AppShell identity={identity} current="/app/deliveries"><div className="app-page-head"><div><span className="app-eyebrow">Custody &amp; dispatch</span><h1>Deliveries.</h1><p>See open work, assigned routes and completed handovers for the organisations you are authorised to support.</p></div></div>
    {jobs === null ? <div className="inline-notice">Delivery records could not be loaded. Refresh to retry.</div> : jobs.length ? <div className="app-grid">{jobs.map((job) => <article className="app-card app-card--span-6" key={job.id}><div className="app-card-title"><div><h2>{job.name}</h2><p>{job.quantity} {job.unit} · {job.pickupCity}</p></div><span className={`status-pill status-pill--${job.status}`}>{job.status.replaceAll("_", " ")}</span></div><p className="form-hint">{job.status === "delivered" ? `Delivered ${job.deliveredAt ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(job.deliveredAt) : "—"}` : `Collection window closes ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(job.pickupLatestAt)}`}</p><Link href={`/app/deliveries/${job.id}`} className="button button--secondary button--small" style={{ marginTop: 15 }}>Open delivery <span aria-hidden="true">↗</span></Link></article>)}</div> : <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">⌖</span><strong>No deliveries to show</strong><p>Open jobs, active handovers and verified receipts will appear here when available to your role.</p>{identity.helperStatus !== "active" && <Link href="/app/onboarding" className="app-card-link" style={{ display: "inline-block", marginTop: 12 }}>Request Helper onboarding ↗</Link>}</div></div>}
  </AppShell>;
}
