"use client";

import Link from "next/link";
import { useState } from "react";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

function localHref(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

export function NotificationList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function markRead(id: string) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${id}`, { method: "PATCH", cache: "no-store" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "This notification could not be updated.");
      setNotifications((rows) => rows.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This notification could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  if (notifications.length === 0) return <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">◉</span><strong>No notifications yet</strong><p>Important review and handover updates will appear here.</p></div></div>;

  return <div className="data-list notification-list">
    {error && <div className="auth-error" role="alert">{error}</div>}
    {notifications.map((notification) => <article className={`notification-row${notification.readAt ? " is-read" : " is-unread"}`} key={notification.id}>
      <div className="notification-copy"><div className="notification-heading"><strong>{notification.title}</strong>{!notification.readAt && <span className="status-pill status-pill--pending">new</span>}</div>
        <p>{notification.body}</p><small>{notification.kind.replaceAll("_", " ")} · {formatDate(notification.createdAt)}</small>
      </div>
      <div className="notification-actions"><Link className="app-card-link" href={localHref(notification.href)}>Open ↗</Link>
        {!notification.readAt && <button className="button button--secondary button--small" type="button" disabled={busyId === notification.id} onClick={() => void markRead(notification.id)}>{busyId === notification.id ? "Saving…" : "Mark read"}</button>}
      </div>
    </article>)}
  </div>;
}
