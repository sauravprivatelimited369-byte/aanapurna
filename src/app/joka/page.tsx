import type { Metadata } from "next";
import Link from "next/link";
import { PublicLayout } from "@/components/public-shell";
import {
  directoryCategoryLabels,
  directoryCategoryNotes,
  readPublicDirectory,
  type DirectoryEntry,
} from "@/lib/directory";

export const metadata: Metadata = {
  title: "Food sources around IIM Calcutta",
  description:
    "A dated directory of restaurants, hotels and banquet venues in Joka and Thakurpukur, listed from public sources. No listing is a partnership, and every detail still needs confirming with the owner.",
};

export const dynamic = "force-dynamic";

const ORDER: DirectoryEntry["category"][] = ["banquet", "hotel", "restaurant", "campus"];

function mapUrl(entry: DirectoryEntry): string {
  if (entry.latitude !== null && entry.longitude !== null) {
    return `https://www.openstreetmap.org/?mlat=${entry.latitude}&mlon=${entry.longitude}#map=17/${entry.latitude}/${entry.longitude}`;
  }
  const url = new URL("https://www.openstreetmap.org/search");
  url.searchParams.set("query", entry.addressLine ?? `${entry.name}, ${entry.area}, Kolkata`);
  return url.toString();
}

function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export default async function JokaDirectoryPage() {
  const places = await readPublicDirectory();
  const latest = places.reduce((newest, entry) => (entry.lastCheckedOn > newest ? entry.lastCheckedOn : newest), "");
  const verified = places.filter((entry) => entry.ownerVerified).length;

  return (
    <PublicLayout active="/near-iim-calcutta">
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow"><span className="eyebrow-line" /> Local discovery · Joka, Kolkata</span>
          <h1>Who cooks near the campus gate.</h1>
          <p>
            {places.length} kitchens, hotels and banquet venues within a few kilometres of IIM Calcutta, read from
            public listings and nothing else. Not one of them has been contacted, and no phone number is published here.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="inline-notice">
            <strong>Read this before you read the list.</strong> A listing is not a partner, a supplier or a
            commitment. Nothing below has been confirmed with an owner — no licence, no capacity, no opening hours,
            no consent to be called. Prices, addresses and even whether a kitchen still trades move quickly. Every row
            carries the date it was read from a public source{latest ? `: ${new Date(`${latest}T00:00:00Z`).toISOString().slice(0, 10)}` : ""}.
            {verified > 0 ? ` ${verified} of them have since been confirmed with the owner.` : " None has been confirmed with its owner yet."}
          </div>

          {places.length === 0 ? (
            <div className="empty-state">
              <div>
                <strong>No published entries yet</strong>
                <p>The directory is loading from the database. If this persists, the migration has not run on this deployment.</p>
              </div>
            </div>
          ) : ORDER.map((category) => {
            const entries = places.filter((entry) => entry.category === category);
            if (entries.length === 0) return null;
            return (
              <section key={category} aria-labelledby={`joka-${category}`} style={{ marginTop: 40 }}>
                <div className="app-card-title">
                  <div>
                    <h2 id={`joka-${category}`}>{directoryCategoryLabels[category]}</h2>
                    <p>{directoryCategoryNotes[category]}</p>
                  </div>
                  <span className="status-pill status-pill--pending">{entries.length}</span>
                </div>
                <div className="app-grid">
                  {entries.map((entry) => (
                    <article className="app-card app-card--span-4" key={entry.slug}>
                      {entry.photoUrl ? (
                        // Only ever a photo the owner supplied. Listing-site photos are someone else's work.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="directory-photo" src={entry.photoUrl} alt={`${entry.name}, ${entry.area}`} loading="lazy" />
                      ) : null}
                      <div className="directory-card-head">
                        <span className="directory-monogram" aria-hidden="true">{initials(entry.name)}</span>
                        <div>
                          <h3>{entry.name}</h3>
                          <small>{entry.area}</small>
                        </div>
                      </div>
                      <p className="directory-address">{entry.addressLine}</p>
                      {entry.phone ? (
                        <p className="directory-phone">
                          <a href={`tel:${entry.phone.replace(/[^+0-9]/g, "")}`}>{entry.phone}</a>
                          <small>Published because the owner agreed to be contacted.</small>
                        </p>
                      ) : null}
                      <div className="directory-tags">
                        <span className={`status-pill status-pill--${entry.ownerVerified ? "active" : "pending"}`}>
                          {entry.ownerVerified ? "confirmed with the owner" : "not yet confirmed with the owner"}
                        </span>
                        {entry.photoUrl ? null : <span className="status-pill status-pill--pending">no photo supplied</span>}
                      </div>
                      <a className="button button--secondary button--small" href={mapUrl(entry)} target="_blank" rel="noreferrer">
                        Find on the map ↗
                      </a>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          <section className="section" style={{ marginTop: 48 }}>
            <div className="cta-panel">
              <div>
                <span className="eyebrow"><span className="eyebrow-line" /> Own one of these places?</span>
                <h2>Tell us what is wrong, or what is right.</h2>
                <p>
                  Contact details are not published here on purpose. If you run one of these kitchens and want to take
                  part — or want the listing corrected or removed — say so and it will be handled by a person.
                </p>
              </div>
              <div className="cta-actions">
                <Link className="button button--primary" href="/contact">Contact the team</Link>
                <Link className="button button--secondary" href="/signup">Request a partner review</Link>
              </div>
            </div>
          </section>
        </div>
      </section>
    </PublicLayout>
  );
}
