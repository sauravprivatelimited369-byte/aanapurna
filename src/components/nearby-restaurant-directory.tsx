"use client";

import { useEffect, useState } from "react";
import {
  RestaurantDirectoryResponseSchema,
  type RestaurantDirectoryResponse,
} from "@/integrations/restaurant-directory-contract";

type DirectoryState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "loaded"; response: RestaurantDirectoryResponse };

function formatObservedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date);
}

function mapSearchUrl(address: string): string {
  const url = new URL("https://www.openstreetmap.org/search");
  url.searchParams.set("query", address);
  return url.toString();
}

function readableSourceName(name: string): string {
  return name.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function NearbyRestaurantDirectory() {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DirectoryState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void fetch("/api/public/restaurant-directory", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Nearby restaurant directory unavailable.");
        const parsed = RestaurantDirectoryResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Nearby restaurant directory returned an invalid response.");
        if (active) setState({ status: "loaded", response: parsed.data });
      })
      .catch(() => { if (active) setState({ status: "unavailable" }); });
    return () => { active = false; };
  }, [retryKey]);

  if (state.status === "loading") {
    return <div className="nearby-loading" role="status" aria-busy="true"><span className="skeleton" /><span>Loading the public restaurant directory…</span></div>;
  }

  if (state.status === "unavailable") {
    return (
      <div className="notice-card nearby-unavailable" role="status">
        <span className="notice-mark" aria-hidden="true">⌁</span>
        <span>
          The public restaurant directory could not be loaded or validated, so no restaurant details are being shown. Check your connection and try again.
          <span className="nearby-retry-row"><button className="button button--secondary button--small" type="button" onClick={() => { setState({ status: "loading" }); setRetryKey((key) => key + 1); }}>Retry listing lookup</button> <a href="https://indiarestros.com/api/docs" target="_blank" rel="noreferrer">API reference ↗</a></span>
        </span>
      </div>
    );
  }

  const { response } = state;
  const { listing } = response;
  const mapAddress = listing.address || `${listing.locality}, ${listing.city}`;

  return (
    <article className="nearby-restaurant-card">
      <div className="nearby-restaurant-heading">
        <div>
          <span className="nearby-public-badge">{response.status === "live" ? "Live public-directory lookup" : "Saved public-directory record"}</span>
          <h2>{listing.name}</h2>
          <p>{listing.locality}, {listing.city}</p>
        </div>
        <span className="nearby-mark" aria-hidden="true">⌖</span>
      </div>

      {response.status === "snapshot" && (
        <div className="nearby-stale-notice" role="status">
          <span>{response.warning}</span>
          <button className="button button--secondary button--small" type="button" onClick={() => { setState({ status: "loading" }); setRetryKey((key) => key + 1); }}>Retry live lookup</button>
        </div>
      )}

      <dl className="nearby-details">
        <div><dt>Address</dt><dd>{mapAddress}</dd></div>
        {listing.cuisines.length > 0 && <div><dt>Cuisines listed</dt><dd>{listing.cuisines.join(" · ")}</dd></div>}
        {formatObservedAt(listing.observedAt) && <div><dt>Directory record updated</dt><dd>{formatObservedAt(listing.observedAt)}</dd></div>}
      </dl>

      <div className="nearby-links">
        <a className="button button--secondary button--small" href={listing.directoryUrl} target="_blank" rel="noreferrer">View source listing <span aria-hidden="true">↗</span></a>
        <a className="button button--ghost button--small" href={mapSearchUrl(mapAddress)} target="_blank" rel="noreferrer">Open map search <span aria-hidden="true">↗</span></a>
        {listing.website && <a className="app-card-link" href={listing.website} target="_blank" rel="noreferrer">Restaurant website ↗</a>}
      </div>

      <p className="nearby-source-caption">
        Data provenance supplied by IndiaRestros: {listing.sources.length ? listing.sources.map((source, index) => (
          <span key={`${source.name}-${index}`}>{index > 0 ? ", " : ""}{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{readableSourceName(source.name)}</a> : readableSourceName(source.name)}</span>
        )) : "its public directory"}. For current details, check the <a href={listing.directoryUrl} target="_blank" rel="noreferrer">IndiaRestros record</a>.
      </p>
      <div className="nearby-disclaimer" role="note">
        <strong>Not an Annapurna Link partner.</strong> This public listing does not mean the restaurant has been contacted, verified, approved, or agreed to donate. Annapurna Link has no current food offer from this business. Confirm details directly before travelling.
      </div>
    </article>
  );
}
