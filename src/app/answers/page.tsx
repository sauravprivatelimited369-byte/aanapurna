import type { Metadata } from "next";
import Link from "next/link";
import { PublicLayout } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Straight answers",
  description:
    "Direct answers to the hard questions about food safety, volunteers, distance, security, liability, data and account recovery on Annapurna Link — including what the software cannot do.",
};

type Answer = {
  id: string;
  question: string;
  short: string;
  enforced: string[];
  limits: string;
  gate?: { label: string; detail: string };
};

const ANSWERS: readonly Answer[] = [
  {
    id: "clean-food",
    question: "How does a receiver know the food is clean — and what if it contains carcinogens or something else harmful?",
    short:
      "Nobody can know that from a web form, and this application never claims to. Carcinogens, pathogens, pesticide residue and adulterants are laboratory findings. What the software does is force the risk decisions into named human hands and leave evidence of what each hand did.",
    enforced: [
      "No human-approved food policy for the area means no listing at all — the server refuses with 423, it does not merely hide a button.",
      "Only the food categories the policy permits can be listed, and only verified organisations can list or accept.",
      "Already-expired food is refused at listing and refused again at acceptance.",
      "Allergen and ingredient disclosure is mandatory when the policy says it is.",
      "The delivery code is shown only to the receiver, and only after the food has physically arrived and the receiver has recorded its checks. The collector can never retrieve it.",
      "The arrival inspection is now four recorded answers plus a temperature reading where the listing declared one: was the seal unbroken, was the packaging intact, did the contents match the declaration, did it arrive inside its window. These are written once, in the same transaction as the acceptance, and cannot be edited afterwards.",
    ],
    limits:
      "The platform does not sample, test, inspect, certify, insure or approve food. A failed check does not stop a receiver accepting knowingly — it records that they did, tells operations, and leaves their decision on the record. A named, qualified food-safety professional still has to sign the policy and the area rules; that is an open launch gate, not a feature.",
    gate: { label: "Open gate", detail: "Food-safety policy is still draft. No real food may move until a qualified professional signs it." },
  },
  {
    id: "volunteers",
    question: "Most people are too busy to help. How do we get more people to help — and what if the helper who accepted is not available?",
    short:
      "Software cannot create volunteers, and this is the weakest link in the whole design. What it can do is make a no-show visible within minutes instead of letting food sit until it expires — and remove the need for a helper entirely when the receiver can collect.",
    enforced: [
      "When a delivery becomes claimable, every approved, active helper in that service area is notified at once. It is not pre-assigned to one person.",
      "A claim is a single atomic update with a 30-minute hold. A second helper is told it is taken, not silently double-booked.",
      "If the claim expires, the job becomes claimable again automatically.",
      "A job nobody claims is escalated to operations and safety staff once, past a configurable threshold (30 minutes by default). It does not wait silently.",
      "Before collection, operations can release a stalled assignment back to the pool with a recorded reason; the previous helper and both organisations are told.",
      "A receiver can collect the food itself. Its operator becomes the assigned collector and the same custody, code and receipt steps apply — so a delivery is possible with no helper at all.",
    ],
    limits:
      "A standby rota, a named coordinator per area and published pickup windows are people decisions, not features. A helper who vanishes after collecting can only be handled by an incident and a hold, because the food has already left the generator.",
    gate: { label: "People gate", detail: "No standby rota or named area coordinator yet. G2d in the gap register." },
  },
  {
    id: "distance",
    question: "The whole thing depends on a third person. What if they help some days and not others, and what if the distance is vast?",
    short:
      "The pilot is deliberately one small area. Distance is measured, not assumed, and a route beyond the area's limit is refused. What does not exist is live traffic routing: the estimate is a planning aid, not a promise of arrival time.",
    enforced: [
      "A helper cannot claim a delivery outside their own approved service area.",
      "Distance is computed from exact coordinates when an organisation supplies them, otherwise from a checked-in gazetteer matched on the city. Road distance applies a stated 1.25 factor and the area's configured average speed.",
      "If a service area sets a maximum transit distance, a claim beyond it is refused outright.",
      "When no distance can be established, the record says \"distance unknown\" and nothing is refused — the application does not invent a number.",
      "Before collection the assignment can be released and re-broadcast; an unclaimed job is escalated automatically.",
    ],
    limits:
      "There is no live traffic, no turn-by-turn directions and no paid maps provider. The honest rule before expanding into a new area is: if a route cannot be completed well inside the declared shelf life and pickup window by a named person with a known vehicle, do not list that food in that area.",
  },
  {
    id: "takeover",
    question: "What if someone tries to take over the application and use it for malicious intent?",
    short:
      "There is a layered, tested set of controls, plus a written list of what is still unproven. The honest residual risks are that ordinary partner accounts do not require a second factor, and that no independent penetration test has been done.",
    enforced: [
      "Roles and account statuses are never read from a request body; identity is loaded from the database on every request.",
      "Row-level security is enabled and forced across the business tables: one organisation cannot read another's records even through a query bug.",
      "Sign-in attempts are rate limited in the database, with generic error messages that do not reveal whether an address is registered.",
      "Sessions are HTTP-only, SameSite and Secure in production, with no cookie cache so revocation is immediate.",
      "Every mutation is same-origin checked. The content-security policy is enforcing and nonce-based on every server-rendered page.",
      "Consequential actions — releasing a hold, resetting a code, recovering an account — require a platform role, a second factor (TOTP with backup codes), a recorded reason and an audit event.",
      "Uploads are size and MIME checked and stored outside the public web root; uploads fail closed unless a malware scanner answers.",
      "Supabase's public PostgREST roles were stripped of every privilege on every application object, closing a real bypass found during hosted deployment.",
    ],
    limits:
      "An operations administrator can reassign deliveries and release holds; every one of those writes an audited event, but the system detects it by review, not in real time. A compromise of the owner's Vercel or Supabase account is a compromise of the application, and no code here prevents that — those accounts need MFA and least privilege.",
    gate: { label: "Open gate", detail: "No independent penetration test yet. The readiness console reports it as unmet until a report less than twelve months old is recorded." },
  },
  {
    id: "responsibility",
    question: "If food turns out to be harmful, who takes responsibility for the harm?",
    short:
      "An application cannot take responsibility, and this pilot does not yet have a legal entity or an insurance policy that would answer a claim. That is a launch blocker, and the software is built to say so rather than hide it.",
    enforced: [
      "Before an organisation is verified, a named member must accept the published partner agreement — which states exactly who answers for which stage of the food's journey — for that specific version.",
      "Each verified partner records its own insurance policy reference and expiry. If it lapses, the readiness check re-opens by itself with nobody editing a document.",
      "Custody events, incident records, recall records and receipts are append-only. The application role cannot edit or delete them; corrections are new events.",
      "Anyone can report harm during a delivery. That escalates to operations, the safety officer and security immediately, separately from an ordinary incident notification.",
      "An incident cannot be closed without recording whether a person was harmed and what changed so the same failure cannot recur.",
      "A recall records its reason, its author and every receipt already issued, so anybody holding the food can be identified.",
    ],
    limits:
      "The partner agreement is plain-language, not a legally reviewed contract. A legal entity, actual insurance cover and counsel's review of food-safety and data-protection duties are all still open. The honest published position is: the organisations handling the food remain responsible for it; the platform records and coordinates, and does not certify, inspect or insure.",
    gate: { label: "Open gate", detail: "No legal entity and no insurance policy recorded yet, so launch readiness reports the pilot as not ready." },
  },
  {
    id: "database",
    question: "How is the database managed? Is there a firewall? Who handles the data if something goes wrong?",
    short:
      "PostgreSQL is the source of truth, reached only from the server with restricted roles. Calling it \"protected by a firewall\" would be an overstatement; what is accurate is that only one service can reach it, with least-privilege roles and row-level policies.",
    enforced: [
      "Three separate non-superuser, non-BYPASSRLS logins: runtime application, authentication, and worker. The privileged migration role is never used by the web app.",
      "The browser never speaks to PostgreSQL — only to the Next.js server.",
      "Row-level security is enabled and forced, with the caller's identity set per transaction so pooled connections cannot leak it.",
      "TLS with a pinned Supabase root certificate and certificate verification, so a machine-in-the-middle with a random certificate is rejected.",
      "Private documents live outside the database, behind an authorised download handler that writes an audit event for every read.",
      "An incident response procedure names a single voice for the incident, with containment, scoping, evidence preservation and notification steps.",
      "Retention runs. A nightly job at 03:15 IST deletes read notifications, spent one-time codes, expired delivery codes and failed email dead letters, and scrubs the free text from closed incidents and old audit rows. A preview shows the exact counts before anything goes, produced by the same function that performs the sweep.",
      "A record on legal hold is never deleted, whatever the window says. Holds are scoped, need a name and a reason, and cannot be deleted — only released.",
    ],
    limits:
      "There is no application-level WAF and no IP allowlist in this repository. Network exposure is governed by the hosting providers, and setting database network restrictions is an owner action in their console. Backups are scripted but a real hosted restore has not been exercised yet, and there is no staffed on-call rota today. Audit rows are never deleted, because they are the evidence the rest of the system worked: past six years only their free text goes, and the guard that refuses every other change to them is tested.",
    gate: { label: "Owner gate", detail: "Supabase network restrictions, a tested restore, and a scheduled on-call shift are console and people actions, not code. The retention windows are enforced in code, but the numbers themselves — 90 days for a notification, 6 years for audit detail — are a legal decision nobody has signed off. The defaults are a defensible starting point, not advice." },
  },
  {
    id: "apis",
    question: "The code was built by AI with tools. What guarantees that the APIs it uses are not being accessed by others?",
    short:
      "No guarantee is possible, and the premise mostly does not apply here: there is exactly one external API integration and it needs no credential. The real exposure is the database and hosting credentials, and those never reach the browser.",
    enforced: [
      "No secret is shipped to the browser: there are no NEXT_PUBLIC_ variables, and domain, database, auth, crypto, email and storage modules fail the build if imported into a client component.",
      "The one external integration fetches a fixed public record with no key and no user data, and validates returned URLs against allowed hosts.",
      "Database credentials are server-side only and use least-privilege roles.",
      "Logging excludes the credential-bearing auth routes; tokens and delivery codes are never logged.",
      "Dependencies are pinned by lockfile and audited in CI.",
      "The behaviour is pinned by tests — row-level security, role boundaries, strict input schemas, security headers, origin rejection — and the dangerous paths fail closed.",
    ],
    limits:
      "There has been no independent code review, no penetration test and no formal audit of the logic. Whoever holds the hosting accounts, the mail credentials or the signing keys can read or alter everything regardless of who wrote the code. Those accounts need MFA and rotation, and the values must never sit in a repository, a chat or a commit.",
  },
  {
    id: "password",
    question: "What if someone forgets their password? Who helps, and how long does it take?",
    short:
      "Three paths now, and the honest time depends on which one you need. Self-service reset takes seconds once real email is configured. If email is not working, a locked-out person can ask for help without signing in, and an operator issues a single-use link after an identity check.",
    enforced: [
      "A reset request returns the same confirmation whether or not the address is registered, so the form cannot be used to discover who has an account.",
      "Reset links are single-use and time-limited, and completing a reset revokes every existing session.",
      "A locked-out person can file a recovery request without a session: name the address and say what happened. The response is identical either way, and the request is rate limited per address and per IP.",
      "Operations see those requests in a queue with a named owner, and every review is audited with the reason it was made.",
      "An operator with the right role and a second factor can issue the single-use link directly and hand it over through a channel they have verified.",
      "The support page publishes a response window derived from the recorded on-call rota — and says plainly that no window is promised when nobody is on call.",
    ],
    limits:
      "On the current hosted deployment, email goes to a capture sink that accepts messages and delivers them to nobody. Until a real mail provider is configured, self-service reset does not reach a person, and recovery depends on a human operator being reachable. That is recorded as an open gate, not glossed over.",
    gate: { label: "Open gate", detail: "Email delivery is a capture sink on the hosted deployment. Operator-assisted recovery works; self-service reset does not, yet." },
  },
];

export default async function AnswersPage() {
  return (
    <PublicLayout active="/answers">
      <section className="page-hero"><div className="container">
        <span className="eyebrow"><span className="eyebrow-line" /> No marketing answers</span>
        <h1>The hard questions,<br />answered plainly.</h1>
        <p>Eight questions a receiver, partner or reviewer should ask before trusting a food-redistribution platform. Each answer separates what the code enforces, what it cannot do, and which gate is still open.</p>
      </div></section>

      <section className="section"><div className="container">
        <div className="draft-banner"><strong>UNVERIFIED ENGINEERING EXPLANATION.</strong> Written by the people who built the software. No qualified food-safety professional, lawyer or independent security reviewer has signed it. Where a claim would be false, the answer says so.</div>

        <div className="answers-grid" style={{ marginTop: 28 }}>
          {ANSWERS.map((answer, index) => (
            <article className="app-card answers-card" key={answer.id} id={answer.id}>
              <span className="app-eyebrow">Question {String(index + 1).padStart(2, "0")}</span>
              <h2>{answer.question}</h2>
              <p className="answers-short">{answer.short}</p>

              <h3>What the software actually enforces</h3>
              <ul className="answers-list">
                {answer.enforced.map((item) => <li key={item}>{item}</li>)}
              </ul>

              <div className="answers-limit">
                <strong>What it cannot do, or does not yet have</strong>
                <p>{answer.limits}</p>
              </div>

              {answer.gate && <p className="status-pill status-pill--pending"><span>{answer.gate.label}: {answer.gate.detail}</span></p>}
            </article>
          ))}
        </div>

        <div className="cta-panel" style={{ marginTop: 30 }}>
          <div>
            <span className="eyebrow"><span className="eyebrow-line" /> Verify it, do not take our word</span>
            <h2>The record is the argument.</h2>
            <p>Every claim on this page corresponds to a database constraint, a role check or a test in the repository. The documents that go deeper are linked below, and they name their own gaps.</p>
          </div>
          <div className="cta-actions">
            <Link className="button button--primary" href="/food-safety">Food safety boundary</Link>
            <Link className="button button--secondary" href="/how-it-works">How a delivery works</Link>
            <Link className="button button--secondary" href="/contact">Contact the operator</Link>
          </div>
        </div>
      </div></section>
    </PublicLayout>
  );
}
