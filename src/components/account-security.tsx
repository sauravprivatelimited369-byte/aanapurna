"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type SessionSummary = {
  id: string;
  device: string;
  network: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}

async function loadSessions(): Promise<SessionSummary[]> {
  const response = await fetch("/api/account/sessions", { cache: "no-store" });
  const result = await response.json() as { sessions?: SessionSummary[]; error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "Your sessions could not be loaded.");
  return result.sessions ?? [];
}

/**
 * Account security for a signed-in person: change the password, see which devices
 * hold a session, and end any of them. Session tokens stay on the server; this
 * component only ever handles session ids.
 */
export function AccountSecurity() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const refresh = useCallback(async () => {
    setSessions(await loadSessions());
  }, []);

  useEffect(() => {
    let active = true;
    loadSessions()
      .then((next) => { if (active) { setSessions(next); setLoadError(""); } })
      .catch((caught) => { if (active) setLoadError(caught instanceof Error ? caught.message : "Your sessions could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadAttempt]);

  async function revoke(sessionId: string) {
    setBusyId(sessionId);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "That session could not be ended.");
      setMessage("Session ended. That device must sign in again.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That session could not be ended.");
    } finally {
      setBusyId("");
    }
  }

  async function revokeOthers() {
    setBusyId("others");
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "others" }),
      });
      const result = await response.json() as { revoked?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Other sessions could not be ended.");
      setMessage(result.revoked ? `${result.revoked} other session${result.revoked === 1 ? "" : "s"} ended.` : "No other sessions were active.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Other sessions could not be ended.");
    } finally {
      setBusyId("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    setPasswordError("");
    setMessage("");
    if (newPassword !== confirmation) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword,
          revokeOtherSessions: form.get("revokeOtherSessions") === "on",
        }),
      });
      const result = await response.json() as { error?: { message?: string }; otherSessionsRevoked?: boolean };
      if (!response.ok) throw new Error(result.error?.message ?? "The password could not be changed.");
      setMessage(result.otherSessionsRevoked
        ? "Password changed. Every other session was signed out."
        : "Password changed. Your other sessions stay signed in.");
      event.currentTarget.reset();
      await refresh();
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : "The password could not be changed.");
    } finally {
      setPasswordBusy(false);
    }
  }

  return <div className="operations-stack">
    {error && <div className="auth-error" role="alert"><span>{error}</span></div>}
    {message && <div className="auth-status" role="status">{message}</div>}

    <section className="app-card app-card--full" id="password">
      <div className="app-card-title"><div><h2>Change your password</h2><p>Your current password is required, so a stolen session cannot take the account over on its own.</p></div></div>
      {passwordError && <div className="auth-error" role="alert"><span>{passwordError}</span></div>}
      <form className="form-stack" onSubmit={changePassword}>
        <div className="app-grid">
          <div className="form-field app-card--span-4"><label htmlFor="current-password">Current password</label><input className="form-control" id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></div>
          <div className="form-field app-card--span-4"><label htmlFor="new-password">New password</label><input className="form-control" id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="new-password-help" /><span className="form-hint" id="new-password-help">12–128 characters, mixed case, a number and a symbol.</span></div>
          <div className="form-field app-card--span-4"><label htmlFor="confirm-password">Confirm new password</label><input className="form-control" id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></div>
        </div>
        <label className="checkbox-row"><input type="checkbox" name="revokeOtherSessions" defaultChecked /> Sign out every other session when the password changes</label>
        <button className="button button--primary button--small" type="submit" disabled={passwordBusy}>{passwordBusy ? "Changing…" : "Change password"}</button>
      </form>
    </section>

    <section className="app-card app-card--full" id="sessions">
      <div className="app-card-title"><div><h2>Signed-in sessions</h2><p>Sessions this account currently holds. Tokens never leave the server; this page refers to them by id only.</p></div>
        {sessions.length > 1 && <button className="button button--secondary button--small" type="button" onClick={revokeOthers} disabled={busyId === "others"}>{busyId === "others" ? "Ending…" : "Sign out other sessions"}</button>}
      </div>
      {loading && <div className="skeleton" style={{ height: 60 }} aria-busy="true" role="status" aria-label="Loading sessions" />}
      {!loading && loadError && <div className="auth-error" role="alert"><span>{loadError}</span><button className="button button--secondary button--small" type="button" onClick={() => { setLoadError(""); setLoading(true); setReloadAttempt((value) => value + 1); }}>Retry</button></div>}
      {!loading && !loadError && (sessions.length ? <div className="data-list">{sessions.map((session) => <div className="data-row data-row--stack" key={session.id}>
        <span className="data-main"><strong>{session.device}{session.current ? " · this device" : ""}</strong><small>{session.network ?? "Network not recorded"} · signed in {formatDate(session.createdAt)} · last used {formatDate(session.lastUsedAt)} · expires {formatDate(session.expiresAt)}</small></span>
        {session.current
          ? <span className="status-pill status-pill--active">current</span>
          : <button className="button button--secondary button--small" type="button" onClick={() => revoke(session.id)} disabled={busyId === session.id}>{busyId === session.id ? "Ending…" : "End session"}</button>}
      </div>)}</div> : <div className="empty-state"><div><strong>No sessions listed</strong><p>Reload the page. If this persists, sign out and sign in again.</p></div></div>)}
    </section>
  </div>;
}
