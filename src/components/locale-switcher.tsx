"use client";

/**
 * Choose the language the product is read in.
 *
 * This used to be a row of pill buttons, one per language, and now that there are four that no
 * longer fits: at 320px the header holds the brand, the switcher, Join and the menu, and four names
 * in three scripts pushed the row past the viewport. The previous fix collapsed the inactive names
 * to a glyph below 640px, which worked for two languages and becomes unreadable at four — four
 * glyphs in a 120px strip is not a control anybody can use.
 *
 * A native `<select>` is the honest answer. It is one control at every width, the platform renders
 * the option list in a way that handles mixed scripts and long names for free, keyboard and screen
 * reader behaviour is the operating system's rather than mine, and it cannot overflow. The cost is
 * that it cannot be styled to match the old pill row exactly, which is a fair trade for a control
 * that works on a 320px phone.
 *
 * Each option carries `lang` so the list renders each name in its own script, and the names are
 * never translated: somebody looking for Odia is looking for ଓଡ଼ିଆ.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LOCALE_NAMES, LOCALES, t, type Locale } from "@/lib/i18n";

export function LocaleSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Locale>(current);

  async function choose(locale: Locale) {
    setChosen(locale);
    if (locale === current) return;
    await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    }).catch(() => null);
    // The server re-renders in the new language rather than patching text in place, so a page has
    // exactly one source of truth for what it says.
    startTransition(() => router.refresh());
  }

  return (
    <label className="locale-switcher">
      <span className="sr-only">{t(current, "common.language")}</span>
      <select
        className="locale-switcher__select"
        value={pending ? chosen : current}
        disabled={pending}
        aria-label={t(current, "common.language")}
        onChange={(event) => void choose(event.target.value as Locale)}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale === "or" ? "or-IN" : `${locale}-IN`}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
