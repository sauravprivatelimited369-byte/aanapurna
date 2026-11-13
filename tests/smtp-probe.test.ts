import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Exercise the actual ESM script with an in-memory transport; no SMTP network or real email.
function probe(env: Record<string, string>, rejected = false) {
  const source = `
    import { runSmtpProbe } from './scripts/verify-smtp.mjs';
    let sent = 0; let closed = 0; let tls = false;
    const factory = (opts) => { tls = opts.requireTLS && opts.tls.rejectUnauthorized; return {
      verify: async () => true,
      sendMail: async () => { sent++; return { accepted: ${rejected ? "[]" : "['fictional@example.test']"}, rejected: [] }; },
      close: () => { closed++; },
    }; };
    try { const message = await runSmtpProbe(process.env, factory); console.log(JSON.stringify({sent,closed,tls,message})); }
    catch (e) { console.log(JSON.stringify({error:e.message,sent,closed,tls})); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { sent: number; closed: number; tls: boolean; error?: string; message?: string };
}
const valid = { RUN_SMTP_VERIFY: "true", SMTP_URL: "smtps://user:private-test-value@smtp.example.test:465", SMTP_FROM: "fixture@example.test" };

describe("SMTP operator probe safeguards", () => {
  it("refuses without explicit opt-in", () => {
    expect(probe({ ...valid, RUN_SMTP_VERIFY: "false" })).toMatchObject({ sent: 0, closed: 0, error: expect.stringContaining("RUN_SMTP_VERIFY") });
  });
  it("does not send by default and requires authenticated TLS", () => {
    expect(probe({ ...valid, SMTP_TEST_TO: "fixture@example.test" })).toMatchObject({ sent: 0, closed: 1, tls: true });
  });
  it("requires a single safe recipient before sending", () => {
    for (const recipient of ["", "first@example.test,second@example.test", "first@example.test\nBcc: second@example.test"]) {
      expect(probe({ ...valid, RUN_SMTP_SEND_TEST: "true", SMTP_TEST_TO: recipient })).toMatchObject({ sent: 0, error: expect.stringContaining("one operator-controlled") });
    }
  });
  it("sends only when explicitly requested and does not claim inbox delivery", () => {
    expect(probe({ ...valid, RUN_SMTP_SEND_TEST: "true", SMTP_TEST_TO: "fixture@example.test" })).toMatchObject({ sent: 1, closed: 1, tls: true, message: expect.stringContaining("does not prove delivery") });
  });
  it("treats SMTP recipient rejection as failure without leaking credentials", () => {
    const result = probe({ ...valid, RUN_SMTP_SEND_TEST: "true", SMTP_TEST_TO: "fixture@example.test" }, true);
    expect(result).toMatchObject({ sent: 1, closed: 1, error: expect.stringContaining("acceptance failed") });
    expect(result.error).not.toContain("private-test-value");
  });
});
