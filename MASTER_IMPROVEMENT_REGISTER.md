# Master improvement register

**Last updated:** 2026-11-15 UTC. This is an evidence-based work register, not a product roadmap promise. `DONE` means only the stated bounded work is done; overall launch remains **NOT APPROVED**. See [`PRODUCTION_READINESS_REPORT.md`](PRODUCTION_READINESS_REPORT.md).

| Priority | Work item | Status | Evidence / remaining gate |
|---|---|---|---|
| P0 | Live account verification and password recovery email | **BLOCKED** | Live health says `test_sink`. Owner must configure and verify a real transactional sender/domain and controlled inbox. No verification bypass is acceptable. |
| P1 | Periodic queue and escalation processing | **PARTIAL / NOT READY** | Existing Graphile Worker, inline post-response delivery and GitHub Actions drain are present. Live worker and scheduler heartbeats are `never_seen`; Actions runs were hours apart. This branch fixes a production-vs-preview target defect and tightens OIDC. Owner/operations must approve and fund a dependable worker/scheduler; verify heartbeat after deployment. |
| P1 | Delivery health and recovery | **PARTIAL** | Public `/api/health` exposes database, email, worker, delivery, push config and readiness. It returns database `ok` while other critical dependencies are blocked; currently does not provide alerting or a complete authorised operational view. |
| P1 | Staging / preview data isolation | **BLOCKED / PARTIAL MITIGATION** | Vercel's DB role variables include preview and development targets, and the Supabase project has only its `main` branch. A pre-guard PR preview build ran the migration command with role `postgres` and reported 28 applied migrations; a later read-only ledger query saw row id 29, with source/cause unverified. This branch gates migration/check steps to production builds only. Preview runtime access remains shared; owner must review the migration/deployment history and approve isolated staging before real-record testing. |
| P1 | Real push validation | **NOT TESTED** | Push keys are configured; no device/browser permission and real delivery was performed in this audit. Requires an authorized physical device and person. |
| P2 | Safety and operational gates | **PARTIAL / NOT APPROVED** | Launch gate is closed and readiness checks are visible. Entity, insurance, legal/privacy, food-safety approval, partners, approved Helpers, trained staff, on-call and scanner evidence remain owner/human gates. |
| P2 | Security assurance | **PARTIAL** | Existing auth, RLS and route tests remain; this branch narrows drain OIDC. No independent penetration test or production cross-tenant test was performed in this audit. |
| P2 | Recovery and retention | **NOT VERIFIED** | Source includes privacy and backup/retention controls, but no successful production restore drill was observed. |
| P3 | Multi-campus institutional workspace and reports | **NOT VERIFIED / GAP** | Existing role workspaces and operational records are present. The audit did not verify isolated multi-campus administration or institution-grade export/reporting. Do not treat listed quantities as verified food saved. |
| P4 | Institutional revenue proposition and pricing | **NOT VALIDATED** | README says no paid offering is approved. No buyer interviews, purchase evidence, competitor price research, reviewed unit economics, or approved plan/prices exist in this evidence set. |
| P5 | Billing | **NOT APPROVED / NOT IMPLEMENTED** | No payment provider merchant setup, sandbox flow, webhook validation or entitlements verified. Do not collect money until offer, account, contract and legal/tax setup are approved. |
| P6 | Institutional lead capture / sales pipeline / event QR assets | **NOT VERIFIED / GAP** | A public contact route is not an institutional enquiry CRM. No database-backed lead, consent, admin pipeline or print-ready event materials were verified. |
| P7 | Release preparation | **IN PROGRESS** | Focused worker/OIDC tests, TypeScript and lint pass locally. Full suite/build/browser, production verification, independent reviews, restore drill and approvals remain open. |

## Immediate owner-dependent blockers

1. Provide a real transactional email account/sender configuration through Vercel's secure settings; never send credentials through chat or GitHub.
2. Approve the operating entity, named accountable operator, food-safety professional, partner terms, liability/insurance position, response contacts and any pilot scope.
3. Authorize a controlled-inbox auth test and real push test on a physical device.
4. Approve any recurring paid hosting, managed worker/scheduler, security testing or commercial vendor before purchase.

No item above should be marked complete merely because a code path or checklist exists.
