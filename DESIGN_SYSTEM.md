# Annapurna Link design system

- **Status:** UI implementation is verified within the documented scope; not a production brand/policy approval.
- **Direction:** Dark, calm and editorial; warm saffron as an action cue; clear records over decorative dashboard chrome.

## Current implementation status

- The public site uses role-specific entry points, a keyboard-operable mobile disclosure, skip navigation, a sourced/verified-impact section with loading, empty, unavailable and retry states, and an accessibility page. Auth screens include password reveal controls, stated requirements, requested-role preselection and a gated expired-session message.
- The app shell now scopes primary navigation to the identity’s active Generator, Receiver, Helper or platform roles, keeps restricted operations out of non-platform navigation, and exposes the operations route for each assigned platform role. Operations queues, onboarding status and support/privacy lists have explicit loading/error/retry feedback.
- Self-hosted Manrope and Playfair Display, reusable surface/button/status styles, visible focus, reduced-motion support and Lucide icons in the shared navigation/public surfaces are implemented. Some existing panels still use Unicode glyphs; a complete icon refactor has not been done.
- Verification includes a real local database empty-impact response, synthetic PGlite positive aggregate fixtures, role-navigation policy tests, axe/overflow checks across 14 public/auth routes at 320px and 1440px, and focused keyboard/motion checks. Protected role actions, non-empty real-PostgreSQL metrics and manual accessibility review remain unverified; see [`UI_UX_TEST_REPORT.md`](UI_UX_TEST_REPORT.md).

## Principles

- **Trust through clarity:** show the source, status, unit and next step. Never infer safety, partnership, approval, distance or impact.
- **Useful hierarchy:** one main action per page, role-specific summaries, generous line-height and readable text.
- **Quiet confidence:** charcoal surfaces, restrained borders, limited shadows, saffron only for primary actions/highlights.
- **Careful motion:** short feedback transitions; respect `prefers-reduced-motion`.
- **Accessible by default:** semantic landmarks, labels, status text, visible focus, keyboard access and generous touch targets.

## Tokens

| Token | Value / intent |
| --- | --- |
| `--bg` | `#0A0A0C` — page background |
| `--surface` | `#14141A` — primary surface |
| `--surface-raised` | `#1C1C24` — raised content surface |
| `--surface-soft` | `#202027` — nested surface |
| `--text` | `#F5F1E8` — primary text |
| `--muted` | `#B8B6B5` — readable secondary text (raise from the earlier low-contrast gray) |
| `--muted-2` | `#8D8B93` — supporting text; avoid for essential copy below 14px |
| `--saffron` | `#FFB703` — primary action and carefully limited accent |
| `--sky` | `#9DB7FF` — informational distinction |
| `--success` | `#4ADE80` — paired with text/icon, never color alone |
| `--warning` | `#FB923C` — paired with clear warning copy |
| `--danger` | `#F87171` — paired with clear error text |
| `--line` | low-opacity white — quiet separators, not the sole grouping cue |
| `--radius-sm` / `--radius` | 12px / 18px — controls and cards |

### Typography

- **Editorial headings:** Playfair Display, with a system Georgia/serif fallback.
- **Interface/body:** Manrope, with system sans-serif fallback.
- **Scale:** display/clamp for public hero only; page titles around 34–44px desktop and 30–36px mobile; body copy 15–17px; labels/help text should remain readable (target 12–14px).
- Use sentence case except short overline labels. Avoid all-caps for important status/validation.

### Spacing and layout

Use a consistent 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80. Public content is centered with a responsive 16–32px gutter. Dashboard uses a 12-column desktop grid, collapsing to a single column at tablet/mobile. Maintain safe-area padding for fixed mobile navigation.

## Components

- **Buttons:** primary saffron with dark text; secondary surface with visible border; tertiary text button. Minimum 44×44px for interactive targets. Disabled/loading state has a clear label and does not announce success.
- **Links:** clear text, underline or distinct color where inline; external links identify new context where relevant.
- **Forms:** visible label, concise hint, field-level error, `aria-invalid`/`aria-describedby`, keyboard focus. Inputs at least 48px high. Reveal-password control is a real button with an accessible name.
- **Status:** text label + optional Lucide icon + color; do not rely on color or dot alone. Use badges for short status, banners for important launch/safety gates.
- **Cards:** group related tasks/data; do not place a border around every row. List rows use clear hover/focus and become stacked content on narrow screens.
- **Empty/error/loading:** empty states explain why and provide a permitted next action; errors do not masquerade as empty data; skeletons use `aria-busy` and reduced-motion support.
- **Navigation:** responsive desktop nav/sidebar, native keyboard-operable mobile disclosure, role-specific mobile bottom nav. Mark current page with `aria-current="page"`.
- **Icons:** `lucide-react`, consistent 18–20px interface size; decorative icons are `aria-hidden`; icon-only controls require an accessible label.
- **Charts:** only with authorized backend series and a defined unit/time range. No chart library or time-series endpoint is currently configured; do not render dummy charts.

## Interaction and content rules

- Mutations wait for server confirmation before success UI.
- Confirmation is required before irreversible/admin-sensitive actions.
- Live impact is counted only from verified receipts; “servings” includes only records whose stored unit is servings. Do not translate kg/boxes/portions into meals.
- A role request is not role approval. A public directory entry is not a partner. A declaration is not independent food inspection.
- OTP is surfaced only to the authorized Receiver through the existing endpoint and never to Helpers, URLs, logs or notifications.
- Draft legal/privacy/safety pages remain visibly marked draft until qualified human approval.

## Responsive and motion

- Design at 320px first; test through 1440px and wider.
- Never hide primary role routes on mobile; use bottom navigation for the highest-frequency actions and a disclosure for secondary routes.
- Respect `env(safe-area-inset-bottom)` and preserve keyboard-visible form actions.
- Honor `prefers-reduced-motion`; all animation is decorative and may be removed without losing state/meaning.
