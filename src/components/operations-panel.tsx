"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { OrganizationDocuments } from "@/components/organization-documents";

type ServiceArea = { id: string; label: string; countryCode: string; stateOrRegion: string | null; cityOrDistrict: string | null; timezone: string; active: boolean };
type OrganizationReview = { id: string; name: string; type: string; status: string; serviceAreaId: string | null; serviceAreaLabel: string | null; cityOrDistrict: string; stateOrRegion: string | null; contactName: string; contactEmail: string; submittedAt: string };
type HelperReview = { userId: string; displayName: string | null; status: string; serviceAreaId: string | null; serviceAreaLabel: string | null; availabilityNotes: string | null; trainingAcknowledgedAt: string | null; submittedAt: string; reviewedAt: string | null };
type Incident = { id: string; donationId: string; deliveryJobId: string | null; donationName: string; incidentType: string; severity: string; description: string; status: string; holdApplied: boolean; resolution: string | null; createdAt: string; closedAt: string | null };
type Policy = { id: string; version: string; status: string; rules: unknown; createdBy: string | null; approvedBy: string | null; approvedAt: string | null; effectiveFrom: string | null; createdAt: string };
type SupportCase = { id: string; reference: string; subject: string; description: string; status: string; organizationId: string | null; createdBy: string; createdByName: string | null; assignedTo: string | null; createdAt: string; updatedAt: string };
type DataRequest = { id: string; userId: string; userName: string | null; requestType: string; description: string | null; status: string; resolution: string | null; assignedTo: string | null; reviewedBy: string | null; completedAt: string | null; createdAt: string };
type Overview = { pendingOrganizations: number; openIncidents: number; verifiedDeliveries: number; emailOutbox: { pending: number; failed: number } };
type RecallableDonation = { id: string; name: string; status: string; category: string; quantity: string; unit: string; generatedAt: string };
type Recall = { id: string; donationId: string; donationName: string; status: string; reason: string; affectedReceiptCount: number; recalledStatus: string; initiatedAt: string; closedAt: string | null; closureNote: string | null };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—";
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as T | { error?: { message?: string } };
  if (!response.ok) throw new Error((result as { error?: { message?: string } }).error?.message ?? "The operations record could not be loaded.");
  return result as T;
}

export function OperationsPanel({ platformRoles, userId, initialOverview }: { platformRoles: string[]; userId: string; initialOverview: Overview | null }) {
  const isOperations = platformRoles.includes("operations_admin");
  const isSafety = platformRoles.includes("safety_officer");
  const isSupport = platformRoles.includes("support_agent");
  const isSecurity = platformRoles.includes("security_admin");
  const canReviewSafety = isOperations || isSafety;
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationReview[]>([]);
  const [helpers, setHelpers] = useState<HelperReview[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [supportCases, setSupportCases] = useState<SupportCase[]>([]);
  const [dataRequests, setDataRequests] = useState<DataRequest[]>([]);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [recallable, setRecallable] = useState<RecallableDonation[]>([]);
  const [overview, setOverview] = useState<Overview | null>(initialOverview);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const work: Array<Promise<void>> = [loadJson<Overview>("/api/admin/overview").then(setOverview)];
    if (isOperations) {
      work.push(loadJson<OrganizationReview[]>("/api/admin/organizations").then(setOrganizations));
      work.push(loadJson<{ helpers: HelperReview[]; serviceAreas: ServiceArea[] }>("/api/admin/helpers").then((data) => setHelpers(data.helpers)));
      work.push(loadJson<ServiceArea[]>("/api/admin/service-areas").then(setAreas));
    }
    if (canReviewSafety) {
      work.push(loadJson<Incident[]>("/api/admin/incidents").then(setIncidents));
      work.push(loadJson<Policy[]>("/api/admin/policies").then(setPolicies));
      work.push(loadJson<{ recalls: Recall[] }>("/api/admin/recalls").then((data) => setRecalls(data.recalls)));
      work.push(loadJson<{ donations: RecallableDonation[] }>("/api/admin/donations").then((data) => setRecallable(data.donations)));
      if (!isOperations) work.push(loadJson<ServiceArea[]>("/api/admin/service-areas").then(setAreas));
    }
    if (isOperations || isSupport) work.push(loadJson<SupportCase[]>("/api/support").then(setSupportCases));
    if (isOperations || isSupport || isSecurity) work.push(loadJson<DataRequest[]>("/api/data-requests").then(setDataRequests));
    const results = await Promise.allSettled(work);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) throw rejected.reason;
  }, [canReviewSafety, isOperations, isSecurity, isSupport]);

  useEffect(() => {
    let active = true;
    refresh().catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Operations data could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, loadAttempt]);

  async function mutate(id: string, endpoint: string, body: unknown, successMessage: string, method = "POST") {
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The review could not be saved.");
      setMessage(successMessage);
      try {
        await refresh();
      } catch {
        setError("The action was recorded, but the refreshed review queue could not be loaded. Retry to confirm its current status.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be saved.");
    } finally {
      setBusyId("");
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>, id: string, endpoint: string, map: (form: FormData) => unknown, successMessage: string, method = "POST") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void mutate(id, endpoint, map(form), successMessage, method);
  }

  const selectOptions = areas.filter((area) => area.active);

  return <div className="operations-stack">
    <div className="inline-notice"><strong>Controlled launch.</strong> Human policy approval and the independent launch gate are separate. This screen does not inspect, certify or declare food safe. Resolve an incident to close its record only; any safety hold remains in place until a separate authorised process is implemented.</div>
    {error && <div className="auth-error" role="alert"><span>{error}</span>{!loading && <button className="button button--secondary button--small" type="button" onClick={() => { setError(""); setLoading(true); setLoadAttempt((value) => value + 1); }}>Retry operations data</button>}</div>}
    {message && <div className="auth-status" role="status">{message}</div>}
    {loading && <div className="skeleton" style={{ height: 60 }} aria-busy="true" role="status" aria-label="Loading operations data" />}
    {(isOperations || canReviewSafety || isSupport || isSecurity) && <nav className="operations-toc" aria-label="Operations review sections">
      {isOperations && <><a href="#organization-reviews">Organisation reviews</a><a href="#helper-reviews">Helper reviews</a></>}
      {canReviewSafety && <><a href="#safety-incidents">Safety incidents</a><a href="#recalls">Recalls</a><a href="#food-policies">Food policies</a></>}
      {isOperations && <a href="#service-areas">Service areas</a>}
      {(isOperations || isSupport) && <a href="#support-cases">Support queue</a>}
      {(isOperations || isSupport || isSecurity) && <a href="#privacy-requests">Privacy requests</a>}
    </nav>}

    {overview && <section className="app-grid">
      <article className="app-card app-card--span-3 metric-card"><span className="metric-label">Partner requests awaiting review</span><strong className="metric-value">{overview.pendingOrganizations}</strong></article>
      <article className="app-card app-card--span-3 metric-card"><span className="metric-label">Open safety incidents</span><strong className="metric-value">{overview.openIncidents}</strong></article>
      <article className="app-card app-card--span-3 metric-card"><span className="metric-label">Verified delivery receipts</span><strong className="metric-value">{overview.verifiedDeliveries}</strong></article>
      {(isOperations || isSecurity) && <article className="app-card app-card--span-3 metric-card"><span className="metric-label">Email outbox · pending / failed</span><strong className="metric-value">{overview.emailOutbox.pending} / {overview.emailOutbox.failed}</strong></article>}
    </section>}

    {isOperations && <section id="organization-reviews" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Organisation verification queue</h2><p>Inspect private evidence and review each partner submission. Approval grants organisation membership; it does not enable donations.</p></div><span className="status-pill status-pill--pending">human review</span></div>
      {organizations.length ? <div className="data-list">{organizations.map((organization) => <article className="operation-record" key={organization.id}>
        <div className="operation-record-head"><div><strong>{organization.name}</strong><small>{organization.type} · {organization.cityOrDistrict}{organization.stateOrRegion ? `, ${organization.stateOrRegion}` : ""} · submitted {formatDate(organization.submittedAt)}</small><small>Contact: {organization.contactName} · {organization.contactEmail}</small></div><span className={`status-pill status-pill--${organization.status}`}>{organization.status.replaceAll("_", " ")}</span></div>
        <div className="form-field"><label htmlFor={`org-area-${organization.id}`}>Reviewed service area</label><select className="form-control" id={`org-area-${organization.id}`} form={`org-review-${organization.id}`} name="serviceAreaId" defaultValue={organization.serviceAreaId ?? ""}><option value="">Choose an active service area</option>{selectOptions.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</select></div>
        <OrganizationDocuments organizationId={organization.id} readOnly />
        <form id={`org-review-${organization.id}`} className="form-stack" onSubmit={(event) => submitForm(event, organization.id, `/api/admin/organizations/${organization.id}/decision`, (form) => ({ decision: form.get("decision"), reason: form.get("reason"), serviceAreaId: form.get("serviceAreaId") || null }), "Organisation review was recorded.")}>
          <div className="form-field"><label htmlFor={`org-decision-${organization.id}`}>Decision</label><select className="form-control" id={`org-decision-${organization.id}`} name="decision" defaultValue="request_information"><option value="approve">Verify and approve</option><option value="request_information">Request more information</option><option value="reject">Reject request</option><option value="suspend">Suspend organisation</option></select></div>
          <div className="form-field"><label htmlFor={`org-reason-${organization.id}`}>Reason for the record</label><textarea className="form-control" id={`org-reason-${organization.id}`} name="reason" required minLength={1} maxLength={500} rows={2} /></div>
          <button className="button button--primary button--small" type="submit" disabled={busyId === organization.id}>{busyId === organization.id ? "Saving…" : "Record human decision"}</button>
        </form>
      </article>)}</div> : <div className="empty-state"><div><strong>No organisation requests to review</strong><p>New submissions will appear here after partner onboarding.</p></div></div>}
    </section>}

    {isOperations && <section id="helper-reviews" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Helper review queue</h2><p>Approval is a human decision. The platform does not provide or certify safety training.</p></div></div>
      {helpers.filter((helper) => helper.status === "pending" || helper.status === "active" || helper.status === "rejected").length ? <div className="data-list">{helpers.filter((helper) => helper.status === "pending" || helper.status === "active" || helper.status === "rejected").map((helper) => <article className="operation-record" key={helper.userId}>
        <div className="operation-record-head"><div><strong>{helper.displayName || "Helper applicant"}</strong><small>{helper.userId} · requested {formatDate(helper.submittedAt)}</small><small>{helper.availabilityNotes || "No availability note provided"} · training acknowledged {helper.trainingAcknowledgedAt ? formatDate(helper.trainingAcknowledgedAt) : "not recorded"}</small></div><span className={`status-pill status-pill--${helper.status}`}>{helper.status}</span></div>
        {helper.status !== "rejected" && <form className="form-stack" onSubmit={(event) => submitForm(event, helper.userId, `/api/admin/helpers/${encodeURIComponent(helper.userId)}/decision`, (form) => ({ decision: form.get("decision"), reason: form.get("reason"), serviceAreaId: form.get("serviceAreaId") || null }), "Helper review was recorded.")}>
          {helper.status === "pending" && <div className="form-field"><label htmlFor={`helper-area-${helper.userId}`}>Assigned active service area</label><select className="form-control" id={`helper-area-${helper.userId}`} name="serviceAreaId" defaultValue={helper.serviceAreaId ?? ""}><option value="">Choose a service area</option>{selectOptions.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</select></div>}
          <div className="form-field"><label htmlFor={`helper-decision-${helper.userId}`}>Decision</label><select className="form-control" id={`helper-decision-${helper.userId}`} name="decision" defaultValue={helper.status === "active" ? "suspend" : "approve"}>{helper.status === "pending" ? <><option value="approve">Approve Helper access</option><option value="reject">Reject request</option></> : <option value="suspend">Suspend Helper access</option>}</select></div>
          <div className="form-field"><label htmlFor={`helper-reason-${helper.userId}`}>Reason for the record</label><textarea className="form-control" id={`helper-reason-${helper.userId}`} name="reason" required maxLength={500} rows={2} /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === helper.userId}>{busyId === helper.userId ? "Saving…" : "Record Helper decision"}</button>
        </form>}
      </article>)}</div> : <div className="empty-state"><div><strong>No Helper requests to review</strong><p>Applicants will appear here after submitting onboarding.</p></div></div>}
    </section>}

    {canReviewSafety && <section id="safety-incidents" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Safety incident register</h2><p>Close the incident record only. Any applied hold stays in place; a resolution is not a finding that food is safe.</p></div></div>
      {incidents.length ? <div className="data-list">{incidents.map((incident) => <article className="operation-record" key={incident.id}>
        <div className="operation-record-head"><div><strong>{incident.donationName} · {incident.incidentType.replaceAll("_", " ")}</strong><small>{incident.severity} severity · reported {formatDate(incident.createdAt)}</small><small>{incident.description}</small></div><span className={`status-pill status-pill--${incident.status}`}>{incident.status}</span></div>
        {incident.holdApplied && <div className="inline-notice"><strong>Safety hold applied.</strong> This workflow will not release the hold or restore delivery operations.</div>}
        {incident.status === "open" ? <form className="form-stack" onSubmit={(event) => submitForm(event, incident.id, `/api/admin/incidents/${incident.id}/resolve`, (form) => ({ resolution: form.get("resolution") }), "Incident record closed. Any applied safety hold remains active.")}>
          <div className="form-field"><label htmlFor={`incident-resolution-${incident.id}`}>Human review note</label><textarea className="form-control" id={`incident-resolution-${incident.id}`} name="resolution" required maxLength={800} rows={3} /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === incident.id}>{busyId === incident.id ? "Saving…" : "Close incident record"}</button>
        </form> : incident.resolution && <p className="form-hint">Reviewer note: {incident.resolution}</p>}
      </article>)}</div> : <div className="empty-state"><div><strong>No safety incidents recorded</strong><p>Incident reports will be visible to authorised safety staff.</p></div></div>}
    </section>}

    {canReviewSafety && <section id="recalls" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Recall register</h2><p>A recall stops the donation, records why, and names every receipt already issued for that batch. Closing a recall is a record-keeping decision: the donation stays recalled and does not return to distribution on its own.</p></div><span className="status-pill status-pill--pending">{recalls.filter((recall) => recall.status === "open").length} open</span></div>
      <form className="form-stack" onSubmit={(event) => submitForm(event, "recall-new", `/api/admin/donations/${String(new FormData(event.currentTarget).get("donationId"))}/recall`, (form) => ({ reason: form.get("reason") }), "Recall recorded. The donation is stopped and the parties notified.")}>
        <div className="app-grid">
          <div className="form-field app-card--span-6">
            <label htmlFor="recall-donation">Donation</label>
            <select className="form-control" id="recall-donation" name="donationId" required defaultValue="">
              <option value="" disabled>Select a recent donation</option>
              {recallable.map((donation) => <option key={donation.id} value={donation.id}>{donation.name} · {donation.status.replaceAll("_", " ")} · {donation.quantity} {donation.unit}</option>)}
            </select>
            <span className="form-hint">Only donations that still hold food can be recalled: offered, reserved, assigned, collected, delivered, expired or on hold.</span>
          </div>
          <div className="form-field app-card--span-6"><label htmlFor="recall-reason">Recall reason (sent to the parties)</label><textarea className="form-control" id="recall-reason" name="reason" required minLength={10} maxLength={1000} rows={3} placeholder="What was found, when, and what must not happen to this batch" /></div>
        </div>
        <button className="button button--secondary button--small" type="submit" disabled={busyId === "recall-new" || !recallable.length}>{busyId === "recall-new" ? "Recording…" : "Issue recall"}</button>
      </form>
      {recalls.length ? <div className="data-list">{recalls.map((recall) => <article className="operation-record" key={recall.id}>
        <div className="operation-record-head"><div><strong>{recall.donationName}</strong><small>recalled from {recall.recalledStatus.replaceAll("_", " ")} · issued {formatDate(recall.initiatedAt)} · {recall.affectedReceiptCount} receipt{recall.affectedReceiptCount === 1 ? "" : "s"} affected</small><small>{recall.reason}</small></div><span className={`status-pill status-pill--${recall.status === "open" ? "on_hold" : "completed"}`}>{recall.status}</span></div>
        {recall.status === "open" ? <form className="form-stack" onSubmit={(event) => submitForm(event, recall.id, `/api/admin/recalls/${recall.id}/close`, (form) => ({ closureNote: form.get("closureNote") }), "Recall closed. The donation stays recalled.")}>
          <div className="form-field"><label htmlFor={`recall-close-${recall.id}`}>Closure note</label><textarea className="form-control" id={`recall-close-${recall.id}`} name="closureNote" required minLength={10} maxLength={1000} rows={2} /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === recall.id}>{busyId === recall.id ? "Saving…" : "Close recall record"}</button>
        </form> : recall.closureNote && <p className="form-hint">Closure note: {recall.closureNote}</p>}
      </article>)}</div> : <div className="empty-state"><div><strong>No recalls recorded</strong><p>A recall can be issued for any donation that still holds food. Every recall keeps its reason, its author and the receipts it affected.</p></div></div>}
    </section>}

    {canReviewSafety && <section id="food-policies" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Food policy versions</h2><p>Policies are authored by an authorised human and approved by a different Safety Officer. Approval never toggles the separate operations launch gate.</p></div></div>
      <form className="policy-draft-form" onSubmit={(event) => submitForm(event, "policy-draft", "/api/admin/policies", (form) => ({
        version: form.get("version"),
        rules: {
          allowedCategories: String(form.get("allowedCategories") ?? "").split(",").map((part) => part.trim()).filter(Boolean),
          allowedFoodTypes: form.getAll("allowedFoodTypes").map(String),
          minimumPickupLeadMinutes: Number(form.get("minimumPickupLeadMinutes")),
          minimumExpiryAfterPickupMinutes: Number(form.get("minimumExpiryAfterPickupMinutes")),
          offerResponseMinutes: Number(form.get("offerResponseMinutes")),
          allowPartialAcceptance: form.get("allowPartialAcceptance") === "on",
          requireAllergenDisclosure: form.get("requireAllergenDisclosure") === "on",
        },
      }), "Food policy draft saved for separate review.")}>
        <div className="app-grid">
          <div className="form-field app-card--span-6"><label htmlFor="policy-version">Version</label><input className="form-control" id="policy-version" name="version" required maxLength={40} pattern="[A-Za-z0-9._-]+" placeholder="e.g. regional-2026-01" /></div>
          <div className="form-field app-card--span-6"><label htmlFor="policy-categories">Allowed categories</label><input className="form-control" id="policy-categories" name="allowedCategories" required maxLength={800} placeholder="Comma-separated categories" /></div>
          <div className="form-field app-card--span-4"><label htmlFor="policy-lead">Minimum pickup lead (minutes)</label><input className="form-control" id="policy-lead" name="minimumPickupLeadMinutes" type="number" min="0" max="10080" required defaultValue="0" /></div>
          <div className="form-field app-card--span-4"><label htmlFor="policy-expiry">Expiry buffer after pickup (minutes)</label><input className="form-control" id="policy-expiry" name="minimumExpiryAfterPickupMinutes" type="number" min="0" max="10080" required defaultValue="0" /></div>
          <div className="form-field app-card--span-4"><label htmlFor="policy-response">Offer response time (minutes)</label><input className="form-control" id="policy-response" name="offerResponseMinutes" type="number" min="5" max="240" required defaultValue="30" /></div>
          <fieldset className="form-field app-card--span-6"><legend className="form-label">Allowed food types</legend><label className="checkbox-row"><input type="checkbox" name="allowedFoodTypes" value="vegetarian" /> Vegetarian</label><label className="checkbox-row"><input type="checkbox" name="allowedFoodTypes" value="non_vegetarian" /> Non-vegetarian</label><label className="checkbox-row"><input type="checkbox" name="allowedFoodTypes" value="mixed" /> Mixed</label><label className="checkbox-row"><input type="checkbox" name="allowedFoodTypes" value="other" /> Other</label></fieldset>
          <fieldset className="form-field app-card--span-6"><legend className="form-label">Policy controls</legend><label className="checkbox-row"><input type="checkbox" name="allowPartialAcceptance" /> Allow partial acceptance</label><label className="checkbox-row"><input type="checkbox" name="requireAllergenDisclosure" defaultChecked /> Require allergen or ingredients disclosure</label></fieldset>
        </div>
        <button className="button button--primary button--small" type="submit" disabled={busyId === "policy-draft"}>{busyId === "policy-draft" ? "Saving…" : "Save policy draft"}</button>
      </form>
      {policies.length ? <div className="data-list policy-version-list">{policies.map((policy) => <article className="operation-record" key={policy.id}>
        <div className="operation-record-head"><div><strong>Policy {policy.version}</strong><small>Created {formatDate(policy.createdAt)}{policy.createdBy ? ` · author ${policy.createdBy}` : ""}</small>{policy.approvedAt && <small>Approved by {policy.approvedBy} · effective {formatDate(policy.effectiveFrom)}</small>}</div><span className={`status-pill status-pill--${policy.status}`}>{policy.status}</span></div>
        <pre className="policy-rules">{JSON.stringify(policy.rules, null, 2)}</pre>
        {policy.status === "draft" && isSafety && policy.createdBy !== null && policy.createdBy !== userId && <form className="inline-form" onSubmit={(event) => submitForm(event, `policy-${policy.id}`, `/api/admin/policies/${policy.id}/approve`, (form) => ({ effectiveFrom: new Date(String(form.get("effectiveFrom"))).toISOString() }), "Policy approved by a separate Safety Officer.")}>
          <div className="form-field"><label htmlFor={`policy-effective-${policy.id}`}>Effective from</label><input className="form-control" id={`policy-effective-${policy.id}`} name="effectiveFrom" type="datetime-local" required /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === `policy-${policy.id}`}>{busyId === `policy-${policy.id}` ? "Saving…" : "Approve as Safety Officer"}</button>
        </form>}
      </article>)}</div> : <div className="empty-state"><div><strong>No food policy versions</strong><p>Draft and approve a written policy before any real donation activity is enabled.</p></div></div>}
    </section>}

    {isOperations && <section id="service-areas" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Service areas</h2><p>Area activation enables onboarding choices and matching eligibility only; it does not enable donation operations.</p></div></div>
      <form className="service-area-form" onSubmit={(event) => submitForm(event, "service-area-create", "/api/admin/service-areas", (form) => ({
        label: form.get("label"), countryCode: form.get("countryCode"), stateOrRegion: form.get("stateOrRegion"), cityOrDistrict: form.get("cityOrDistrict"), timezone: form.get("timezone"), active: form.get("active") === "on",
      }), "Service area saved.")}>
        <div className="app-grid">
          <div className="form-field app-card--span-4"><label htmlFor="area-label">Area label</label><input className="form-control" id="area-label" name="label" required maxLength={120} /></div>
          <div className="form-field app-card--span-2"><label htmlFor="area-country">Country code</label><input className="form-control" id="area-country" name="countryCode" required defaultValue="IN" maxLength={2} pattern="[A-Za-z]{2}" /></div>
          <div className="form-field app-card--span-3"><label htmlFor="area-state">State or region</label><input className="form-control" id="area-state" name="stateOrRegion" maxLength={120} /></div>
          <div className="form-field app-card--span-3"><label htmlFor="area-city">City or district</label><input className="form-control" id="area-city" name="cityOrDistrict" maxLength={120} /></div>
          <div className="form-field app-card--span-6"><label htmlFor="area-timezone">IANA time zone</label><input className="form-control" id="area-timezone" name="timezone" required defaultValue="Asia/Kolkata" maxLength={80} /></div>
          <div className="form-field app-card--span-6"><label className="checkbox-row"><input type="checkbox" name="active" /> Make this area available to new requests</label></div>
        </div>
        <button className="button button--secondary button--small" type="submit" disabled={busyId === "service-area-create"}>{busyId === "service-area-create" ? "Saving…" : "Add service area"}</button>
      </form>
      {areas.length ? <div className="data-list">{areas.map((area) => <article className="data-row" key={area.id}><span className="data-main"><strong>{area.label}</strong><small>{area.countryCode}{area.stateOrRegion ? ` · ${area.stateOrRegion}` : ""}{area.cityOrDistrict ? ` · ${area.cityOrDistrict}` : ""} · {area.timezone}</small></span><span className={`status-pill status-pill--${area.active ? "active" : "pending"}`}>{area.active ? "active" : "inactive"}</span><button className="button button--secondary button--small" type="button" disabled={busyId === `area-${area.id}`} onClick={() => void mutate(`area-${area.id}`, `/api/admin/service-areas/${area.id}`, { active: !area.active }, area.active ? "Service area deactivated." : "Service area activated.", "PATCH")}>{area.active ? "Deactivate" : "Activate"}</button></article>)}</div> : <div className="empty-state"><div><strong>No service areas configured</strong><p>Add a human-reviewed operating area before approving partners.</p></div></div>}
    </section>}

    {(isOperations || isSupport) && <section id="support-cases" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Support queue</h2><p>Case content is visible only to its requester, related organisation members and authorised support staff.</p></div></div>
      {supportCases.length ? <div className="data-list">{supportCases.map((item) => <article className="operation-record" key={item.id}>
        <div className="operation-record-head"><div><strong>{item.reference} · {item.subject}</strong><small>{item.createdByName || item.createdBy} · opened {formatDate(item.createdAt)}</small><small>{item.description}</small></div><span className={`status-pill status-pill--${item.status}`}>{item.status.replaceAll("_", " ")}</span></div>
        <form className="inline-form" onSubmit={(event) => submitForm(event, `support-${item.id}`, `/api/support/${item.id}`, (form) => ({ status: form.get("status") }), "Support case updated.", "PATCH")}>
          <div className="form-field"><label htmlFor={`support-status-${item.id}`}>Status</label><select className="form-control" id={`support-status-${item.id}`} name="status" defaultValue={item.status}><option value="open">Open</option><option value="in_progress">In progress</option><option value="awaiting_user">Awaiting requester</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === `support-${item.id}`}>{busyId === `support-${item.id}` ? "Saving…" : "Update case"}</button>
        </form>
      </article>)}</div> : <div className="empty-state"><div><strong>No support cases</strong><p>Requests from the support workspace will appear here.</p></div></div>}
    </section>}

    {(isOperations || isSupport || isSecurity) && <section id="privacy-requests" className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Personal-data request queue</h2><p>Requests remain under review until authorised privacy/security staff record an outcome. Do not infer deletion or export completion.</p></div></div>
      {dataRequests.length ? <div className="data-list">{dataRequests.map((request) => <article className="operation-record" key={request.id}>
        <div className="operation-record-head"><div><strong>{request.requestType.replaceAll("_", " ")}</strong><small>{request.userName || request.userId} · submitted {formatDate(request.createdAt)}</small><small>{request.description || "No additional details"}</small>{request.resolution && <small>Reviewer note: {request.resolution}</small>}</div><span className={`status-pill status-pill--${request.status}`}>{request.status.replaceAll("_", " ")}</span></div>
        {(isOperations || isSecurity) && <form className="form-stack" onSubmit={(event) => submitForm(event, `data-${request.id}`, `/api/data-requests/${request.id}`, (form) => ({ status: form.get("status"), resolution: form.get("resolution") }), "Privacy request review recorded.", "PATCH")}>
          <div className="form-field"><label htmlFor={`data-status-${request.id}`}>Decision status</label><select className="form-control" id={`data-status-${request.id}`} name="status" defaultValue={request.status === "submitted" ? "in_review" : request.status}><option value="in_review">In review</option><option value="awaiting_user">Awaiting user</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select></div>
          <div className="form-field"><label htmlFor={`data-resolution-${request.id}`}>Reviewer response</label><textarea className="form-control" id={`data-resolution-${request.id}`} name="resolution" required maxLength={800} rows={2} /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busyId === `data-${request.id}`}>{busyId === `data-${request.id}` ? "Saving…" : "Record privacy review"}</button>
        </form>}
      </article>)}</div> : <div className="empty-state"><div><strong>No personal-data requests</strong><p>Requests will appear here for authorised reviewers.</p></div></div>}
    </section>}

    {!loading && !canReviewSafety && !isOperations && !isSupport && !isSecurity && <div className="inline-notice">Your account has no operations workspace permissions.</div>}
  </div>;
}
