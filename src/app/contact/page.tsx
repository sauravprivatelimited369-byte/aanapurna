import type { Metadata } from "next";
import Link from "next/link";
import { PublicLayout } from "@/components/public-shell";
import { readPublishedContacts } from "@/lib/published-contacts";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const { dataProtection, entity } = await readPublishedContacts();
  return (
    <PublicLayout>
      <section className="page-hero"><div className="container"><span className="eyebrow"><span className="eyebrow-line" /> Get in touch</span><h1>{dataProtection ? "Reach a named person." : "We are setting up the right support path."}</h1><p>{dataProtection ? "Data-protection questions go to the person named below. Account holders can also open a support request." : "A named support contact has not been configured yet, so we will not invent an email address or phone number."}</p></div></section>
      <section className="section"><div className="container">
        <div className="cta-panel"><div><span className="eyebrow"><span className="eyebrow-line" /> For account holders</span><h2>Open a support request.</h2><p>Once signed in, you can contact the operations team through your account.</p></div><div className="cta-actions"><Link className="button button--primary" href="/login">Log in <span aria-hidden="true">↗</span></Link></div></div>
        {dataProtection ? (
          <div className="cta-panel" style={{ marginTop: 22 }}><div><span className="eyebrow"><span className="eyebrow-line" /> Personal data</span><h2>{dataProtection.contactName}</h2><p><a href={`mailto:${dataProtection.contactEmail}`}>{dataProtection.contactEmail}</a>{dataProtection.hours ? ` · ${dataProtection.hours}` : ""}</p>{entity ? <p>Controller: {entity.entityName}.</p> : null}</div><div className="cta-actions"><Link className="button button--secondary" href="/privacy">Privacy notice</Link></div></div>
        ) : null}
        <div className="notice-card" style={{ marginTop: 22 }}><span className="notice-mark" aria-hidden="true">✳</span><span>For urgent food-safety concerns, follow your organisation&apos;s approved operating and escalation procedure. This website is not an emergency service.</span></div>
      </div></section>
    </PublicLayout>
  );
}
