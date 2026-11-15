import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

describe("shortened homepage", () => {
  it("has three sections, no impact panel, and a link to it", async () => {
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const stream = await renderToReadableStream(element);
    await stream.allReady;
    const html = await new Response(stream).text();
    expect((html.match(/<section/g) ?? []).length).toBe(3);
    expect(html).not.toContain("impact-card");
    expect(html).toContain('href="/impact"');
    console.log("SECTIONS", (html.match(/<section/g) ?? []).length, "| impact link:", html.includes('href="/impact"'));
  });
});
