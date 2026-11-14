import { redirect } from "next/navigation";
import { AccountStateShell } from "@/components/account-state-shell";
import { AccountSignOut } from "@/components/account-sign-out";
import { getAccountState } from "@/lib/identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account suspended" };

export default async function SuspendedPage() {
  const state = await getAccountState();
  if (state.state !== "suspended") redirect("/auth/continue");

  return <AccountStateShell
    eyebrow="Account status"
    title="This account cannot sign in."
    description="The account is suspended, locked or deactivated in the backend. No new session or protected data will be issued while this state is recorded."
  >
    <div className="auth-error" role="alert">
      Your existing session has been revoked for protected pages. Contact the organisation operating this deployment if you believe this is a mistake. We do not publish an unverified support address here.
    </div>
    <div className="inline-notice"><strong>Privacy.</strong> This page does not reveal whether an email address exists to anyone who is not already signed in with that account.</div>
    <div className="account-state-actions"><AccountSignOut /></div>
  </AccountStateShell>;
}
