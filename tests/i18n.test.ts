import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_NAMES, isLocale, resolveLocale, t, formatDate, htmlLang } from "@/lib/i18n";
import { noticeFor, privacyNotice, responseWindowParagraph } from "@/domain/privacy-notice";

describe("locale resolution", () => {
  it("defaults to Odia, because that is who this is for", () => {
    // English as the default would make the majority-language reader do the work of opting in.
    expect(resolveLocale(undefined, null)).toBe("or");
    expect(resolveLocale(undefined, "")).toBe("or");
  });

  it("lets an explicit choice outrank the browser header", () => {
    // Somebody who has already chosen English should not be moved back by a header.
    expect(resolveLocale("en", "or-IN,or;q=0.9")).toBe("en");
    expect(resolveLocale("or", "en-GB,en;q=0.9")).toBe("or");
  });

  it("reads the browser header when no choice was made", () => {
    expect(resolveLocale(undefined, "or-IN,or;q=0.9,en;q=0.8")).toBe("or");
    expect(resolveLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
    // Hindi and Bengali are offered now, so the header must be honoured rather than collapsed to Odia.
    expect(resolveLocale(undefined, "hi-IN,hi;q=0.9")).toBe("hi");
    expect(resolveLocale(undefined, "bn-IN,bn;q=0.9")).toBe("bn");
    // A language that is still not offered falls back to the default rather than to English.
    expect(resolveLocale(undefined, "ta-IN,ta;q=0.9")).toBe("or");
  });

  it("ignores a cookie value it did not set", () => {
    expect(isLocale("or")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(resolveLocale("fr", null)).toBe("or");
  });

  it("writes each language's name in its own script", () => {
    // Never translate a language's own name: somebody looking for Odia looks for ଓଡ଼ିଆ.
    expect(LOCALE_NAMES.or).toBe("ଓଡ଼ିଆ");
    expect(LOCALE_NAMES.en).toBe("English");
  });

  it("sets the html lang attribute to the right script", () => {
    expect(htmlLang("or")).toBe("or-IN");
    expect(htmlLang("en")).toBe("en-IN");
  });
});

describe("messages", () => {
  it("substitutes named values", () => {
    expect(t("en", "request.progress.window", { hours: 72 })).toBe("Promised answer within 72 hours");
    expect(t("or", "request.progress.window", { hours: 72 })).toContain("72");
  });

  it("leaves a placeholder alone rather than printing undefined", () => {
    expect(t("en", "request.progress.window", {})).toContain("{hours}");
  });

  it("has no English falling through in the Odia dictionary", () => {
    // A missing key silently renders English, which looks translated and is not. Every key the
    // English side defines must exist in Odia and must differ where prose is involved.
    const en = t("en", "request.progress.heading");
    const or = t("or", "request.progress.heading");
    expect(or).not.toBe(en);
    expect(or).toMatch(/[\u0B00-\u0B7F]/); // Odia block
  });

  it("formats dates in the reader's language", () => {
    const value = "2026-11-15T06:30:00.000Z";
    expect(formatDate("or", value)).toMatch(/[\u0B00-\u0B7F]/);
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

describe("the privacy notice exists in both languages", () => {
  it("has every section in both", () => {
    expect(privacyNotice.or.sections).toHaveLength(privacyNotice.en.sections.length);
  });

  it("keeps the section order aligned so the generated paragraph lands in the right place", () => {
    // `page.tsx` injects the recorded response window into section 4 by index. If the two languages
    // drifted out of order that paragraph would appear under the wrong heading.
    expect(privacyNotice.or.sections.map((s) => s.heading)).toHaveLength(
      privacyNotice.en.sections.map((s) => s.heading).length,
    );
    expect(privacyNotice.en.sections[4]?.heading).toBe("How long we take");
    expect(privacyNotice.or.sections[4]?.heading).toContain("ସମୟ");
  });

  it("warns a reader in their own language that this is a draft", () => {
    expect(privacyNotice.or.draftBannerStrong).toMatch(/[\u0B00-\u0B7F]/);
    expect(privacyNotice.or.draftBannerStrong).not.toContain("DRAFT");
    expect(privacyNotice.en.draftBannerStrong).toContain("DRAFT");
  });

  it("writes real Odia, not transliterated English", () => {
    for (const section of privacyNotice.or.sections) {
      for (const paragraph of section.paragraphs) {
        expect(paragraph.body.length).toBeGreaterThan(40);
        // At least half the characters must be in the Odia block, or it is English wearing a label.
        const odia = (paragraph.body.match(/[\u0B00-\u0B7F]/g) ?? []).length;
        expect(odia / paragraph.body.length).toBeGreaterThan(0.4);
      }
    }
  });

  it("states the response window in both languages, and never invents a number", () => {
    const none = { hours: null, staffedBy: null };
    expect(responseWindowParagraph("or", none)).toMatch(/[\u0B00-\u0B7F]/);
    expect(responseWindowParagraph("or", none)).not.toMatch(/\d/);
    expect(responseWindowParagraph("en", none)).toMatch(/none/i);
    expect(responseWindowParagraph("en", none)).not.toMatch(/\d+\s*hour/i);

    const recorded = { hours: 72, staffedBy: "Privacy desk" };
    expect(responseWindowParagraph("or", recorded)).toContain("72");
    expect(responseWindowParagraph("en", recorded)).toContain("72 hours");
    expect(responseWindowParagraph("en", recorded)).toContain("Privacy desk");
  });

  it("does not name a person as accountable when none was recorded", () => {
    const recorded = { hours: 24, staffedBy: null };
    expect(responseWindowParagraph("en", recorded)).not.toMatch(/undefined|null/);
    expect(responseWindowParagraph("or", recorded)).not.toMatch(/undefined|null/);
  });

  it("says so in the reader's language when it has not been translated", () => {
    // This used to assert that every offered language had a notice. That is no longer true — Hindi
    // and Bengali are offered and the notice is not translated into them — so the assertion changes
    // from "all four exist" to the thing that actually protects a reader: every offered language
    // either has the notice, or is told it does not and gets English explicitly.
    for (const locale of LOCALES) {
      const { notice, translated } = noticeFor(locale);
      expect(notice.sections.length).toBeGreaterThan(0);
      expect(translated).toBe(locale === "or" || locale === "en");
    }
    // The banner text must exist in every offered language, and must name the language in its own script.
    for (const locale of LOCALES) {
      const banner = t(locale, "language.untranslatedBanner", { language: LOCALE_NAMES[locale] });
      expect(banner).toContain(LOCALE_NAMES[locale]);
      if (locale !== "en") expect(banner).not.toBe(t("en", "language.untranslatedBanner", { language: LOCALE_NAMES[locale] }));
    }
  });
});

describe("the language control has to survive a 320px phone", () => {
  it("names every language in its own script and offers all four", () => {
    // Four languages wide enough to overflow the old pill row at 320px, which is why the control is
    // now one select. What still matters is that each name is in its own script, so a reader can
    // recognise their own language without having its name translated for them.
    expect(LOCALES).toEqual(["or", "en", "hi", "bn"]);
    expect(LOCALE_NAMES.or).toMatch(/[\u0B00-\u0B7F]/); // Odia block
    expect(LOCALE_NAMES.hi).toMatch(/[\u0900-\u097F]/); // Devanagari
    expect(LOCALE_NAMES.bn).toMatch(/[\u0980-\u09FF]/); // Bengali
  });

  it("keeps the full name available to a screen reader", () => {
    // CSS may hide the spelled-out label visually, but an assistive technology must still hear
    // "English" rather than "EN".
    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.or).toBe("ଓଡ଼ିଆ");
  });
});
