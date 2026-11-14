# Master Audit and Gap Register

**Date:** 2026-11-14  
**Branch:** `arena/bf508d10-aanapurna`  
**Live Deployment:** `https://aanapurna-link-preview.vercel.app` (`prj_ioMsFVvCdLPvelL6gURUChyoiboJ`)  
**Database:** Supabase (`wlpibnftabirwtziwubv`, `ACTIVE_HEALTHY`)

## Gap Register

| ID | Area | Severity | Evidence | Consequence | Solution | Status |
|---|---|---|---|---|---|---|
| GAP-01 | Transactional Email (SMTP) | Critical | Vercel `SMTP_HOST=smtp.ethereal.email` (`test_sink`) | Emails are captured in a test inbox and never reach real users | Configure owner-provided transactional SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) on Vercel | BLOCKED (Owner SMTP credentials required) |
| GAP-02 | Background Worker on Vercel | High | `public.service_health` has 0 rows (`never_seen`); `vercel.json` had no cron | Email outbox is not drained automatically on Vercel | Added `crons` entry in `vercel.json` targeting `/api/worker/drain` (`*/5 * * * *`) | DONE (Code & `vercel.json` updated; requires deploy) |
| GAP-03 | `/api/health` Readiness Ambiguity | Medium | `src/app/api/health/route.ts` returned top-level `status: "ok"` even when worker was `never_seen` and email was `test_sink` | Monitoring could mistake DB liveness for production readiness | Added explicit `liveness` and `readiness` (`ready` / `not_ready` + `reasons`) fields | DONE |
| GAP-04 | Real Organisations & Donations | Critical | Supabase `organizations` = 0, `donations` = 0 | No real-world pilot activity exists yet | Onboard and human-verify real Generator/Receiver/Helper partners | NOT APPROVED / BLOCKED (Human partner onboarding required) |
| GAP-05 | Food-Safety Policy & Launch Approvals | Critical | `0.1.0-iim-calcutta` is draft; `LAUNCH_CHECKLIST.md` gates unchecked | Real food operations must remain disabled (`OPERATIONS_ENABLED=false`) | Legal, DPDP, and FSSAI qualified human review and sign-off | NOT APPROVED |
| GAP-06 | Institutional Landing Page | Medium | No `/for-colleges` route existed | Institutional visitors lacked a dedicated, honest pilot overview | Created `src/app/for-colleges/page.tsx` | DONE |
