import { NextResponse, type NextRequest } from "next/server";

/**
 * Enforcing Content-Security-Policy with a per-request nonce.
 *
 * The policy used to be `Content-Security-Policy-Report-Only`: it reported
 * violations and blocked nothing. Enforcement needs a nonce, because Next.js
 * emits small inline bootstrap scripts (`self.__next_f`, the Turbopack runtime)
 * that `'self'` does not cover.
 *
 * Next.js reads the CSP from the request headers and attaches the nonce to the
 * scripts it renders. That only works for documents rendered per request. Pages
 * that are pre-rendered at build time cannot carry a per-request nonce, so this
 * file uses two policies:
 *
 *   * `strict` (default) — nonce + `'strict-dynamic'`. Every authenticated page,
 *     every form and every account flow is server-rendered, so every page that
 *     can act on a session is covered.
 *   * `preRendered` — only for the public marketing pages listed below, which
 *     contain no session, no form that mutates anything, and no personal data.
 *     They keep `'unsafe-inline'` for scripts because their inline bootstrap is
 *     fixed at build time.
 *
 * The default is deliberately the strict policy: a new route is nonce-enforced
 * unless it is explicitly listed here. A newly pre-rendered page fails visibly
 * in testing rather than silently getting the weaker policy.
 */

/** Public pages that Next pre-renders at build time (verified against `next build`). */
export const PRE_RENDERED_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/_not-found",
  "/about",
  "/accessibility",
  "/contact",
  "/food-safety",
  "/how-it-works",
  "/near-iim-calcutta",
  "/preview",
  "/privacy",
  "/terms",
]);

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const BASE_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
];

export function buildCsp(nonce: string, options: { upgradeInsecureRequests: boolean }): string {
  return [
    // 'strict-dynamic' is ignored by browsers that do not support it, which keep
    // the nonce and 'self'. Modern browsers ignore 'self' for scripts once it is
    // present, so only nonce-trusted scripts run.
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    ...BASE_DIRECTIVES.slice(1),
    ...(options.upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function buildPreRenderedCsp(options: { upgradeInsecureRequests: boolean }): string {
  return [
    ...BASE_DIRECTIVES,
    // No nonce exists on a build-time document, so the inline bootstrap needs
    // this. It is scoped to the public pages only.
    "script-src 'self' 'unsafe-inline'",
    ...(options.upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

export function proxy(request: NextRequest) {
  const upgradeInsecureRequests = process.env.NODE_ENV === "production";
  const path = normalizePath(request.nextUrl.pathname);

  if (PRE_RENDERED_ROUTES.has(path)) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", buildPreRenderedCsp({ upgradeInsecureRequests }));
    return response;
  }

  const nonce = createNonce();
  const csp = buildCsp(nonce, { upgradeInsecureRequests });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads this during rendering to attach the nonce to its own script
  // and preload tags.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  /**
   * Documents and API responses both get the header. Static build output is
   * excluded: it cannot contain a per-request nonce, and serving assets through
   * this proxy would charge every request for a policy that cannot apply.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
