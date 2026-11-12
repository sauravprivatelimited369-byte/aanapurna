# Annapurna Link UI/UX implementation plan

- **Created:** 2026-11-12
- **Branch:** `arena/d3d3055c-aanapurna` (active)
- **Basis:** `UI_UX_AUDIT.md`. The design work preserves the existing Next.js architecture, Better Auth, PostgreSQL/Drizzle/RLS services, and controlled-launch gates.

## Progress snapshot — 2026-11-12

The core UI transformation is **implemented and locally verified within the coverage below**. Remaining verification and external launch gates are explicit; passing tests are not launch or accessibility-conformance approval.

| Phase | Status | Implemented / remaining |
| --- | --- | --- |
| 1. Foundation | **Implemented; manual review remains** | Licensed self-hosted fonts, shared tokens/styles, semantic icon use, focus and reduced-motion foundations are in place. Full component-by-component accessibility review remains. |
| 2. Public site | **Implemented; real empty and synthetic aggregate checks pass** | Role-specific CTAs, responsive public navigation/footer, impact aggregate contract/API/UI, accessibility page and directory attribution are present. The isolated real database returns the backend-derived empty state; a separate PGlite fixture verifies positive aggregation and unit semantics. No non-empty real-PostgreSQL data is claimed. |
| 3. Authentication/onboarding | **Core local flow tested; partial coverage** | Requested-role preselection, password reveal/requirements/confirmation, session-expired messaging and onboarding pending/status/error/retry feedback are implemented. An isolated signup → email verification → login → pending Helper request flow passes, including denial of admin access. Password reset, logout and external mail remain untested. |
| 4. Role workspace | **Active/pending navigation and access boundary checked; protected tasks remain** | Role-scoped dashboard framing, all-role platform navigation, mobile primary routes, operations section anchors and clearer mutation/list refresh failures are implemented. Unit tests cover active Generator/Receiver/Helper links, pending-role exclusion and all platform roles; a real pending non-platform account is denied admin access. Active task pages and staff mutations remain untested. |
| 5. Accessibility/states | **Broader selected public-route checks pass** | Axe checks cover 14 public/auth routes at 320px and 1440px; the homepage also covers five widths. Targeted keyboard and reduced-motion checks pass. Screen-reader, full keyboard, protected-workspace visual and route-wide manual review remain. |
| 6. Regression/docs | **Local checks pass; controlled-launch gates remain** | 41 unit tests, 13 browser tests, real empty-impact and synthetic aggregate checks, local auth integration, typecheck, lint, dependency audits, database checks and production build pass. Active authorized role workflows, non-empty real-database metrics, Docker/Compose and deployment gates remain unverified. |

See [`UI_UX_TEST_REPORT.md`](UI_UX_TEST_REPORT.md) for exact scope, commands, current result and limitations.

## Phase 1 — Foundation and component language

- Retain the dark charcoal / warm saffron identity; refine contrast, readable type scale, spacing, border, focus, surface, and status tokens.
- Load the requested Playfair Display and Manrope styles from self-hosted, licensed assets if practical; avoid runtime third-party font requests.
- Use the already-installed Lucide icon set consistently with decorative icons hidden from assistive technology.
- Add shared page headings, status/alert variants, accessible links/buttons, skeleton/empty/error patterns, skip navigation, and responsive utility styles.
- Keep reduced-motion behavior and strengthen keyboard focus/target-size defaults.

## Phase 2 — Public site and trustworthy first impression

- Build a responsive desktop navigation and a keyboard-accessible native mobile menu with Home, How it works, Impact, Food safety, About, Contact, Login and Join actions.
- Give signup CTAs role-specific query parameters and preselect the requested role without approving that role.
- Rework the homepage around an editorial headline, original “donor → handover → receiver” illustration, clear three-role calls to action, process, trust/safety notes and a final CTA.
- Add a public, privacy-preserving aggregate impact endpoint backed only by verified delivery receipts, verified organizations and active Helpers. A servings total may include only receipt rows whose recorded unit is `servings`; do not convert other units into “meals”. Return an explicit empty state when no verified records exist.
- Add an Accessibility page; complete the footer with existing pages and draft disclaimers; do not invent email, phone, affiliations or legal approvals.

## Phase 3 — Authentication and account setup

- Preserve Better Auth and current verification/password-reset APIs.
- Improve heading/context, role selection, password requirements, reveal controls, labels, errors, status announcements and small-screen behavior.
- Keep signup short; explain that organisation/Helper access remains pending human review. Add a session-expired message only when a safe route parameter is present.
- Signup → email verification → sign-in → pending Helper onboarding now passes against isolated local PostgreSQL and the loopback test SMTP sink. Password-reset delivery and logout remain untested; the reusable opt-in procedure is documented in `README.md`.

## Phase 4 — Role-specific workspace and mobile operations

- Tailor dashboard title, summary metrics, primary action and data modules to Generator, Receiver, Helper and authorised staff using only the existing `getDashboard` response.
- Fix sidebar and bottom-navigation route visibility for each role; use a shared accessible mobile menu for secondary routes.
- Refine listing, offer, delivery and receipt details for scanability and responsive operation. Group the listing form into clear steps/sections while keeping a single secure submission until a draft API exists.
- Keep every mutation behind the existing APIs, status flags and permissions; improve confirmation and post-submit feedback without claiming unconfirmed success.
- Reorganize admin existing review queues into clearer sections/anchors and responsive records; do not create mock user management, analytics, audit-log search or other missing modules.

## Phase 5 — Cross-cutting states and accessibility

- Resolve cases where a failed request also looks like an empty state; add safe retry controls to applicable client data panels.
- Check all controls at 320, 360, 375, 390, 412, 430, 768, 1024, 1366 and 1440px where browser tooling permits.
- Manually review keyboard access, focus visibility, semantic hierarchy, form announcements, reduced motion and 44px touch targets.
- Run available automated accessibility checks; record untested items rather than claiming a WCAG conformance audit.

## Phase 6 — Regression and documentation

- Run unit tests, typecheck, lint, build, browser E2E and any safe integration checks available.
- Keep tests safe: operations are disabled in the local environment, so do not claim listing/acceptance/pickup/OTP/receipt workflows were tested unless executed against authorized seeded test records.
- Update `UI_UX_TEST_REPORT.md` with PASS / FAIL / NOT TESTED per journey and viewport.
- Update `DESIGN_SYSTEM.md` and README with exact implemented components/tokens and explicit deployment/policy blockers.

## Acceptance criteria

- No new fake record or operational success; public metrics are database-backed and label the exact units/receipt basis.
- Every new button/link either navigates to an existing route/API or is visibly disabled with a reason.
- Existing auth, RLS, anti-CSRF/origin checks (including the strict same-origin Fetch Metadata fallback for browsers that omit `Origin`), rate limits, launch gate, private document access, safety language and OTP permissions remain intact.
- Primary desktop and mobile navigation are keyboard-accessible and expose the role’s real routes.
- UI is responsive without horizontal page overflow at the tested widths and respects reduced-motion preferences.
- All requested design/test docs exist, with unavailable backend capabilities clearly called out.
