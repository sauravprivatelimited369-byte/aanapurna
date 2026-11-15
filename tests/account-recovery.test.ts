import { describe, expect, it } from "vitest";
import { accountRecoverySchema } from "../src/domain/validation";
import { capturePasswordResetUrl, withPasswordResetCapture } from "../src/email/reset-link-capture";

describe("operator-assisted recovery", () => {
  it("accepts a plausible address and a substantive reason", () => {
    const parsed = accountRecoverySchema.safeParse({
      email: "  Person@Example.ORG ",
      reason: "Identity confirmed by phone with the organisation owner; the person cannot receive mail.",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.email).toBe("person@example.org");
  });

  it("rejects a short reason and smuggled fields", () => {
    expect(accountRecoverySchema.safeParse({ email: "a@b.co", reason: "too short" }).success).toBe(false);
    expect(accountRecoverySchema.safeParse({
      email: "a@b.co",
      reason: "Identity confirmed by phone with the organisation owner.",
      role: "security_admin",
    }).success).toBe(false);
    expect(accountRecoverySchema.safeParse({ email: "not-an-email", reason: "Identity confirmed by phone with the owner." }).success).toBe(false);
  });

  it("hands back the link only inside an explicit capture scope", async () => {
    const { url } = await withPasswordResetCapture(async () => {
      capturePasswordResetUrl("https://app.example.test/reset-password?token=abc");
      return "done";
    });
    expect(url).toBe("https://app.example.test/reset-password?token=abc");
  });

  it("stays inert when nothing asked to capture", async () => {
    expect(() => capturePasswordResetUrl("https://app.example.test/reset-password?token=zzz")).not.toThrow();
    const { url } = await withPasswordResetCapture(async () => "no reset requested");
    expect(url).toBeNull();
  });
});
