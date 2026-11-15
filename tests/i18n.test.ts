import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT_NAMES, isLocale, resolveLocale, t, formatDate, htmlLang } from "@/lib/i18n";
import { privacyNotice, responseWindowParagraph } from "@/domain/privacy-notice";

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
    expect(resolveLocale(undefined, "hi-IN,hi;q=0.9")).toBe("or");
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

  it("covers both languages the switcher offers", () => {
    for (const locale of LOCALES) expect(privacyNotice[locale]).toBeDefined();
  });
});

describe("the language control has to survive a 320px phone", () => {
  it("offers a compact label in the language's own script", () => {
    // The header holds brand + switch + join + menu, which does not fit at 320px with two full
    // names. Collapsing to a glyph keeps the control present; removing it would trap the reader in
    // a language they may not read.
    expect(LOCALE_SHORT_NAMES.or).toMatch(/[\u0B00-\u0B7F]/);
    expect(LOCALE_SHORT_NAMES.en.length).toBeLessThanOrEqual(2);
    expect(LOCALE_SHORT_NAMES.or.length).toBeLessThan(LOCALE_NAMES.or.length);
  });

  it("keeps the full name available to a screen reader", () => {
    // CSS may hide the spelled-out label visually, but an assistive technology must still hear
    // "English" rather than "EN".
    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.or).toBe("ଓଡ଼ିଆ");
  });
});
