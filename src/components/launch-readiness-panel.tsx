"use client";

/**
 * Launch readiness.
 *
 * Five requirements on the register cannot be met by a commit: a legal entity, insurance, a named
 * data-protection contact, a staffed rota and an independent penetration test. This panel makes that
 * honest instead of decorative. It shows which named fact is missing, what evidence was recorded,
 * when it expires, and who declared it — and it goes red again on its own when the expiry passes.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ReadinessItem } from "@/domain/readiness";

type Readiness = { items: ReadinessItem[]; complete: boolean; missing: string[] };

type FormKind = "legal_entity" | "insurance" | "data_protection_contact" | "penetration_test" | "on_call";

const formTitles: Record<FormKind, string> = {
  legal_entity: "Record the legal entity",
  insurance: "Record insurance cover",
  data_protection_contact: "Record the data-protection contact",
  penetration_test: "Record the independent test",
  on_call: "Schedule on-call coverage",
};

function statusLabel(item: ReadinessItem): string {
  return item.satisfied ? "met" : "not met";
}

export function LaunchReadinessPanel({ canWrite }: { canWrite: boolean }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [openForm, setOpenForm] = useState<FormKind | "">("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/readiness", { cache: "no-store" });
    const body = await response.json() as Readiness & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "Launch readiness could not be loaded.");
    setReadiness({ items: body.items, complete: body.complete, missing: body.missing });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Launch readiness could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [load]);

  async function send(endpoint: string, body: unknown, method = "POST"): Promise<void> {
    setError(""); setMessage("");
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "The record could not be saved.");
  }

  function submit(kind: FormKind, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const evidenceReference = field("evidenceReference");
    setBusy(kind);
    void (async () => {
      try {
        if (kind === "on_call") {
          await send("/api/admin/on-call", {
            email: field("email"),
            startsAt: new Date(field("startsAt")).toISOString(),
            endsAt: new Date(field("endsAt")).toISOString(),
            channel: field("channel"),
            notes: field("notes"),
          });
        } else if (kind === "legal_entity") {
          await send("/api/admin/attestations", {
            key: kind, evidenceReference, expiresAt: null,
            value: {
              entityName: field("entityName"), jurisdiction: field("jurisdiction"),
              registeredAddress: field("registeredAddress"),
              registrationReference: field("registrationReference"),
              liabilityPosition: field("liabilityPosition"),
            },
          });
        } else if (kind === "insurance") {
          await send("/api/admin/attestations", {
            key: kind, evidenceReference, expiresAt: new Date(field("expiresAt")).toISOString(),
            value: {
              insurer: field("insurer"), policyReference: field("policyReference"),
              coverageSummary: field("coverageSummary"), liabilityLimit: field("liabilityLimit"),
            },
          });
        } else if (kind === "data_protection_contact") {
          await send("/api/admin/attestations", {
            key: kind, evidenceReference, expiresAt: null,
            value: {
              contactName: field("contactName"), contactEmail: field("contactEmail"),
              hours: field("hours"), postalAddress: field("postalAddress"),
            },
          });
        } else {
          await send("/api/admin/attestations", {
            key: kind, evidenceReference, expiresAt: null,
            value: {
              provider: field("provider"), reportReference: field("reportReference"),
              completedOn: field("completedOn"), scopeSummary: field("scopeSummary"),
            },
          });
        }
        setMessage("Recorded. Readiness was recalculated from the stored fact, not from this screen.");
        setOpenForm("");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The record could not be saved.");
      } finally {
        setBusy("");
      }
    })();
  }

  function withdraw(key: FormKind, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    setBusy(`withdraw-${key}`);
    void (async () => {
      try {
        await send("/api/admin/attestations", { key, reason }, "DELETE");
        setMessage("Declaration withdrawn. It is no longer used for readiness, and the withdrawal is audited.");
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The declaration could not be withdrawn.");
      } finally {
        setBusy("");
      }
    })();
  }

  const attestationItems = readiness?.items.filter((item) =>
    ["legal_entity", "insurance", "data_protection_contact", "penetration_test"].includes(item.key)) ?? [];

  return <section id="launch-readiness" className="app-card app-card--full">
    <div className="app-card-title">
      <div>
        <h2>Launch readiness</h2>
        <p>Seven requirements stand between this build and real operations. Four are declarations only a named person can make, one is a staffed rota, and two depend on values only the owner can supply. Readiness is computed from the stored records and their expiry, so a lapsed policy re-opens the gap without anyone editing a document.</p>
      </div>
      <span className={`status-pill status-pill--${readiness?.complete ? "active" : "pending"}`}>
        {readiness ? `${readiness.missing.length} unmet` : "loading"}
      </span>
    </div>

    {error && <div className="auth-error" role="alert"><span>{error}</span></div>}
    {message && <div className="auth-status" role="status">{message}</div>}

    <div className="inline-notice"><strong>What this cannot do.</strong> It cannot incorporate a company, buy a policy, employ a person or commission an audit. Until someone records the fact with its evidence reference, the item stays unmet and the health endpoint reports it as missing.</div>

    {readiness ? <div className="data-list">
      {readiness.items.map((item) => <article className="data-row" key={item.key}>
        <span className="data-main">
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
          {!item.satisfied && <small>{item.ownerAction}</small>}
          {item.expiresAt && <small>Expires {new Date(item.expiresAt).toISOString().slice(0, 10)}</small>}
        </span>
        <span className={`status-pill status-pill--${item.satisfied ? "active" : "pending"}`}>{statusLabel(item)}</span>
        {canWrite && item.key === "legal_entity" && <button className="button button--secondary button--small" type="button" onClick={() => setOpenForm(openForm === "legal_entity" ? "" : "legal_entity")}>{openForm === "legal_entity" ? "Close" : "Record"}</button>}
        {canWrite && item.key === "insurance" && <button className="button button--secondary button--small" type="button" onClick={() => setOpenForm(openForm === "insurance" ? "" : "insurance")}>{openForm === "insurance" ? "Close" : "Record"}</button>}
        {canWrite && item.key === "data_protection_contact" && <button className="button button--secondary button--small" type="button" onClick={() => setOpenForm(openForm === "data_protection_contact" ? "" : "data_protection_contact")}>{openForm === "data_protection_contact" ? "Close" : "Record"}</button>}
        {canWrite && item.key === "penetration_test" && <button className="button button--secondary button--small" type="button" onClick={() => setOpenForm(openForm === "penetration_test" ? "" : "penetration_test")}>{openForm === "penetration_test" ? "Close" : "Record"}</button>}
        {canWrite && item.key === "on_call" && <button className="button button--secondary button--small" type="button" onClick={() => setOpenForm(openForm === "on_call" ? "" : "on_call")}>{openForm === "on_call" ? "Close" : "Schedule"}</button>}
      </article>)}

      {canWrite && openForm && <form className="form-stack" onSubmit={(event) => submit(openForm, event)} aria-label={formTitles[openForm]}>
        <h3>{formTitles[openForm]}</h3>
        {openForm === "legal_entity" && <>
          <div className="form-field"><label htmlFor="att-entity">Registered entity name</label><input className="form-control" id="att-entity" name="entityName" required maxLength={200} /></div>
          <div className="form-field"><label htmlFor="att-jurisdiction">Jurisdiction of registration</label><input className="form-control" id="att-jurisdiction" name="jurisdiction" required maxLength={120} /></div>
          <div className="form-field"><label htmlFor="att-address">Registered address</label><input className="form-control" id="att-address" name="registeredAddress" required maxLength={500} /></div>
          <div className="form-field"><label htmlFor="att-registration">Registration number</label><input className="form-control" id="att-registration" name="registrationReference" maxLength={120} /></div>
          <div className="form-field"><label htmlFor="att-liability">Liability position</label><textarea className="form-control" id="att-liability" name="liabilityPosition" required maxLength={500} rows={2} /></div>
        </>}
        {openForm === "insurance" && <>
          <div className="form-field"><label htmlFor="ins-insurer">Insurer</label><input className="form-control" id="ins-insurer" name="insurer" required maxLength={160} /></div>
          <div className="form-field"><label htmlFor="ins-policy">Policy reference</label><input className="form-control" id="ins-policy" name="policyReference" required maxLength={120} /></div>
          <div className="form-field"><label htmlFor="ins-coverage">What the cover includes</label><textarea className="form-control" id="ins-coverage" name="coverageSummary" required maxLength={1000} rows={2} /></div>
          <div className="form-field"><label htmlFor="ins-limit">Liability limit</label><input className="form-control" id="ins-limit" name="liabilityLimit" maxLength={120} /></div>
          <div className="form-field"><label htmlFor="ins-expiry">Cover expires</label><input className="form-control" id="ins-expiry" name="expiresAt" type="date" required /></div>
        </>}
        {openForm === "data_protection_contact" && <>
          <div className="form-field"><label htmlFor="dpo-name">Name of the person</label><input className="form-control" id="dpo-name" name="contactName" required maxLength={160} /></div>
          <div className="form-field"><label htmlFor="dpo-email">Published email address</label><input className="form-control" id="dpo-email" name="contactEmail" type="email" required maxLength={320} /></div>
          <div className="form-field"><label htmlFor="dpo-hours">When they are reachable</label><input className="form-control" id="dpo-hours" name="hours" required maxLength={120} placeholder="Mon–Fri, 09:00–18:00 IST" /></div>
          <div className="form-field"><label htmlFor="dpo-address">Postal address</label><input className="form-control" id="dpo-address" name="postalAddress" required maxLength={500} /></div>
        </>}
        {openForm === "penetration_test" && <>
          <div className="form-field"><label htmlFor="pt-provider">Testing provider</label><input className="form-control" id="pt-provider" name="provider" required maxLength={160} /></div>
          <div className="form-field"><label htmlFor="pt-report">Report reference</label><input className="form-control" id="pt-report" name="reportReference" required maxLength={160} /></div>
          <div className="form-field"><label htmlFor="pt-date">Date completed</label><input className="form-control" id="pt-date" name="completedOn" type="date" required /></div>
          <div className="form-field"><label htmlFor="pt-scope">Scope tested</label><textarea className="form-control" id="pt-scope" name="scopeSummary" required maxLength={1000} rows={2} /></div>
        </>}
        {openForm === "on_call" && <>
          <div className="form-field"><label htmlFor="oc-email">Person on call (account email)</label><input className="form-control" id="oc-email" name="email" type="email" required maxLength={320} /></div>
          <div className="form-field"><label htmlFor="oc-start">Starts</label><input className="form-control" id="oc-start" name="startsAt" type="datetime-local" required /></div>
          <div className="form-field"><label htmlFor="oc-end">Ends</label><input className="form-control" id="oc-end" name="endsAt" type="datetime-local" required /></div>
          <div className="form-field"><label htmlFor="oc-channel">How to reach them</label><input className="form-control" id="oc-channel" name="channel" required maxLength={160} /></div>
          <div className="form-field"><label htmlFor="oc-notes">Notes</label><textarea className="form-control" id="oc-notes" name="notes" maxLength={500} rows={2} /></div>
        </>}
        {openForm !== "on_call" && <div className="form-field"><label htmlFor="att-evidence">Where the evidence is held</label><input className="form-control" id="att-evidence" name="evidenceReference" required minLength={3} maxLength={500} placeholder="Certificate number, board resolution, insurer portal reference…" /></div>}
        <button className="button button--primary button--small" type="submit" disabled={busy === openForm}>{busy === openForm ? "Recording…" : "Record declaration"}</button>
      </form>}

      {canWrite && attestationItems.length > 0 && <details>
        <summary>Withdraw a declaration</summary>
        <form className="form-stack" onSubmit={(event) => withdraw(String(new FormData(event.currentTarget).get("key")) as FormKind, event)}>
          <div className="form-field"><label htmlFor="withdraw-key">Declaration</label>
            <select className="form-control" id="withdraw-key" name="key" required>
              {attestationItems.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </div>
          <div className="form-field"><label htmlFor="withdraw-reason">Why is it being withdrawn?</label><textarea className="form-control" id="withdraw-reason" name="reason" required minLength={20} maxLength={500} rows={2} /></div>
          <button className="button button--secondary button--small" type="submit" disabled={busy.startsWith("withdraw-")}>Withdraw declaration</button>
        </form>
      </details>}
    </div> : <div className="skeleton" style={{ height: 80 }} aria-busy="true" role="status" aria-label="Loading launch readiness" />}
  </section>;
}
