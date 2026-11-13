import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> A working draft</span><h1>Terms of use.</h1><p>These draft notes are for product review only. They are not a contract, partner agreement or approved statement of legal obligations.</p></div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner"><strong>DRAFT — REQUIRES QUALIFIED LEGAL REVIEW.</strong> The legal entity, service area, operating model, liability allocation and dispute process have not been supplied or approved.</div>
        <h2>What Annapurna Link is</h2><p>The intended service coordinates offers of surplus food, receiving organisations, Helpers and records of collection and receipt. It does not inspect or certify food, guarantee transport conditions or replace professional judgement.</p>
        <h2>Partner responsibilities</h2><p>Final terms must describe who may list, receive and transport food; what declarations and checks are required; who may pause or refuse a delivery; and how incidents, recalls, disputes and service outages are handled.</p>
        <h2>Not yet in effect</h2><p>No real donation workflow is enabled by this draft. These terms must be replaced with an approved agreement before public onboarding or real-world use.</p>
      </div></section>
    </PublicLayout>
  );
}
