import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AccountSecurity } from "@/components/account-security";
import { MyDataPanel } from "@/components/my-data-panel";
import { TwoFactorPanel } from "@/components/two-factor-panel";
import { PartnerCompliance } from "@/components/partner-compliance";
import { AGREEMENT_STATUS_LABEL, AGREEMENT_VERSION, PARTNER_AGREEMENT_CLAUSES } from "@/domain/partner-agreement";
import { requiresTwoFactorEnrolment } from "@/lib/identity";
import { getIdentity } from "@/lib/identity";
import { getUserProfile } from "@/domain/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile and security" };

const roleLabel: Record<string, string> = {
  operations_admin: "Operations administrator",
  support_agent: "Support agent",
  safety_officer: "Compliance and safety officer",
  security_admin: "Security administrator",
};

export default async function ProfilePage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");

  const profile = await getUserProfile(identity.id);

  return (
    <AppShell identity={identity} current="/app/profile">
      <div className="app-page-head">
        <div>
          <span className="app-eyebrow">Your account</span>
          <h1>Profile and security</h1>
          <p>Your account details, the access you hold, and the sessions this account is signed in on. Changing a password or ending a session is recorded in the audit trail.</p>
        </div>
        <Link className="button button--secondary button--small" href="/app/support">Support &amp; privacy <span aria-hidden="true">↗</span></Link>
      </div>

      <div className="app-grid" style={{ marginBottom: 14 }}>
        <section className="app-card app-card--span-6">
          <div className="app-card-title"><div><h2>Account</h2><p>Read your own verified details here. Corrections go through support so the change is attributable.</p></div></div>
          <dl className="demo-facts">
            <div><dt>Name</dt><dd>{identity.name}</dd></div>
            <div><dt>Email</dt><dd>{identity.email}</dd></div>
            <div><dt>Account id</dt><dd>{identity.id}</dd></div>
            <div><dt>Requested role</dt><dd>{identity.requestedRole ?? "None recorded"}</dd></div>
            <div><dt>Helper status</dt><dd>{identity.helperStatus ?? "Not a Helper"}</dd></div>
          </dl>
        </section>

        <section className="app-card app-card--span-6">
          <div className="app-card-title"><div><h2>Access you hold</h2><p>Organisation membership and platform roles, as stored on the server.</p></div></div>
          {identity.platformRoles.length > 0 && <div className="data-list" style={{ marginBottom: 12 }}>
            {identity.platformRoles.map((role) => <div className="data-row" key={role}>
              <span className="data-main"><strong>{roleLabel[role] ?? role}</strong><small>Restricted platform role</small></span>
              <span className="status-pill status-pill--active">granted</span>
            </div>)}
          </div>}
          {identity.memberships.length > 0 ? <div className="data-list">{identity.memberships.map((membership) => <div className="data-row" key={membership.id}>
            <span className="data-main"><strong>{membership.organizationName}</strong><small>{membership.organizationType === "generator" ? "Food Generator" : "Receiver organisation"} · {membership.role} · organisation {membership.organizationStatus}</small></span>
            <span className={`status-pill status-pill--${membership.organizationStatus}`}>{membership.status}</span>
          </div>)}</div> : <div className="empty-state"><div><strong>No organisation membership</strong><p>Start or track a partner request in Partner setup. Membership is granted by a human review, never by signing in.</p></div></div>}
        </section>
      </div>

      {identity.memberships.length > 0 && <PartnerCompliance
        memberships={identity.memberships.map((membership) => ({
          id: membership.id,
          organizationId: membership.organizationId,
          organizationName: membership.organizationName,
          role: membership.role,
        }))}
        agreementVersion={AGREEMENT_VERSION}
        clauses={PARTNER_AGREEMENT_CLAUSES.map((clause) => ({ heading: clause.heading, body: clause.body }))}
        statusLabel={AGREEMENT_STATUS_LABEL}
      />}

      <TwoFactorPanel enabled={identity.twoFactorEnabled} requiredForRole={identity.platformRoles.length > 0} />

      {requiresTwoFactorEnrolment(identity) && <div className="auth-error" role="alert" style={{ marginBottom: 14 }}>
        <strong>Restricted features are blocked.</strong> Your account holds a platform role, so application actions are refused until a second factor is confirmed above. Pages stay readable.
      </div>}

      <MyDataPanel currentDisplayName={profile?.displayName ?? null} />

      <AccountSecurity />

      <div className="inline-notice" style={{ marginTop: 18 }}>
        <strong>Locked out?</strong> Password reset by email needs a configured mail provider. Until one is set, an operations administrator can restore access for your account and records the reason in the audit trail — see <Link href="/contact">contact and support</Link>.
      </div>
    </AppShell>
  );
}
