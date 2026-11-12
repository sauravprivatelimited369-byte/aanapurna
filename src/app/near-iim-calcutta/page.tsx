import type { Metadata } from "next";
import Link from "next/link";
import { NearbyRestaurantDirectory } from "@/components/nearby-restaurant-directory";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Restaurant near IIM Calcutta",
  description: "A public-directory listing for Halla Bowl in Joka, with dated fallback data and clear partner-status notes.",
};

export default function NearbyIimCalcuttaPage() {
  return (
    <PublicLayout active="/near-iim-calcutta">
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow"><span className="eyebrow-line" /> Local discovery · Joka, Kolkata</span>
          <h1>A nearby place, with a clear source.</h1>
          <p>This is a public restaurant-directory entry near IIM Calcutta—not an Annapurna Link partner listing or food offer.</p>
        </div>
      </section>

      <section className="section">
        <div className="container nearby-directory">
          <NearbyRestaurantDirectory />
          <aside className="nearby-context-card">
            <span className="eyebrow"><span className="eyebrow-line" /> About this page</span>
            <h2>Discovery, not endorsement.</h2>
            <p>Restaurant details come from IndiaRestros’ public read API. IIM Calcutta lists its campus on Diamond Harbour Road, Joka; the restaurant record is also in Joka.</p>
            <div className="nearby-source-links">
              <a href="https://indiarestros.com/api/docs" target="_blank" rel="noreferrer">IndiaRestros API docs ↗</a>
              <a href="https://application.iimcal.ac.in/about/contacts" target="_blank" rel="noreferrer">IIM Calcutta campus address ↗</a>
            </div>
            <p className="nearby-data-note">Public directory data may be incomplete or out of date. It is shown for local orientation only and is not a safety, capacity, licence, or partnership check.</p>
          </aside>
        </div>

        <div className="container nearby-cta-wrap">
          <div className="cta-panel">
            <div>
              <span className="eyebrow"><span className="eyebrow-line" /> For local food businesses</span>
              <h2>Represent a restaurant?</h2>
              <p>Request a Generator partner review. A public listing never creates a partner account or enables food donations.</p>
            </div>
            <div className="cta-actions">
              <Link className="button button--primary" href="/signup">Request to join <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
