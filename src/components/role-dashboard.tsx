import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getDashboard } from "@/domain/service";
import type { DashboardRole } from "@/lib/authorization";
import type { Identity } from "@/lib/identity";

type Role = Exclude<DashboardRole, "pending">;

const copy: Record<Role, { eyebrow: string; title: string; description: string }> = {
  admin: {
    eyebrow: "Administration workspace",
    title: "Platform administration.",
    description: "User management, organisation verification, listing and delivery monitoring, incidents and analytics are restricted to granted platform roles.",
  },
  generator: {
    eyebrow: "Generator workspace",
    title: "Your food donations.",
    description: "Manage your own profile and listings, follow your own delivery history and view your own receipts.",
  },
  receiver: {
    eyebrow: "Receiver workspace",
    title: "Food for your organisation.",
    description: "Manage your organisation profile, view deliveries addressed to it and access only your authorised delivery codes and received-food history.",
  },
  helper: {
    eyebrow: "Helper workspace",
    title: "Your delivery work.",
    description: "Browse eligible open donations, accept delivery requests and complete your own assigned deliveries.",
  },
};

const quickLinks: Record<Role, Array<{ href: string; label: string; detail: string }>> = {
  admin: [
    { href: "/app/operations", label: "Operations & review", detail: "Verify organisations, review incidents and monitor platform records." },
    { href: "/api/admin/overview", label: "Administration data", detail: "Backend-enforced overview endpoint (JSON)." },
    { href: "/app/support", label: "Support & privacy", detail: "Review support and data-request queues." },
    { href: "/app/onboarding", label: "Partner setup", detail: "Inspect onboarding records." },
  ],
  generator: [
    { href: "/app/listings", label: "My food listings", detail: "Only listings belonging to your verified organisations." },
    { href: "/app/listings/new", label: "Create a listing", detail: "Available when operations and an approved policy are active." },
    { href: "/app/deliveries", label: "Delivery history", detail: "Records linked to your own donations only." },
    { href: "/app/onboarding", label: "My profile", detail: "Manage your organisation profile and verification status." },
  ],
  receiver: [
    { href: "/app/offers", label: "Offers to my organisation", detail: "Only offers addressed to your verified organisation." },
    { href: "/app/deliveries", label: "Deliveries to my organisation", detail: "Authorised delivery OTPs and received-food history." },
    { href: "/app/onboarding", label: "Organisation profile", detail: "Manage your organisation's details." },
  ],
  helper: [
    { href: "/app/deliveries", label: "Browse available deliveries", detail: "Eligible open donations in your approved service area." },
    { href: "/app/deliveries", label: "My assigned deliveries", detail: "Confirm pickup, submit verification and view your own history." },
    { href: "/app/onboarding", label: "Helper profile", detail: "View your approval status and availability." },
  ],
};

export async function RoleDashboard({ identity, role, current }: {
  identity: Identity;
  role: Role;
  current: string;
}) {
  let dashboard: Awaited<ReturnType<typeof getDashboard>> | null = null;
  try {
    dashboard = await getDashboard(identity);
  } catch {
    // A read failure must not expose another user's records or claim success.
  }

  const firstName = identity.name.trim().split(/\s+/)[0] || "there";
  const operationsPaused = process.env.OPERATIONS_ENABLED !== "true";
  const metrics: Array<{ label: string; value: number; caption: string }> = [];

  if (dashboard) {
    if (role === "generator") metrics.push({ label: "My listings", value: dashboard.metrics.listings, caption: "Records on your Generator organisations" });
    if (role === "receiver") metrics.push({ label: "Offers awaiting response", value: dashboard.metrics.awaitingReceiver, caption: "Pending offers for your organisations" });
    if (role === "helper" || role === "receiver") metrics.push({ label: "Active deliveries", value: dashboard.metrics.activeDeliveries, caption: "Open, assigned or collected work visible to your role" });
    if (role !== "admin") metrics.push({ label: "Verified deliveries", value: dashboard.metrics.verifiedDeliveries, caption: "Receipts confirmed for your role" });
    if (role === "admin" && dashboard.platformMetrics) {
      metrics.push(
        { label: "Partner requests pending review", value: dashboard.platformMetrics.organizationsPending, caption: "All requests awaiting a human decision" },
        { label: "Deliveries in progress", value: dashboard.platformMetrics.activeDeliveries, caption: "Platform-wide open, assigned or collected work" },
        { label: "Open safety incidents", value: dashboard.platformMetrics.openIncidents, caption: "Restricted to authorised operations and safety staff" },
      );
    }
  }

  return <AppShell identity={identity} current={current} notificationCount={dashboard?.notificationCount ?? 0}>
    <div className="app-page-head">
      <div>
        <span className="app-eyebrow">{copy[role].eyebrow}</span>
        <h1>Welcome, {firstName}.</h1>
        <p>{copy[role].description}</p>
      </div>
      <Link className="button button--primary button--small" href="/app">Full workspace <span aria-hidden="true">↗</span></Link>
    </div>

    {operationsPaused && <div className="inline-notice"><strong>Controlled launch.</strong> Real donation operations are paused until a human-approved operating policy, partner checks and security review are recorded. Account, profile and verification work remains available.</div>}

    {!dashboard && <div className="auth-error" role="alert">This dashboard could not load live records. No data was substituted and no action was recorded. Refresh to try again.</div>}

    {metrics.length > 0 && <div className="dashboard-metrics" aria-label="Role-scoped dashboard totals">
      {metrics.map((metric) => <article className="app-card metric-card" key={metric.label}>
        <span className="metric-label">{metric.label}</span>
        <strong className="metric-value">{metric.value}</strong>
        <span className="metric-caption">{metric.caption}</span>
      </article>)}
    </div>}

    <div className="app-grid">
      <section className="app-card app-card--full">
        <div className="app-card-title"><div><h2>Where you can go</h2><p>Every destination re-checks your role and organisation membership on the server.</p></div></div>
        <div className="data-list">
          {quickLinks[role].map((link) => <Link className="data-row" href={link.href} key={`${link.href}-${link.label}`}>
            <span className="data-main"><strong>{link.label}</strong><small>{link.detail}</small></span>
            <span aria-hidden="true">↗</span>
          </Link>)}
        </div>
      </section>
      <section className="app-card app-card--full">
        <div className="app-card-title"><div><h2>How your access was decided</h2><p>Trusted backend data only.</p></div></div>
        <div className="principle-list">
          <div className="principle-row"><span className="principle-check">01</span><div><strong>Your role came from the database</strong><p>Platform roles, verified organisation memberships and Helper approval are read from PostgreSQL after session validation. No dropdown, URL or browser storage decides access.</p></div></div>
          <div className="principle-row"><span className="principle-check">02</span><div><strong>Other users&apos; records stay private</strong><p>Row Level Security plus explicit API authorisation restrict listings, offers, deliveries, delivery codes and profile details to the authorised account.</p></div></div>
        </div>
      </section>
    </div>
  </AppShell>;
}
