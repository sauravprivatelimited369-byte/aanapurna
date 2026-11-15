import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The service worker, executed rather than described.
 *
 * `public/sw.js` is the only file in this repository that runs in a browser process we do not control,
 * on a device we have never seen, potentially weeks after it was installed. It also handles a payload
 * that arrived over a push channel — attacker-influenced in principle — and turns it into something the
 * operating system will display and a thumb will tap. That is worth testing as code, not as prose.
 *
 * These tests run the shipped file's handlers against stubbed browser globals. The stubs stand in for
 * `self`, `clients` and `registration`; the logic under test is the file itself, read from disk, so a
 * change to it that breaks a path fails here rather than on somebody's phone.
 */

type ShownNotification = { title: string; body: string; tag: string; data?: { url: string } };
type Harness = {
  listeners: Record<string, (event: unknown) => void>;
  shown: ShownNotification[];
  focused: unknown[];
  opened: string[];
  dispatchPush: (payload: unknown) => Promise<void>;
  click: (url: string) => Promise<void>;
};

function loadWorker(): Harness {
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: ShownNotification[] = [];
  const focused: unknown[] = [];
  const opened: string[] = [];

  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    skipWaiting: () => undefined,
    location: { origin: "http://localhost:3000" },
    clients: {
      claim: () => undefined,
      matchAll: async () => [{
        url: "http://localhost:3000/app",
        focus: async () => { focused.push("focus"); },
        navigate: async (u: string) => { focused.push(u); },
      }],
      openWindow: async (u: string) => { opened.push(u); },
    },
    registration: {
      showNotification: async (title: string, opts: Omit<ShownNotification, "title">) => {
        shown.push({ ...opts, title });
      },
    },
  };

  new Function("self", "URL", source)(self, URL);

  return {
    listeners,
    shown,
    focused,
    opened,
    async dispatchPush(payload: unknown) {
      let waited: Promise<unknown> | null = null;
      listeners.push({
        data: {
          json: () => {
            if (payload === "malformed") throw new Error("not json");
            return payload;
          },
        },
        waitUntil: (p: Promise<unknown>) => { waited = p; },
      });
      if (waited) await waited;
    },
    async click(url: string) {
      let waited: Promise<unknown> | null = null;
      listeners.notificationclick?.({
        notification: { close: () => undefined, data: { url } },
        waitUntil: (p: Promise<unknown>) => { waited = p; },
      });
      if (waited) await waited;
    },
  };
}

describe("the shipped service worker", () => {
  it("shows a valid push with its title, body and a site-relative link", async () => {
    const worker = loadWorker();
    await worker.dispatchPush({ title: "A claim expires", body: "Collect within 45 minutes.", href: "/app/offers" });
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]!.title).toBe("A claim expires");
    expect(worker.shown[0]!.body).toBe("Collect within 45 minutes.");
    expect(worker.shown[0]!.data?.url).toBe("http://localhost:3000/app/offers");
  });

  it("refuses to turn an off-origin link into a notification", async () => {
    // The payload is attacker-influenced in principle. An absolute URL here is how a notification
    // becomes a redirect somewhere else, so the worker must pin the origin and fall back.
    const worker = loadWorker();
    await worker.dispatchPush({ title: "Bad", body: "Try to leave", href: "https://evil.example/x" });
    expect(worker.shown[0]!.data?.url).toBe("http://localhost:3000/app");
    expect(worker.shown[0]!.data?.url).not.toContain("evil.example");
  });

  it("still shows something when the payload cannot be parsed", async () => {
    // Completing a push event without calling showNotification makes some browsers display a generic
    // "updated in the background" message, which tells a person nothing and looks broken.
    const worker = loadWorker();
    await worker.dispatchPush("malformed");
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0]!.title).toBe("Annapurna Link");
    expect(worker.shown[0]!.data?.url).toBe("http://localhost:3000/app");
  });

  it("reuses an open tab on click instead of opening another", async () => {
    const worker = loadWorker();
    await worker.click("http://localhost:3000/app/offers");
    // Somebody tapping a notification wants that delivery, not another copy of the app.
    expect(worker.opened).toEqual([]);
    expect(worker.focused).toContain("http://localhost:3000/app/offers");
  });

  it("never caches. A stale page could show an offer that has already been collected", () => {
    const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    expect(source).not.toMatch(/caches\.(open|match|addAll)/);
    expect(source).not.toContain("fetch");
  });
});
