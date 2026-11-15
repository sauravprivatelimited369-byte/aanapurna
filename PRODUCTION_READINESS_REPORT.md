# Production readiness report

**Audit date:** 2026-11-15 UTC  
**Reviewed source revision:** `976b19ccfc6dd27d7d004c8d0aefc961100e6525` (`main`)  
**Environment:** public Vercel app `https://annapurna-link.vercel.app`, Supabase project `annapurna-link-hosted` (`ap-south-1`)  
**Decision:** **NOT APPROVED for real food operations.** The existing launch gate remains closed (`OPERATIONS_ENABLED=false`). No direct Supabase query or agent operation changed production records/settings. However, after creating the PR, a Vercel preview build was observed running the repository's pre-existing migration build command against shared hosted database credentials; this is a production-adjacent schema operation and is disclosed below. The PR added no SQL migration, but this audit cannot prove the provider-side migration command made no schema changes.

## Evidence observed

| Area | Status | Evidence and limit |
|---|---|---|
| Public web app | **DONE — live read only** | Home page and `/api/health` returned content when fetched on 2026-11-15. The deployment connector reported the latest production deployment for `976b19c` as `READY`. No authenticated browser session was tested. |
| PostgreSQL | **PARTIAL — live availability observed; environment isolation blocked** | `/api/health` returned `database.status: ok`, latency 1,345 ms at that observation. Supabase reported database, Auth service and Storage `ACTIVE_HEALTHY`. Vercel has the database role variables scoped to production, preview and development, while Supabase reports only its `main` branch; no isolated staging DB was evidenced. This is not a restore test, data-integrity audit, or latency SLO. |
| Better Auth / verified accounts | **BLOCKED — email configuration** | Health reports `email.status: test_sink` and `captureTestSink: true`. A capture inbox is not a user's inbox; verification and recovery cannot be called production-usable on this evidence. No authorised controlled inbox or real production registration/login test was available. Email verification and privileged-account controls remain enabled in source; they were not bypassed. |
| Email transport | **BLOCKED — external configuration** | Live health has no missing setting names but explicitly classifies the transport as a test sink. No inbox delivery, bounce processing, or provider deliverability was verified. Owner must configure a real provider, verified sender/domain and DNS authentication, then authorize a test to a controlled inbox. |
| Background worker | **NOT READY** | Live `worker.status: never_seen`; no production worker heartbeat. Source contains Graphile Worker and bounded inline serverless delivery. These do not provide dependable periodic processing on their own. |
| Scheduled drain | **NOT READY** | Live `delivery.scheduledDrain.status: never_seen`. GitHub Actions history shows scheduled runs several hours apart, despite the nominal five-minute cron. Source inspection found the workflow target was the preview alias, not the canonical production URL. This branch corrects the target and tightens OIDC trust; it is not deployed yet. After merge/deployment, a production heartbeat and end-to-end drain must be observed. |
| Push | **PARTIAL — configuration only** | `push.configured: true` in public health. No live browser permission, real push-service delivery, expired subscription handling or device click path was tested in this audit. |
| Operations safety gate | **DONE — safely closed** | Health reports `realOperationsEnabled: false`. The production launch-readiness evaluation is incomplete. Do not enable operations as part of this change. |
| Launch approvals | **NOT APPROVED** | Live readiness lists unmet owner actions for accountable entity, insurance, data-protection contact, on-call coverage, independent penetration test, partner insurance/agreement, grievance window, real email and malware scanning. These require evidence or human approval, not code-only attestation. |
| Source control / CI | **DONE — automation only** | The PR's latest GitHub CI run completed green: verifier/build/browser suite, hosted-shape, native PostgreSQL + auth, disposable PostgreSQL browser workflow, Docker Compose and Windows jobs. Local branch: `npm ci`, TypeScript, ESLint, 484/484 Vitest tests, synthetic-env production build and npm audits passed. CI database/auth and browser tests use synthetic/disposable systems; they do not establish live account deliverability or production restore. |
| Billing / paid offer | **NOT APPROVED** | No customer-validated paid offering, approved pricing, merchant account or billing implementation was evidenced. No payments were accepted or tested. |
| Institutional enquiry pipeline | **NOT IMPLEMENTED / NOT VERIFIED** | Existing contact page provides account-holder support navigation and may publish a configured data-protection contact. It is not a public institutional lead CRM. No enquiry form, consent record or admin sales pipeline was verified. |

## Deployment side effect requiring owner review

After the PR preview was created, read-only inspection of its Vercel build log (deployment `dpl_6ygKsBYHCsPVBw4Vhr1Ye7xYdcww`, commit `3c1aadc`) showed it ran the then-configured command `npm run db:migrate && npm run db:check && npm run build`. The migration log identified the database role as `postgres`; the subsequent check reported 28 applied application migrations. This PR contains **no Drizzle SQL migration files**, but Vercel's environment variables were scoped to preview as well as production, and Supabase reported only a `main` branch. A later read-only query of the migration ledger showed a row with id 29; this audit cannot attribute that row to this build or another deployment, nor infer what DDL was executed. Do not manually roll back or edit migration history. The owner should review the database migration ledger and deployment history before the next production schema change.

**Mitigation in this PR:** Vercel now invokes `scripts/vercel-build.mjs`; it runs migrations and `db:check` only when `VERCEL_ENV=production`. Preview/development build behavior is unit-tested and was exercised locally with synthetic `example.test` credentials. This does not isolate preview runtime access. The PR's earlier preview deployment happened before this mitigation existed; subsequent preview deployments should use the new guard after the branch is updated and Vercel rebuilds it.

## Changes proposed in this branch

1. Point the GitHub worker-drain workflow at the canonical production URL (`https://annapurna-link.vercel.app`) rather than the preview deployment alias. This addresses the production-heartbeat mismatch found between the workflow target and the live health endpoint.
2. Restrict GitHub OIDC authorization to the expected repository, `main`, exact `worker-drain.yml`, and `schedule` / `workflow_dispatch` events. The old verifier trusted an obsolete branch and did not bind the token to the expected workflow/event.
3. Add a regression test for the drain target and strengthen OIDC verification tests.
4. Correct deployment documentation that still described the hosted database as having zero application tables and the scheduler as absent from `main`.
5. Gate Vercel migrations and `db:check` to `VERCEL_ENV=production`. Preview/development builds now run the app build only, reducing the risk of an automatic PR preview applying schema migrations to the shared production database. This does **not** isolate preview runtime database access; preview credentials and runtime separation still require owner-approved staging configuration.

These are source changes only until reviewed, merged, deployed and rechecked. Green unit tests do not prove production scheduling or email delivery.

## Required next verification, in order

1. Review and merge this change through the repository's checks; confirm the Vercel production deployment is `READY` and serves the merged revision.
2. Confirm the workflow run posts to the canonical URL and that `/api/health` then reports a recent `scheduledDrain` age. A green action without a production heartbeat is not success.
3. Owner configures a real transactional email provider and verified sender/domain in secure deployment settings; verify SPF, DKIM and DMARC as required by that provider. Redeploy, then send verification/reset messages only to an owner-controlled test inbox and record observed arrival separately from provider acceptance.
4. Arrange real browser push testing on an authorized Android/desktop device and, separately, iOS Home Screen install where applicable.
5. Before a pilot, obtain the named entity/operator, qualified food-safety review, legal/privacy review, partner consent and agreements, trained approved Helpers, incident/on-call coverage, insurance review, private-file malware scanning, and a witnessed backup restore. Keep operations disabled until the applicable gates are evidenced.

## Audit boundaries

- Read-only live health and public page inspection are not a full browser security assessment.
- Automated tests and dependency audit are not independent penetration testing or certification.
- Provider acceptance is not inbox delivery; push configuration is not device delivery.
- CI passed a disposable PostgreSQL backup/restore test. That does not prove a production backup is complete, retained or recoverable; no production restore was attempted.
- Public Joka directory records are not verified partner relationships.
- No real donation, person served, food-safety outcome, customer, sponsorship, revenue or partnership is claimed by this report.
