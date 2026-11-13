import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildPlan,
  dependencyState,
  escapeHtml,
  formatBytes,
  isLocalHttpUrl,
  localState,
  parseConsent,
  parseInbox,
  resolveApproval,
  renderInboxHtml,
} from "../scripts/launch-support.mjs";

const scratch = mkdtempSync(join(tmpdir(), "annapurna-launch-support-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function sandbox(name: string) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  return dir;
}

describe("local launcher consent", () => {
  it("accepts only clear yes/no answers", () => {
    for (const yes of ["y", "Y", "yes", "YES", "ok", "1", " true "]) expect(parseConsent(yes)).toBe(true);
    for (const no of ["n", "N", "no", "No", "cancel", "0"]) expect(parseConsent(no)).toBe(false);
  });
  it("treats ambiguous input as unanswered so the launcher asks again", () => {
    for (const unsure of ["maybe", "later", "y/n", "😀", "y n"]) expect(parseConsent(unsure)).toBeNull();
    expect(parseConsent("   ")).toBe(false);
  });
  it("uses the shown default only for an empty answer", () => {
    expect(parseConsent("", { defaultYes: true })).toBe(true);
    expect(parseConsent("", { defaultYes: false })).toBe(false);
    expect(parseConsent("maybe", { defaultYes: true })).toBeNull();
  });
});

describe("automation approval", () => {
  it("accepts only explicit --yes/-y or ANNAPURNA_LAUNCH_APPROVED=1", () => {
    expect(resolveApproval(["--yes"], {})).toEqual({ approved: true, source: "flag" });
    expect(resolveApproval(["-y"], {})).toEqual({ approved: true, source: "flag" });
    expect(resolveApproval([], { ANNAPURNA_LAUNCH_APPROVED: "1" })).toEqual({ approved: true, source: "environment" });
  });
  it("does not treat lookalike values as approval", () => {
    for (const value of ["0", "true", "YES", "1 ", "", "yes"]) {
      expect(resolveApproval([], { ANNAPURNA_LAUNCH_APPROVED: value })).toEqual({ approved: false, source: null });
    }
    expect(resolveApproval(["yes"], {})).toEqual({ approved: false, source: null });
    expect(resolveApproval(["--y"], {})).toEqual({ approved: false, source: null });
  });
  it("prefers the visible flag when both are present", () => {
    expect(resolveApproval(["--yes"], { ANNAPURNA_LAUNCH_APPROVED: "1" }).source).toBe("flag");
  });
});

describe("local launcher inspection", () => {
  it("reports a fresh managed install when nothing exists", () => {
    expect(localState(sandbox("fresh"))).toMatchObject({ mode: "managed-fresh" });
  });
  it("reports the managed state once .env and its settings exist", () => {
    const dir = sandbox("managed");
    writeFileSync(join(dir, ".env"), "OPERATIONS_ENABLED=false\n");
    mkdirSync(join(dir, ".local-data"));
    writeFileSync(join(dir, ".local-data/managed-postgres.json"), "{}");
    expect(localState(dir).mode).toBe("managed-existing");
  });
  it("reports a user-managed .env as native so it is never replaced", () => {
    const dir = sandbox("native");
    writeFileSync(join(dir, ".env"), "OPERATIONS_ENABLED=false\n");
    expect(localState(dir).mode).toBe("native-existing");
  });
  it("never offers to create new data when the database outlives its .env", () => {
    const dir = sandbox("lost-env");
    mkdirSync(join(dir, ".local-data/postgres"), { recursive: true });
    const state = localState(dir);
    expect(state.mode).toBe("needs-attention");
    const plan = buildPlan({ dependency: { state: "current" }, local: state });
    expect(plan[0]).toMatchObject({ id: "blocked", blocking: true });
    expect(plan.some((step) => step.id === "database")).toBe(false);
  });
  it("detects missing, stale and current dependency fingerprints", () => {
    const dir = sandbox("dependencies");
    expect(dependencyState(dir).state).toBe("missing");
    mkdirSync(join(dir, "node_modules"));
    for (const name of ["next", "embedded-postgres", "pg"]) {
      mkdirSync(join(dir, "node_modules", name), { recursive: true });
      writeFileSync(join(dir, "node_modules", name, "package.json"), "{}");
    }
    expect(dependencyState(dir).state).toBe("stale");
    mkdirSync(join(dir, ".local-data"), { recursive: true });
    const lock = readFileSync(join(dir, "package-lock.json"));
    writeFileSync(join(dir, ".local-data", "dependencies.sha256"), createHash("sha256").update(lock).digest("hex"));
    expect(dependencyState(dir).state).toBe("current");
  });
  it("plans a first run as: download, create database, migrate, start and open", () => {
    const plan = buildPlan({ dependency: { state: "missing" }, local: { mode: "managed-fresh" } });
    expect(plan.map((step) => step.id)).toEqual(["dependencies", "database", "migrate", "start", "open"]);
    expect(plan[0].needsInternet).toBe(true);
  });
  it("plans a repeat run without touching the database", () => {
    const plan = buildPlan({ dependency: { state: "current" }, local: { mode: "managed-existing" } });
    expect(plan.map((step) => step.id)).toEqual(["migrate", "start", "open"]);
  });
});

describe("local launcher presentation", () => {
  it("only allows loopback http URLs for browser opening", () => {
    expect(isLocalHttpUrl("http://localhost:3000")).toBe(true);
    expect(isLocalHttpUrl("http://127.0.0.1:2527/")).toBe(true);
    for (const remote of ["https://localhost:3000", "http://example.com", "http://127.0.0.1.nip.io:3000", "javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expect(isLocalHttpUrl(remote)).toBe(false);
    }
  });
  it("formats download sizes for humans", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
    expect(formatBytes(-1)).toBe("unknown");
  });
});

describe("private test inbox page", () => {
  const message = [
    "From: Annapurna Link <no-reply@annapurna.local>",
    "Subject: Verify <script>alert(1)</script>",
    "",
    "Open http://localhost:3000/api/auth/verify?token=abc123",
  ].join("\r\n");

  it("splits the raw sink file into messages and ignores empty chunks", () => {
    const raw = `--- MESSAGE ---\r\n${message}\r\n--- MESSAGE ---\r\n${message}\r\n\r\n`;
    expect(parseInbox(raw)).toHaveLength(2);
    expect(parseInbox("")).toHaveLength(0);
    expect(parseInbox(undefined)).toHaveLength(0);
  });
  it("escapes message content instead of executing it", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const html = renderInboxHtml({ messages: [message] });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("token=abc123");
  });
  it("explains the empty state and stays script-free", () => {
    const html = renderInboxHtml({ messages: [] });
    expect(html).toContain("No messages yet");
    expect(html).not.toContain("<script");
    expect(html).toContain("Private");
  });
});
