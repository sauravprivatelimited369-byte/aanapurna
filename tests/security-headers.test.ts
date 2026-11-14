import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

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

  it("keeps a content security policy that forbids framing and objects", async () => {
    const rules = await headerRules();
    const global = rules.find((rule) => rule.source === "/(.*)")!;
    const csp = global.headers.find((header) => header.key.startsWith("Content-Security-Policy"));
    expect(csp).toBeDefined();
    expect(csp!.key).toBe("Content-Security-Policy-Report-Only");
    expect(csp!.value).toContain("frame-ancestors 'none'");
    expect(csp!.value).toContain("object-src 'none'");
    expect(csp!.value).toContain("base-uri 'self'");
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
