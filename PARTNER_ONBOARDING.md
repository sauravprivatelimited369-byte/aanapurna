# Partner onboarding

The checklist a human follows before a Generator, Receiver or Helper may take part in real
operations. The software supports every step; none of it decides anything on its own.

## For every partner

1. **Registration.** The person creates an account and chooses Generator, Receiver or Helper. The
   choice is a request, never an approval.
2. **Identity and contact.** Legal name, the responsible person, phone, email, operating address.
   Recorded in `registration_profiles` and, on approval, in `organizations`.
3. **Evidence.** The documents the reviewer needs, uploaded to private storage and visible only to
   authorised reviewers.
4. **Review.** A reviewer with `operations_admin` records approve, request-information, reject or
   suspend, with a reason, which writes an audit event.
5. **Service area.** The partner is linked to an active service area. An organisation outside every
   active area cannot be matched.
6. **Training and acknowledgement.** For Helpers: handling expectations and the escalation path. The
   acknowledgement timestamp is stored on the Helper profile.
7. **First job supervision.** The first delivery for a new Helper is watched by operations; the
   workflow is identical, so this is a people step, not a code step.

## Generator specifics

Kitchen and prep space, categories it may offer, quantities, pickup window, storage between
preparation and pickup, who hands over, and what happens when an offer is partially accepted.

## Receiver specifics

Receiving window, storage and reheating capability, quantity capacity per period, dietary and
allergen handling, the named person who inspects and who holds the code, and the refusal path.

## Helper specifics

Service area, availability, whether they are a volunteer, staff member or contracted partner,
identity check, transport, and the escalation numbers. A Helper never receives a delivery code.

## Re-validation

Documents expire and kitchens change. Set an expiry per evidence type and re-check on a calendar the
owner controls. The software has no expiry automation yet: today this is a manual list, and that is a
known gap recorded in `LAUNCH_CHECKLIST.md`.

## Suspension

Any reviewer decision of `suspend` blocks new listings and offers on the next request. Existing
deliveries in progress are handled by operations, not by the system.

## What onboarding is not

Approval means a human reviewed the evidence supplied. It is not a licence, not a food-safety
certificate, not an endorsement and not a finding of compliance. Reviewers must be told this
explicitly, because an interface that says "verified" invites a stronger reading.
