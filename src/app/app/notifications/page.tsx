import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NotificationList } from "@/components/notification-list";
import { listNotifications } from "@/domain/service";
import { getIdentity } from "@/lib/identity";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  let items;
  try {
    const rows = await listNotifications(identity);
    items = rows.map((row) => ({
      ...row,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    items = null;
  }
  return <AppShell identity={identity} current="/app/notifications"><div className="app-page-head"><div><span className="app-eyebrow">Your activity</span><h1>Notifications.</h1><p>Review onboarding, offer and custody updates tied to your account.</p></div></div>
    {items ? <NotificationList initialNotifications={items} /> : <div className="inline-notice">Notifications could not be loaded. Refresh to retry.</div>}
  </AppShell>;
}
