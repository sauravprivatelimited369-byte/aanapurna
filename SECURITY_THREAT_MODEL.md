# Security threat model

Scope: the web application, its API, the worker, the database roles and the data they hold. This is
an engineering document, not a certification and not a security review by an independent party.

## Assets

| Asset | Why it matters |
|---|---|
| Delivery verification codes | A code proves physical handover. Leaking one lets the wrong person close a delivery. |
| Session tokens | Bearer credentials for a signed-in account. |
| Partner identity and location data | Names, organisations, addresses and phone numbers of people who handle food. |
| Private verification documents | Registration or licence documents uploaded during onboarding. |
| Custody events, receipts, audit log | Evidence. If these can be edited, the accountability story collapses. |
| Password and reset tokens | Account takeover. |

## Actors

Generator staff, Receiver staff, Helpers, operations administrators, safety officers, support
agents, security administrators, anonymous visitors, and a hostile party with a browser.

## Threats and the controls that address them

| # | Threat | Control | Where |
|---|---|---|---|
| 1 | Credential stuffing on login | Database-backed rate limit (8/minute per key), generic error messages, 12-character minimum with category rules | `src/lib/auth.ts`, `src/domain/validation.ts` |
| 2 | Session theft | HTTP-only, SameSite=Lax, Secure in production cookies; no cookie cache, so revocation is immediate; session list and revocation screen | `src/lib/auth.ts`, `/app/profile` |
| 3 | Privilege escalation by request body | Roles and statuses are never read from a request. `registrationSchema.strict()` rejects privileged fields; identity is loaded from the database per request | `src/lib/identity.ts` |
| 4 | Tenant data leak across organisations | 70 RLS policies + `withUserContext`; every domain function re-checks organisation access with `canAccessOrganization` | `drizzle/*.sql`, `src/domain/service.ts` |
| 5 | Direct object reference on a delivery or listing | `app_can_view_donation()`, `app_can_view_delivery_job()` policies; 404 rather than 403 where existence itself is sensitive | migrations |
| 6 | Helper obtaining the delivery code | The code is never in any Helper-visible response, notification, URL, log or audit detail; only `/api/jobs/[id]/code` returns it, and only to the Receiver of that active delivery | `src/domain/service.ts`, `/api/jobs/[id]/code` |
| 7 | Code brute force | 6-digit CSPRNG value, hashed with a keyed hash, 5 attempts then lock, per-delivery scoping, constant-time comparison | `src/security/crypto.ts`, `app_consume_delivery_code` |
| 8 | Duplicate receipt or double assignment | Unique constraints on `delivery_receipts.donation_id` and `delivery_job_id`; the claim is one conditional UPDATE with a status guard | migrations, `/api/jobs/[id]/claim` |
| 9 | Editing history | Append-only triggers on `audit_events` and `custody_events`; no DELETE policy or grant on `recall_records` | migrations |
| 10 | CSRF | Same-origin assertion on every mutation plus SameSite cookies | `src/lib/http.ts` |
| 11 | XSS | React escaping; no `dangerouslySetInnerHTML` in application code; enforcing nonce-based CSP on every server-rendered page (pre-rendered public pages use a documented relaxed policy) | `src/proxy.ts` |
| 12 | Upload abuse | Size and MIME checks, private storage outside the web root, authorised download handler, scan mode flag | `/api/documents/[id]`, `/api/organizations/[id]/documents` |
| 13 | Enumeration | Uniform 404s, rate limits on sensitive endpoints, no email-existence disclosure on login or reset | `src/lib/http.ts` |
| 14 | Notification flooding | Outbox with bounded retries and dead-letter visibility; worker heartbeat shows a stalled drainer | `src/worker` |
| 15 | Queue poisoning / replay | Graphile Worker job table plus idempotent handlers; `/api/worker/drain` requires GitHub OIDC | `src/worker`, `/api/worker/drain` |
| 16 | Credential exposure in logs | Tokens and codes are never logged; `/api/auth/*` is excluded from request logging because verification URLs carry one-time credentials | `next.config.ts` |
| 17 | Secret leakage in the browser bundle | No secret is referenced outside server-only modules; `server-only` guards domain and db modules | `src/domain`, `src/db` |
| 18 | Notification fan-out used to spam or address arbitrary users | `app_notify_area_helpers` selects recipients itself (active, approved, same service area, capped) and checks the caller is a party to the donation or platform staff; no user list crosses the wire | `drizzle/20261115090000_*.sql` |
| 19 | Escalation sweep driven by an ordinary user | A signed-in caller must hold `operations_admin` or `safety_officer`; a background caller is authorised only by the EXECUTE grant on the worker role; each job is reported once | same migration, `src/worker/escalation.ts` |
| 20 | Releasing a delivery to hijack or delay it | Only `operations_admin`/`safety_officer`; only before collection; reason required; custody event, audit record and notifications written | `releaseDeliveryAssignment`, `POST /api/jobs/[id]/release` |

## Residual risks (accepted, documented, not fixed)

1. **CSP is enforcing, with one documented exception.** Server-rendered documents get a fresh nonce
   and `'strict-dynamic'`; the eleven pre-rendered public pages cannot carry a per-request nonce and
   keep `'unsafe-inline'` for scripts. They hold no session, no mutating form and no personal data.
2. **RLS is forced.** Every policy-bearing table has `FORCE ROW LEVEL SECURITY`, so the owner is
   subject to its own policies too. The owner (`postgres`) holds `BYPASSRLS` on the hosted project,
   which is what lets migrations and SECURITY DEFINER functions continue to work.
3. **The second factor is required for platform roles only.** `requireIdentity` returns
   `403 TWO_FACTOR_ENROLMENT_REQUIRED` until an administrator, safety officer, support agent or
   security administrator has confirmed TOTP, and the enrolment flow offers backup codes. A partner
   account (Generator, Receiver, Helper) is protected by its password, the session controls and the
   audit trail, not by a second factor.
4. **Account erasure is impossible** while audit and custody events are append-only. Personal data
   requires an anonymisation path before real users exist.
4a. **Private document scanning has no scanner to talk to.** The client is real and fails closed:
   production refuses the upload unless a clamd endpoint answers. Until one exists, partners cannot
   upload evidence and no unscanned file is ever served.
5. **Capture SMTP.** The hosted deployment currently reports `test_sink`: messages are accepted and
   never delivered. Self-service reset therefore does not work; an operator can issue the same
   single-use reset link from the operations console and hand it over.
6. **No independent penetration test** and no formal threat-model review by an outside party.
7. **Backups are scripted but a restore has not been performed.** The verification half is now
   built and baselined (`ops/RESTORE_DRILL.md`); the restore itself needs a Pro-plan branch or one
   owner-run `pg_dump`/`pg_restore`.

## Security regression tests

- `tests/authorization.test.ts` — role and tenant boundaries.
- `tests/database-migrations.test.ts` — RLS on 25 tables, 12 required functions, app role cannot
  escalate its own account status, worker may write its heartbeat while the app role may only read
  it, no delete grant on recall records, PostgREST privileges revoked.
- `tests/security-headers.test.ts` — hardening headers, the enforcing nonce policy, the narrow
  pre-rendered exception and per-request nonce uniqueness.
- `tests/recall-and-account-security.test.ts` — strict input schemas reject smuggled ids and weak
  passwords.
- `scripts/test-auth-security.mjs`, `scripts/test-auth-roles.mjs` — hosted/CI authentication attacks.
- `scripts/hosted-smoke.mjs` — the deployed origin rejects a stranger `Origin`.
