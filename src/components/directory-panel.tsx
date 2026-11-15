"use client";

/**
 * The private half of the Joka directory.
 *
 * The public page shows names and areas. The numbers live here because ringing a business about a
 * scheme it has never heard of is an approach a person should make deliberately, once, with a note
 * of who answered. Nothing here claims a licence: `ownerVerified` means somebody spoke to the owner
 * and confirmed the details, and that is the only thing that turns the public label green.
 */

import { FormEvent, useCallback, useEffect, useState } from "react";

type Place = {
  slug: string;
  name: string;
  category: "banquet" | "hotel" | "restaurant" | "campus";
  area: string;
  addressLine: string | null;
  phone: string | null;
  phoneSource: string | null;
  phoneKind: "unknown" | "direct" | "business_line" | "marketplace_line";
  consentStatus: "unknown" | "contacted" | "consented" | "declined";
  ownerVerified: boolean;
  published: boolean;
  photoUrl: string | null;
  lastCheckedOn: string;
  notes: string | null;
};

const kindLabels: Record<Place["phoneKind"], string> = {
  unknown: "unverified line",
  direct: "owner's line",
  business_line: "business line",
  marketplace_line: "booking/listing line",
};

export function DirectoryPanel({ canWrite }: { canWrite: boolean }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/directory-places", { cache: "no-store" });
    const body = await response.json() as Place[] | { error?: { message?: string } };
    if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "The directory could not be loaded.");
    setPlaces(body as Place[]);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "The directory could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [load]);

  async function save(slug: string, patch: Record<string, unknown>, success: string) {
    setBusy(slug); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/directory-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...patch }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The change could not be saved.");
      setMessage(success);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
    } finally {
      setBusy("");
    }
  }

  function updatePhone(event: FormEvent<HTMLFormElement>, place: Place) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = String(form.get("phone") ?? "").trim();
    const phoneKind = String(form.get("phoneKind") ?? "unknown");
    const photoUrl = String(form.get("photoUrl") ?? "").trim();
    void save(
      place.slug,
      { phone: phone || null, phoneKind, photoUrl: photoUrl || null },
      `Saved for ${place.name}. The number stays off the public page; a photo appears only if one was supplied.`,
    );
  }

  const published = places?.filter((place) => place.published).length ?? 0;

  return <section id="directory-places" className="app-card app-card--full">
    <div className="app-card-title">
      <div>
        <h2>Nearby food sources · Joka</h2>
        <p>Restaurants, hotels and banquet venues within a few kilometres of the campus, read from public listings. Numbers are held here, never on the public page. Confirming details with an owner is a person&rsquo;s record, not a licence lookup.</p>
      </div>
      <span className="status-pill status-pill--pending">{places ? `${published}/${places.length} published` : "loading"}</span>
    </div>

    {error && <div className="auth-error" role="alert"><span>{error}</span></div>}
    {message && <div className="auth-status" role="status">{message}</div>}

    <div className="inline-notice">
      <strong>No licence claims.</strong> The directory stores none, and the public page shows
      &ldquo;not yet confirmed with the owner&rdquo; until somebody speaks to them. Ask the owner directly about
      registration, kitchen capacity, what they already do with surplus, and whether they want to take part.
    </div>

    {places === null ? (
      <div className="skeleton" style={{ height: 90 }} aria-busy="true" role="status" aria-label="Loading the directory" />
    ) : (
      <div className="data-list">
        {places.map((place) => <article className="operation-record" key={place.slug}>
          <div className="operation-record-head">
            <div>
              <strong>{place.name}</strong>
              <small>{place.category} · {place.area} · checked {place.lastCheckedOn}</small>
              <small>{place.phone ? <>{place.phone} <span className="status-pill status-pill--pending">{kindLabels[place.phoneKind]}</span>{place.phoneSource ? ` · from ${place.phoneSource}` : ""}</> : "No number recorded. Get it from the owner on a visit, not from another listing site."}</small>
              {place.notes && <small>{place.notes}</small>}
            </div>
            <span className={`status-pill status-pill--${place.published ? "active" : "pending"}`}>{place.published ? "published" : "hidden"}</span>
          </div>

          {canWrite && <div className="inline-form">
            <form className="inline-form" onSubmit={(event) => updatePhone(event, place)}>
              <div className="form-field">
                <label htmlFor={`dir-phone-${place.slug}`}>Number to call</label>
                <input className="form-control" id={`dir-phone-${place.slug}`} name="phone" defaultValue={place.phone ?? ""} maxLength={40} inputMode="tel" placeholder="+91…" />
              </div>
              <div className="form-field">
                <label htmlFor={`dir-kind-${place.slug}`}>What kind of line is it?</label>
                <select className="form-control" id={`dir-kind-${place.slug}`} name="phoneKind" defaultValue={place.phoneKind}>
                  <option value="unknown">Not sure yet</option>
                  <option value="direct">The owner&rsquo;s own line</option>
                  <option value="business_line">The business line</option>
                  <option value="marketplace_line">A booking/listing line</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`dir-photo-${place.slug}`}>Photo the owner supplied (https link)</label>
                <input className="form-control" id={`dir-photo-${place.slug}`} name="photoUrl" type="url" defaultValue={place.photoUrl ?? ""} maxLength={500} placeholder="Leave empty rather than copying a listing site's photo" />
              </div>
              <button className="button button--secondary button--small" type="submit" disabled={busy === place.slug}>
                {busy === place.slug ? "Saving…" : "Save details"}
              </button>
            </form>

            <div className="form-stack">
              <div className="form-field">
                <label htmlFor={`dir-consent-${place.slug}`}>Where the conversation stands</label>
                <select
                  className="form-control"
                  id={`dir-consent-${place.slug}`}
                  defaultValue={place.consentStatus}
                  onChange={(event) => void save(place.slug, { consentStatus: event.target.value }, `Recorded for ${place.name}.`)}
                >
                  <option value="unknown">Not contacted</option>
                  <option value="contacted">Contacted, awaiting an answer</option>
                  <option value="consented">Wants to take part</option>
                  <option value="declined">Declined</option>
                </select>
              </div>
              <div className="form-field">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={place.ownerVerified}
                    onChange={(event) => void save(place.slug, { ownerVerified: event.target.checked }, event.target.checked ? `${place.name} confirmed with the owner.` : `${place.name} is unconfirmed again.`)}
                  />
                  Details confirmed with the owner (licence, capacity and consent were asked, not assumed)
                </label>
              </div>
              <div className="form-field">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={place.published}
                    onChange={(event) => void save(place.slug, { published: event.target.checked }, event.target.checked ? `${place.name} is listed publicly.` : `${place.name} is hidden from the public page.`)}
                  />
                  Show on the public page
                </label>
              </div>
            </div>
          </div>}
        </article>)}
      </div>
    )}
  </section>;
}
