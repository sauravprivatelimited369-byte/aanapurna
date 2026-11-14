import { redirect } from "next/navigation";
import { getAccountState, hadSessionCookie } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Central server-side gate for every /app page. Individual pages and every API
 * route still check authorisation themselves; this removes unauthenticated,
 * suspended and unverified sessions before any workspace UI renders.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await getAccountState();
  if (state.state === "anonymous") redirect(await hadSessionCookie() ? "/login?reason=session-expired" : "/login");
  if (state.state === "suspended") redirect("/account/suspended");
  if (state.state === "unverified") redirect("/verify-email");
  return <>{children}</>;
}
