import type { Metadata } from "next";
import Link from "next/link";
import { PublicLayout } from "@/components/public-shell";
import { PublicImpact } from "@/components/public-impact";

export const metadata: Metadata = { title: "Our impact" };

/**
 * Impact figures on their own page.
 *
 * These used to sit in a panel on the home page, which is what made the home page four screens
 * long. Moving them here is not a demotion: a number that is worth publishing is worth reading
 * properly, with room to say what it does and does not count. The navigation already pointed at
 * an anchor on the home page, which would have become a link to nothing once that panel moved —
 * this page is where it now goes.
 */
export default async function ImpactPage() {
  return (
    <PublicLayout active="/impact">
      <section className="page-hero"><div className="container">
        <span className="eyebrow"><span className="eyebrow-line" /> Recorded, not estimated</span>
        <h1>What has actually been handed over.</h1>
        <p>A delivery counts here only after a Receiver confirms it arrived and the handover is recorded. Nothing is estimated, projected or converted into meals.</p>
      </div></section>
      <PublicImpact />
      <section className="prose"><div className="content-narrow">
        <h2>What these numbers do not include</h2>
        <p>Food offered but not collected, deliveries in progress, and claims that were released or refused are all excluded. A number that counted intentions would flatter the programme and tell a reader nothing about whether food reached anybody.</p>
        <p>Units are shown as the unit the donor declared — servings, kilograms, packets. Converting them to an estimated meal count would require an assumption the platform has no basis for, so it does not.</p>
        <div className="notice-card"><span className="notice-mark" aria-hidden="true">✳</span><span><strong>Impact is not a safety claim.</strong> A recorded delivery means a handover happened and both parties confirmed it. It does not mean the platform inspected or certified the food.</span></div>
      </div></section>
      <section className="section"><div className="container">
        <Link className="button button--secondary" href="/how-it-works">Read the full process</Link>
      </div></section>
    </PublicLayout>
  );
}
