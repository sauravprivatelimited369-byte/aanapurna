import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getDashboard } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const dynamic = "force-dynamic";

function formatDate(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}

function EmptyState({ title, text, href, action }: { title: string; text: string; href?: string; action?: string }) {
  return <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">✳</span><strong>{title}</strong><p>{text}</p>{href && action && <Link href={href} className="app-card-link" style={{ display: "inline-block", marginTop: 12 }}>{action} ↗</Link>}</div></div>;
}

export default async function DashboardPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  let dashboard: Awaited<ReturnType<typeof getDashboard>> | null = null;
  try {
    dashboard = await getDashboard(identity);
  } catch {
    return <AppShell identity={identity} current="/app">
      <div className="app-page-head"><div><span className="app-eyebrow">Your workspace</span><h1>Your records are temporarily unavailable.</h1><p>We could not load this account&apos;s current records. No action was recorded by this display error.</p></div></div>
      <div className="inline-notice" role="status"><strong>Workspace unavailable.</strong> Refresh to retry. If the problem continues, use Support &amp; privacy from the workspace navigation.</div>
      <form action="/app" method="get"><button className="button button--secondary" type="submit">Reload workspace</button></form>
    </AppShell>;
  }

  const hasGenerator = identity.memberships.some((membership) => membership.organizationType === "generator");
  const hasReceiver = identity.memberships.some((membership) => membership.organizationType === "receiver");
  const hasHelper = identity.helperStatus === "active";
  const firstName = identity.name.trim().split(/\s+/)[0] || "there";
  const operationsPaused = process.env.OPERATIONS_ENABLED !== "true";
  const current = "/app";
  const metricCards: Array<{ label: string; value: number; caption: string }> = [];
  if (hasGenerator) metricCards.push({ label: "Listings on your organisations", value: dashboard.metrics.listings, caption: "Records on your Generator organisations · not an impact count" });
  if (hasReceiver) metricCards.push({ label: "Offers awaiting response", value: dashboard.metrics.awaitingReceiver, caption: "Pending offers for your Receiver organisations" });
  if (hasReceiver || hasHelper) metricCards.push({ label: "Active deliveries", value: dashboard.metrics.activeDeliveries, caption: "Open, assigned or collected work visible to your role" });
  if (hasGenerator || hasReceiver || hasHelper) metricCards.push({ label: "Verified deliveries", value: dashboard.metrics.verifiedDeliveries, caption: "Receipts confirmed for your role; quantities keep their recorded units" });
  if (dashboard.platformMetrics) {
    metricCards.push(
      { label: "Partner requests pending review", value: dashboard.platformMetrics.organizationsPending, caption: "All requests awaiting an authorised human decision" },
      { label: "Deliveries in progress", value: dashboard.platformMetrics.activeDeliveries, caption: "Platform-wide open, assigned or collected work" },
      { label: "Open safety incidents", value: dashboard.platformMetrics.openIncidents, caption: "Restricted to authorised operations and safety staff" },
    );
  }

  return (
    <AppShell identity={identity} current={current} notificationCount={dashboard.notificationCount}>
      <div className="app-page-head">
        <div><span className="app-eyebrow">{identity.platformRoles.length ? "Operations workspace" : hasHelper ? "Helper workspace" : hasGenerator && hasReceiver ? "Shared partner workspace" : hasGenerator ? "Generator workspace" : hasReceiver ? "Receiver workspace" : "Account setup"}</span><h1>Welcome, {firstName}.</h1><p>{metricCards.length ? "Here is what is relevant to your approved role and linked organisations." : "Your account is active. Request or review access before starting operational work."}</p></div>
        <Link className="button button--primary button--small" href="/app/onboarding">Partner setup <span aria-hidden="true">↗</span></Link>
      </div>

      {operationsPaused && <div className="inline-notice"><strong>Controlled launch.</strong> Real donation operations are paused until the operating area, food-safety policy, partner checks, privacy notice and security review are approved. Account and onboarding work remains available.</div>}

      {identity.memberships.length === 0 && identity.helperStatus !== "active" && identity.platformRoles.length === 0 && <div className="app-card app-card--full" style={{ marginBottom: 14 }}>
        <div className="app-card-title"><div><h2>Start with a partner request</h2><p>Your organisation and role remain pending until an authorised person records a review decision.</p></div><span className="status-pill status-pill--pending">review required</span></div>
        <EmptyState title="No approved partner access yet" text={identity.requestedRole ? `You selected ${identity.requestedRole} during account creation. Submit or track the access request in Partner setup; email verification alone does not grant role access.` : "Request Generator, Receiver or Helper onboarding. Sensitive actions stay unavailable until the review is recorded."} href="/app/onboarding" action="Continue onboarding" />
      </div>}

      {metricCards.length > 0 && <div className="dashboard-metrics" aria-label="Role-scoped workspace totals">
        {metricCards.map((metric) => <article className="app-card metric-card" key={metric.label}><span className="metric-label">{metric.label}</span><strong className="metric-value">{metric.value}</strong><span className="metric-caption">{metric.caption}</span></article>)}
      </div>}

      <div className="app-grid">
        {hasGenerator && <section className="app-card app-card--span-7">
          <div className="app-card-title"><div><h2>Your recent listings</h2><p>Food offered by your verified Generator organisation(s).</p></div><Link className="app-card-link" href="/app/listings">View history ↗</Link></div>
          {dashboard.generatorListings.length ? <div className="data-list">{dashboard.generatorListings.map((listing) => <Link className="data-row" key={String(listing.id)} href={`/app/listings/${listing.id}`}><span className="data-main"><strong>{String(listing.name)}</strong><small>{String(listing.quantity)} {String(listing.unit)} · best before {formatDate(listing.bestBeforeAt)}</small></span><span className={`status-pill status-pill--${String(listing.status)}`}>{String(listing.status).replaceAll("_", " ")}</span></Link>)}</div> : <EmptyState title="No listings yet" text="New listings are available only when the operations gate and an approved policy are active." href="/app/listings/new" action="Create a listing" />}
        </section>}

        {hasReceiver && <section className="app-card app-card--span-5">
          <div className="app-card-title"><div><h2>Offers to review</h2><p>Review every detail before responding.</p></div><Link className="app-card-link" href="/app/offers">All offers ↗</Link></div>
          {dashboard.receiverOffers.length ? <div className="data-list">{dashboard.receiverOffers.map((offer) => <Link className="data-row" key={String(offer.id)} href={`/app/offers/${offer.id}`}><span className="data-main"><strong>{String(offer.name)}</strong><small>{String(offer.quantity)} {String(offer.unit)} · category {String(offer.category)}</small></span><span className="status-pill status-pill--pending">review</span></Link>)}</div> : <EmptyState title="No offers waiting" text="New offers will appear here when a matching donation is available for your verified organisation." />}
        </section>}

        {hasHelper && <section className="app-card app-card--span-6">
          <div className="app-card-title"><div><h2>Deliveries assigned to you</h2><p>Only the information required for your work is shown.</p></div><Link className="app-card-link" href="/app/deliveries">My deliveries ↗</Link></div>
          {dashboard.myDeliveries.length ? <div className="data-list">{dashboard.myDeliveries.map((job) => <Link className="data-row" key={String(job.id)} href={`/app/deliveries/${job.id}`}><span className="data-main"><strong>{String(job.name)}</strong><small>{String(job.status).replaceAll("_", " ")} · {formatDate(job.collectedAt ?? job.deliveredAt)}</small></span><span className={`status-pill status-pill--${String(job.status)}`}>{String(job.status).replaceAll("_", " ")}</span></Link>)}</div> : <EmptyState title="No assigned deliveries" text="When a delivery is assigned, it will appear here with its approved handling instructions." />}
        </section>}

        {hasHelper && <section className="app-card app-card--span-6">
          <div className="app-card-title"><div><h2>Open deliveries nearby</h2><p>Only your approved service area is included.</p></div><Link className="app-card-link" href="/app/deliveries">Browse jobs ↗</Link></div>
          {dashboard.openDeliveries.length ? <div className="data-list">{dashboard.openDeliveries.map((job) => <Link className="data-row" key={String(job.id)} href={`/app/deliveries/${job.id}`}><span className="data-main"><strong>{String(job.name)}</strong><small>{String(job.pickupCity)} · collection by {formatDate(job.pickupLatestAt)}</small></span><span className="status-pill status-pill--open">open</span></Link>)}</div> : <EmptyState title="No open deliveries" text="There are no eligible delivery jobs in your approved service area right now." />}
        </section>}

        {dashboard.platformMetrics && <section className="app-card app-card--full">
          <div className="app-card-title"><div><h2>Operations review queues</h2><p>Continue in the restricted workbench to review records with the authority assigned to your platform role.</p></div><Link className="app-card-link" href="/app/operations">Open operations ↗</Link></div>
          <p className="form-hint">Partner approval, privacy decisions, policy publication and incident resolution require explicit human decisions. This overview does not change any record.</p>
        </section>}

        <section className="app-card app-card--full">
          <div className="app-card-title"><div><h2>Records that can be trusted</h2><p>Verified receipts are the source of delivery impact.</p></div></div>
          <div className="principle-list">
            <div className="principle-row"><span className="principle-check">01</span><div><strong>No estimated impact claims</strong><p>Quantities remain in the units partners recorded. No meals, kilograms or emissions are inferred.</p></div></div>
            <div className="principle-row"><span className="principle-check">02</span><div><strong>Changes leave a trace</strong><p>Important actions create timestamped audit and custody events; completed receipts cannot be silently edited.</p></div></div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
