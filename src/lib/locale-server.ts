import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/lib/i18n";

/**
 * The language for the current request.
 *
 * Read on the server so the first paint is already in the right language. Doing this in the browser
 * would show an Odia reader an English page that swaps itself a moment later, which for a privacy
 * notice is long enough to decide the page is not for them.
 */
export async function currentLocale(): Promise<Locale> {
  const [store, head] = await Promise.all([cookies(), headers()]);
  return resolveLocale(store.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
}
