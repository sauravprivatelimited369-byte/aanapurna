import type { Metadata } from "next";
import { PublicLayout } from "@/components/public-shell";
import { readPublishedContacts } from "@/lib/published-contacts";

export const metadata: Metadata = { title: "Privacy" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const { entity, dataProtection } = await readPublishedContacts();
  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> Your information</span><h1>Privacy, by design.</h1><p>This draft describes the intended principles. It is not a final privacy notice and must not be used to onboard real people until reviewed and approved.</p></div></section>
      <section className="prose"><div className="content-narrow">
        <div className="draft-banner"><strong>DRAFT — REQUIRES QUALIFIED PRIVACY AND LEGAL REVIEW.</strong> {dataProtection ? "A data-protection contact is recorded below." : "Data controller, contact, retention periods, processors and lawful bases are not yet confirmed."}</div>
        <h2>Information the service may use</h2><p>Accounts require an email address and name. Partner onboarding may include organisation details, operational contacts, service area and restricted verification documents. Delivery records may include donation details, custody events, incident reports and receipts.</p>
        <h2>Why it is used</h2><p>Information is intended to support account security, organisation review, donation coordination, delivery traceability, support and incident response. The final purposes and legal bases must be confirmed for the actual operating model.</p>
        <h2>Access and retention</h2><p>Access is role- and organisation-scoped. Verification documents are intended to remain private. Which retention periods apply is still a legal decision nobody has signed off, so this draft states only what the software actually enforces today.</p>
        <p><strong>What runs.</strong> A job sweeps every night at 03:15 IST and deletes read notifications after 90 days, spent one-time sign-in codes after 1 day, expired delivery codes after 30 days, and failed email dead letters after 30 days. It scrubs the free text from closed safety incidents after two years and from audit records after six years, keeping the record itself. Before any sweep an operator can preview the exact number of rows affected, produced by the same code, and that preview changes nothing.</p>
        <p><strong>What stops it.</strong> A legal hold on a person, an organisation, a delivery job or a donation outranks every window. A held record is never deleted, the hold cannot be removed — only released by a named member of staff with a reason — and the number of rows kept back is shown on every sweep.</p>
        <p><strong>What is never deleted.</strong> Audit records and delivery receipts are not deleted by retention, because they are the evidence of what happened to the food. Beyond six years only the free text inside an audit record goes; who did what, when and to which record remains.</p>
        <p><strong>Erasure.</strong> A person can ask for erasure. Fulfilling it overwrites their name, email and credentials and ends their sessions, while keeping the receipts and audit trail that answer for the food. The erasure is itself recorded in the audit trail.</p>
        <p><strong>Getting your data.</strong> Any signed-in person can produce one file containing everything this service holds about their account — profile, memberships, notifications, donations, receipts, custody events, support and privacy requests, and the retention actions that ran — from their profile page. The download is recorded as a disclosure in the audit trail.</p>
        <p><strong>Correcting something.</strong> You can change your own display name, and the change is recorded. Your email address, a partner&apos;s phone number, an organisation&apos;s registered name and a verification status are records other people act on, so those go through a reviewed request instead of a silent edit.</p>
        <p><strong>Asking to be erased.</strong> Erasure is a reviewed request rather than a button, because it ends your sign-in methods and cannot be undone. When it is approved, your name, email and credentials are overwritten and your sessions destroyed, in the same step that closes the request — the two cannot come apart. Your receipts and the audit trail are kept, because they answer for what happened to the food.</p>
        <p><strong>How long we take.</strong> The advertised window is whatever is recorded on the operations register, and the operations screen counts anything past it as overdue. If no window has been recorded, none is promised — this page will not state a number nobody committed to.</p>
        <p><strong>What is not settled.</strong> The retention numbers above are defaults, not an approved policy, and the full period list requires qualified privacy and legal review before real operations. Rectification of an email address or partner contact details is handled by a human rather than automatically. Rectification and grievance handling have no escalation path beyond the operations screen flagging an overdue item.</p>
        <h2>Contact and rights</h2>
        {dataProtection ? (
          <>
            <p>{dataProtection.contactName} answers questions about personal data, including access, correction, erasure and grievances.</p>
            <p><a href={`mailto:${dataProtection.contactEmail}`}>{dataProtection.contactEmail}</a>{dataProtection.hours ? ` · ${dataProtection.hours}` : ""}</p>
            <p>Recorded {dataProtection.recordedAt ? new Date(dataProtection.recordedAt).toISOString().slice(0, 10) : "recently"}. The retention periods, processors and lawful bases in this notice still require review.</p>
          </>
        ) : (
          <p>No public privacy contact has been configured. Do not submit sensitive personal data through this draft site. A reviewed notice and named grievance route are required before launch.</p>
        )}
        {entity ? <p>Controller: {entity.entityName}{entity.jurisdiction ? `, ${entity.jurisdiction}` : ""}.</p> : null}
      </div></section>
    </PublicLayout>
  );
}
