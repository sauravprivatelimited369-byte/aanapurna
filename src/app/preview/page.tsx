import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ShieldCheck } from "lucide-react";
import { PublicLayout } from "@/components/public-shell";
import { DEMO_WORKSPACE, DEMO_WORKSPACE_NOTICE } from "@/domain/demo-workspace";

export const metadata: Metadata = {
  title: "Sample workspace walkthrough",
  description: "Walk through one food handover end to end with clearly fictional sample data. No account is needed.",
  robots: { index: false, follow: true },
};

const roleLabel: Record<string, string> = {
  generator: "Generator",
  receiver: "Receiver",
  helper: "Helper",
  system: "System",
};

function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DEMO_WORKSPACE.serviceArea.timeZone,
  }).format(date);
}

export default function PreviewPage() {
  const demo = DEMO_WORKSPACE;
  const generator = demo.organizations.find((organization) => organization.type === "generator");
  const receiver = demo.organizations.find((organization) => organization.type === "receiver");
  const claimant = demo.dispatch.candidates.find((candidate) => candidate.result === "claimed");
  const conflict = demo.dispatch.candidates.find((candidate) => candidate.result === "conflict");

  return (
    <PublicLayout active="/preview">
      <section className="section section--preview">
        <div className="container">
          <p className="demo-ribbon"><strong>Sample data</strong> — this walkthrough is not a live workspace</p>
          <div className="app-page-head">
            <div>
              <span className="app-eyebrow">No account needed</span>
              <h1>One donation, from surplus to confirmed receipt.</h1>
              <p>
                This is the same set of records the application keeps for a real handover — listing, offer, dispatch, custody events,
                single-use verification and receipt — rendered with fictional data so you can read the whole path before you sign up.
              </p>
            </div>
            <Link className="button button--primary button--small" href="/signup">
              Join Annapurna <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className="inline-notice" role="note">
            <strong>{DEMO_WORKSPACE_NOTICE}</strong> Sample figures appear here only so the arithmetic of a partial acceptance is visible;
            they are never added to real impact totals.
          </div>

          <div className="app-grid" style={{ marginBottom: 14 }}>
            <article className="app-card app-card--span-7">
              <div className="app-card-title">
                <div>
                  <h2>1 · Where this takes place</h2>
                  <p>The operating area and the policy version attached to every record below.</p>
                </div>
                <span className={`status-pill status-pill--${demo.serviceArea.policyStatus}`}>{demo.serviceArea.policyStatus} policy</span>
              </div>
              <div className="data-list">
                <div className="data-row"><span className="data-main"><strong>Service area</strong><small>{demo.serviceArea.name} · {demo.serviceArea.timeZone}</small></span><span className="status-pill status-pill--active">active</span></div>
                <div className="data-row"><span className="data-main"><strong>Operating policy</strong><small>{demo.serviceArea.policyVersion} — food categories, lead times and response windows</small></span><span className="status-pill status-pill--pending">draft</span></div>
                {demo.organizations.map((organization) => (
                  <div className="data-row" key={organization.id}>
                    <span className="data-main"><strong>{organization.displayName}</strong><small>{roleLabel[organization.type]} · {organization.area} · {organization.contact}</small></span>
                    <span className={`status-pill status-pill--${organization.status}`}>{organization.status}</span>
                  </div>
                ))}
              </div>
              <p className="demo-footnote">A real listing cannot leave draft until the policy is approved and the organisation is verified. The states are enforced on the server, not by hiding a button.</p>
            </article>

            <article className="app-card app-card--span-5">
              <div className="app-card-title"><div><h2>What a guest cannot do</h2><p>Sign-in is optional for reading. It is required for acting.</p></div></div>
              <ul className="demo-list">
                {demo.guestLimits.map((limit) => <li key={limit}>{limit}</li>)}
              </ul>
              <p className="demo-footnote">This page issues no request and stores nothing. The application itself never accepts a browser-supplied role or status.</p>
            </article>
          </div>

          <div className="app-grid" style={{ marginBottom: 14 }}>
            <article className="app-card app-card--span-6">
              <div className="app-card-title">
                <div><h2>2 · The Generator declares the food</h2><p>{demo.listing.reference} · submitted by {generator?.displayName}</p></div>
                <span className="status-pill status-pill--offered">offered</span>
              </div>
              <dl className="demo-facts">
                <div><dt>Food</dt><dd>{demo.listing.name} — {demo.listing.category}</dd></div>
                <div><dt>Quantity</dt><dd>{demo.listing.quantity} {demo.listing.unit}</dd></div>
                <div><dt>Ingredients</dt><dd>{demo.listing.ingredients}</dd></div>
                <div><dt>Allergens declared</dt><dd>{demo.listing.allergens.join(", ")}</dd></div>
                <div><dt>Prepared</dt><dd>{when(demo.listing.preparedAt)}</dd></div>
                <div><dt>Packed</dt><dd>{when(demo.listing.packedAt)}</dd></div>
                <div><dt>Best before</dt><dd>{when(demo.listing.bestBeforeAt)}</dd></div>
                <div><dt>Pickup window</dt><dd>{when(demo.listing.pickupFrom)} – {when(demo.listing.pickupUntil)}</dd></div>
                <div><dt>Storage</dt><dd>{demo.listing.storage}</dd></div>
                <div><dt>Handling</dt><dd>{demo.listing.handling}</dd></div>
                <div><dt>Note from the kitchen</dt><dd>{demo.listing.notes}</dd></div>
              </dl>
            </article>

            <article className="app-card app-card--span-6">
              <div className="app-card-title">
                <div><h2>3 · The Receiver answers inside the window</h2><p>{demo.offer.responder} has {demo.offer.responseWindowMinutes} minutes to respond</p></div>
                <span className="status-pill status-pill--accepted">partial accept</span>
              </div>
              <div className="data-list">
                <div className="data-row"><span className="data-main"><strong>Offered</strong><small>{demo.listing.quantity} {demo.listing.unit}</small></span><span aria-hidden="true" className="demo-arrow">→</span></div>
                <div className="data-row"><span className="data-main"><strong>Accepted</strong><small>{demo.offer.acceptedQuantity} {demo.offer.acceptedUnit} for the next service</small></span><span className="status-pill status-pill--accepted">accepted</span></div>
              </div>
              <p className="demo-quote">&ldquo;{demo.offer.reason}&rdquo;</p>
              <p className="demo-footnote">Capacity, category, allergen handling and pickup time are checked again on the server at the moment of acceptance. An expired or held listing cannot be accepted even if the page is stale.</p>
            </article>
          </div>

          <div className="app-grid" style={{ marginBottom: 14 }}>
            <article className="app-card app-card--span-6">
              <div className="app-card-title">
                <div><h2>4 · Dispatch is decided once</h2><p>{demo.dispatch.jobReference} · first valid claim wins</p></div>
                <span className="status-pill status-pill--assigned">assigned</span>
              </div>
              <div className="data-list">
                {demo.dispatch.candidates.map((candidate) => (
                  <div className="data-row" key={candidate.helper}>
                    <span className="data-main"><strong>{candidate.helper}</strong><small>{candidate.result === "claimed" ? "Conditional update succeeded — job assigned" : "Attempted at the same moment — told the job was already taken"}</small></span>
                    <span className={`status-pill status-pill--${candidate.result === "claimed" ? "assigned" : "rejected"}`}>{candidate.result}</span>
                  </div>
                ))}
                <div className="data-row">
                  <span className="data-main"><strong>{demo.dispatch.releasedBy}</strong><small>Released before collection · {demo.dispatch.releaseReason}</small></span>
                  <span className="status-pill status-pill--pending">released</span>
                </div>
              </div>
              <p className="demo-footnote">Two Helpers cannot hold the same job: an atomic database update plus a unique active-assignment constraint decides it. After collection, only an audited operations exception can reassign.</p>
            </article>

            <article className="app-card app-card--span-6" aria-labelledby="demo-verification">
              <div className="app-card-title">
                <div><h2 id="demo-verification">5 · The code stays with the Receiver</h2><p>Single use, tied to this delivery, shared only after inspection</p></div>
                <ShieldCheck size={20} aria-hidden="true" />
              </div>
              <div className="demo-code" aria-label="Masked example of a delivery code"><span>{demo.verification.maskedExample}</span><small>Example of the shape only — no code value is stored on this page.</small></div>
              <dl className="demo-facts">
                <div><dt>Format</dt><dd>{demo.verification.format}</dd></div>
                <div><dt>Who can see it</dt><dd>{demo.verification.visibleTo}</dd></div>
                <div><dt>Never visible to</dt><dd>{demo.verification.neverVisibleTo.join(" · ")}</dd></div>
                <div><dt>Wrong attempts</dt><dd>{demo.verification.attemptLimit} allowed, then the delivery locks</dd></div>
                <div><dt>Locked delivery</dt><dd>{demo.verification.resetPath}</dd></div>
              </dl>
            </article>
          </div>

          <article className="app-card app-card--full" style={{ marginBottom: 14 }}>
            <div className="app-card-title">
              <div><h2>6 · Custody timeline</h2><p>Append-only events. A correction is a new event, never an edit of an old one.</p></div>
              <span className="status-pill status-pill--delivered">delivered</span>
            </div>
            <ol className="demo-timeline">
              {demo.custody.map((event) => (
                <li key={`${event.at}-${event.event}`}>
                  <span className="demo-timeline-mark" aria-hidden="true" />
                  <div>
                    <p className="demo-timeline-head"><strong>{event.event}</strong> <span className={`status-pill status-pill--active`}>{roleLabel[event.actorRole]}</span></p>
                    <p className="demo-timeline-meta">{event.actor} · {when(event.at)}</p>
                    <p className="demo-timeline-detail">{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </article>

          <div className="app-grid" style={{ marginBottom: 14 }}>
            <article className="app-card app-card--span-7">
              <div className="app-card-title">
                <div><h2>7 · Receipt and what it may claim</h2><p>{demo.receipt.reference} · confirmed by {receiver?.displayName}</p></div>
                <span className="status-pill status-pill--verified">verified</span>
              </div>
              <div className="data-list">
                <div className="data-row"><span className="data-main"><strong>Quantity received</strong><small>{demo.receipt.quantity} {demo.receipt.unit} · keeps its recorded unit, never converted</small></span><span className="status-pill status-pill--verified">received</span></div>
                <div className="data-row"><span className="data-main"><strong>Collected</strong><small>{when(demo.receipt.collectedAt)}</small></span></div>
                <div className="data-row"><span className="data-main"><strong>Delivered and verified</strong><small>{when(demo.receipt.deliveredAt)}</small></span></div>
                <div className="data-row"><span className="data-main"><strong>Job</strong><small>{demo.dispatch.jobReference} · Helper {claimant?.helper}{conflict ? ` (second claim by ${conflict.helper} was refused)` : ""}</small></span></div>
              </div>
              <p className="demo-footnote">Only a verified receipt counts. Listed, accepted, claimed and collected food is never reported as delivered.</p>
            </article>

            <article className="app-card app-card--span-5">
              <div className="app-card-title"><div><h2>Sample totals for this walkthrough</h2><p>Shown so the partial acceptance is legible</p></div></div>
              <div className="dashboard-metrics" aria-label="Sample totals for this walkthrough">
                <article className="app-card metric-card"><span className="metric-label">Verified deliveries</span><strong className="metric-value">{demo.sample.verifiedDeliveries}</strong><span className="metric-caption">sample</span></article>
                <article className="app-card metric-card"><span className="metric-label">Portions received</span><strong className="metric-value">{demo.sample.verifiedPortions}</strong><span className="metric-caption">sample</span></article>
              </div>
              <p className="demo-footnote">{demo.sample.caption}</p>
              <p className="demo-footnote">The public impact page reads verified aggregates from the database and shows an explicit empty state until real receipts exist.</p>
            </article>
          </div>

          <div className="app-card app-card--full">
            <div>
              <h2>Want the real workspace?</h2>
              <p>
                Sign in to create a listing, respond to an offer, claim a job or record a handover. Partner access is requested at sign-up and
                granted only after a human review, so the first step is an access request, not a live donation.
              </p>
              <div className="hero-actions">
                <Link className="button button--primary" href="/signup">Request access <ArrowUpRight size={17} aria-hidden="true" /></Link>
                <Link className="button button--ghost" href="/how-it-works">Read the full process <ArrowRight size={16} aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
