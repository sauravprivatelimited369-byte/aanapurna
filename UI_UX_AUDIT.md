# Annapurna Link UI/UX audit

- **Audit date:** 2026-11-12
- **Branch:** `arena/d3d3055c-aanapurna` (active)
- **Scope:** Existing Next.js App Router/React/TypeScript application, routes, component and CSS architecture, Better Auth integration, app API surface, Drizzle/PostgreSQL/RLS domain services, responsive rules, and available test setup. This is an interface audit, not a production-readiness or policy approval.

**Reading note:** The route matrix below records the initial findings before the current redesign. See the dated implementation follow-up and verification report for what has since changed and what remains open.

## Architecture and backend inventory

- Next.js 16 App Router and React 19; TypeScript; one global stylesheet (`src/app/globals.css`) with hand-written CSS and a Tailwind import. No component or chart library is in use. `lucide-react` is already installed but the UI mostly uses Unicode glyphs as icons.
- Better Auth handles email/password signup, sign-in, verification, reset, sessions, and DB rate limits. `auth-form.tsx` is the shared UI. Account and partner requests remain pending until existing human review logic changes their status.
- PostgreSQL/Drizzle services enforce tenant context and RLS. The existing API covers dashboard, onboarding, donation/listing, offer response, delivery claim/pickup/code/verification/incident, notifications, private evidence, support/privacy requests, admin review/policy/area management, health, authentication, and the public restaurant directory. Mutations use origin checks, validation and rate limits where applicable.
- The dashboard service already returns role-scoped real counts/lists. A public impact-statistics API now reports only backend-derived verified receipt/organization/Helper counts. The isolated real database returned its honest empty state; a separate PGlite migration test verifies positive aggregation using clearly synthetic rows. No time-series/chart API exists. Receipts store quantities with different units, so a generic “meals” total cannot be inferred honestly. Listing photo upload, draft-save, distance/routing, and several requested enterprise admin screens are not backed by existing APIs.
- The public directory is a sourced listing with live lookup and a dated fallback. It is correctly not an Annapurna Link partner or food offer.

## Implementation follow-up — 2026-11-12

- The public homepage now has role-specific entry points, a keyboard-operable responsive navigation, explicit verified-impact loading/empty/unavailable/retry states, a complete footer, and an Accessibility page. The Halla Bowl directory listing remains clearly separate from partners and offers.
- Auth screens now include requested-role preselection without role grant, password visibility/reveal controls, password requirements and confirmation, and a safely gated session-expired message. An isolated local signup → email verification → login → pending Helper request flow passes; the external SMTP, password-reset delivery and logout flows are still unverified.
- The shared workspace navigation now follows active memberships/helper status and exposes restricted operations to every assigned platform role, while excluding non-platform accounts. Mobile navigation keeps role-relevant primary routes available.
- Workspace overview framing and metrics are scoped to current roles and existing backend responses. Operations, support/privacy and onboarding flows now distinguish recoverable errors from empty/success states and offer appropriate retry feedback.
- The design layer includes licensed self-hosted Manrope and Playfair Display fonts, responsive styles, visible focus treatment, semantic icon labels and reduced-motion handling.
- Automated verification covers the public homepage, real-database empty impact, PGlite synthetic aggregate fixtures, local non-platform auth/onboarding with permission denial, and active/pending role-navigation policy. Axe checks and overflow checks cover 14 public/auth routes at 320px and 1440px; the homepage covers five widths. Manual accessibility and protected-workspace review are still outstanding. See [`UI_UX_TEST_REPORT.md`](UI_UX_TEST_REPORT.md) for exact scope.

### Remaining audit gaps

- Active authorized Generator, Receiver, approved Helper and platform-staff journeys still need realistic tests with isolated role fixtures. The local auth test covers a pending Helper request and verifies ordinary-user denial; real operations remain disabled.
- The backend impact endpoint has been exercised against a real local database and returned the correct empty response with all five metrics at zero. A PGlite migration fixture verifies positive aggregate results and unit filtering; no non-empty real-PostgreSQL or public production metric is claimed.
- Listing photo/draft support, charts/time-series, distance/routing, general user search and an audit-log browser remain unsupported by existing backends; no fake UI should imply those capabilities exist.
- Manual screen-reader/keyboard review, protected-route responsive review, production services and human policy/legal/privacy/security approvals remain outstanding.

## Initial route-by-route findings

| Route / surface | Current condition | Usability, visual, state, mobile and accessibility findings |
| --- | --- | --- |
| `/` | Custom dark landing page, original SVG food illustration, three process cards, trust statements, local discovery and join CTAs. | Strong brand starting point, but the requested “Donate / Helper / Receiver” actions collapse into one generic signup link. There is no real impact section, so users cannot distinguish verified results from illustrative claims. Public nav is incomplete and disappears on mobile without a replacement. High visual whitespace and headline size can crowd 320–390px screens. |
| `/how-it-works`, `/about`, `/food-safety` | Clear, cautious editorial content; draft/legal and safety limitations are stated. | Mostly long-form text with limited visual hierarchy, no contextual step links or mobile table of contents. Some supporting copy is very small/low contrast. Existing safety disclaimer is a product strength and must remain. |
| `/contact`, `/privacy`, `/terms` | Contact avoids inventing an address; privacy and terms are visibly marked draft. | Footer has no accessibility link or safety-disclaimer destination. Contact does not invent details, appropriately, but needs clearer alternatives for signed-in support and urgent/emergency limitations. These draft notices must not be visually softened into implied approval. |
| `/near-iim-calcutta` | Attributed IndiaRestros record, loading/retry/fallback and explicit no-affiliation language. | Preserve existing safeguards. Small metadata and compact text need more readable sizing; upstream and stale-data states should remain distinguishable and accessible. |
| `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password` | Real Better Auth calls, shared form, email-verification and generic-enough reset messaging, minimum password length. | No password visibility control or inline requirement summary; query-string role CTAs cannot preselect the role; form uses `noValidate` without complete client-side field validation; errors are mostly form-level and focus is not moved to them. Session-expiry has no explicit message. Mobile layout is single-column but labels/statuses are too small. No OAuth is configured and none should be invented. |
| `/app` | Real `getDashboard` data and pending/empty/error states; shows role-specific lists when the identity has those roles. | The same dashboard header and four KPI cards lead for every role; some roles see irrelevant zero metrics. The next task is not prominent. Admin/safety overview is only a small subset of the dashboard service. The backend’s actual counts are preferable to invented charts. |
| Generator: `/app/listings`, `/app/listings/new`, `/app/listings/[id]` | Real listing data, policy/date/food declarations, status/history and operations-gate stop. | Create form is a long, ungrouped scroll with no progress or review step. No image-upload or draft-save endpoint exists; do not add pretend controls. Submit success is set immediately before navigation, so it is not reliably seen. Empty and gated states are accurate but visually underdeveloped. |
| Receiver: `/app/offers`, `/app/offers/[id]` | Real scoped offers, detailed declarations, accept/decline API and operations gate. | Offer choices are inline, with no final confirmation for acceptance. Decline reason is always displayed even though only needed on decline. Expiry/status is low-emphasis. No fabricated acceptance or food rating is present. |
| Helper / delivery: `/app/deliveries`, `/app/deliveries/[id]` | Real delivery states/actions, collection notes, receiver-only code API, incident reporting, custody timeline and receipt. | Mobile navigation currently omits role links; the one-hand “next action” hierarchy and custody steps are weak. OTP is authorized server-side for the Receiver and hidden from the Helper; do not widen access. Attempt counts are shown only after an incorrect code, but no dedicated locked/expired state exists in the UI. |
| Notifications and support: `/app/notifications`, `/app/support` | Existing notification, support and data-request APIs; success/error/loading/empty UI in the client components. | Data rows and tiny action labels are hard to scan on small screens. Support requests use `Promise.all`, so one failed endpoint blocks both sections. Some error states can coexist with an empty state. No live contact details are configured. |
| Operations/admin: `/app/operations` | Existing permission-scoped dashboard for partner/helper review, policy/area management, incidents, support and privacy requests; real overview counts. | Long single-scroll panel; no section navigation or queue prioritisation, search, filters, or pagination. Unicode icons, small text and dense record controls reduce scanability. “User management”, audit-log browser, analytics/time series and other requested modules have no UI/API and must not be represented as working. Sensitive actions need better confirmation/feedback affordances without bypassing server authorization. |
| Shared shell/forms | One shared app shell, account identity, notifications, sign-out, form controls and status patterns. | Sidebar has no mobile replacement drawer. Mobile bottom nav selects only base links for non-admins, hiding Listings, Offers and Deliveries. Status icons are glyphs, some text is 8–10px, touch targets as small as 38px, and muted colors can fail WCAG contrast. Sign-out errors are only screen-reader text. Focus styling and `prefers-reduced-motion` support are good foundations. |

## Cross-cutting issues and strengths

### Priority issues

1. Replace the missing mobile public navigation and role-blind mobile app navigation; make every primary workspace route reachable at 320–430px.
2. Give the landing page role-specific CTAs and a truthful backend-fed impact area. Only count receipts/verified records; no fabricated meals or impact.
3. Create differentiated Generator, Receiver, Helper and operations dashboard framing using existing role-scoped service results; do not imply permissions or features the API does not grant.
4. Improve typography, contrast, touch sizes, semantic iconography, focus/error behavior, and long form/layout handling.
5. Reduce form friction and misleading feedback: role-prefill from CTA, password visibility, clear password rules, step/group affordances for listing, and visible confirmed errors/success.
6. Add an Accessibility page and meaningful, complete footer destinations without inventing organization contact details.
7. Separate failures from true empty states and provide retry where the existing data-loading flow can safely retry.

### Existing strengths to preserve

- Dark/saffron identity and a custom food illustration.
- Actual Better Auth flows, role/status gating, PostgreSQL/RLS services, API validation, real backend dashboard data, and verified-receipt semantics.
- Clear “not a food-safety certification”, controlled-launch, pending-human-review and no-partnership statements.
- Existing reduced-motion support, focus-visible outline, semantic labels on most form fields, and explicit loading/error/empty states.

## Non-negotiable product boundaries

- `OPERATIONS_ENABLED` remains false unless separately authorized. UI must not imply live donations are enabled.
- Do not invent contacts, partners, organizations, impact values, distance, food safety assessments, receipts, audit entries or admin capabilities.
- Keep the one-time delivery code accessible only through the existing Receiver-authorized endpoint and appropriate Receiver UI. Never put it in URLs, logs, analytics, Helper pages, or notifications.
- Draft privacy/terms/food-safety language stays clearly marked pending qualified review.
- Where a preferred feature has no secure backend (photos, drafts, charts/time-series, general admin user search), clearly document it as unavailable rather than fake it.
