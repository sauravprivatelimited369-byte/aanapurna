import { existsSync, readFileSync } from "node:fs";
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

type ShownNotification = { title: string; body: string; tag: string; icon?: string; data?: { url: string } };
type FakeSubscription = {
  endpoint: string;
  options?: { applicationServerKey: string | null };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
};
type Sent = { url: string; method: string; credentials: string; body: Record<string, unknown> };
type Harness = {
  listeners: Record<string, (event: unknown) => void>;
  shown: ShownNotification[];
  focused: unknown[];
  opened: string[];
  /** Requests the worker itself made to the server. */
  sent: Sent[];
  /** Subscriptions the worker asked the browser to create, by the key it asked with. */
  subscribedWith: unknown[];
  dispatchPush: (payload: unknown) => Promise<void>;
  click: (url: string) => Promise<void>;
  rotate: (event: { oldSubscription?: FakeSubscription | null; newSubscription?: FakeSubscription | null }) => Promise<void>;
};

function subscription(name: string, applicationServerKey: string | null = "server-key"): FakeSubscription {
  const endpoint = `https://push.example.test/${name}`;
  return {
    endpoint,
    options: { applicationServerKey },
    toJSON: () => ({ endpoint, keys: { p256dh: `p256dh-of-${name}`, auth: `auth-of-${name}` } }),
  };
}

function loadWorker(behaviour: { network?: "ok" | "down"; subscribe?: "ok" | "refused" } = {}): Harness {
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: ShownNotification[] = [];
  const focused: unknown[] = [];
  const opened: string[] = [];
  const sent: Sent[] = [];
  const subscribedWith: unknown[] = [];

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
      pushManager: {
        subscribe: async (options: { userVisibleOnly: boolean; applicationServerKey: unknown }) => {
          if (behaviour.subscribe === "refused") throw new Error("NotAllowedError: permission was withdrawn");
          subscribedWith.push(options);
          return subscription("made-by-the-worker");
        },
      },
    },
    fetch: async (url: string, init: { method: string; credentials: string; body: string }) => {
      if (behaviour.network === "down") throw new TypeError("Failed to fetch");
      sent.push({ url, method: init.method, credentials: init.credentials, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 201 };
    },
  };

  new Function("self", "URL", source)(self, URL);

  return {
    listeners,
    shown,
    focused,
    opened,
    sent,
    subscribedWith,
    async rotate(event) {
      let waited: Promise<unknown> | null = null;
      listeners.pushsubscriptionchange?.({ ...event, waitUntil: (p: Promise<unknown>) => { waited = p; } });
      // The handler must never reject: an unhandled rejection in `waitUntil` is logged against the
      // site by the browser and achieves nothing.
      if (waited) await waited;
    },
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

  it("shows the product's own icon, from this origin, whatever the payload says", async () => {
    const worker = loadWorker();
    await worker.dispatchPush({ title: "A claim expires", body: "Collect within 45 minutes.", href: "/app/offers", icon: "https://evil.example/tracker.png" });
    await worker.dispatchPush("malformed");
    for (const notification of worker.shown) {
      // An icon URL is fetched by the device when the notification is shown. One taken from the payload
      // would let whoever can influence a push learn when, and from where, it was looked at.
      expect(notification.icon).toBe("/icons/icon-192.png");
    }
    // And it is a file this application actually serves; a missing icon is a blank square on a lock screen.
    expect(existsSync(resolve(process.cwd(), "public/icons/icon-192.png"))).toBe(true);
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

  it("never caches, and never sits between a page and the network. A stale page could show an offer that has already been collected", () => {
    const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    expect(source).not.toMatch(/caches\s*\.\s*(open|match|addAll|keys|delete)/);
    // The worker makes one request of its own (reporting a rotated subscription). What it must never
    // do is answer a page's requests, which is what a `fetch` listener is. Checked on the worker as
    // loaded, not by searching the text for a word.
    const worker = loadWorker();
    expect(worker.listeners.fetch).toBeUndefined();
    expect(Object.keys(worker.listeners).sort()).toEqual(["activate", "install", "notificationclick", "push", "pushsubscriptionchange"]);
    expect(source).not.toMatch(/respondWith/);
  });
});

describe("a subscription the browser replaced by itself", () => {
  /**
   * Browsers may rotate a push subscription with no page open. Without this the old endpoint simply
   * stops working and notifications stop arriving, silently, until the person next happens to open
   * the Notifications page.
   */
  it("tells the server about the replacement, naming the one it replaces", async () => {
    const worker = loadWorker();
    await worker.rotate({ oldSubscription: subscription("old"), newSubscription: subscription("new") });
    expect(worker.sent).toEqual([{
      url: "/api/account/push",
      method: "POST",
      // The session cookie is how the server knows whose device this is.
      credentials: "same-origin",
      body: {
        endpoint: "https://push.example.test/new",
        keys: { p256dh: "p256dh-of-new", auth: "auth-of-new" },
        // The server registers the new one only if this one belongs to the account that is signed in.
        replaces: "https://push.example.test/old",
      },
    }]);
    expect(worker.subscribedWith).toEqual([]);
  });

  it("makes the replacement itself when the browser does not supply one, with the key the old one used", async () => {
    const worker = loadWorker();
    await worker.rotate({ oldSubscription: subscription("old", "the-application-server-key"), newSubscription: null });
    expect(worker.subscribedWith).toEqual([{ userVisibleOnly: true, applicationServerKey: "the-application-server-key" }]);
    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0]!.body).toMatchObject({
      endpoint: "https://push.example.test/made-by-the-worker",
      replaces: "https://push.example.test/old",
    });
  });

  it("does nothing when it cannot name what is being replaced", async () => {
    // With no old subscription there is nothing to show that this continues a registration somebody
    // chose to make. Turning notifications on is something a person does with a button: a background
    // event must not enrol whoever happens to be signed in on this browser.
    for (const event of [{}, { oldSubscription: null, newSubscription: subscription("new") }, { newSubscription: subscription("new") }]) {
      const worker = loadWorker();
      await worker.rotate(event);
      expect(worker.sent).toEqual([]);
      expect(worker.subscribedWith).toEqual([]);
    }
    // And with an old subscription that carries no key, there is nothing to subscribe with.
    const worker = loadWorker();
    await worker.rotate({ oldSubscription: subscription("old", null) });
    expect(worker.sent).toEqual([]);
    expect(worker.subscribedWith).toEqual([]);
  });

  it("fails quietly when the browser refuses or the network is down", async () => {
    // Nobody is looking at a screen when this runs. The page is the recovery path: it compares what the
    // browser holds with what the server has, and offers the button again when they differ.
    const refused = loadWorker({ subscribe: "refused" });
    await expect(refused.rotate({ oldSubscription: subscription("old") })).resolves.toBeUndefined();
    expect(refused.sent).toEqual([]);

    const offline = loadWorker({ network: "down" });
    await expect(offline.rotate({ oldSubscription: subscription("old"), newSubscription: subscription("new") })).resolves.toBeUndefined();
    expect(offline.shown).toEqual([]);
  });
});

describe("the site can be put on a Home Screen", () => {
  /**
   * Not for its own sake. Safari on an iPhone or iPad offers the Push API only to a site that was added
   * to the Home Screen and opens as its own app; in a tab it is absent. The Notifications page tells an
   * iPhone user to do exactly that, and the instruction is only true if the manifest makes a Home
   * Screen icon open standalone.
   */
  it("opens as its own app, which is what makes notifications available on iOS", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const value = manifest();
    expect(value.display).toBe("standalone");
    expect(value.start_url).toBe("/app");
    expect(value.scope).toBe("/");
    // The service worker is registered at the root scope; an app scoped more narrowly would not be
    // controlled by it.
    expect(value.name).toBe("Annapurna Link");
  });

  it("names icons this application actually serves", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const icons = manifest().icons ?? [];
    expect(icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512", "512x512"]);
    for (const icon of icons) {
      expect(icon.src.startsWith("/"), icon.src).toBe(true);
      expect(existsSync(resolve(process.cwd(), "public", icon.src.slice(1))), icon.src).toBe(true);
    }
    // iOS takes its Home Screen icon from here rather than from the manifest.
    expect(existsSync(resolve(process.cwd(), "src/app/apple-icon.png"))).toBe(true);
  });
});
