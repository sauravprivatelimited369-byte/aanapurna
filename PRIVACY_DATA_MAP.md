# Privacy data map

A record of what personal data this application actually stores, where, why, who can read it, and
how long it is kept. It describes the code as written at commit `52e71ec`; it is not a legal opinion
and the privacy notice remains `DRAFT — REQUIRES QUALIFIED REVIEW`.

Companion gaps are tracked in `LAUNCH_CHECKLIST.md`.

## Personal data held

| Data | Table / location | Purpose | Who can read it | Retention |
|---|---|---|---|---|
| Name, email, email-verified flag, Better Auth intake fields | `"user"` | Sign-in, contact, verification | The account holder; operations and support roles per policy | Lifetime of the account |
| Password hash | `account` | Authentication | Nobody (only the verifier reads it) | Lifetime of the account |
| Sessions (token, IP, user agent, timestamps) | `session` | Session management, revocation screen | The account holder (coarse device/location only), security administrator | Until expiry or revocation |
| Account status, display name, requested role | `user_profiles` | Access decisions | The account holder; platform roles | Lifetime of the account |
| Registration intake (phone, address, organisation name, profile notes) | `registration_profiles`, transient `"user".registration_*` | Partner review | The applicant; reviewers with the `registration_profiles_select` policy | Until review completes, then retained as evidence |
| Organisation contact and address | `organizations`, `delivery_destination_details` | Pickup and delivery coordination | Members of that organisation; the assigned Helper (destination only); platform roles | Lifetime of the organisation |
| Helper display name, availability, eligibility | `helper_profiles` | Dispatch | The Helper; operations | Lifetime of the Helper |
| Delivery destination for an assigned job | `delivery_destination_details` | Telling the Helper where to go | The assigned Helper only, via a restricted policy | Lifetime of the job |
| Delivery code (hash + encrypted value) | `delivery_codes` | Proof of handover | The Receiver of that delivery; never the Helper or Generator | Retired on verification or expiry |
| Custody and audit events (actor, action, timestamp, details) | `custody_events`, `audit_events` | Accountability, incident reconstruction | Participants for their own donations; platform roles | Append-only; no deletion path |
| Receipts | `delivery_receipts` | Proof of delivery, impact | Parties to the delivery; platform roles | Long-term evidence |
| Private documents | `private_documents` + `PRIVATE_STORAGE_DIR` | Partner verification | Authorised reviewers only, through `/api/documents/[id]` | Per document retention policy (not automated) |
| Support cases and data requests | `support_cases`, `data_requests`, `donation_private_details` | Handling requests and corrections | Support and operations; the requester | Until resolved, then retained for accountability |
| Notifications | `notifications`, `email_outbox` | Operational alerts | The recipient | Outbox pruned by policy (see runbook) |
| Rate-limit keys | `api_rate_limits`, `rate_limit` | Abuse prevention | Infrastructure only | Window-bounded |

## Data minimisation decisions already in the code

- No GPS traces, no continuous location history, no device fingerprinting beyond the user agent that
  the session table already receives.
- Delivery codes and password/reset tokens are never written to logs, audit details, notifications or
  URLs after use.
- The session screen masks IPv4 to three octets and summarises the user agent instead of echoing it.
- Helper-visible delivery data is a destination snapshot, not the Receiver organisation's full record.
- Public impact numbers are aggregates from verified receipts; no personal data is exposed publicly,
  and no public proof page exists yet.

## Processors and transfers

| Processor | Purpose | Data | Notes |
|---|---|---|---|
| SMTP provider (owner-selected) | Verification, reset, operational email | Email address, name, message content | Currently a capture inbox: accepted, not delivered |
| Vercel | Hosting for the web tier | Request data, application logs | No database content beyond what a request requires |
| Supabase | PostgreSQL hosting | Everything above | Region chosen by the owner; confirm before real data |
| No analytics, no error-reporting SaaS, no advertising SDK | — | — | — |

Cross-border transfer assessment, processor agreements and the DPDP notice language are owner/legal
actions, not code.

## Rights handling in the product today

- **Access:** the account holder sees their profile, memberships, sessions and their own deliveries.
- **Correction:** through support; the change is attributed in the audit trail.
- **Erasure:** *not implemented*. `audit_events` and `custody_events` are append-only and 32 foreign
  keys reference `"user"`, so a delete fails by design. A controlled anonymisation workflow is
  required before real onboarding.
- **Grievance:** `/contact` and `/app/support` are the documented paths; neither can be exercised
  until an owner-supplied contact is configured.
- **Consent records:** terms acceptance is captured at registration; the notice itself is a draft.

## Retention

No automated retention job exists. Periods must be set by the owner — at minimum for registrations
that are never approved, for outbox messages after delivery, for rate-limit rows, and for private
documents after verification — and then implemented as a worker task. Until that exists, data is
kept indefinitely, which is itself a finding.

## Changes that would need this document updated

Adding analytics, a maps provider, SMS/WhatsApp, an object store in a new region, public receipt
pages, or an erasure/anonymisation workflow.
