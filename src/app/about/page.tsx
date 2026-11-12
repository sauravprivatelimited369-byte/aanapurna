import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = { title: "Our approach" };

export default function AboutPage() {
  return (
    <PublicLayout active="/about">
      <section className="page-hero"><div className="container">
        <span className="eyebrow"><span className="eyebrow-line" /> The work behind the meal</span>
        <h1>Less waste.<br />More neighbourliness.</h1>
        <p>Annapurna Link is being built to help local food donors, community organisations and approved helpers work together with clear records and care for the people on every side of a handover.</p>
      </div></section>
      <section className="prose"><div className="content-narrow">
        <h2>Not a marketplace. A coordination layer.</h2>
        <p>Surplus food is not an abstract unit. It has a source, a preparation time, handling needs and a destination. Annapurna Link brings those details into one accountable workflow, so partners can make informed choices and operations teams can respond when plans change.</p>
        <h2>Start locally, earn trust</h2>
        <p>The service area, partner eligibility, food categories, operating windows and verification requirements must be set by the people responsible for the real-world operation. Those decisions are not inferred from a city name or invented by software.</p>
        <h2>Designed for a careful launch</h2>
        <p>Accounts and organisations begin pending. Food redistribution stays disabled until the owner supplies the required legal, safety, privacy, partner and security approvals. This website is not evidence that a partner, regulator or operating policy has been approved.</p>
      </div></section>
    </PublicLayout>
  );
}
