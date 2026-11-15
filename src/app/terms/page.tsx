import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";
import { readPublishedContacts } from "@/lib/published-contacts";

export const metadata: Metadata = { title: "Terms" };
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const { entity } = await readPublishedContacts();
  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> A working draft</span><h1>Terms of use.</h1><p>These draft notes are for product review only. They are not a contract, partner agreement or approved statement of legal obligations.</p></div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner"><strong>DRAFT — REQUIRES QUALIFIED LEGAL REVIEW.</strong> {entity ? `${entity.entityName}${entity.jurisdiction ? ` (${entity.jurisdiction})` : ""} is recorded as the operating entity.` : "The legal entity has not been recorded."} The operating model, liability allocation and dispute process have not been supplied or approved.</div>
        <h2>What Annapurna Link is</h2><p>The intended service coordinates offers of surplus food, receiving organisations, Helpers and records of collection and receipt. It does not inspect or certify food, guarantee transport conditions or replace professional judgement.</p>
        {entity ? (
          <>
            <h2>Who you are dealing with</h2>
            <p>{entity.entityName}{entity.jurisdiction ? `, ${entity.jurisdiction}` : ""}.{entity.registeredAddress ? ` Registered address: ${entity.registeredAddress}.` : ""}{entity.registrationReference ? ` Registration reference: ${entity.registrationReference}.` : ""}</p>
            <p>These notes still do not constitute an agreement; they record who would be answerable once an approved agreement exists.</p>
          </>
        ) : null}
        <h2>Partner responsibilities</h2><p>Final terms must describe who may list, receive and transport food; what declarations and checks are required; who may pause or refuse a delivery; and how incidents, recalls, disputes and service outages are handled.</p>
        <h2>Not yet in effect</h2><p>No real donation workflow is enabled by this draft. These terms must be replaced with an approved agreement before public onboarding or real-world use.</p>
      </div></section>
    </PublicLayout>
  );
}
