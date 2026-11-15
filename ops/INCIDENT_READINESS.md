# Incident and breach readiness

The register said the breach process was "a document, not a capability". This file is the part a
repository can make real: the actions that exist, the ones that need a person, and a script that
checks the machine half in a few seconds.

Run `node scripts/incident-readiness.mjs` to check the code-side preconditions. It prints `READY` or
`MISSING` per line and exits non-zero if anything needed is absent.

## What is already implemented (and where)

| Capability | Where | Checked by |
|---|---|---|
| Revoke every session of one account | `DELETE /api/account/sessions` (`revokeAccountSessions`) | `tests/authorization.test.ts` |
| See who did what, append-only | `audit_events` + `custody_events` with an append-only guard | `tests/database-migrations.test.ts` |
| Second factor before privileged action | `requireIdentity` → `403 TWO_FACTOR_ENROLMENT_REQUIRED` | `tests/authorization.test.ts` |
| Operator-assisted credential recovery | `POST /api/admin/account-recovery` | `tests/account-recovery.test.ts` |
| Personal-data request intake and tracking | `data_requests` table, `/api/data-requests`, operations queue | `tests/local-domain.test.ts` |
| Notify affected people in-product | `notifyUser` / `notifyOrganization` | notification tests |
| Document what a restore must match | `ops/backups/hosted-manifest-2026-11-15.json` | `tests/backup-manifest.test.ts` |
| Answer a contract question honestly | `TRUST_AND_SAFETY_QA.md` gap register | this file |

## What only a person can do

1. **Name the data-protection contact** and put the address where users can find it. Today no name
   is published anywhere, which is why `G6` stays open.
2. **Hold the rota.** A breach noticed on a Sunday is only a capability if somebody is on call.
3. **Run the drill once.** A drill is a rehearsal with a clock, not a checklist. The suggested
   scenario is: "a `security_admin` account is suspected compromised at 21:40 on a Saturday".

## Drill script (45 minutes, two people)

| Minute | Action | Evidence it produces |
|---|---|---|
| 0–5 | Declare the incident in a shared channel. One incident lead, one scribe. | Timestamp of declaration |
| 5–10 | Revoke every session of the account — `DELETE /api/account/sessions` while signed in, or `scripts/revoke-sessions.mjs` if it exists; otherwise ask operations. | Session count before and after |
| 10–20 | Pull the audit trail for the account for the last 7 days and write down the queries used. | A list of `audit_events` rows with actor, action, time |
| 20–30 | Decide, with the named data-protection contact, whether personal data was accessed. Write the answer down even if it is "we do not know yet". | A written determination with the reason |
| 30–40 | Notify affected users in-product through the operations console, and record the text used. | Notification rows |
| 40–45 | Write the three things that did not work, and open one task for each. | Dated follow-up list |

The drill is complete when the follow-up list exists. It is not complete when the table is filled in
without doing the actions.

## What to change in this repository afterwards

- If a step needed a query nobody had written down, add it to this file.
- If a person was hard to reach, that is `G6`, and it belongs in the register rather than in someone's
  memory.
- If the audit trail could not answer "what did they touch?", that is a real product defect: add a
  test that fails until it can.
