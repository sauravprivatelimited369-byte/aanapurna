/**
 * Two languages, chosen deliberately.
 *
 * This product serves Sambalpur, in Odisha. Publishing an English-only privacy notice to people who
 * read Odia is not a presentation problem: a notice in a language you do not read is not notice, and
 * a rights flow you cannot follow is not a right. English stays as the second language because the
 * organisation, its auditors and its lawyers work in it.
 *
 * The translations are written as prose rather than assembled from fragments. Sentence order differs
 * between the two languages, so a template like `"within " + hours + " hours"` cannot be translated
 * by substitution — the Odia phrasing puts the number where English does not. Where a number or a date
 * is involved, the whole sentence is stored per language.
 *
 * This is a dictionary, not a framework. There is no pluralisation engine and no message extraction,
 * because there are two languages and one of them is not the source language. A framework here would
 * be machinery to maintain for a problem that four hundred lines of table already solve.
 */

/**
 * Note: this module is imported by client components as well as server ones, so it carries no
 * `server-only` guard. The dictionary is public text and the resolver is pure; there is no secret
 * here. The cookie and header read lives in `locale-server.ts`, which *is* server-only.
 */
export const LOCALES = ["or", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "or";

/** What each language calls itself, for the switcher. Never translate a language's own name. */
export const LOCALE_NAMES: Record<Locale, string> = {
  or: "ଓଡ଼ିଆ",
  en: "English",
};

/**
 * A one-glyph fallback for the narrowest screens, where the full pair does not fit beside the brand
 * and the menu. Still in the language's own script, so it is recognisable rather than an abbreviation.
 */
export const LOCALE_SHORT_NAMES: Record<Locale, string> = {
  or: "ଓ",
  en: "EN",
};

export const LOCALE_COOKIE = "annapurna_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * A person's language, from the cookie they chose, falling back to what their browser asked for.
 *
 * Order matters: an explicit choice outranks a header, because somebody who has already told us they
 * read Odia should not be moved back to English by a browser default on their next device.
 */
export function resolveLocale(cookieValue: unknown, acceptLanguage: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    if (tag === "or" || tag.startsWith("or-")) return "or";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return DEFAULT_LOCALE;
}

const OR = {
  "request.progress.heading": "ଆପଣଙ୍କ ଅନୁରୋଧ କେଉଁଠି ଅଛି",
  "request.progress.showTimeline": "ସମୟରେଖା ଦେଖନ୍ତୁ",
  "request.progress.hideTimeline": "ସମୟରେଖା ଲୁଚାନ୍ତୁ",
  "request.progress.loading": "ଅନୁରୋଧ ଖୋଜୁଛୁ…",
  "request.progress.failed": "ଅନୁରୋଧର ସ୍ଥିତି ପଢ଼ିପାରିଲୁ ନାହିଁ।",
  "request.progress.waited": "ଅପେକ୍ଷା",
  "request.progress.hours": "ଘଣ୍ଟା",
  "request.progress.nextStep": "ପରବର୍ତ୍ତୀ ପଦକ୍ଷେପ",
  "request.progress.queue": "ଆପଣଙ୍କ ପୂର୍ବରୁ {count}ଟି ଖୋଲା ଅନୁରୋଧ ଅଛି",
  "request.progress.noWindow": "କୌଣସି ସମୟସୀମା ଲେଖା ହୋଇନାହିଁ, ତେଣୁ କୌଣସି ତାରିଖର ପ୍ରତିଶ୍ରୁତି ନାହିଁ।",
  "request.progress.window": "{hours} ଘଣ୍ଟା ମଧ୍ୟରେ ଉତ୍ତର ଦେବାକୁ ପ୍ରତିଶ୍ରୁତି",
  "request.progress.overdue": "{hours} ଘଣ୍ଟାର ସମୟସୀମା ଅତିକ୍ରମ ହୋଇଛି",
  "request.progress.onTime": "ସମୟସୀମା ଭିତରେ ଅଛି",
  "request.progress.current": "ବର୍ତ୍ତମାନ ଏଠାରେ",
  "privacy.nav": "ଗୋପନୀୟତା",
  "common.dateAt": "{date} ରେ, {time} ଘଟିକାରେ",
} as const;

const EN = {
  "request.progress.heading": "Where your request is",
  "request.progress.showTimeline": "Show the timeline",
  "request.progress.hideTimeline": "Hide the timeline",
  "request.progress.loading": "Looking up your request…",
  "request.progress.failed": "The status of this request could not be read.",
  "request.progress.waited": "Waiting",
  "request.progress.hours": "hours",
  "request.progress.nextStep": "What happens next",
  "request.progress.queue": "{count} open requests were submitted before yours",
  "request.progress.noWindow": "No response window is recorded, so no date is promised.",
  "request.progress.window": "Promised answer within {hours} hours",
  "request.progress.overdue": "Past the {hours}-hour window",
  "request.progress.onTime": "Inside the window",
  "request.progress.current": "Here now",
  "privacy.nav": "Privacy",
  "common.dateAt": "on {date} at {time}",
} as const;

export type MessageKey = keyof typeof EN;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { or: OR, en: EN };

/**
 * Look up a message and substitute `{name}` placeholders.
 *
 * Only whole-sentence substitution is used. Word order is the translator's decision, so a caller
 * must never split a message to interleave markup or to reorder a number.
 */
export function t(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = MESSAGES[locale][key] ?? MESSAGES.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match);
}

/** A translator bound to one language, which is what a page component should hold. */
export function translator(locale: Locale) {
  return (key: MessageKey, values?: Record<string, string | number>) => t(locale, key, values);
}

/**
 * Dates in the reader's language.
 *
 * Asia/Kolkata rather than the server's zone: everybody this serves is in one timezone, and a request
 * that says it was answered "tomorrow" because a server ran in UTC is worse than no timestamp.
 * Odia uses the same digits as English here; the day and month names are what change.
 */
export function formatDate(locale: Locale, value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "or" ? "or-IN" : "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value instanceof Date ? value : new Date(value));
}

/** The `lang` attribute for <html>, so a screen reader switches voice rather than mispronouncing. */
export function htmlLang(locale: Locale): string {
  return locale === "or" ? "or-IN" : "en-IN";
}
