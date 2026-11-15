# Food safety controls

**Status: DRAFT — REQUIRES QUALIFIED REVIEW.** Written by the engineering team to describe what the
software records and enforces. It is not a food-safety plan, not a legal opinion and not a
certification. No qualified food-safety professional has reviewed it.

## The boundary

Annapurna Link coordinates a handover and keeps the record of it. It does not inspect, sample, test,
certify, insure or approve food, and it cannot verify that a declaration is true. The Generator
declares; the Helper observes in transit; the Receiver inspects on arrival; operations and safety
staff decide about holds and recalls.

Any statement that the platform "ensures safe food" would be false and must be removed wherever it
appears.

## What the software enforces by construction

| Control | Mechanism |
|---|---|
| Only an approved policy permits listing | `activePolicy()` refuses with `423 NO_ACTIVE_POLICY`; a listing stores the policy version it was created under |
| Category must be permitted | checked against `policy.rules.allowedCategories` server-side |
| Food type must be permitted | checked against `policy.rules.allowedFoodTypes` |
| Lead time before pickup | `policy.rules.minimumPickupLeadMinutes` enforced against the pickup window |
| Shelf life after pickup | `policy.rules.minimumExpiryAfterPickupMinutes` enforced against best-before |
| Already-expired food | rejected at creation and refused again at acceptance |
| Allergen disclosure | required when `policy.rules.requireAllergenDisclosure` is true |
| Response window | `policy.rules.offerResponseMinutes`; an offer past its deadline cannot be accepted |
| Partial acceptance | allowed only when `policy.rules.allowPartialAcceptance` is true |
| Only verified organisations trade | unverified or suspended organisations cannot list, accept or be matched |
| Holds stop movement | an incident with a hold blocks matching, claiming and distribution |
| Recall stops a batch | `recall_records` + `donations.status = 'recalled'`; parties notified; receipts listed |
| Nothing counts until verified | impact derives from verified receipts only |
| Arrival checks are structured, not prose | four recorded answers (seal, packaging, label, window) plus an optional temperature; written once, in the same transaction as the acceptance, by a trigger that only the receiving organisation can satisfy |
| A temperature reading is required when the listing declared one | `TEMPERATURE_READING_REQUIRED`; a receiver cannot claim to have checked what it did not measure |
| A failed check is recorded, not hidden | the receiver may still accept knowingly; the failed checks are written to the custody event, audited, and escalated to both organisations |
| Harm cannot be reported without describing it | `harm_reported` requires `harm_details`; a database CHECK enforces the same rule |
| Harm escalates beyond a queue | a harm report notifies operations, the safety officer and security immediately, separately from an ordinary incident notification |
| An incident cannot be closed without a corrective action | `corrective_action` of at least 20 characters, required by a CHECK and by the service; harm recorded at report time cannot be dropped at closure |

## Arrival checks in detail

The four checks are deliberately individual booleans rather than one "all fine" tick, because "the
seal was broken but the label matched" is information an investigation needs and a single tick would
destroy it. Every one starts unset in the interface: a pre-selected answer turns a safety record into
a form somebody clicks through.

| Check | What it records | Why it is separate |
|---|---|---|
| Seal intact | whether the packaging seal was unbroken on arrival | the most common tamper and spoilage signal |
| Packaging intact | whether the packaging was intact and not leaking | distinguishes a broken seal from a crushed box |
| Label matched | whether the contents matched the declared ingredients and allergens | allergen mismatch is the highest-consequence declaration error |
| Within window | whether the food arrived inside its declared time window | a delivery that is technically complete but hours late is a safety event |

The temperature field is bounded to −40 to 120 °C, which spans a commercial freezer, a chiller, a hot
box and near-boiling rice. That bound is a sanity check on a typo, **not** a policy: whether 63 °C is
acceptable for a given category is the approved policy's decision, and the platform does not make it.

A receiver who reports a failed check is accepting the food knowingly. The record says so, operations
and the generator are told, and the decision is the receiver's to answer for. That is deliberate: the
alternative is a system that either blocks a receiver who has a legitimate reason, or quietly records
a pass nobody gave.

## The partner's own cover

Each organisation records its own insurance policy reference and expiry, and a named member accepts
the current partner agreement (versioned, with the SHA-256 of the text they were shown stored beside
the acceptance). `app_launch_readiness()` reports partner coverage as unmet until every verified
organisation holds a current declaration and has accepted the current agreement, so the answer to
"who is covered if someone is harmed" is a query, not a paragraph that may have gone stale.

The agreement is plain-language and **has not been legally reviewed**. It is a record of what a
partner accepted, not a substitute for counsel.

## The human decisions the software only records

1. Whether a category is safe to redistribute in this area at all.
2. Whether a particular donation may be listed, after human judgement about the kitchen.
3. Whether an observed condition (temperature, packaging, time) means the food should not be
   delivered.
4. Whether a recall is warranted and when it is closed.
5. Whether a partner may keep operating after an incident.

Each of these requires an authorised person, a reason, and — where the action is a decision — an
audit event. The interface never presents a suggestion as a decision.

## Declarations captured per listing

Preparation time, packing time, best-before, category and food type, ingredients (free text plus
known allergens as a list), storage requirement, handling instruction, pickup window, quantity with
a unit, and the Generator's own note. These are declarations by the Generator; the record shows who
declared them and when.

## Non-negotiable behaviours

- A hold or recall cannot be released by resolving an incident; a separate authorised decision is
  required and recorded.
- A delivery code is shared only after physical arrival and inspection. A Helper who cannot obtain a
  code must escalate; nobody may silently complete a delivery on the Helper's behalf.
- An exception (damaged, mismatched, late, wrong temperature, suspected contamination) must be
  recordable without the system pretending the delivery succeeded.
- Re-listing recalled food requires a new listing that a human sees and reviews. Closing a recall does
  not return the donation to distribution.
- No AI output may pass or fail food. If advisory assist is added later, it must be labelled advisory
  and a qualified human must still decide.

## Records kept for accountability

Custody events (who did what, when), incident records with severity and hold flag, recall records
with reason/author/affected receipts, receipts for verified deliveries, and an append-only audit log
for privileged actions. Audit and custody records cannot be edited or deleted by the application
role; corrections are new events.

## What is missing before real food moves

- A named, qualified person to review and sign this document and the policy rules.
- Area-specific rules: which categories may be redistributed, temperature handling requirements,
  maximum time between cooking and consumption, packaging standards.
- Partner evidence checks: how a kitchen's entitlement is verified and how often it is rechecked.
- Handling training material and an acknowledgement path for Helpers.
- A documented escalation plan for a suspected food-safety incident, including who calls whom.
- Insurance and liability position. Each partner now *records* its own cover and each accepts a
  responsibility agreement, but none of that creates a policy, an entity or a liability position
  that would answer a claim.
- Laboratory or inspection arrangements, if the responsible professional requires them.

Until those exist, the honest description of this system is: it can coordinate a pilot among
organisations that already trust each other and already meet their own obligations, and it will keep
a better record than a spreadsheet. It cannot make food safe.
