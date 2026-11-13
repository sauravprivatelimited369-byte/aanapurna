import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountStateShell } from "@/components/account-state-shell";
import { AccountSignOut } from "@/components/account-sign-out";
import { dashboardHref, resolvePrimaryRole } from "@/lib/authorization";
import { getAccountState, getIdentity } from "@/lib/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account pending verification" };

const roleLabels: Record<string, string> = {
  generator: "Food Generator",
  receiver: "Receiver Organisation",
  helper: "Delivery Helper",
};

export default async function PendingPage() {
  const state = await getAccountState();
  if (state.state === "anonymous") redirect("/login?reason=session-expired");
  if (state.state === "suspended") redirect("/account/suspended");
  if (state.state === "unverified") redirect("/verify-email");

  const identity = await getIdentity();
  if (!identity) redirect("/login?reason=session-expired");
  const role = resolvePrimaryRole(identity);
  if (role !== "pending") redirect(dashboardHref(role));

  return <AccountStateShell
    eyebrow="Account status"
    title="Your account is waiting for review."
    description="Your email is verified and your session is real. Food operations stay closed until an authorised person approves your organisation or Helper profile."
  >
    <div className="account-state-panel" role="status">
      <strong>Signed in as {identity.email}</strong>
      <span>Requested access: {roleLabels[identity.requestedRole ?? ""] ?? "not recorded yet"}</span>
      <span>Approval status: <b>pending human review</b></span>
    </div>
    <div className="inline-notice">
      <strong>What happens next.</strong> Submit or check your partner request in Partner setup. A reviewer records the decision in the backend; email verification alone does not grant a role.
    </div>
    <div className="account-state-actions">
      <Link className="button button--primary" href="/app/onboarding">Continue partner setup</Link>
      <Link className="button button--ghost" href="/verify-email">Resend verification email</Link>
    </div>
    <div className="account-state-actions"><AccountSignOut /></div>
  </AccountStateShell>;
}
