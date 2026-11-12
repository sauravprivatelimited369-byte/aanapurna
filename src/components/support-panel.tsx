"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Membership = { organizationId: string; organizationName: string };
type SupportCase = { id: string; reference: string; subject: string; description: string; status: string; createdAt: string; updatedAt: string };
type DataRequest = { id: string; requestType: string; description: string | null; status: string; resolution: string | null; createdAt: string; completedAt: string | null };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

async function loadList<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as unknown;
  if (!response.ok || !Array.isArray(result)) throw new Error("This request list is temporarily unavailable.");
  return result as T[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "This request list is temporarily unavailable.";
}

export function SupportPanel({ memberships }: { memberships: Membership[] }) {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [casesError, setCasesError] = useState("");
  const [requestsError, setRequestsError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const [caseResult, requestResult] = await Promise.allSettled([
      loadList<SupportCase>("/api/support"),
      loadList<DataRequest>("/api/data-requests"),
    ]);
    if (caseResult.status === "fulfilled") {
      setCases(caseResult.value);
      setCasesError("");
    } else {
      setCasesError(errorText(caseResult.reason));
    }
    if (requestResult.status === "fulfilled") {
      setRequests(requestResult.value);
      setRequestsError("");
    } else {
      setRequestsError(errorText(requestResult.reason));
    }
  }, []);

  async function refreshLists() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(reload)
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Requests could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: string, successMessage: string) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSending(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body: Record<string, unknown> = Object.fromEntries(form.entries());
    if (body.organizationId === "") body.organizationId = null;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Your request could not be submitted.");
      formElement.reset();
      setMessage(successMessage);
      await refreshLists();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your request could not be submitted.");
    } finally {
      setSending(false);
    }
  }

  return <div className="app-grid">
    <section className="app-card app-card--span-6">
      <div className="app-card-title"><div><h2>Contact support</h2><p>Share a clear description. Do not include passwords, sign-in links or unnecessary health or identity details.</p></div></div>
      <form className="form-stack" onSubmit={(event) => void submit(event, "/api/support", "Your support request was submitted. Track its reference below when the request list is available.")}>
        <div className="form-field"><label htmlFor="support-organization">Related organisation <span className="form-hint">(optional)</span></label><select className="form-control" id="support-organization" name="organizationId" defaultValue=""><option value="">Not about a specific organisation</option>{memberships.map((membership) => <option key={membership.organizationId} value={membership.organizationId}>{membership.organizationName}</option>)}</select></div>
        <div className="form-field"><label htmlFor="support-subject">Subject</label><input className="form-control" id="support-subject" name="subject" required maxLength={160} /></div>
        <div className="form-field"><label htmlFor="support-description">What happened?</label><textarea className="form-control" id="support-description" name="description" required maxLength={2000} rows={5} /></div>
        <button className="button button--primary button--small" type="submit" disabled={sending}>{sending ? "Submitting…" : "Send support request"}</button>
      </form>
    </section>

    <section className="app-card app-card--span-6">
      <div className="app-card-title"><div><h2>Privacy and personal-data request</h2><p>Submit a request for review. The platform will not claim completion until an authorised reviewer records the outcome.</p></div></div>
      <form className="form-stack" onSubmit={(event) => void submit(event, "/api/data-requests", "Your personal-data request was submitted for review.")}>
        <div className="form-field"><label htmlFor="data-request-type">Request type</label><select className="form-control" id="data-request-type" name="requestType" required defaultValue="access"><option value="access">Access my personal data</option><option value="export">Export a copy</option><option value="rectification">Correct inaccurate data</option><option value="erasure">Request erasure</option><option value="restriction">Restrict processing</option><option value="objection">Object to processing</option><option value="other">Other privacy request</option></select></div>
        <div className="form-field"><label htmlFor="data-request-description">Details for the privacy reviewer <span className="form-hint">(optional)</span></label><textarea className="form-control" id="data-request-description" name="description" maxLength={1000} rows={4} /></div>
        <button className="button button--secondary button--small" type="submit" disabled={sending}>{sending ? "Submitting…" : "Submit privacy request"}</button>
      </form>
    </section>

    {error && <div className="auth-error app-card--full" role="alert">{error}</div>}
    {message && <div className="auth-status app-card--full" role="status">{message}</div>}

    <section className="app-card app-card--span-6">
      <div className="app-card-title"><div><h2>Your support requests</h2><p>Private to you and the authorised support team.</p></div></div>
      {loading ? <div className="skeleton" style={{ height: 80 }} aria-busy="true" role="status" aria-label="Loading support requests" /> : casesError ? <div className="empty-state"><div><strong>Support requests are unavailable</strong><p>{casesError}</p><button className="app-card-link" type="button" disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshLists()}>{refreshing ? "Refreshing lists…" : "Retry request lists"}</button></div></div> : cases.length ? <div className="data-list">{cases.map((item) => <article className="data-row" key={item.id}><span className="data-main"><strong>{item.reference} · {item.subject}</strong><small>{item.description} · updated {formatDate(item.updatedAt)}</small></span><span className={`status-pill status-pill--${item.status}`}>{item.status.replaceAll("_", " ")}</span></article>)}</div> : <div className="empty-state"><div><strong>No support requests</strong><p>Requests you submit will appear here.</p></div></div>}
    </section>

    <section className="app-card app-card--span-6">
      <div className="app-card-title"><div><h2>Your privacy requests</h2><p>Track status and the recorded reviewer response.</p></div></div>
      {loading ? <div className="skeleton" style={{ height: 80 }} aria-busy="true" role="status" aria-label="Loading privacy requests" /> : requestsError ? <div className="empty-state"><div><strong>Privacy requests are unavailable</strong><p>{requestsError}</p><button className="app-card-link" type="button" disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshLists()}>{refreshing ? "Refreshing lists…" : "Retry request lists"}</button></div></div> : requests.length ? <div className="data-list">{requests.map((item) => <article className="data-row data-row--stack" key={item.id}><span className="data-main"><strong>{item.requestType.replaceAll("_", " ")}</strong><small>Submitted {formatDate(item.createdAt)}{item.description ? ` · ${item.description}` : ""}</small>{item.resolution && <small className="request-resolution">Reviewer update: {item.resolution}</small>}</span><span className={`status-pill status-pill--${item.status}`}>{item.status.replaceAll("_", " ")}</span></article>)}</div> : <div className="empty-state"><div><strong>No privacy requests</strong><p>Requests you submit will appear here until a reviewer records an outcome.</p></div></div>}
    </section>
  </div>;
}
