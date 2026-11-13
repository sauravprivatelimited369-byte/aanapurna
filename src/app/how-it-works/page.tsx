import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <PublicLayout active="/how-it-works">
      <section className="page-hero"><div className="container">
        <span className="eyebrow"><span className="eyebrow-line" /> A shared responsibility</span>
        <h1>A clear path from offer to receipt.</h1>
        <p>Each person has a defined part in the chain. The platform helps coordinate the work; the people involved make the decisions and confirm what actually happened.</p>
      </div></section>
      <section className="prose"><div className="content-narrow">
        <h2>01 — Offer</h2><p>A verified Generator describes the food, quantity and unit, preparation time, known ingredients and allergens, storage needs, collection window and pickup instructions. Each listing records the human-approved policy version that applies.</p>
        <h2>02 — Review and accept</h2><p>Eligible, verified Receivers are matched using declared capability, service area, availability and capacity. A Receiver reviews the details and accepts or declines. A match is not a safety inspection or certification.</p>
        <h2>03 — Collect</h2><p>An approved Helper claims an open delivery. The claim is atomic, so only one Helper can win. At collection, the Helper records the condition and relevant handling observations. A concern can put the donation on hold.</p>
        <h2>04 — Confirm arrival</h2><p>After the food physically arrives, the Receiver performs its agreed acceptance checks and shares its one-time code directly with the assigned Helper. The Helper submits the code; the platform never returns it to the Helper.</p>
        <h2>05 — Keep the record</h2><p>A successful confirmation creates one receipt and an append-only custody event. A delivery counts toward impact only after this step. Refusals, incidents and corrections remain visible to authorised people.</p>
        <div className="notice-card"><span className="notice-mark" aria-hidden="true">✳</span><span><strong>People stay accountable.</strong> Annapurna Link records declarations and handovers; it does not determine whether food is safe, suitable, compliant or fit to eat.</span></div>
      </div></section>
    </PublicLayout>
  );
}
