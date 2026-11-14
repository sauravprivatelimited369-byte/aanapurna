import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  recallClosureSchema,
  recallRequestSchema,
  sessionRevocationSchema,
} from "@/domain/validation";

describe("recall request validation", () => {
  it("rejects a reason nobody could act on", () => {
    expect(recallRequestSchema.safeParse({ reason: "bad" }).success).toBe(false);
    expect(recallRequestSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(recallRequestSchema.safeParse({ reason: "x".repeat(1001) }).success).toBe(false);
  });

  it("accepts a stated reason and trims it", () => {
    const parsed = recallRequestSchema.safeParse({ reason: "  Temperature breach during transport; do not distribute.  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe("Temperature breach during transport; do not distribute.");
  });

  it("refuses extra fields, so a browser cannot supply the initiator or the affected count", () => {
    expect(recallRequestSchema.safeParse({ reason: "Adequate reason text", initiatedBy: "someone-else" }).success).toBe(false);
    expect(recallRequestSchema.safeParse({ reason: "Adequate reason text", affectedReceiptCount: 0 }).success).toBe(false);
  });

  it("requires a closure note before a recall can be closed", () => {
    expect(recallClosureSchema.safeParse({}).success).toBe(false);
    expect(recallClosureSchema.safeParse({ closureNote: "short" }).success).toBe(false);
    expect(recallClosureSchema.safeParse({ closureNote: "Batch destroyed by the Receiver on 14 November; evidence filed." }).success).toBe(true);
  });
});

describe("password change validation", () => {
  const valid = { currentPassword: "old-password-123!", newPassword: "Fresh-Table-9081" };

  it("accepts a strong replacement and defaults to keeping other sessions", () => {
    const parsed = changePasswordSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.revokeOtherSessions).toBe(false);
  });

  it("rejects reusing the current password", () => {
    const parsed = changePasswordSchema.safeParse({ currentPassword: valid.newPassword, newPassword: valid.newPassword });
    expect(parsed.success).toBe(false);
  });

  it.each([
    ["too short", "Short-1a"],
    ["only lower case and digits", "longerpassword1234"],
    ["only lower case and symbols", "longerpassword!!!!"],
    ["a long run of one character", "Aaaaaaaa1234!"],
    ["common", "password12345!"],
  ])("rejects a weak password (%s)", (_label, newPassword) => {
    expect(changePasswordSchema.safeParse({ currentPassword: valid.currentPassword, newPassword }).success).toBe(false);
  });

  it("refuses extra fields such as a target user id", () => {
    expect(changePasswordSchema.safeParse({ ...valid, userId: "someone-else" }).success).toBe(false);
  });
});

describe("session revocation validation", () => {
  it("accepts one session id or the others scope", () => {
    expect(sessionRevocationSchema.safeParse({ sessionId: "session-abc" }).success).toBe(true);
    expect(sessionRevocationSchema.safeParse({ scope: "others" }).success).toBe(true);
  });

  it("refuses an unnamed scope or a mixed request", () => {
    expect(sessionRevocationSchema.safeParse({ scope: "all" }).success).toBe(false);
    expect(sessionRevocationSchema.safeParse({ sessionId: "a", scope: "others" }).success).toBe(false);
    expect(sessionRevocationSchema.safeParse({}).success).toBe(false);
  });
});
