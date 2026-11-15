"use client";

/**
 * Switch between the two languages this product publishes.
 *
 * Both names are written in their own script and are never translated: an Odia reader looking for
 * their language is looking for the word ଓଡ଼ିଆ, not for "Odia". The button refreshes so the server
 * re-renders in the chosen language instead of patching text in place, which keeps a single source of
 * truth for what a page says.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALE_NAMES, type Locale } from "@/lib/i18n";

export function LocaleSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function choose(locale: Locale) {
    if (locale === current || busy) return;
    setBusy(true);
    await fetch("/api/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    }).catch(() => null);
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="locale-switcher" role="group" aria-label={current === "or" ? "ଭାଷା" : "Language"}>
      {(Object.keys(LOCALE_NAMES) as Locale[]).map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale === "or" ? "or-IN" : "en-IN"}
          className={locale === current ? "locale-switcher__choice is-active" : "locale-switcher__choice"}
          aria-pressed={locale === current}
          disabled={busy}
          onClick={() => void choose(locale)}
        >
          {LOCALE_NAMES[locale]}
        </button>
      ))}
    </div>
  );
}
