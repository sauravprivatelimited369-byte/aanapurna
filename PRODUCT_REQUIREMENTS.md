# Product requirements

The single page that answers "what is this, what does it do, what does it explicitly not do". Scope
decisions are dated; the pilot area is Joka · IIM Calcutta (Kolkata).

## Mission

Coordinate surplus food from approved Generators to verified Receivers through approved Helpers, and
keep a record good enough to answer, months later, who handed what to whom and who decided what.

Tagline: *Share Every Meal. Waste Nothing.*

## Users

Generator staff, Receiver staff, Helpers, operations administrators, safety officers, support agents,
security administrators — plus anonymous visitors who must be able to read the product without an
account.

## Core flow (acceptance criteria)

1. A verified Generator creates a listing that satisfies the active policy, including allergens,
   times and handling. **Server-side**, not by hiding a button.
2. A verified Receiver in the same service area accepts wholly or partly inside the response window.
3. Exactly one Helper can hold a job; a second simultaneous claim is refused.
4. The Helper records collection; the Receiver inspects on arrival and shares a single-use code.
5. The Helper submits the code; exactly one receipt is written, one custody event appended, notices
   queued once.
6. The delivery counts toward impact exactly once, from the receipt.
7. Every step is attributable and appears on the timeline visible to the parties.
8. A recall can stop a batch and name its receipts.

## Roles and access

- Public signup offers only Generator, Receiver and Helper. Administration is never self-service.
- Access is granted by a human review with a reason, and can be suspended.
- A user may belong to several organisations; membership is checked on every request.
- Support staff cannot read codes, passwords or unrestricted documents.

## Non-goals

- Certifying, inspecting or insuring food.
- Deciding legal compliance for a partner.
- Live routing, ETAs or paid maps. Addresses, service areas and OpenStreetMap links only.
- Payments, donations of money, or tax receipts.
- AI decisions about food.
- Public proof pages that expose personal data.

## Experience requirements

- Mobile-first from 360px; touch targets at least 44px; no page-level horizontal overflow.
- Every data screen: loading, populated, empty, error+retry, submitting and permission-denied states.
- Reading needs no account (`/preview`, public pages). Acting always does.
- Wording never implies certification; the food-safety disclaimer appears where decisions are made.

## Operational requirements

- Real operations are gated behind `OPERATIONS_ENABLED` **and** an approved, effective policy, and
  every state change is audited.
- Notifications are transactional; a provider outage must not lose an intent.
- A dead worker is visible (`/api/health` heartbeat), not silent.
- Records are append-only; corrections are new events.

## Success measures (definitions, not targets)

Verified deliveries, quantity received with its own unit, active verified partners, approved Helpers,
acceptance rate, refusal/expiry rate, time from listing to acceptance, incident and recall counts.
Every figure derives from receipts. No conversion from meals to kilograms, money or emissions without
a documented method.

## Known gaps

Tracked in `MASTER_PROMPT_COMPLIANCE.md` and `LAUNCH_CHECKLIST.md`; the largest are account erasure
(blocked by the append-only guard), retention automation, real SMTP delivery, and human approvals for
the operating policy.
