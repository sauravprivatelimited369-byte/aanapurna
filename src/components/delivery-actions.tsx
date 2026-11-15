"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * One arrival check. Three states, not two: unset, passed, failed. There is no default, because a
 * pre-selected answer turns a safety record into a form somebody clicks through.
 */
function InspectionCheck({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (next: boolean) => void;
}) {
  return <div className="inspection-check">
    <span id={`${id}-label`}>{label}</span>
    <div className="inspection-check-options" role="group" aria-labelledby={`${id}-label`}>
      <label><input type="radio" name={id} checked={value === true} onChange={() => onChange(true)} /> Yes</label>
      <label><input type="radio" name={id} checked={value === false} onChange={() => onChange(false)} /> No</label>
    </div>
  </div>;
}

export function DeliveryActions({
  jobId,
  canClaim,
  canPickup,
  canReportArrival,
  canConfirmInspection,
  canVerify,
  canViewCode,
  canReportIncident,
  canReleaseAssignment,
  canSelfCollect,
}: {
  jobId: string;
  canClaim: boolean;
  canPickup: boolean;
  canReportArrival: boolean;
  canConfirmInspection: boolean;
  canVerify: boolean;
  canViewCode: boolean;
  canReportIncident: boolean;
  canReleaseAssignment: boolean;
  canSelfCollect: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pickupCondition, setPickupCondition] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [acceptanceConfirmed, setAcceptanceConfirmed] = useState(false);
  // The structured arrival checks. Every one starts unset: a pre-ticked box records a check nobody
  // made, which is worse than no record at all.
  const [sealIntact, setSealIntact] = useState<boolean | null>(null);
  const [packagingIntact, setPackagingIntact] = useState<boolean | null>(null);
  const [labelMatched, setLabelMatched] = useState<boolean | null>(null);
  const [withinWindow, setWithinWindow] = useState<boolean | null>(null);
  const [temperatureC, setTemperatureC] = useState("");
  const [code, setCode] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [incidentType, setIncidentType] = useState("quality_concern");
  const [severity, setSeverity] = useState("moderate");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [harmReported, setHarmReported] = useState(false);
  const [harmDetails, setHarmDetails] = useState("");
  const [releaseReason, setReleaseReason] = useState("");

  async function request(method: "POST", path: string, body?: Record<string, unknown>) {
    const response = await fetch(path, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as { error?: { message?: string }; code?: string; expiresAt?: string; verified?: boolean; attemptsRemaining?: number; receipt?: { reference: string }; failedChecks?: string[] };
    if (!response.ok) {
      if (result.verified === false) throw new Error(`That code did not match. ${result.attemptsRemaining ?? 0} attempts remain. Contact operations if locked.`);
      throw new Error(result.error?.message ?? "The action could not be completed.");
    }
    return result;
  }

  async function claim() {
    setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/claim`); setMessage("Delivery assigned to you. Check the collection window before travelling."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not claim this delivery."); }
    finally { setBusy(false); }
  }

  async function selfCollect() {
    setBusy(true); setError(""); setMessage("");
    try {
      await request("POST", `/api/jobs/${jobId}/self-collect`);
      setMessage("Your organisation is collecting this delivery. Record collection at the generator before the window closes; the same code and receipt steps apply.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start a self-collection."); }
    finally { setBusy(false); }
  }

  async function pickup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/pickup`, { condition: pickupCondition.trim() }); setMessage("Collection was recorded. Follow the handling instructions and go to the Receiver."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Collection could not be recorded."); }
    finally { setBusy(false); }
  }

  async function reportArrival() {
    setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/arrival`); setMessage("Arrival reported. Ask the Receiver to inspect and record acceptance before sharing the code."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Arrival could not be recorded."); }
    finally { setBusy(false); }
  }

  async function confirmInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await request("POST", `/api/jobs/${jobId}/inspection`, {
        acceptanceConfirmed,
        notes: inspectionNotes.trim(),
        sealIntact,
        packagingIntact,
        labelMatched,
        withinWindow,
        temperatureC: temperatureC.trim() === "" ? null : Number(temperatureC),
      });
      const failed = (result.failedChecks ?? []) as string[];
      setInspectionNotes(""); setAcceptanceConfirmed(false);
      setSealIntact(null); setPackagingIntact(null); setLabelMatched(null); setWithinWindow(null); setTemperatureC("");
      setMessage(failed.length > 0
        ? `Recorded, with failed checks: ${failed.join("; ")}. Your organisation accepted knowingly and operations can see it. If the food should not be distributed, report a concern now.`
        : "Your checks and acceptance were recorded. You may now show the delivery code to the assigned collector.");
      router.refresh();
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Your inspection could not be recorded."); }
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

  async function releaseAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await request("POST", `/api/jobs/${jobId}/release`, { reason: releaseReason.trim() }); setReleaseReason(""); setMessage("The assignment was released back to the open pool. The reason, the previous Helper and the time are recorded in the custody and audit records."); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The assignment could not be released."); }
    finally { setBusy(false); }
  }

  async function reportIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await request("POST", `/api/jobs/${jobId}/incident`, {
        incidentType, severity, description: incidentDescription.trim(),
        harmReported, harmDetails: harmReported ? harmDetails.trim() : null,
      });
      setIncidentDescription(""); setHarmReported(false); setHarmDetails("");
      setMessage("The concern was recorded. Follow the approved hold and escalation procedure; operations and safety staff were notified.");
      router.refresh();
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The report could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className="form-stack">
    {canSelfCollect && <div><p className="form-hint">Your organisation can collect this food itself instead of waiting for a Helper. You become the assigned collector, and the same collection, code and receipt steps apply. Start only if you can reach the generator within the window.</p><button className="button button--secondary" type="button" disabled={busy} onClick={() => void selfCollect()}>{busy ? "Please wait…" : "Collect it ourselves"}</button></div>}
    {canClaim && <div><p className="form-hint">Claiming assigns this delivery to you for a limited window. Do not claim unless you can complete the collection.</p><button className="button button--primary" type="button" disabled={busy} onClick={() => void claim()}>{busy ? "Please wait…" : "Claim delivery"}</button></div>}
    {canPickup && <form className="form-stack" onSubmit={pickup}><div className="form-field"><label htmlFor="pickup-condition">Collection condition</label><textarea className="form-control" id="pickup-condition" required maxLength={500} value={pickupCondition} onChange={(event) => setPickupCondition(event.target.value)} placeholder="Describe packaging and any relevant handling observation" /></div><button className="button button--primary" type="submit" disabled={busy || pickupCondition.trim().length < 1}>{busy ? "Recording…" : "Confirm collection"}</button></form>}
    {canReportArrival && <div><p className="form-hint">Only report arrival when you are physically at the receiving location.</p><button className="button button--primary" type="button" disabled={busy} onClick={() => void reportArrival()}>{busy ? "Recording…" : "Report physical arrival"}</button></div>}
    {canConfirmInspection && <form className="form-stack" onSubmit={confirmInspection}>
      <p className="form-hint">Check the delivery using your approved operating procedure. These four answers are the record of what you saw, and they cannot be edited afterwards. If you cannot accept the food, report a concern below and contact operations instead of accepting it. The platform does not certify food safety.</p>
      <fieldset className="inspection-checks">
        <legend>Arrival checks</legend>
        <InspectionCheck id="seal" label="The packaging seal was unbroken" value={sealIntact} onChange={setSealIntact} />
        <InspectionCheck id="packaging" label="The packaging was intact and not leaking" value={packagingIntact} onChange={setPackagingIntact} />
        <InspectionCheck id="label" label="The contents matched what was declared (ingredients and allergens)" value={labelMatched} onChange={setLabelMatched} />
        <InspectionCheck id="window" label="The food arrived inside its declared time window" value={withinWindow} onChange={setWithinWindow} />
      </fieldset>
      <div className="form-field">
        <label htmlFor="inspection-temperature">Temperature you read at handover (°C)</label>
        <input className="form-control" id="inspection-temperature" type="number" inputMode="decimal" step="0.1" min="-40" max="120" value={temperatureC} onChange={(event) => setTemperatureC(event.target.value)} placeholder="For example 63 or 4" />
        <span className="form-hint">Required when the listing declared a temperature requirement. Leave it blank if you took no reading — the record will say so.</span>
      </div>
      <div className="form-field"><label htmlFor="inspection-notes">Acceptance check observations</label><textarea className="form-control" id="inspection-notes" required maxLength={500} value={inspectionNotes} onChange={(event) => setInspectionNotes(event.target.value)} placeholder="Record what you saw, and anything the four answers above do not cover" /></div>
      <label><input type="checkbox" checked={acceptanceConfirmed} onChange={(event) => setAcceptanceConfirmed(event.target.checked)} required /> I confirm the assigned collector has physically arrived, my organisation completed these checks, and we accept custody of this food.</label>
      <button className="button button--primary" type="submit" disabled={busy || !acceptanceConfirmed || !inspectionNotes.trim() || sealIntact === null || packagingIntact === null || labelMatched === null || withinWindow === null}>{busy ? "Recording…" : "Record checks and acceptance"}</button>
    </form>}
    {canViewCode && <div className="form-stack"><p className="form-hint">Only request this when the Helper has physically arrived and your acceptance checks are complete. Never share the code earlier.</p><button className="button button--secondary" type="button" onClick={() => void revealCode()} disabled={busy}>{code ? "Refresh delivery code" : "Show delivery code"}</button>{code && <div className="otp-display" aria-label="One-time delivery code"><span>{code.slice(0,3)}</span><span>{code.slice(3)}</span></div>}</div>}
    {canVerify && <form className="form-stack" onSubmit={verify}><div className="form-field"><label htmlFor="delivery-code">Receiver&apos;s six-digit code</label><input className="form-control otp-input" id="delivery-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} minLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></div><span className="form-hint">This field is sent only to the verification endpoint; the code is never returned to the Helper.</span><button className="button button--primary" type="submit" disabled={busy || verificationCode.length !== 6}>{busy ? "Verifying…" : "Verify delivery"}</button></form>}
    {canReleaseAssignment && <details className="incident-details"><summary>Operations: release this assignment</summary><form className="form-stack" onSubmit={releaseAssignment}><p className="form-hint">Use this when the assigned Helper cannot complete the collection. The delivery returns to the open pool and the Helper is notified. Once food has been collected, this is unavailable — record an incident and a hold instead.</p><div className="form-field"><label htmlFor="release-reason">Why is this being released?</label><textarea className="form-control" id="release-reason" required minLength={10} maxLength={500} value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="For example: Helper unreachable after 40 minutes and collection window closes in 25 minutes" /></div><button className="button button--secondary" type="submit" disabled={busy || releaseReason.trim().length < 10}>{busy ? "Releasing…" : "Release assignment"}</button></form></details>}
    {canReportIncident && <details className="incident-details"><summary>Report a concern or incident</summary><form className="form-stack" onSubmit={reportIncident}><div className="form-field"><label htmlFor="incident-type">Concern type</label><select className="form-control" id="incident-type" value={incidentType} onChange={(event) => setIncidentType(event.target.value)}><option value="damaged_packaging">Damaged packaging</option><option value="temperature_concern">Temperature concern</option><option value="allergen_mismatch">Allergen or label mismatch</option><option value="quality_concern">Quality concern</option><option value="delay">Delay</option><option value="failed_collection">Failed collection</option><option value="other">Other</option></select></div><div className="form-field"><label htmlFor="incident-severity">Severity</label><select className="form-control" id="incident-severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></div><div className="form-field"><label htmlFor="incident-description">What happened?</label><textarea className="form-control" id="incident-description" required maxLength={1000} value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} /></div>
      <label><input type="checkbox" checked={harmReported} onChange={(event) => setHarmReported(event.target.checked)} /> Somebody may have been harmed or become unwell</label>
      {harmReported && <div className="form-field"><label htmlFor="incident-harm">Who was affected, and how?</label><textarea className="form-control" id="incident-harm" required minLength={10} maxLength={1000} value={harmDetails} onChange={(event) => setHarmDetails(event.target.value)} placeholder="For example: two people who ate at the shelter reported stomach pain the same evening" /><span className="form-hint">This escalates the report to operations, the safety officer and security rather than waiting in a queue.</span></div>}
      <button className="button button--danger" type="submit" disabled={busy || (harmReported && harmDetails.trim().length < 10)}>{busy ? "Submitting…" : "Submit report"}</button></form></details>}
    {error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-status" role="status">{message}</div>}
  </div>;
}
