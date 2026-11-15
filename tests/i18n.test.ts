import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_NAMES, isLocale, resolveLocale, t, formatDate, htmlLang } from "@/lib/i18n";
import { noticeFor, privacyNotice, responseWindowParagraph } from "@/domain/privacy-notice";

describe("locale resolution", () => {
  it("defaults to English", () => {
    // English is the default now that Odia has been removed. Hindi and Bengali are offered but their
    // copy is unreviewed, so making either one the default would hand a first-time reader unreviewed
    // prose as the baseline rather than as a choice they made.
    expect(resolveLocale(undefined, null)).toBe("en");
    expect(resolveLocale(undefined, "")).toBe("en");
  });

  it("lets an explicit choice outrank the browser header", () => {
    // Somebody who has already chosen English should not be moved back by a header.
    expect(resolveLocale("hi", "en-IN,en;q=0.9")).toBe("hi");
    expect(resolveLocale("en", "hi-IN,hi;q=0.9")).toBe("en");
  });

  it("reads the browser header when no choice was made", () => {
    expect(resolveLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
    // Hindi and Bengali are offered now, so the header must be honoured rather than collapsed to Odia.
    expect(resolveLocale(undefined, "hi-IN,hi;q=0.9")).toBe("hi");
    expect(resolveLocale(undefined, "bn-IN,bn;q=0.9")).toBe("bn");
    // A language that is not offered falls back to the default.
    expect(resolveLocale(undefined, "ta-IN,ta;q=0.9")).toBe("en");
    // Odia was removed on the owner's instruction. A browser asking for it gets the default, and the
    // resolver must not quietly reintroduce it.
    expect(resolveLocale(undefined, "or-IN,or;q=0.9")).toBe("en");
  });

  it("ignores a cookie value it did not set", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("or")).toBe(false);
    expect(isLocale("odia")).toBe(false);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(resolveLocale("fr", null)).toBe("en");
  });

  it("writes each language's name in its own script", () => {
    // Never translate a language's own name: somebody looking for Bengali looks for বাংলা.
    expect(LOCALE_NAMES.bn).toBe("বাংলা");
    expect(LOCALE_NAMES.hi).toBe("हिन्दी");
    expect(LOCALE_NAMES.en).toBe("English");
  });

  it("sets the html lang attribute to the right script", () => {
    expect(htmlLang("hi")).toBe("hi-IN");
    expect(htmlLang("en")).toBe("en-IN");
  });
});

describe("messages", () => {
  it("substitutes named values", () => {
    expect(t("en", "request.progress.window", { hours: 72 })).toBe("Promised answer within 72 hours");
    expect(t("hi", "request.progress.window", { hours: 72 })).toContain("72");
  });

  it("leaves a placeholder alone rather than printing undefined", () => {
    expect(t("en", "request.progress.window", {})).toContain("{hours}");
  });

  it("has no English falling through in the Hindi or Bengali dictionary", () => {
    // A missing key silently renders English, which looks translated and is not.
    const en = t("en", "request.progress.heading");
    expect(t("hi", "request.progress.heading")).not.toBe(en);
    expect(t("bn", "request.progress.heading")).not.toBe(en);
    expect(t("hi", "request.progress.heading")).toMatch(/[\u0900-\u097F]/); // Devanagari
    expect(t("bn", "request.progress.heading")).toMatch(/[\u0980-\u09FF]/); // Bengali
  });

  it("formats dates in the reader's language", () => {
    const value = "2026-11-15T06:30:00.000Z";
    expect(formatDate("hi", value)).toMatch(/[\u0900-\u097F]/);
    expect(formatDate("en", value)).toMatch(/2026/);
    expect(formatDate("en", null)).toBe("—");
  });

  it("uses Asia/Kolkata so a timestamp cannot read as a different day", () => {
    // 2026-11-15T20:00Z is already the 16th in India. Showing the UTC date would tell somebody their
    // request was answered on a day it was not.
    const formatted = formatDate("en", "2026-11-15T20:00:00.000Z");
    expect(formatted).toContain("16");
  });
});

describe("the privacy notice exists in English, and says so where it does not", () => {
  it("keeps the section order stable so the generated paragraph lands in the right place", () => {
    // `page.tsx` injects the recorded response window into section 4 by index. If the sections drift
    // out of order that paragraph appears under the wrong heading.
    expect(privacyNotice.en.sections[4]?.heading).toBe("How long we take");
  });

  it("warns a reader that this is a draft", () => {
    expect(privacyNotice.en.draftBannerStrong).toContain("DRAFT");
  });

  it("refuses to serve an Odia notice", () => {
    // Odia was removed on the owner's instruction. `privacyNotice` must not still carry a translation
    // that no longer has a selector reaching it, and `noticeFor` must not accept the tag.
    expect((privacyNotice as Record<string, unknown>).or).toBeUndefined();
    expect(isLocale("or")).toBe(false);
    const { notice, translated } = noticeFor("or" as never);
    expect(translated).toBe(false);
    expect(notice.title).not.toMatch(/[\u0B00-\u0B7F]/);
  });

  it("states the response window, and never invents a number", () => {
    const none = { hours: null, staffedBy: null };
    expect(responseWindowParagraph("en", none)).toMatch(/none/i);
    expect(responseWindowParagraph("en", none)).not.toMatch(/\d+\s*hour/i);
    // Hindi and Bengali are offered, so they must state it too rather than fall back.
    expect(responseWindowParagraph("hi", none)).toMatch(/[\u0900-\u097F]/);
    expect(responseWindowParagraph("bn", none)).toMatch(/[\u0980-\u09FF]/);

    const recorded = { hours: 72, staffedBy: "Privacy desk" };
    expect(responseWindowParagraph("en", recorded)).toContain("72 hours");
    expect(responseWindowParagraph("en", recorded)).toContain("Privacy desk");
    expect(responseWindowParagraph("hi", recorded)).toContain("72");
    expect(responseWindowParagraph("bn", recorded)).toContain("72");
  });

  it("does not name a person as accountable when none was recorded", () => {
    const recorded = { hours: 24, staffedBy: null };
    for (const locale of LOCALES) {
      expect(responseWindowParagraph(locale, recorded)).not.toMatch(/undefined|null/);
    }
  });

  it("says so in the reader's language when it has not been translated", () => {
    // Hindi and Bengali are offered and the notice is not translated into them, so every offered
    // language must either have the notice, or be told it does not and get English explicitly.
    for (const locale of LOCALES) {
      const { notice, translated } = noticeFor(locale);
      expect(notice.sections.length).toBeGreaterThan(0);
      expect(translated).toBe(locale === "en");
    }
    for (const locale of LOCALES) {
      const banner = t(locale, "language.untranslatedBanner", { language: LOCALE_NAMES[locale] });
      expect(banner).toContain(LOCALE_NAMES[locale]);
      if (locale !== "en") expect(banner).not.toBe(t("en", "language.untranslatedBanner", { language: LOCALE_NAMES[locale] }));
    }
  });
});

describe("the language control has to survive a 320px phone", () => {
  it("names every language in its own script and offers exactly three", () => {
    // Each name is in its own script, so a reader recognises their own language without having its
    // name translated for them. Odia is deliberately absent.
    expect(LOCALES).toEqual(["en", "hi", "bn"]);
    expect(LOCALES).not.toContain("or");
    expect(LOCALE_NAMES.hi).toMatch(/[\u0900-\u097F]/); // Devanagari
    expect(LOCALE_NAMES.bn).toMatch(/[\u0980-\u09FF]/); // Bengali
  });

  it("keeps the full name available to a screen reader", () => {
    // CSS may hide the spelled-out label visually, but an assistive technology must still hear
    // "English" rather than "EN".
    expect(LOCALE_NAMES.en).toBe("English");
  });
});
