# Operating model

How a donation is meant to work in the real world, who is responsible at each step, and where the
software stops. The pilot area is **Joka · IIM Calcutta (Kolkata)**, configured in the database, with
policy `0.1.0-iim-calcutta` still in `draft`.

This document describes intended operation. It does not assert that any partner, licence or
inspection exists.

## Roles and responsibilities

| Role | Responsible for | Accountable for | The software does not |
|---|---|---|---|
| **Generator** (canteen, kitchen, caterer, event) | Truthful declaration of food, ingredients, allergens, times, storage and handling | The condition of the food until it is handed over | Inspect, certify or test the food |
| **Receiver** (NGO, shelter, community kitchen) | Confirming capacity, performing acceptance checks, sharing the code only after inspection | What happens to the food after receipt | Judge suitability on the Receiver's behalf |
| **Helper** (volunteer or staff) | Collecting on time, keeping the food as instructed, recording condition | The handling of the food in transit | Guarantee cold chain or vehicle fitness |
| **Operations administrator** | Verifying partners, service areas, dispatch exceptions, recalls | Consistent, documented decisions | Grant itself safety or legal authority |
| **Safety officer** | Food-category policy, holds, recalls, incident closure | The content of a policy version, each closure note and each recorded corrective action | Replace a food authority or regulator |
| **Support agent** | Support cases and correction requests | Handling personal data minimally | See codes, passwords or unrestricted documents |
| **Security administrator** | Privileged access and audit review | Keeping access least-privilege | Inspect food or recipient personal data |

## The lifecycle, and what must be true

1. **Onboarding.** A person registers, asks for Generator, Receiver or Helper access, and uploads
   verification evidence to private storage. Access stays `pending` until a human records a decision
   with a reason. A verified organisation can be suspended later; suspension blocks new listings and
   offers immediately.
2. **Policy.** A service area is only live when an approved policy version is in force. The policy
   fixes the allowed categories, the minimum lead time between listing and pickup, the minimum
   shelf life after the latest pickup, the Receiver's response window, whether partial acceptance is
   allowed and whether allergen disclosure is mandatory. Anything outside the policy is refused by
   the server, not hidden in the interface.
3. **Listing.** The Generator declares quantity with a unit, category, food type, ingredients,
   allergens, preparation and packing times, best-before, pickup window, storage and handling. The
   server rejects expired food, impossible time ordering, missing allergen data where the policy
   requires it, and categories the policy does not permit.
4. **Offer and acceptance.** Eligible Receivers are the ones in the service area whose organisation
   is verified and whose declared capability matches the category. A Receiver accepts (wholly or
   partly) or declines with a reason inside the response window. Acceptance is not a safety finding;
   it is a capacity commitment.
5. **Dispatch.** Every approved, active Helper in the service area is notified when a delivery
   becomes claimable. The first Helper whose conditional claim succeeds owns the job; a second Helper
   is told it is taken. If nobody claims it, or a claim expires, the backlog sweep tells operations
   once. Before collection, operations can release a stalled assignment back to the open pool with a
   recorded reason; after collection, only an incident and a hold can stop it. The delivery code is
   not available to the Helper at any point.
6. **Collection.** The collector — a Helper, or the receiving organisation collecting its own food —
   records collection with condition observations. A concern raised here can put the donation on hold
   instead of proceeding.
7. **Delivery.** After physical arrival, the Receiver records four structured checks (seal, packaging,
   label against the declaration, inside the declared window) and a temperature reading whenever the
   listing declared a temperature requirement. Only then does it share the single-use code. A failed
   check is recorded as a knowing acceptance and escalated to both organisations; it does not block
   the Receiver from acting on its own judgement. Five wrong code attempts lock the delivery and
   require an audited operations reset.
8. **Receipt.** Verification writes exactly one receipt, one custody event and one set of notices.
   Only this step counts toward impact.
9. **Exception.** Refusal, no-show, failed collection, damaged packaging, suspected contamination,
   allergen mismatch or a time-window breach is recorded as an incident with a hold. A recall stops
   the batch, records why and lists the receipts already issued.

## Service areas

A service area is a row, not a hardcoded city: label, country, region, city, timezone and an active
flag. Policies attach to service areas. Adding a second area is a data change plus a policy
approval, not a deploy. Areas are not assumed to share legal requirements.

## Partner approval

Before any real listing: the organisation's legal name, the responsible person, the operating
address, the food it handles, the receiving or collection window, and the evidence it is entitled to
operate are recorded and reviewed by a human who is not the applicant. Re-validation on document
expiry is a manual step today. See `PARTNER_ONBOARDING.md`.

Two further declarations are now records rather than prose, and both feed the launch gate:

- **The partner agreement.** A named member of the organisation accepts a specific published version
  (`src/domain/partner-agreement.ts`). The acceptance stores who, when, and the SHA-256 of exactly
  what was shown. Changing the text is a new version, so every partner is asked again instead of
  being silently grandfathered. **It has not been reviewed by counsel** and must not be described as
  a contract, a licence or insurance.
- **Insurance.** The organisation records its own policy reference and expiry. `app_launch_readiness()`
  reports partner cover as unmet until every verified organisation holds a current declaration, so a
  lapsed policy re-opens the gate without anyone editing a document. A declaration is not cover, and
  the platform operator's own entity and policy are separate, still-open owner gates.

## When harm is reported

Any participant on a delivery may flag that a person was harmed or became unwell. The description is
required, and the report notifies operations, the safety officer and security immediately — it does
not wait in an ordinary notification queue. The incident it creates cannot be closed until somebody
records what changed so the same failure cannot recur. A closure is a record of a decision, never a
finding that food was safe, and it does not release a hold.

## Refusal, hold and recall

- **Refusal** at offer time: the Receiver declines with a reason; the listing returns to the pool or
  expires.
- **Refusal on arrival** (unsuitable, damaged, unsafe, mismatched): recorded as an incident; the food
  does not enter distribution; the code is not shared.
- **Hold:** the donation is stopped and cannot be matched or assigned until an authorised release is
  recorded. Closing the incident record does not release the hold.
- **Recall:** the batch, its reason, its author and the receipts already issued are recorded; every
  party is notified; the donation does not return to distribution.

## What the software must never be described as doing

It does not inspect, test, certify, insure or approve food. It records declarations, decisions and
handovers made by people. Every screen in the pilot says so, and any marketing copy that implies
otherwise is a defect.

## Escape hatches for a bad day

- Operations can pause a whole service area by deactivating it.
- The launch gate `OPERATIONS_ENABLED` stops every donation action at once.
- A recall stops a batch immediately without a deploy.
- Any organisation can be suspended, which blocks its listings and offers on the next request.
- An uncollected assignment can be released and re-broadcast when the assigned Helper cannot
  complete it (`POST /api/jobs/[id]/release`, operations or safety role, reason recorded). Once food
  has been collected this is deliberately unavailable: record an incident and a hold instead.
- A job that stays unclaimed past `ESCALATION_THRESHOLD_MINUTES` (default 30) is escalated to
  operations and safety staff exactly once, so no delivery waits silently.
- Notifications are not a delivery mechanism for safety decisions: a recall notice is a courtesy,
  a phone call is the actual control.
