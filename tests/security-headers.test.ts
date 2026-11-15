import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { NextRequest } from "next/server";
import { PRE_RENDERED_ROUTES, buildCsp, buildPreRenderedCsp, config as proxyConfig, proxy } from "../src/proxy";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function headerRules(): Promise<HeaderRule[]> {
  if (!nextConfig.headers) throw new Error("next.config must expose headers()");
  return nextConfig.headers() as Promise<HeaderRule[]>;
}

describe("response security headers", () => {
  it("sets the baseline hardening headers on every response", async () => {
    const rules = await headerRules();
    const global = rules.find((rule) => rule.source === "/(.*)");
    expect(global).toBeDefined();
    const keys = new Map(global!.headers.map((header) => [header.key, header.value]));

    expect(keys.get("X-Content-Type-Options")).toBe("nosniff");
    expect(keys.get("X-Frame-Options")).toBe("DENY");
    expect(keys.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(keys.get("Permissions-Policy")).toContain("geolocation=()");
    expect(keys.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("does not declare a static content security policy that would conflict with the nonce", async () => {
    const rules = await headerRules();
    const global = rules.find((rule) => rule.source === "/(.*)")!;
    expect(global.headers.some((header) => header.key.startsWith("Content-Security-Policy"))).toBe(false);
  });

  it("enforces a nonce-based content security policy from middleware", async () => {
    const response = proxy(new NextRequest(new URL("https://example.test/login")));
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).not.toContain("unsafe-inline'; script-src");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    // The same nonce must reach the renderer so Next.js can attach it.
    expect(response.headers.get("x-nonce")).toMatch(/^[A-Za-z0-9+/=]{16,}$/);
    expect(csp).toContain(`'nonce-${response.headers.get("x-nonce")}'`);
  });

  it("issues a different nonce for every request", () => {
    const first = proxy(new NextRequest(new URL("https://example.test/login"))).headers.get("x-nonce");
    const second = proxy(new NextRequest(new URL("https://example.test/login"))).headers.get("x-nonce");
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("uses the relaxed policy only for the documented pre-rendered pages", () => {
    const relaxed = proxy(new NextRequest(new URL("https://example.test/preview"))).headers.get("Content-Security-Policy");
    expect(relaxed).toContain("script-src 'self' 'unsafe-inline'");
    expect(relaxed).not.toContain("strict-dynamic");
    // Everything else is nonce-enforced, including routes that look public.
    for (const path of ["/login", "/signup", "/app", "/app/profile", "/admin"]) {
      const strict = proxy(new NextRequest(new URL(`https://example.test${path}`))).headers.get("Content-Security-Policy");
      expect(strict).toContain("'strict-dynamic'");
      expect(strict).not.toContain("unsafe-inline'; script-src");
    }
    expect(PRE_RENDERED_ROUTES.has("/preview")).toBe(true);
    expect(PRE_RENDERED_ROUTES.has("/login")).toBe(false);
  });

  it("keeps the pre-rendered policy free of framing and object sources", () => {
    const csp = buildPreRenderedCsp({ upgradeInsecureRequests: true });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("keeps scripts nonce-bound and styles permissive but framing forbidden", () => {
    const csp = buildCsp("test-nonce-value", { upgradeInsecureRequests: true });
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce-value' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("applies to documents but not to immutable build assets", () => {
    expect(proxyConfig.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });

  it("never caches a response that can carry a one-time credential", async () => {
    const rules = await headerRules();
    const auth = rules.find((rule) => rule.source === "/api/auth/(.*)");
    expect(auth?.headers).toEqual([{ key: "Cache-Control", value: "no-store" }]);
  });

  it("does not overwrite the cache policy of the public impact endpoint", async () => {
    const rules = await headerRules();
    expect(rules.some((rule) => rule.source === "/api/(.*)")).toBe(false);
  });
});
