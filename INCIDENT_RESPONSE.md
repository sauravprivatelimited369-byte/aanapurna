# Incident response

Two kinds of incident, one escalation path. The distinction that matters in the first five minutes is
whether food may already be unsafe, or whether data or access may already be compromised. Both stop
operations for the affected scope until a human says otherwise.

## Severity

| Level | Example | Response |
|---|---|---|
| **SEV-1** | Suspected contaminated batch delivered; personal data exposed; privileged account compromised | Stop affected operations immediately, notify the owner within the hour, preserve evidence |
| **SEV-2** | Delivery code brute-forced or leaked; partner operating after suspension; worker down for hours | Contain inside the working day, notify affected parties |
| **SEV-3** | Single failed delivery, notification backlog, a partner unable to sign in | Handle in normal operations |

## Food safety incident

1. **Stop the food.** Recall the donation from the operations console. That records the reason, the
   author, the previous status and every receipt already issued, and notifies the Generator, the
   Receiver and any assigned Helper.
2. **Phone the Receiver.** A notice in an application is a courtesy. A call is the control.
3. **Record what is known.** Incident with severity, description and hold. Do not guess.
4. **Preserve** the listing, custody events and receipts. They are append-only; do not attempt to
   correct them.
5. **Escalate** to the responsible food-safety professional and to the owner.
6. **Close** the incident only with a resolution note; a closure is not a finding that food was safe.
   Release of a hold is a separate authorised decision.
7. **Review** afterwards: what the declaration said, what the Helper observed, what the Receiver
   found, and which check should have caught it.

## Data or access incident

1. **Contain.** Revoke sessions for the affected account (Profile and security, or a privileged
   reset). Suspend the account if it is a partner.
2. **Scope.** Establish which records were reachable: role, organisation, delivery, and time window.
   Row-level policies bound what was actually readable; say what the evidence supports, not less and
   not more.
3. **Preserve** audit events and request logs before changing anything else.
4. **Notify** the owner, and take legal advice on whether the persons affected must be informed and
   within what period — the DPDP obligations in `LEGAL_RESEARCH_REGISTER.md` are unverified and must
   be confirmed by a professional.
5. **Fix** the class of defect, not just the instance, and add the test that would have caught it.

## Delivery incident

Failed collection, a Helper stranded, a Receiver refusing on arrival: the delivery is not marked
delivered. Record what happened, keep the code unused, and reassign only through an operations
exception with a reason. Food that has been out of controlled conditions too long is not
redistributed; say so and record why.

## Communication

One person speaks for the incident: the owner or the operations administrator on duty. Support agents
answer from the same written summary. Nobody improvises a cause, and nobody describes the platform as
having certified anything.

## Afterwards

A short written review within a week: timeline, what the record shows, what failed, what changed, and
which test or control now covers it. If the answer is "the process relied on someone remembering",
that is the finding.
