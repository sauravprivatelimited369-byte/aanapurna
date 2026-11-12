import type { Metadata } from "next";
import Link from "next/link";
import { Keyboard, MonitorSmartphone, PersonStanding } from "lucide-react";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Accessibility information and known limitations for Annapurna Link.",
};

const practices = [
  { title: "Keyboard access", text: "Navigation, forms and actions are intended to be usable without a pointer, with a visible focus indicator.", Icon: Keyboard },
  { title: "Responsive layouts", text: "Public pages and the account workspace are designed to reflow for narrow screens and touch use.", Icon: MonitorSmartphone },
  { title: "Reduced motion", text: "Decorative animation should respect the reduced-motion preference configured on your device.", Icon: PersonStanding },
];

export default function AccessibilityPage() {
  return <PublicLayout>
    <section className="page-hero"><div className="container">
      <span className="eyebrow"><span className="eyebrow-line" /> Access for more people</span>
      <h1>Accessibility is part of the work.</h1>
      <p>We are improving Annapurna Link so people can understand and use its information and workflows across devices and input methods.</p>
    </div></section>
    <section className="section"><div className="container">
      <div className="accessibility-practice-grid">
        {practices.map(({ title, text, Icon }) => <article className="accessibility-practice-card" key={title}><span className="role-card-icon"><Icon size={21} aria-hidden="true" /></span><h2>{title}</h2><p>{text}</p></article>)}
      </div>
      <div className="content-narrow accessibility-statement">
        <div className="draft-banner"><strong>ACCESSIBILITY STATUS: NOT FORMALLY AUDITED.</strong> These practices describe implementation intent, not a claim of WCAG 2.2 AA conformance.</div>
        <h2>Known limitations</h2>
        <p>Some workspace screens and legacy content are still being refined. Screen-reader, keyboard-only and cross-device testing is ongoing. The public accessibility contact and response process have not yet been configured.</p>
        <h2>Request help</h2>
        <p>If you can sign in, the Support &amp; privacy workspace offers an authenticated support request. No email address or phone number is published until an authorised contact is provided.</p>
        <Link className="button button--secondary" href="/contact">Contact and support information</Link>
      </div>
    </div></section>
  </PublicLayout>;
}
