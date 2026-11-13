"use client";

import { FormEvent, useEffect, useState } from "react";
import { OrganizationDocuments } from "@/components/organization-documents";

type OnboardingData = {
  profile: { requestedRole: "generator" | "receiver" | "helper" | null; status: string } | null;
  organizations: Array<{ id: string; name: string; type: string; status: string; membershipStatus: string; cityOrDistrict: string; reason: string | null }>;
  helper: { status: string; serviceAreaId: string | null } | null;
  serviceAreas: Array<{ id: string; label: string }>;
};

async function loadOnboarding(): Promise<OnboardingData> {
  const response = await fetch("/api/onboarding", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load your partner requests.");
  return response.json() as Promise<OnboardingData>;
}

export function OnboardingPanel({ initialRole = "generator" }: { initialRole?: "generator" | "receiver" | "helper" }) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [role, setRole] = useState<"generator" | "receiver" | "helper">(initialRole);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    loadOnboarding().then((value) => { if (active) { setData(value); if (value.profile?.requestedRole) setRole(value.profile.requestedRole); setStatusError(""); } })
      .catch(() => { if (active) setStatusError("Partner setup could not be loaded. Check your connection and retry."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSending(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const serviceArea = String(form.get("serviceAreaId") ?? "");
    const shared = { role, serviceAreaId: serviceArea || null };
    let body: Record<string, unknown>;
    if (role === "helper") {
      body = { ...shared, availabilityNotes: String(form.get("availabilityNotes") ?? ""), trainingAcknowledged: form.get("trainingAcknowledged") === "on" };
    } else {
      body = {
        ...shared,
        organizationName: String(form.get("organizationName") ?? ""),
        operatingAddress: String(form.get("operatingAddress") ?? ""),
        cityOrDistrict: String(form.get("cityOrDistrict") ?? ""),
        stateOrRegion: String(form.get("stateOrRegion") ?? ""),
        postalCode: String(form.get("postalCode") ?? ""),
        contactName: String(form.get("contactName") ?? ""),
        contactEmail: String(form.get("contactEmail") ?? ""),
        contactPhone: String(form.get("contactPhone") ?? ""),
        ...(role === "receiver" ? {
          receivingCapacity: Number(form.get("receivingCapacity") || 0),
          capacityUnit: String(form.get("capacityUnit") || "servings"),
          foodCapabilities: String(form.get("foodCapabilities") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        } : {}),
      };
    }

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Request could not be submitted.");
      setSuccess("Your onboarding request was submitted. It is pending human review; no operational permissions have been granted.");
      formElement.reset();
      try {
        setData(await loadOnboarding());
        setStatusError("");
      } catch {
        setStatusError("Your request was submitted, but its updated review status could not be loaded. Retry the status panel below.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be submitted. Try again.");
    } finally {
      setSending(false);
    }
  }

  return <div className="app-grid">
    <section className="app-card app-card--span-7">
      <div className="app-card-title"><div><h2>Request partner access</h2><p>Every request stays pending until an authorised person reviews it.</p></div></div>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-field"><label htmlFor="role">I am requesting to join as</label><select className="form-control" id="role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="generator">Generator / food donor</option><option value="receiver">Receiver / community organisation</option><option value="helper">Helper / delivery partner</option></select></div>
        {role !== "helper" ? <>
          <div className="form-field"><label htmlFor="organizationName">Organisation name</label><input className="form-control" id="organizationName" name="organizationName" required maxLength={160} placeholder="Registered or operating name" /></div>
          <div className="form-field"><label htmlFor="operatingAddress">Operating address</label><textarea className="form-control" id="operatingAddress" name="operatingAddress" required maxLength={500} placeholder="Street address, building or pickup location" /></div>
          <div className="app-grid" style={{ gap: 10 }}>
            <div className="form-field app-card--span-6"><label htmlFor="cityOrDistrict">City or district</label><input className="form-control" id="cityOrDistrict" name="cityOrDistrict" required maxLength={120} /></div>
            <div className="form-field app-card--span-6"><label htmlFor="stateOrRegion">State or region</label><input className="form-control" id="stateOrRegion" name="stateOrRegion" maxLength={120} /></div>
            <div className="form-field app-card--span-6"><label htmlFor="postalCode">Postal code</label><input className="form-control" id="postalCode" name="postalCode" maxLength={20} autoComplete="postal-code" /></div>
            <div className="form-field app-card--span-6"><label htmlFor="serviceAreaId">Requested service area</label><select className="form-control" id="serviceAreaId" name="serviceAreaId" defaultValue=""><option value="">Not listed yet</option>{data?.serviceAreas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</select></div>
          </div>
          <div className="app-grid" style={{ gap: 10 }}>
            <div className="form-field app-card--span-6"><label htmlFor="contactName">Responsible contact</label><input className="form-control" id="contactName" name="contactName" required maxLength={120} autoComplete="name" /></div>
            <div className="form-field app-card--span-6"><label htmlFor="contactEmail">Operational email</label><input className="form-control" id="contactEmail" name="contactEmail" type="email" required maxLength={254} /></div>
            <div className="form-field app-card--span-6"><label htmlFor="contactPhone">Operational phone <span className="form-hint">(optional)</span></label><input className="form-control" id="contactPhone" name="contactPhone" type="tel" maxLength={32} /></div>
          </div>
          {role === "receiver" && <>
            <div className="app-grid" style={{ gap: 10 }}><div className="form-field app-card--span-6"><label htmlFor="receivingCapacity">Receiving capacity</label><input className="form-control" id="receivingCapacity" name="receivingCapacity" type="number" min="1" max="100000" step="any" required /></div><div className="form-field app-card--span-6"><label htmlFor="capacityUnit">Capacity unit</label><select className="form-control" id="capacityUnit" name="capacityUnit"><option value="servings">Servings</option><option value="kg">Kilograms</option><option value="g">Grams</option><option value="litre">Litres</option><option value="portion">Portions</option><option value="box">Boxes</option></select></div></div>
            <div className="form-field"><label htmlFor="foodCapabilities">Food categories you can receive</label><input className="form-control" id="foodCapabilities" name="foodCapabilities" maxLength={500} placeholder="Add only categories you can actually handle" /><span className="form-hint">Separate entries with commas. A human reviewer must confirm each capability.</span></div>
          </>}
        </> : <>
          <div className="form-field"><label htmlFor="serviceAreaId">Requested service area</label><select className="form-control" id="serviceAreaId" name="serviceAreaId" defaultValue=""><option value="">Not listed yet</option>{data?.serviceAreas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</select></div>
          <div className="form-field"><label htmlFor="availabilityNotes">Availability notes <span className="form-hint">(optional)</span></label><textarea className="form-control" id="availabilityNotes" name="availabilityNotes" maxLength={500} placeholder="Days or broad availability, not a live location" /></div>
          <label className="form-label" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><input type="checkbox" name="trainingAcknowledged" required style={{ marginTop: 3 }} /><span>I understand that this request is not Helper approval or safety training. I will wait for the required human review before accepting any delivery.</span></label>
        </>}
        <div className="inline-notice"><strong>Pending means pending.</strong> This request does not verify an organisation, approve a Helper, or enable food operations. Evidence uploads are available on the organisation record after submission.</div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {success && <div className="auth-status" role="status">{success}</div>}
        <button className="button button--primary" type="submit" disabled={sending || loading}>{sending ? "Submitting…" : "Submit for human review"} <span aria-hidden="true">↗</span></button>
      </form>
    </section>
    <section className="app-card app-card--span-5">
      <div className="app-card-title"><div><h2>Review status</h2><p>Requests linked to your account.</p></div></div>
      {loading ? <div aria-busy="true" role="status" aria-label="Loading partner requests"><div className="skeleton" style={{ height: 58, marginBottom: 9 }} /><div className="skeleton" style={{ height: 58 }} /></div> : statusError ? <div className="empty-state"><div><strong>Current review status is unavailable</strong><p>{statusError}</p><button className="app-card-link" type="button" onClick={() => { setStatusError(""); setLoading(true); setLoadAttempt((value) => value + 1); }}>Retry status check</button></div></div> : data?.organizations.length || data?.helper ? <div className="data-list">
        {data?.organizations.map((organization) => <div className="onboarding-org" key={organization.id}><article className="data-row"><span className="data-main"><strong>{organization.name}</strong><small>{organization.type} · {organization.cityOrDistrict} · membership {organization.membershipStatus}</small>{organization.reason && <small>Reviewer note: {organization.reason}</small>}</span><span className={`status-pill status-pill--${organization.status}`}>{organization.status.replaceAll("_", " ")}</span></article><OrganizationDocuments organizationId={organization.id} /></div>)}
        {data?.helper && <article className="data-row"><span className="data-main"><strong>Helper profile</strong><small>Human approval and required checks are still pending.</small></span><span className={`status-pill status-pill--${data.helper.status}`}>{data.helper.status}</span></article>}
      </div> : <div className="empty-state"><div><span className="empty-icon" aria-hidden="true">◇</span><strong>No request yet</strong><p>Submit the form to begin a review. A request does not grant access.</p></div></div>}
    </section>
  </div>;
}
