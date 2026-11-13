import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> Your information</span><h1>Privacy, by design.</h1><p>This draft describes the intended principles. It is not a final privacy notice and must not be used to onboard real people until reviewed and approved.</p></div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner"><strong>DRAFT — REQUIRES QUALIFIED PRIVACY AND LEGAL REVIEW.</strong> Data controller, contact, retention periods, processors and lawful bases are not yet confirmed.</div>
        <h2>Information the service may use</h2><p>Accounts require an email address and name. Partner onboarding may include organisation details, operational contacts, service area and restricted verification documents. Delivery records may include donation details, custody events, incident reports and receipts.</p>
        <h2>Why it is used</h2><p>Information is intended to support account security, organisation review, donation coordination, delivery traceability, support and incident response. The final purposes and legal bases must be confirmed for the actual operating model.</p>
        <h2>Access and retention</h2><p>Access is role- and organisation-scoped. Verification documents are intended to remain private. Retention, deletion, correction, legal hold, data export and grievance handling periods are not yet approved and must be configured before real operations.</p>
        <h2>Contact and rights</h2><p>No public privacy contact has been configured. Do not submit sensitive personal data through this draft site. A reviewed notice and named grievance route are required before launch.</p>
      </div></section>
    </PublicLayout>
  );
}
