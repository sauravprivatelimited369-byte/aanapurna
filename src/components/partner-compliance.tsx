"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Membership = { id: string; organizationId: string; organizationName: string; role: string };
type AgreementState = {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  acceptedCurrent: boolean;
  insurancePolicyReference: string | null;
  insuranceExpiresOn: string | null;
  insuranceCurrent: boolean;
};

type AgreementClause = { heading: string; body: string };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—";
}

/**
 * Two declarations every partner has to make, and the reason each one exists.
 *
 * The insurance field records what an organisation says its cover is. The agreement panel records
 * which version of the responsibility text a named person accepted, and it shows the text rather than
 * a link to it, so nobody can accept something they were not shown. Neither creates cover or a
 * contract; both are what an investigation would read afterwards.
 *
 * `canAccept` is false for a viewer, and the server enforces the same role check — the interface is
 * a courtesy, not the control.
 */
export function PartnerCompliance({
  memberships,
  agreementVersion,
  clauses,
  statusLabel,
}: {
  memberships: Membership[];
  agreementVersion: string;
  clauses: AgreementClause[];
  statusLabel: string;
}) {
  const [orgId, setOrgId] = useState(memberships[0]?.organizationId ?? "");
  const [state, setState] = useState<AgreementState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [policyReference, setPolicyReference] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const currentRole = memberships.find((membership) => membership.organizationId === orgId)?.role ?? "";
  const canDeclare = ["owner", "manager"].includes(currentRole);
  const canAccept = ["owner", "manager", "operator"].includes(currentRole);

  const load = useCallback(async (organizationId: string) => {
    if (!organizationId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/organizations/${organizationId}/agreement`, { cache: "no-store" });
      const result = await response.json() as AgreementState & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The compliance record could not be loaded.");
      setState(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The compliance record could not be loaded.");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(orgId); });
    return () => { active = false; };
  }, [orgId, load]);

  async function saveInsurance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/organizations/${orgId}/insurance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insurancePolicyReference: policyReference.trim(), insuranceExpiresOn: expiresOn }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The insurance declaration could not be saved.");
      setPolicyReference(""); setExpiresOn("");
      setMessage("Insurance declaration recorded. It is a declaration with an expiry, not cover the platform verified — launch readiness reads it and re-opens when it lapses.");
      await load(orgId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The insurance declaration could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptAgreement() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/organizations/${orgId}/agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: agreementVersion, accepted: true }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The acceptance could not be recorded.");
      setAcknowledged(false);
      setMessage(`Accepted version ${agreementVersion} for this organisation. The record stores who accepted, when, and a fingerprint of the exact text above.`);
      await load(orgId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The acceptance could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (!memberships.length) {
    return <section className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Partner declarations</h2><p>Insurance and the responsibility agreement belong to an organisation, not an account.</p></div></div>
      <div className="empty-state"><div><strong>No organisation on this account</strong><p>These declarations appear once your organisation membership is approved.</p></div></div>
    </section>;
  }

  return <section className="app-card app-card--full" id="partner-declarations">
    <div className="app-card-title">
      <div>
        <h2>Partner declarations</h2>
        <p>Two things every partner has to record before the pilot can be called ready: what cover it holds, and which version of the responsibility agreement a named person accepted.</p>
      </div>
      {memberships.length > 1 && <label className="inline-select">
        <span className="sr-only">Organisation</span>
        <select className="form-control" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
          {memberships.map((membership) => <option key={membership.organizationId} value={membership.organizationId}>{membership.organizationName}</option>)}
        </select>
      </label>}
    </div>

    {error && <div className="auth-error" role="alert">{error}</div>}
    {message && <div className="auth-status" role="status" aria-live="polite">{message}</div>}
    {loading && <div className="skeleton" style={{ height: 52 }} aria-busy="true" role="status" aria-label="Loading declarations" />}

    {state && <div className="app-grid">
      <div className="app-card app-card--span-6 compliance-card">
        <h3>Responsibility agreement</h3>
        <p className="form-hint">{statusLabel}</p>
        <dl className="demo-facts">
          <div><dt>Current version</dt><dd>{state.currentVersion}</dd></div>
          <div><dt>Accepted version</dt><dd>{state.acceptedVersion ?? "None"}</dd></div>
          <div><dt>Accepted on</dt><dd>{formatDate(state.acceptedAt)}</dd></div>
        </dl>
        <span className={`status-pill status-pill--${state.acceptedCurrent ? "active" : "pending"}`}>
          {state.acceptedCurrent ? "current" : state.acceptedVersion ? "stale — a newer version exists" : "not accepted"}
        </span>

        <details className="agreement-text">
          <summary>Read the agreement before accepting</summary>
          <div className="agreement-body">
            {clauses.map((clause, index) => <div key={clause.heading}>
              <h4>{index + 1}. {clause.heading}</h4>
              <p>{clause.body}</p>
            </div>)}
          </div>
        </details>

        {state.acceptedCurrent
          ? <p className="form-hint">This organisation has accepted the current version. If the text changes, a new version appears here and this organisation is asked again.</p>
          : <>
            <label className="checkbox-row">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={!canAccept || busy} />
              <span>I have read the agreement, I am authorised to act for this organisation, and I accept it for version {state.currentVersion}.</span>
            </label>
            {!canAccept && <p className="form-hint">Only an owner, manager or operator of this organisation can accept. Your role is {currentRole}.</p>}
            <button className="button button--primary button--small" type="button" disabled={!acknowledged || !canAccept || busy} onClick={() => void acceptAgreement()}>
              {busy ? "Recording…" : "Accept for this organisation"}
            </button>
          </>}
      </div>

      <div className="app-card app-card--span-6 compliance-card">
        <h3>Insurance declaration</h3>
        <p className="form-hint">The policy this organisation holds. A declaration with an expiry — not cover this platform has verified with an insurer.</p>
        <dl className="demo-facts">
          <div><dt>Policy reference</dt><dd>{state.insurancePolicyReference ?? "Not recorded"}</dd></div>
          <div><dt>Expires on</dt><dd>{state.insuranceExpiresOn ?? "—"}</dd></div>
        </dl>
        <span className={`status-pill status-pill--${state.insuranceCurrent ? "active" : "pending"}`}>
          {state.insuranceCurrent ? "current" : state.insurancePolicyReference ? "expired" : "not declared"}
        </span>

        {canDeclare
          ? <form className="form-stack" onSubmit={saveInsurance} style={{ marginTop: 14 }}>
            <div className="form-field">
              <label htmlFor="insurance-reference">Policy or cover reference</label>
              <input className="form-control" id="insurance-reference" required minLength={3} maxLength={120} value={policyReference} onChange={(event) => setPolicyReference(event.target.value)} placeholder="As it appears on the policy" />
            </div>
            <div className="form-field">
              <label htmlFor="insurance-expiry">Expires on</label>
              <input className="form-control" id="insurance-expiry" type="date" required value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
              <span className="form-hint">A date in the future. The launch gate reports this organisation as uncovered the day after it passes, with nobody editing anything.</span>
            </div>
            <button className="button button--secondary button--small" type="submit" disabled={busy || !policyReference.trim() || !expiresOn}>{busy ? "Saving…" : "Record declaration"}</button>
          </form>
          : <p className="form-hint">Only an owner or manager can record this declaration. Your role is {currentRole}.</p>}
      </div>
    </div>}
  </section>;
}
