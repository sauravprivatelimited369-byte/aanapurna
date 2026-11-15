# Trust and safety: direct answers

**Status: UNVERIFIED ENGINEERING EXPLANATION.** This document answers the questions a receiver,
partner or reviewer actually asks before trusting a food-redistribution platform. It describes what
this repository's code enforces today, what it cannot enforce, and who has to act. It is not a
food-safety plan, a legal opinion, an insurance position or a certification. No qualified
food-safety professional, lawyer or independent security reviewer has signed it.

Read the status column literally:

| Status | Meaning |
|---|---|
| **Enforced** | The server refuses the action if the condition is not met. A bug here is a security or safety defect. |
| **Recorded** | A human makes the decision and the system keeps an inspectable record of who decided, when and why. The record does not make the decision correct. |
| **People / legal** | Software cannot substitute for this. Missing today, and listed as a launch blocker. |
| **Not possible** | No honest version of this application can guarantee it. Anyone claiming otherwise is misleading you. |

Current position: **pre-pilot**. `OPERATIONS_ENABLED=false` means every donation action is refused
(`src/domain/service.ts`), the pilot policy `0.1.0-iim-calcutta` is still `draft`, and the hosted
deployment cannot yet deliver mail to a real inbox. Nothing below should be read as "this is running
in production".

---

## 1. How does a receiver know the food is clean? What about carcinogens or other contaminants?

**Short answer: nobody can know that from a web form, and this application never claims to.** What it
does is force the risk decisions into named human hands and leave evidence of what each hand did.

**Not possible:** "contains cancerous elements" is a laboratory finding. Carcinogens, pathogens,
pesticide residue, adulterants and spoilage cannot be detected by entering data into an application.
Only sampling and testing detect them, and this platform does no testing, sampling, inspection or
certification. `FOOD_SAFETY_CONTROLS.md` states the boundary in one sentence: the platform "cannot
make food safe", and any screen or marketing line implying otherwise is called a defect.

**What is actually enforced by the server, before the receiver is exposed at all:**

| Control | Behaviour | Evidence |
|---|---|---|
| No approved policy, no listing | A listing is refused with `423 NO_ACTIVE_POLICY` | `activePolicy()` in `src/domain/service.ts` |
| Only permitted food categories | Checked server-side against the policy version | `policy.rules.allowedCategories` |
| Only verified organisations trade | Unverified or suspended organisations cannot list, accept or be matched | organisation status checks in the domain service |
| Minimum lead time before pickup | A pickup window that is too soon is rejected | `minimumPickupLeadMinutes` |
| Minimum shelf life after pickup | Best-before that expires too soon is rejected | `minimumExpiryAfterPickupMinutes` |
| Already-expired food | Refused at creation and refused again at acceptance | domain validation |
| Allergen disclosure | Required when the policy requires it | `requireAllergenDisclosure` |
| A hold stops movement | An incident with a hold blocks matching, claiming and distribution | hold checks before claim/verify |
| A recall stops a batch | Recall record, status `recalled`, receipts listed, parties notified | `recall_records`, `INCIDENT_RESPONSE.md` |

**The strongest control is procedural, not algorithmic.** The delivery verification code exists in
the database and is shown **only to the receiver**, and **only after the food has physically arrived
and the receiver has recorded their arrival inspection** — see `CODE_NOT_READY` in
`src/domain/service.ts`. The helper can never retrieve it (`/api/jobs/[id]/code` is receiver-only,
hashed at rest, five attempts then lock). That encodes one rule in code: *do not release the goods
until you have looked at them.* A receiver who inspects and is unhappy records an exception; the
delivery is not marked successful and the food does not enter distribution.

**What "clean" therefore means here:** an organisation whose entitlement a human reviewed, declared
this food under a policy a human approved, kept it inside declared time and temperature limits, and a
second organisation physically inspected it before accepting custody — with a written trail for every
step.

**Still missing (people / legal):** a named qualified food-safety professional to sign
`FOOD_SAFETY_CONTROLS.md` and the policy rules; area-specific temperature and handling limits;
partner evidence checks and re-validation; helper training and acknowledgement; a documented
escalation plan; insurance and liability position; laboratory or inspection arrangements if that
professional requires them.

---

## 2. Most people are too busy to help. How do we get more helpers, and what if the one who accepted is not available?

**Short answer: software cannot create volunteers, and this is the weakest link in the whole design.
The system handles the *no-show* case; it does not solve the *not enough people* case.**

**Enforced today:**

- Any approved, active helper in the same service area can claim an open job. It is not pre-assigned
  to one person, so several people can compete for the same job.
- A claim is a **conditional update with a 30-minute hold**. A second helper is told it is taken
  rather than silently double-booked (`DELIVERY_CLAIMED`).
- A claim **expires after 30 minutes**. The job then becomes claimable again, so one distracted
  volunteer does not strand a pickup permanently.
- Before collection a helper can release a job. After collection, only an audited operations
  exception can reassign it.
- A delivery is never marked successful because a helper stopped responding. The code stays unused,
  the job stays open to an exception, and `INCIDENT_RESPONSE.md` defines that path.
- Active helpers are refused if their approval lapses mid-delivery (`HELPER_NOT_APPROVED`).

**Fixed in code (migration 14):** the three parts of this that software can carry now exist.

1. **Dispatch fan-out.** When an accepted offer creates a claimable job, every approved, active
   Helper in that service area is notified (`app_notify_area_helpers`). The recipient list is chosen
   inside a `SECURITY DEFINER` function with its own caller check — a client cannot address arbitrary
   users, and suspended Helpers are excluded.
2. **Unclaimed-job escalation.** A sweep (`app_escalate_delivery_backlog`) tells operations and
   safety staff once about any job that has sat unclaimed past a threshold (default 30 minutes) or
   whose claim has expired. Each job is reported once, tracked by `delivery_jobs.escalated_at`.
3. **Operations release.** An uncollected assignment can be returned to the open pool with a
   recorded reason (`POST /api/jobs/[id]/release`, operations or safety roles only). Before this,
   the state machine forbade `assigned -> open` and a Helper who vanished left the food with no path
   except a hold. The release writes a custody event, an audit record, notifies the parties and the
   previous Helper, and re-broadcasts to the area.

The sweep runs from the Graphile Worker crontab (`*/5 * * * *`) and, on this hosted deployment where
no long-lived worker exists, from the same scheduled `/api/worker/drain` invocation that drains the
mail outbox. Thresholds are configurable with `ESCALATION_THRESHOLD_MINUTES` and
`ESCALATION_DOCUMENT_HORIZON_DAYS`.

**Still true, and not fixable in code:** every handover needs a Helper to claim the job; there is no
"receiver collects it themselves" path. Software can notify, escalate and reassign — it cannot create
volunteers. A standby rota, a named coordinator per area and published pickup windows are people
decisions, not features.

**What would actually produce more helpers:** a named coordinator per area; a published pickup window
people can plan around; short, local, low-friction jobs; a standby rota with named backups;
reciprocal obligation between generators and receivers; recognition that does not pretend to be
payment.

---

## 3. The app depends on a third person. Some days they help, some days they do not. Who moves the food, and what if the distance is vast?

**Short answer: the pilot is deliberately limited to one small area. Distance is now measured and a
route beyond the area's limit is refused, and a receiving organisation can collect the food itself.
What still does not exist is live routing around traffic.**

**Enforced today:** a helper cannot claim a delivery outside their own approved service area —
`SERVICE_AREA_MISMATCH` in `src/domain/service.ts`. Organisations outside every active service area
cannot be matched. Policy and pickup windows bound how long food may sit. Service areas are database
rows, not hardcoded cities, so a second area is a data change plus an approved policy.

**Measured since migration 16:** straight-line distance between the two organisations, converted to
road distance with a stated 1.25 factor, divided by the area's configured average speed, plus a
ten-minute handover allowance. The result is stored on the delivery and shown as "about N km, about N
minutes" — never as a guaranteed arrival time. When the service area has a `max_transit_km`, a claim
beyond it is refused with `DELIVERY_OUTSIDE_TRANSIT_LIMIT`.

**Where the coordinates come from:** exact `latitude`/`longitude` if an organisation supplies them
during onboarding (optional, and both or neither), otherwise the city it entered is matched against a
checked-in gazetteer of 43 Indian places. If neither yields a point, the delivery says "distance
unknown" and nothing is refused — the application does not invent a number to fill the gap.

**Receiver self-collection (migration 16):** a receiving organisation can collect the food itself
instead of waiting for a Helper (`POST /api/jobs/[id]/self-collect`). The receiving operator becomes
the assigned collector, the same collection code, custody events and receipt apply, and the job is
refused under the same transit limit.

**Still not implemented:** live traffic-aware routing, turn-by-turn directions, and paid maps
(`PRODUCT_REQUIREMENTS.md`). The estimate is a planning aid, not a promise of arrival time.

**What now catches the symptom rather than the cause:** a job nobody claims is escalated to
operations within the threshold window (migration 14), so a delivery that stalls because the distance
or the timing was unrealistic is visible while the food is still inside its pickup window, instead of
being discovered after it expires. That is a backstop, not a routing engine.

**The honest rule before expanding:** if a route cannot be completed well inside the declared
shelf-life and pickup window by a named person with a known vehicle, do not list that food in that
area. The application will not catch that mistake for you. Before any multi-neighbourhood expansion,
the work is: zone-level service areas, a maximum travel time per policy, and a transport capacity
field on the helper profile.

---

## 4. What if someone tries to take over the application and use it for malicious intent?

**Short answer: a deliberate, layered set of controls exists and is tested; the honest residual risk
is that the second factor is enforced for platform roles only, that pre-rendered public pages need a
weaker script policy than the rest of the site, and that there is still no independent penetration
test.**

**Enforced today** (full table in `SECURITY_THREAT_MODEL.md`):

| Attack | Control |
|---|---|
| Smuggling a role or status in a request body | Roles and statuses are never read from input; `registrationSchema.strict()` rejects privileged fields; identity is loaded from the database per request (`src/lib/identity.ts`) |
| Credential stuffing | Database-backed rate limit, 8 sign-in attempts/minute per key, generic error messages, 12-character minimum (`src/lib/auth.ts`) |
| Session theft | HTTP-only, SameSite=Lax, Secure in production, no cookie cache so revocation is immediate, session list and revocation screen |
| One organisation reading another's data | 70 row-level-security policies plus `withUserContext`, and every domain function re-checks organisation access |
| Guessing record identifiers | `app_can_view_donation()` / `app_can_view_delivery_job()` policies; 404 instead of 403 where existence itself is sensitive |
| A helper stealing the delivery code | The code appears in no helper-visible response, notification, URL, log or audit detail |
| Brute-forcing the code | 6-digit CSPRNG, keyed hash at rest, 5 attempts then lock, constant-time comparison, audited operations reset |
| Double receipt or double assignment | Unique constraints plus a single conditional claim update |
| Erasing history | Append-only triggers on `audit_events` and `custody_events`; no delete grant on `recall_records` |
| CSRF | Same-origin assertion on every mutation plus SameSite cookies (`src/lib/http.ts`) |
| Malicious uploads | Size and MIME checks, private storage outside the web root, authorised download handler, scan-mode flag |
| Email enumeration | Uniform responses on login and reset; no "this email exists" disclosure |
| Supabase's own public API roles | Migration 12 revokes every privilege from `anon` and `authenticated` and resets defaults, so a future table cannot inherit them — this closed a real bypass found during hosted deployment |
| A stranger origin | Hosted smoke test asserts the deployed origin rejects a foreign `Origin` |

**Residual risks, accepted and written down rather than hidden:** the second factor is required
before application APIs serve a platform-role account, but ordinary Generator, Receiver and Helper
accounts are not forced into it; the Content-Security-Policy is enforcing with a per-request nonce on
every server-rendered page, while the pre-rendered public pages cannot carry a nonce and keep
`'unsafe-inline'` for scripts; RLS is not `FORCE`'d, so a careless future `GRANT` is the scenario it
would catch; no independent penetration test and no outside threat-model review; account erasure is
impossible while audit rows are append-only.

**Also true, and outside this repository:** the hosted deployment runs on Vercel and Supabase. A
compromise of the *owner's* Vercel or Supabase account is a compromise of the application, and no
code here prevents that. Enable MFA on both, restrict project access, and rotate keys.

**What a hostile insider could still do:** an `operations_admin` can reassign deliveries, release
holds and reset codes. Every one of those writes an audit event with an actor and a reason, but the
system detects those actions by review, not in real time. There is no automated anomaly alerting
today.

---

## 5. If food turns out to be harmful, who is responsible for the harm?

**Short answer: an application cannot take responsibility, and this project does not currently have
a legal entity, an insurance policy or a signed partner agreement that assigns it. That is a launch
blocker, not a detail.**

**What this system gives the people who are responsible:** the ability to show, afterwards, who
declared what, who inspected what, who handled the food in between, and who decided to release it.
`OPERATING_MODEL.md` assigns accountability explicitly:

| Role | Accountable for |
|---|---|
| Generator | The condition of the food until handover; the truth of the declaration |
| Helper | Handling in transit; recording what they observed |
| Receiver | The arrival inspection; keeping the code until they have looked |
| Operations administrator | Consistent, documented decisions and dispatch exceptions |
| Safety officer | Policy content, holds, recalls, incident closure |

Custody events, incident records with severity and hold, recall records with reason and author, and
receipts are append-only. The application role cannot edit or delete them; corrections are new
events.

**What is missing, and cannot be invented in code:**

- A legal entity that would actually answer a claim.
- An insurance and liability position for redistribution.
- A written partner agreement stating who is responsible for which stage, and what happens on harm.
- Legal review of whether the operator carries duties under FSSAI surplus-food rules and the DPDP
  Act. `LEGAL_RESEARCH_REGISTER.md` is explicitly **unverified** and `LAUNCH_CHECKLIST.md` requires
  counsel to confirm it.
- A named person who answers the phone at 21:00 on a Saturday.

**The honest position to publish:** the platform records and coordinates; the organisations handling
the food remain responsible for it; the platform does not certify, inspect or insure. Any marketing
copy that implies otherwise must be removed. See `INCIDENT_RESPONSE.md` for what happens in the first
five minutes — including the rule that a notice in an application is a courtesy and **a phone call is
the control**.

---

## 6. How is the database managed? Is there a firewall? Who handles the data if something goes wrong?

**Database:** PostgreSQL is the source of truth. Schema and thirteen migrations are versioned in
`src/db/schema.ts` and `drizzle/`; GitHub stores definitions, never the running data. The hosted
instance is Supabase PostgreSQL in `ap-south-1`, reached with TLS and a pinned Supabase root CA
(`certs/supabase-prod-ca-2021.crt`, verified in `HOSTED_DEPLOYMENT.md`).

**Access control, which is the part that actually protects records:**

- Three separate non-superuser, non-`BYPASSRLS` logins — `annapurna_app`, `annapurna_auth`,
  `annapurna_worker`. The migration role is privileged and is not used by the web app.
- 70 row-level-security policies; `withUserContext` sets `app.user_id` transaction-locally so pooled
  connections cannot leak identity.
- Supabase's `anon` and `authenticated` PostgREST roles were stripped of every privilege on every
  application object (migration 12), because they had full DML on all 30 tables — including
  `session` and `account`. That was a genuine authentication bypass, found and closed. It is now
  enforced by `npm run db:check` and by the migration test suite.
- Delivery codes are stored hashed with a keyed hash; private documents live outside the database in
  private storage, behind an authorised download handler.
- Append-only audit and custody records.

**Firewall — an honest answer.** There is no application-level WAF, no IP allowlist and no
network-policy configuration in this repository. Network exposure is governed by the hosting
providers: Vercel terminates public HTTPS, and Supabase controls database network reachability. The
database is not publicly queryable by a browser — the browser never talks to PostgreSQL, only to the
Next.js server. Application-side, the perimeter is authentication, rate limiting, same-origin
enforcement and RLS, hardened by security headers (`next.config.ts`) and a Caddy equivalent for
self-hosting (`infra/caddy/Caddyfile`). **Claiming "we have a firewall" would be an overstatement;
claiming "only one service can reach the database, with restricted roles and row-level policies" is
accurate.** Before launch, the owner should set Supabase network restrictions (allow only the
application egress), enable provider-level protections, and record it — it is a console setting, not
code.

**Who processes data if something goes wrong:** `INCIDENT_RESPONSE.md` names the owner and the
operations administrator on duty as the single voice, with containment, scoping, evidence
preservation and notification steps. `PRIVACY_DATA_MAP.md` records what is held and why. Two honest
gaps: **there is no named data-protection owner or staffed on-call today**, and **backups are
scripted but a real restore has not been exercised for the hosted instance**. Backup and restore is a
launch gate, not a feature.

---

## 7. What if someone forgets their password? Who helps, and how long does it take?

**Short answer: reset is fully self-service and should take under a minute — but on the current hosted
deployment it does not work, because email is a capture sink that accepts messages and delivers
nothing. The interface says so instead of pretending.**

**What works in code** (`src/lib/auth.ts`, `src/components/auth-form.tsx`,
`src/app/forgot-password/page.tsx`):

- A reset request returns the same confirmation whether or not the address is registered, so the flow
  cannot be used to discover who has an account.
- Requests are rate limited; the reset link is single-use and time-limited; completing a reset
  **revokes all existing sessions** (`revokeSessionsOnPasswordReset: true`), so a stolen session dies
  with the old password.
- Messages go through an encrypted outbox with bounded retries and dead-letter visibility, not fired
  inline during the request.
- If email is not configured, the page and the success message both state that no email was actually
  sent — the false reassurance is deliberately removed.
- `/api/health` reports `email.status` as `not_configured`, `test_sink` or `configured`, so the
  operator can see the truth without guessing.

**What is broken today:** the hosted deployment reports `email.status: "test_sink"`. A message is
accepted and never delivered to a person. So on the live site, a user who forgets their password
receives nothing. This is recorded as residual risk 5 in `SECURITY_THREAT_MODEL.md` and as an open
gate in `LAUNCH_CHECKLIST.md`.

**"How much time will it take?"** — Once a real transactional SMTP provider is configured: the link
arrives in seconds to minutes, and the user is back in under a minute. **Today: it does not
complete at all.** And there is **no human support team with a published response time**. Support
cases can be filed in-app (`/api/support`), but no one is contractually on the other end. A promised
"our team will help within X hours" would be a lie until a named person owns it. That is a decision
for the owner, not an engineering default.

---

## 8. The code was written by AI with tools. What guarantees that the APIs it uses are not accessed by others?

**Short answer: no guarantee is possible, and the premise mostly does not apply here — there are
almost no third-party APIs with keys. The real exposure is the database and hosting credentials, and
those never reach the browser.**

**What is actually true in this repository:**

- **No secret is shipped to the browser.** A search for `NEXT_PUBLIC_` environment variables returns
  nothing. Domain, database, auth, crypto, email and storage modules import `server-only`, so
  importing them into a client component fails the build rather than leaking.
- **There is exactly one external API integration, and it needs no credential.**
  `src/integrations/indiarestros.ts` fetches one fixed public restaurant record with an `Accept`
  header and sends no key and no user data. Returned URLs are validated against allowed hosts.
- **Database credentials are server-side only**, use least-privilege roles, and the browser never
  speaks to PostgreSQL.
- **TLS is pinned for the hosted database** using Supabase's public root CA with
  `rejectUnauthorized: true`, so a machine-in-the-middle with a random certificate is rejected.
- **Logging excludes credential-bearing routes** (`/api/auth/*`), and tokens and delivery codes are
  never logged.
- **Dependencies are pinned** by `package-lock.json` and audited in CI.

**What is genuinely unproven:** there has been no independent code review, no secret-scanning proof
beyond repository hygiene, no penetration test, and no formal audit of AI-generated logic. The
mitigation is not a claim of correctness — it is that the behaviour is pinned by tests (RLS on 24
tables, 10 required functions, role boundaries, strict input schemas, security headers, hosted
origin rejection), the dangerous paths fail closed, and every privileged action leaves an audit
event. AI-written code is not inherently less safe than human-written code, but it is only as safe
as the review it received, and this one has not had an external review yet.

**The exposure that actually matters:** whoever holds the Vercel and Supabase accounts, the SMTP
credentials, or the `AUTH_SECRET` and the three encryption/HMAC keys can read or alter everything,
regardless of who wrote the code. Those accounts need MFA, least privilege, and rotation. Do not put
those values in GitHub, chat, or a committed `.env`.

---

## Gap register

Everything below is a real, open gap. None of it is solved by adding copy to the website.

| # | Gap | Status | Impact | Kind | Owner |
|---|---|---|---|---|---|
| G1 | Hosted email is a capture sink; reset and verification mail reaches nobody | **Partially fixed** — an authorised operator can now issue the same single-use reset link from the operations screen (audited, 2FA-gated) and hand it over; verification mail still reaches nobody | Self-service reset is gone, but a locked-out person is no longer stranded | Config + code | Owner: SMTP provider credential for the email half |
| G2a | No notification when a delivery job opens | **Fixed (migration 14)** — area Helpers are notified inside a checked database function | — | Code | — |
| G2b | No unclaimed-job escalation | **Fixed (migration 14)** — sweep notifies operations once per stale job or lapsed claim | — | Code + schedule | — |
| G2c | An unresponsive Helper blocked the delivery; `assigned -> open` was forbidden | **Fixed (migration 14)** — audited operations release, pre-collection only | — | Code | — |
| G2d | No standby rota, named coordinator or published pickup window | **Open** | Dispatch still depends on people being reachable | People | Operations |
| G3 | No distance, travel time or ETA; only service-area equality. No receiver self-collection path | **Fixed (migration 16)** — distance and ETA recorded per delivery from coordinates or a checked-in gazetteer, claims refused beyond the area's `max_transit_km`, receiving organisations can collect their own food | No traffic-aware routing; the estimate is a planning aid | Code | — |
| G4a | No second factor | **Fixed (migration 15)** — TOTP enrolment with 10 backup codes, required for platform roles before application APIs serve them | — | Code | — |
| G4b | CSP report-only | **Fixed** — enforcing nonce-based policy from `src/proxy.ts`; pre-rendered public pages use a documented relaxed policy | — | Code | — |
| G4c | RLS not `FORCE`'d | **Fixed (migration 16)** — `FORCE ROW LEVEL SECURITY` on all 26 policies-bearing tables; the owner holds `BYPASSRLS`, so migrations and definer functions still work | — | Code | — |
| G4d | No independent penetration test | **Open** — cannot be self-administered | Unknown vulnerabilities remain unknown | External review | Owner |
| G5 | No legal entity, insurance, liability position or signed partner agreement | **Open** | Nobody is contractually answerable for harm | Legal | Owner |
| G6 | No named data-protection owner; no staffed on-call; breach-reporting process unexercised | **Machine half ready, people half open** — `scripts/incident-readiness.mjs` checks every code path an incident needs (session revocation, append-only audit, second factor, recovery, data-request intake), and `ops/INCIDENT_READINESS.md` holds the 45-minute drill script | Nobody is on call, and no drill has been run with a clock | People | Owner: a named contact and a rota, then run the drill once |
| G7 | Backups scripted but hosted restore unproven | **Partially fixed** — restore is now verifiable: baseline manifest, manifest query and comparator (`ops/RESTORE_DRILL.md`). Supabase branching refused on the current plan; the restore itself needs one owner action | Recovery time still unknown | Ops | Owner: Pro plan branch, or run `pg_dump`/`pg_restore` once |
| G8 | No human account-recovery path or published response time | **Recovery path fixed; response window now configurable** — operator-issued single-use reset link (role-gated, second factor, reason audited), and the support page publishes a window only when `SUPPORT_RESPONSE_HOURS` is set by an operator who has staffed it. Unset, it states plainly that nothing is promised | The window is not set on the hosted deployment | Config + people | Owner: set `SUPPORT_RESPONSE_HOURS` when a rota exists |
| G9a | Partner evidence expiring while the organisation stays verified | **Partially fixed (migration 14)** — operations are now reminded 14 days ahead, once per document | Re-validation decision is still manual | Code + ops | Operations |
| G9b | File scanning not configured | **Code complete, blocked on a scanner endpoint** — `storePrivateDocument` speaks ClamAV `INSTREAM` over TCP, verifies magic bytes, and refuses every upload in production unless `FILE_SCAN_MODE=clamav` with a reachable `CLAMAV_HOST`/`CLAMAV_PORT` | Uploads stay blocked (fail-closed), so nothing unscanned is ever served | Infra | Owner: a clamd endpoint reachable from the web tier, or a managed scanning service |
| G10 | Food-safety policy is `draft`; no qualified professional has signed it or the area rules | **Open** | No real food may move | Professional review | Owner |

"Fixed" here means the code, migration and tests exist and the migration is applied to the hosted
database. It does not mean the hosted deployment has been exercised end to end with real accounts —
`OPERATIONS_ENABLED` is still `false`.

---

## What must never be claimed

- "The food is safe." It is declared by a person, inspected by a person, and recorded by this
  system. Nothing more.
- "Partners are certified." A human reviewed evidence. That is not a licence, a certificate or an
  inspection.
- "We have a firewall and encryption, so the data is protected." Row-level policies and restricted
  roles are real; a provider-level network control has not been configured or evidenced.
- "Our team will help you within X hours." No such commitment exists until a named person owns it.
- "Impact verified" from anything other than verified receipts — sample and demo records are
  labelled and excluded from totals.

When any of these becomes true, it should be backed by a date, a name and a link to the evidence —
not by a sentence on a landing page.

---

## Related documents

`FOOD_SAFETY_CONTROLS.md` (draft), `SECURITY_THREAT_MODEL.md`, `OPERATING_MODEL.md`,
`INCIDENT_RESPONSE.md`, `PARTNER_ONBOARDING.md`, `DATABASE.md`, `PRIVACY_DATA_MAP.md`,
`LEGAL_RESEARCH_REGISTER.md` (unverified), `LAUNCH_CHECKLIST.md`, `HOSTED_DEPLOYMENT.md`.
