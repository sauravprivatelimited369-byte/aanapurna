# Language and request visibility

Two things this repository now does that it did not before: it explains where a request has got to,
and it does so in Odia as well as English.

## Why Odia is the default and not a setting

This service operates in Sambalpur, Odisha. A privacy notice published only in English is not a notice
to somebody who reads Odia — it is a document they cannot use, in a place they are told their rights
live. The same is true of a rights flow: an export button labelled in a language you do not read is a
feature you cannot reach.

So the notice, the response-window statement and the request timeline are published in both languages,
and **Odia is the default**. English remains available because the organisation, its auditors and its
lawyers read it. A person who has explicitly chosen a language keeps that choice even if their browser
prefers the other.

### What is translated, and what is not yet

| Surface | Odia? |
|---|---|
| `/privacy` — the full notice | Yes |
| Response-window statement | Yes |
| Request timeline and its next-step guidance | Yes |
| Language switcher, `<html lang>` | Yes |
| `/answers` | No — English only |
| `/terms`, `/food-safety`, `/how-it-works` | No — English only |
| Support and privacy request forms (labels, buttons) | No — English only |
| Emails and notifications | No — English only |

The boundary is honest: the pages a person needs in order to *understand and exercise* a right are
translated. The surrounding marketing and the transactional email are not. That is a real gap and it is
listed in `BUILD_STATUS.md` rather than left for a reader to discover.

### The translations are drafts and say so

The Odia notice carries the same "DRAFT — REQUIRES QUALIFIED PRIVACY AND LEGAL REVIEW" warning as the
English one, in Odia. A translation is not a review: whoever signs off the English text has not thereby
signed off the Odia text, and the banner keeps that visible.

**A native Odia speaker has not reviewed this text.** The vocabulary follows standard Odia legal usage
(`ଗୋପନୀୟତା` for privacy, `ଅନୁରୋଧ` for request, `ସମୟସୀମା` for time limit, confirmed against published
dictionaries), but dictionary correctness is not the same as being natural to read. Treat every Odia
string here as provisional until a fluent reviewer has read it aloud.

### How the translation is stored

Both languages live side by side in `src/domain/privacy-notice.ts`. The page holds no prose of its own,
so a change to one language is a visible diff against the other rather than a string buried in JSX.

Sentences are stored whole rather than assembled from fragments. Odia places the number and the
subordinate clause differently from English, so `"within " + hours + " hours"` cannot be translated by
substitution — `responseWindowParagraph` is a function per language rather than a template.

`src/lib/i18n.ts` is a dictionary with `{name}` substitution, not a framework. There is no pluralisation
engine and no message extraction. With two languages and one of them not the source language, a
framework would be machinery to maintain for a problem a few hundred lines of table already solve.

## Where a request has got to

A status pill reading `in_review` names an internal state. It does not say whether anybody has picked
the request up, how long it has been waiting, or what happens next — which is what a person actually
wants to know.

`getRequestProgress` (`src/domain/service.ts`) answers that from `audit_events`, not from the current
status. The timeline is a **record of what happened**, so a stage appears only if it did. There are no
greyed-out future steps: a timeline showing events that have not occurred reads as reassurance and is
indistinguishable from a lie.

`buildRequestProgress` (`src/domain/request-progress.ts`) is pure, so the wording and the stage rules are
testable without a database and a person's view cannot drift from a staff view.

### What it refuses to do

- **It never invents a response window.** With no recorded window `overdue` is `null`, not `false`, and
  the next step says no date is promised. `null` and "on time" are different facts and the styling keeps
  them apart.
- **It does not name staff.** A person is told that a reviewer has the request and when it moved, not
  which member of staff it is. That is somebody else's personal data, and naming staff in a customer
  view invites retaliation.
- **It does not leak existence.** Asking about somebody else's request returns `404`, the same answer as
  an id that does not exist, so the endpoint cannot be used to enumerate requests.
- **It counts the whole queue for "ahead of yours".** Three requests ahead only means something if it
  counts everybody's. The count is null, never an invented zero, if the queue read fails.

### Endpoint

`GET /api/account/requests/:id` — returns the timeline for one request. Scoped to the caller; staff may
read any. Rate-limited to 120 reads per hour per address, which is a guard against a loop rather than
against the request.

## Status

Verified against the live hosted database on 2026-11-15: a real audit row
(`privacy.data_request_updated` with `details.toStatus = "in_review"`) was read through the real query
shape and folded by `buildRequestProgress` into two stages, with `overdue: null` and the "no response
window recorded" next step. The probe rows were removed afterwards.

`320` tests pass, including 12 for the progress rules and 18 for the language layer. `npx eslint .`,
`npx tsc --noEmit` and `npm run build` are clean. `/privacy` was confirmed rendering in both languages
with a matching `<html lang>` and no English prose leaking into the Odia page.
