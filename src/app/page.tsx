import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  ClipboardCheck,
  HandHeart,
  ShieldCheck,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import { FoodArt } from "@/components/food-art";
import { PublicImpact } from "@/components/public-impact";
import { PublicLayout } from "@/components/public-shell";

const roles = [
  {
    key: "generator",
    title: "Food donors",
    label: "Restaurants · hotels · caterers",
    text: "Share a clear surplus-food offer and its preparation, storage and collection details.",
    Icon: UtensilsCrossed,
    action: "Request donor access",
  },
  {
    key: "receiver",
    title: "Community organisations",
    label: "Receivers · NGOs · shelters",
    text: "Review offers against your real receiving capacity and confirm each handover when it arrives.",
    Icon: Building2,
    action: "Register your organisation",
  },
  {
    key: "helper",
    title: "Delivery Helpers",
    label: "Volunteers · approved drivers",
    text: "Support a collection and delivery with clear custody steps and role-limited details.",
    Icon: HandHeart,
    action: "Request Helper access",
  },
] as const;

const steps = [
  {
    number: "01",
    title: "A donor lists what is available",
    text: "Food details, quantities, ingredients, known allergens, timing and handling instructions are recorded as human declarations.",
    Icon: UtensilsCrossed,
  },
  {
    number: "02",
    title: "A Receiver reviews the offer",
    text: "Only an eligible, verified organisation can review a matching offer and decide whether it can receive it.",
    Icon: ClipboardCheck,
  },
  {
    number: "03",
    title: "A Helper completes the handover",
    text: "An approved Helper records collection. The Receiver confirms arrival directly, creating the delivery receipt.",
    Icon: Truck,
  },
];

const commitments = [
  {
    title: "Verified means human-reviewed",
    text: "Account and organisation requests stay pending until an authorised person records a decision.",
    Icon: BadgeCheck,
  },
  {
    title: "Traceable, not exaggerated",
    text: "A delivery enters impact figures only after the Receiver confirms the handover. Units are not converted into meal estimates.",
    Icon: ClipboardCheck,
  },
  {
    title: "Safety stays a human responsibility",
    text: "The platform records declarations and events. It does not inspect, certify or guarantee food safety.",
    Icon: ShieldCheck,
  },
];

export default function HomePage() {
  return (
    <PublicLayout active="/">
      <section className="hero hero--home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> Surplus food · responsible handovers</span>
            <h1>Good food deserves <em>a destination.</em></h1>
            <p className="hero-lead">Annapurna Link coordinates surplus food between donors and community organisations—with approved Helpers, clear handling information and a confirmed delivery record.</p>
            <div className="hero-actions">
              <Link className="button button--primary" href="/signup?role=generator">Donate surplus food <ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link className="button button--secondary" href="/signup?role=helper">Become a Helper</Link>
            </div>
            <div className="hero-tertiary-row">
              <Link className="hero-tertiary-link" href="/signup?role=receiver">Register your organisation <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link className="hero-tertiary-link" href="/preview">Walk through a sample handover — no account needed <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <div className="hero-note">
              <span className="hero-note-mark" aria-hidden="true"><ShieldCheck size={15} /></span>
              <span><strong>Requests are reviewed by people.</strong> Food operations remain paused until launch approvals are recorded.</span>
            </div>
          </div>
          <FoodArt />
        </div>
      </section>

      <section className="trust-strip" aria-label="Platform commitments">
        <div className="container trust-row" role="group" aria-label="Platform commitments" tabIndex={0}>
          <span className="trust-label">A careful chain, with a record</span>
          <span className="trust-item"><BadgeCheck size={19} aria-hidden="true" /> Human-reviewed access</span>
          <span className="trust-item"><Truck size={19} aria-hidden="true" /> Traceable handovers</span>
          <span className="trust-item"><ClipboardCheck size={19} aria-hidden="true" /> Verified outcomes only</span>
        </div>
      </section>

      <section className="section role-section" aria-labelledby="role-heading">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow section-kicker"><span className="eyebrow-line" /> Three roles, one shared outcome</span>
              <h2 className="section-title" id="role-heading">Start with the part <em>you can play.</em></h2>
            </div>
            <p className="section-intro">Choose a role to request access. Selecting a role starts a review—it does not approve a person, organisation or donation.</p>
          </div>
          <div className="role-grid">
            {roles.map(({ key, title, label, text, Icon, action }) => <article className="role-card" key={key}>
              <span className="role-card-icon"><Icon size={22} aria-hidden="true" /></span>
              <span className="role-card-label">{label}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <Link className="role-card-link" href={`/signup?role=${key}`}>{action}<ArrowRight size={16} aria-hidden="true" /></Link>
            </article>)}
          </div>
        </div>
      </section>

      <PublicImpact />

      <section className="section section--soft process-section" id="how-it-works" aria-labelledby="process-heading">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow section-kicker"><span className="eyebrow-line" /> From offer to receipt</span>
              <h2 className="section-title" id="process-heading">Every handover has <em>a next step.</em></h2>
            </div>
            <Link className="text-link" href="/how-it-works">Read the full process <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
          <ol className="process-grid">
            {steps.map(({ number, title, text, Icon }) => <li className="process-card" key={number}>
              <div className="process-card-top"><span className="process-number">{number}</span><span className="process-icon"><Icon size={19} aria-hidden="true" /></span></div>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>)}
          </ol>
        </div>
      </section>

      <section className="section promise-section" aria-labelledby="promise-heading">
        <div className="container promise-layout">
          <div className="promise-intro">
            <span className="eyebrow section-kicker"><span className="eyebrow-line" /> Trust is part of the workflow</span>
            <h2 className="section-title" id="promise-heading">Clear records. <em>Human decisions.</em></h2>
            <p>Food redistribution needs more than a matching button. Annapurna Link keeps declarations, handovers and exceptions visible to the people responsible for them.</p>
            <Link className="button button--ghost" href="/food-safety">Understand the safety boundaries <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className="commitment-list">
            {commitments.map(({ title, text, Icon }, index) => <article className="commitment-row" key={title}>
              <span className="commitment-icon"><Icon size={18} aria-hidden="true" /></span>
              <div><span className="commitment-index">0{index + 1} / PRINCIPLE</span><h3>{title}</h3><p>{text}</p></div>
            </article>)}
          </div>
        </div>
      </section>

      <section className="section section--soft local-discovery-section" aria-labelledby="local-discovery-heading">
        <div className="container local-discovery-panel">
          <div>
            <span className="eyebrow"><span className="eyebrow-line" /> Public directory · Joka, Kolkata</span>
            <h2 id="local-discovery-heading">Local discovery, with the source in view.</h2>
            <p>See one public restaurant-directory record near IIM Calcutta. It is not a partner profile, endorsement or food offer.</p>
          </div>
          <Link className="button button--secondary" href="/near-iim-calcutta">View the directory record <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="section final-cta-section">
        <div className="container">
          <div className="cta-panel final-cta-panel">
            <div>
              <span className="eyebrow"><span className="eyebrow-line" /> Begin with a human review</span>
              <h2>One careful handover can make a difference.</h2>
              <p>Request partner access. Real food operations will remain paused until the people, policies and local approvals are ready.</p>
            </div>
            <div className="cta-actions">
              <Link className="button button--primary" href="/signup">Start an access request <ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link className="button button--secondary" href="/contact">Contact and support</Link>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
