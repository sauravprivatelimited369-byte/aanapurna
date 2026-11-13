"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function DeliveryActions({
  jobId,
  canClaim,
  canPickup,
  canVerify,
  canViewCode,
  canReportIncident,
}: {
  jobId: string;
  canClaim: boolean;
  canPickup: boolean;
  canVerify: boolean;
  canViewCode: boolean;
  canReportIncident: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pickupCondition, setPickupCondition] = useState("");
  const [code, setCode] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [incidentType, setIncidentType] = useState("quality_concern");
  const [severity, setSeverity] = useState("moderate");
  const [incidentDescription, setIncidentDescription] = useState("");

  async function request(method: "POST", path: string, body?: Record<string, unknown>) {
    const response = await fetch(path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as { error?: { message?: string }; code?: string; expiresAt?: string; verified?: boolean; attemptsRemaining?: number; receipt?: { reference: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "The action could not be completed.");
    return result;
  }

  async function claim() {
    setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/claim`); setMessage("Delivery assigned to you. Check the collection window before travelling."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not claim this delivery."); }
    finally { setBusy(false); }
  }

  async function pickup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/pickup`, { condition: pickupCondition.trim() }); setMessage("Collection was recorded. Follow the handling instructions and go to the Receiver."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Collection could not be recorded."); }
    finally { setBusy(false); }
  }

  async function revealCode() {
    setBusy(true); setError(""); setMessage(""); setCode("");
    try { const result = await request("POST", `/api/jobs/${jobId}/code`); setCode(result.code ?? ""); setMessage(`Share this code only with the assigned Helper after physical arrival and your acceptance checks. Expires ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(result.expiresAt ?? ""))}.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The code is unavailable."); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { const result = await request("POST", `/api/jobs/${jobId}/verify`, { code: verificationCode }); setVerificationCode(""); if (result.verified) { setMessage(`Delivery verified. Receipt ${result.receipt?.reference ?? "recorded"} was created.`); router.refresh(); } else { setError(`That code did not match. ${result.attemptsRemaining ?? 0} attempts remain.`); } }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Delivery verification could not be completed."); }
    finally { setBusy(false); }
  }

  async function reportIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/incident`, { incidentType, severity, description: incidentDescription.trim() }); setIncidentDescription(""); setMessage("The concern was recorded. Follow the approved hold and escalation procedure; operations and safety staff were notified."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The report could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className="form-stack">
    {canClaim && <div><p className="form-hint">Claiming assigns this delivery to you for a limited window. Do not claim unless you can complete the collection.</p><button className="button button--primary" type="button" disabled={busy} onClick={() => void claim()}>{busy ? "Please wait…" : "Claim delivery"}</button></div>}
    {canPickup && <form className="form-stack" onSubmit={pickup}><div className="form-field"><label htmlFor="pickup-condition">Collection condition</label><textarea className="form-control" id="pickup-condition" required maxLength={500} value={pickupCondition} onChange={(event) => setPickupCondition(event.target.value)} placeholder="Describe packaging and any relevant handling observation" /></div><button className="button button--primary" type="submit" disabled={busy || pickupCondition.trim().length < 1}>{busy ? "Recording…" : "Confirm collection"}</button></form>}
    {canViewCode && <div className="form-stack"><p className="form-hint">Only request this when the Helper has physically arrived and your acceptance checks are complete. Never share the code earlier.</p><button className="button button--secondary" type="button" onClick={() => void revealCode()} disabled={busy}>{code ? "Refresh delivery code" : "Show delivery code"}</button>{code && <div className="otp-display" aria-label="One-time delivery code"><span>{code.slice(0,3)}</span><span>{code.slice(3)}</span></div>}</div>}
    {canVerify && <form className="form-stack" onSubmit={verify}><div className="form-field"><label htmlFor="delivery-code">Receiver&apos;s six-digit code</label><input className="form-control otp-input" id="delivery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} minLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></div><span className="form-hint">This field is sent only to the verification endpoint; the code is never returned to the Helper.</span><button className="button button--primary" type="submit" disabled={busy || verificationCode.length !== 6}>{busy ? "Verifying…" : "Verify delivery"}</button></form>}
    {canReportIncident && <details className="incident-details"><summary>Report a concern or incident</summary><form className="form-stack" onSubmit={reportIncident}><div className="form-field"><label htmlFor="incident-type">Concern type</label><select className="form-control" id="incident-type" value={incidentType} onChange={(event) => setIncidentType(event.target.value)}><option value="damaged_packaging">Damaged packaging</option><option value="temperature_concern">Temperature concern</option><option value="allergen_mismatch">Allergen or label mismatch</option><option value="quality_concern">Quality concern</option><option value="delay">Delay</option><option value="failed_collection">Failed collection</option><option value="other">Other</option></select></div><div className="form-field"><label htmlFor="incident-severity">Severity</label><select className="form-control" id="incident-severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></div><div className="form-field"><label htmlFor="incident-description">What happened?</label><textarea className="form-control" id="incident-description" required maxLength={1000} value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} /></div><button className="button button--danger" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit report"}</button></form></details>}
    {error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-status" role="status">{message}</div>}
  </div>;
}
