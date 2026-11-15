# Language and request visibility

Two things this repository now does that it did not before: it explains where a request has got to,
and it offers that explanation in more than one language.

## The languages, and why English is the default

This service operates in Sambalpur, Odisha, and its interface is published in **English, Hindi and
Bengali**. Odia was offered earlier and was **removed on the owner's instruction**; the switcher no
longer lists it and no notice, message or date format is produced in it.

English is the default. Neither Hindi nor Bengali copy has been read by a native speaker of that
language, and making an unreviewed translation the baseline would give a first-time reader unreviewed
prose as the default rather than as a choice they made. A person who has explicitly chosen a language
keeps that choice even if their browser prefers another.

### What is translated, and what is not yet

| Surface | Hindi | Bengali |
|---|---|---|
| Site navigation, hero and role cards | Yes | Yes |
| Privacy banner | Yes | Yes |
| Response-window statement | Yes | Yes |
| Request timeline and its next-step guidance | Yes | Yes |
| Language switcher, `<html lang>` | Yes | Yes |
| `/privacy` — the full notice | **No** — English, and the page says so | **No** — English, and the page says so |
| `/answers` | No — English only | No — English only |
| `/terms`, `/food-safety`, `/how-it-works` | No — English only | No — English only |
| Support and privacy request forms | No — English only | No — English only |
| Emails and notifications | No — English only | No — English only |

The boundary is stated on screen rather than left for a reader to discover: a page that exists only in
English tells a Hindi or Bengali reader that, in their own language, instead of showing English prose
and letting them conclude it is the translation.

### The translations are drafts and say so

**No native Hindi or Bengali speaker has reviewed any translated text in this repository.** The
translations were written by an engineer; being plausible is not the same as being reviewed. A
translation is not a review: whoever signs off the English text has not thereby signed off the Hindi or
Bengali text, and the DRAFT banners keep that visible until a human reads them.

**A native Hindi or Bengali speaker has not reviewed this text.** The vocabulary follows ordinary usage
in each language, but dictionary correctness is not the same as being natural to read. Treat every
Hindi and Bengali string here as provisional until a fluent reviewer has read it aloud.

### How the translation is stored

The privacy notice lives in `src/domain/privacy-notice.ts`. The page holds no prose of its own, so a
wording change is a visible diff in one place rather than a string buried in JSX.

Sentences are stored whole rather than assembled from fragments. Hindi and Bengali place the number and
the subordinate clause differently from English, so `"within " + hours + " hours"` cannot be translated
by substitution — `responseWindowParagraph` is a function per language rather than a template.

`src/lib/i18n.ts` is a dictionary with `{name}` substitution, not a framework. There is no pluralisation
engine and no message extraction. With three languages, a framework would be machinery to maintain for a
problem a few hundred lines of table already solve.

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

## Two layout constraints this created, and the fixes

**A public page must not wait on the database to render.** Adding the recorded window meant a third
public read on every render. The pool's connect timeout is 30 seconds, which is fine for an app request
and wrong for a page: during an outage a reader would get a blank screen instead of a notice, and the
browser test that asserts `main` is visible would time out rather than fail on something meaningful.
`published-contacts.ts` now wraps each public read in a 2-second bound and treats a slow answer as no
answer, which every caller already renders truthfully as "not recorded". All nine public pages return
200 in milliseconds with no database reachable.

**The switcher has to survive 320px.** Brand + two language names + join + menu does not fit in a 288px
container. Below 560px the inactive language collapses to a glyph in its own script (`ଓ` / `EN`), which
keeps the control present instead of deleting it — deleting it would trap a reader in a language they
may not read. Below 380px the header switcher hides and the mobile menu carries its own, because hiding
the only way to change language is worse than a crowded header. The spelled-out names stay in the
accessibility tree via `sr-only`, so a screen reader still hears "English" rather than "EN".
