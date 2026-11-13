"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type GeneratorOrganization = { id: string; name: string };

function iso(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function ListingForm({ organizations, enabled }: { organizations: GeneratorOrganization[]; enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    const picklist = (name: string) => String(form.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const body = {
      organizationId: String(form.get("organizationId") ?? ""),
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
      foodType: String(form.get("foodType") ?? ""),
      description: String(form.get("description") ?? "").trim(),
      quantity: Number(form.get("quantity")),
      unit: String(form.get("unit") ?? ""),
      ingredients: String(form.get("ingredients") ?? "").trim(),
      allergens: picklist("allergens"),
      preparedAt: iso(form.get("preparedAt")),
      packedAt: iso(form.get("packedAt")) ?? null,
      bestBeforeAt: iso(form.get("bestBeforeAt")),
      pickupEarliestAt: iso(form.get("pickupEarliestAt")),
      pickupLatestAt: iso(form.get("pickupLatestAt")),
      storageInstructions: String(form.get("storageInstructions") ?? "").trim(),
      temperatureRequirement: String(form.get("temperatureRequirement") ?? "").trim(),
      pickupAddress: String(form.get("pickupAddress") ?? "").trim(),
      pickupInstructions: String(form.get("pickupInstructions") ?? "").trim(),
      declarationsAccepted: form.get("declarationsAccepted") === "on",
    };
    try {
      const response = await fetch("/api/donations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { id?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The listing could not be created.");
      setSuccess("The listing was saved and matching offers were created for eligible verified Receivers.");
      router.push("/app/listings");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The listing could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!enabled) return <div className="app-card app-card--full"><div className="inline-notice"><strong>Listing is disabled.</strong> Real donation operations remain closed until an authorised human has approved the operating policy, service area, partner checks and launch gates.</div><p className="form-hint">The form will become available only when the operations gate is enabled and an approved policy is active. No record has been created.</p></div>;
  if (organizations.length === 0) return <div className="app-card app-card--full"><div className="empty-state"><div><strong>No verified Generator organisation</strong><p>Complete partner onboarding and wait for an authorised human review before creating a listing.</p></div></div></div>;

  return <form className="app-grid" onSubmit={submit}>
    <section className="app-card app-card--span-7">
      <div className="app-card-title"><div><h2>Food details</h2><p>Enter information truthfully; the platform does not inspect or certify food.</p></div></div>
      <div className="form-stack">
        <div className="form-field"><label htmlFor="organizationId">Generator organisation</label><select className="form-control" name="organizationId" id="organizationId" required defaultValue={organizations[0]?.id}>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select></div>
        <div className="form-field"><label htmlFor="name">Food name</label><input className="form-control" id="name" name="name" required maxLength={160} placeholder="Use a clear, specific description" /></div>
        <div className="app-grid" style={{ gap: 10 }}>
          <div className="form-field app-card--span-6"><label htmlFor="category">Category</label><input className="form-control" id="category" name="category" required maxLength={64} placeholder="As approved by policy" /></div>
          <div className="form-field app-card--span-6"><label htmlFor="foodType">Food type</label><select className="form-control" id="foodType" name="foodType" required><option value="vegetarian">Vegetarian</option><option value="non_vegetarian">Non-vegetarian</option><option value="mixed">Mixed</option><option value="other">Other</option></select></div>
        </div>
        <div className="app-grid" style={{ gap: 10 }}>
          <div className="form-field app-card--span-6"><label htmlFor="quantity">Quantity</label><input className="form-control" id="quantity" name="quantity" type="number" min="0.001" max="100000" step="any" required /></div>
          <div className="form-field app-card--span-6"><label htmlFor="unit">Unit</label><select className="form-control" id="unit" name="unit"><option value="servings">Servings</option><option value="kg">Kilograms</option><option value="g">Grams</option><option value="litre">Litres</option><option value="portion">Portions</option><option value="box">Boxes</option></select></div>
        </div>
        <div className="form-field"><label htmlFor="description">Additional details <span className="form-hint">(optional)</span></label><textarea className="form-control" id="description" name="description" maxLength={1000} /></div>
        <div className="form-field"><label htmlFor="ingredients">Ingredients</label><textarea className="form-control" id="ingredients" name="ingredients" maxLength={1000} required placeholder="List known ingredients; do not leave blank if allergens are not listed" /></div>
        <div className="form-field"><label htmlFor="allergens">Known allergens</label><input className="form-control" id="allergens" name="allergens" maxLength={500} placeholder="Comma-separated; write none known only if verified" /><span className="form-hint">Follow the approved policy for the applicable food category.</span></div>
      </div>
    </section>

    <section className="app-card app-card--span-5">
      <div className="app-card-title"><div><h2>Time &amp; handling</h2><p>Times are entered in your device&apos;s local timezone.</p></div></div>
      <div className="form-stack">
        <div className="form-field"><label htmlFor="preparedAt">Prepared at</label><input className="form-control" id="preparedAt" name="preparedAt" type="datetime-local" required /></div>
        <div className="form-field"><label htmlFor="packedAt">Packed at <span className="form-hint">(if applicable)</span></label><input className="form-control" id="packedAt" name="packedAt" type="datetime-local" /></div>
        <div className="form-field"><label htmlFor="bestBeforeAt">Use-by / best-before</label><input className="form-control" id="bestBeforeAt" name="bestBeforeAt" type="datetime-local" required /></div>
        <div className="form-field"><label htmlFor="pickupEarliestAt">Collection from</label><input className="form-control" id="pickupEarliestAt" name="pickupEarliestAt" type="datetime-local" required /></div>
        <div className="form-field"><label htmlFor="pickupLatestAt">Collect by</label><input className="form-control" id="pickupLatestAt" name="pickupLatestAt" type="datetime-local" required /></div>
        <div className="form-field"><label htmlFor="storageInstructions">Storage / handling instructions</label><textarea className="form-control" id="storageInstructions" name="storageInstructions" required maxLength={500} /></div>
        <div className="form-field"><label htmlFor="temperatureRequirement">Temperature requirement <span className="form-hint">(if applicable)</span></label><input className="form-control" id="temperatureRequirement" name="temperatureRequirement" maxLength={200} /></div>
      </div>
    </section>

    <section className="app-card app-card--full">
      <div className="app-card-title"><div><h2>Pickup &amp; declarations</h2><p>Exact pickup details are shared only with authorised participants after acceptance.</p></div></div>
      <div className="form-stack">
        <div className="form-field"><label htmlFor="pickupAddress">Pickup address</label><input className="form-control" id="pickupAddress" name="pickupAddress" required maxLength={500} autoComplete="street-address" /></div>
        <div className="form-field"><label htmlFor="pickupInstructions">Pickup instructions <span className="form-hint">(optional)</span></label><textarea className="form-control" id="pickupInstructions" name="pickupInstructions" maxLength={500} /></div>
        <label className="form-label" style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><input type="checkbox" name="declarationsAccepted" required style={{ marginTop: 3 }} /><span>I confirm that the information above is truthful to the best of my knowledge and that I remain responsible for meeting the approved operating policy. I understand Annapurna Link does not certify food as safe.</span></label>
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}{success && <div className="auth-status" role="status">{success}</div>}
      <button className="button button--primary" type="submit" disabled={pending} style={{ marginTop: 20 }}>{pending ? "Saving…" : "Save listing and match"} <span aria-hidden="true">↗</span></button>
    </section>
  </form>;
}
