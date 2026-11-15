import { NextResponse } from "next/server";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { enforceRateLimit, getRequestAddressKey } from "@/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remember which language somebody reads.
 *
 * A cookie rather than a field on the account, deliberately: a person should be able to read the
 * privacy notice in Odia before signing in, and a language preference is not worth an account.
 */
export async function POST(request: Request) {
  enforceRateLimit({ bucket: "locale", subject: getRequestAddressKey(request), max: 60, windowSeconds: 3600 });
  const body = await request.json().catch(() => ({})) as { locale?: unknown };
  if (!isLocale(body.locale)) {
    return NextResponse.json({ error: { message: "Unsupported language." } }, { status: 400 });
  }
  const response = NextResponse.json({ locale: body.locale });
  response.cookies.set(LOCALE_COOKIE, body.locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
