import { describe, expect, it } from "vitest";
import { donationCreateSchema, helperDecisionSchema, incidentClosureSchema, incidentSchema, inspectionSchema, onboardingSchema, organizationInsuranceSchema, policyDraftSchema, serviceAreaSchema } from "@/domain/validation";
import {
  createDeliveryCode,
  decryptValue,
  encryptValue,
  hashDeliveryCode,
  newAuthSecret,
  verifyDeliveryCode,
} from "@/security/crypto";

process.env.AUTH_SECRET ??= "test-only-auth-secret-for-local-unit-tests-0123456789";
process.env.OTP_HASH_KEY = Buffer.alloc(32, 0x31).toString("base64");
process.env.OTP_ENCRYPTION_KEY = Buffer.alloc(32, 0x32).toString("base64");
process.env.EMAIL_ENCRYPTION_KEY = Buffer.alloc(32, 0x33).toString("base64");

describe("request validation", () => {
  it("requires an explicit Helper training acknowledgement and valid service-area IDs", () => {
    const rejected = onboardingSchema.safeParse({ role: "helper", trainingAcknowledged: false });
    expect(rejected.success).toBe(false);
    const accepted = onboardingSchema.safeParse({ role: "helper", trainingAcknowledged: true, serviceAreaId: null });
    expect(accepted.success).toBe(true);
  });

  it("restricts Receiver capacity to units used by donation matching", () => {
    const receiver = onboardingSchema.safeParse({
      role: "receiver",
      organizationName: "Community Kitchen",
      operatingAddress: "1 Main Road",
      cityOrDistrict: "Sambalpur",
      contactName: "R. Example",
      contactEmail: "receiver@example.test",
      receivingCapacity: 20,
      capacityUnit: "boxes",
    });
    expect(receiver.success).toBe(false);
  });

  it("validates food dates and refuses extra, unrecognised donation fields", () => {
    const now = Date.now();
    const base = {
      organizationId: "ad026225-01d9-4ef9-a00b-661af78ffdd2",
      name: "Fresh vegetables",
      category: "produce",
      foodType: "vegetarian",
      quantity: 12,
      unit: "kg",
      preparedAt: new Date(now - 30 * 60_000).toISOString(),
      bestBeforeAt: new Date(now + 4 * 60 * 60_000).toISOString(),
      pickupEarliestAt: new Date(now + 60 * 60_000).toISOString(),
      pickupLatestAt: new Date(now + 2 * 60 * 60_000).toISOString(),
      storageInstructions: "Keep chilled",
      pickupAddress: "Private pickup location",
      declarationsAccepted: true,
      allergens: ["none known"],
    };
    expect(donationCreateSchema.safeParse(base).success).toBe(true);
    expect(donationCreateSchema.safeParse({ ...base, hiddenField: "must not be accepted" }).success).toBe(false);
    expect(donationCreateSchema.safeParse({ ...base, bestBeforeAt: new Date(now - 60_000).toISOString() }).success).toBe(false);
  });

  it("requires a distinct, reasoned Helper decision and a complete, versioned policy draft", () => {
    expect(helperDecisionSchema.safeParse({ decision: "approve", reason: "   " }).success).toBe(false);
    const policy = policyDraftSchema.safeParse({
      version: "region-2026-01",
      rules: {
        allowedCategories: ["produce"],
        allowedFoodTypes: ["vegetarian"],
        minimumPickupLeadMinutes: 30,
        minimumExpiryAfterPickupMinutes: 60,
        offerResponseMinutes: 30,
        allowPartialAcceptance: false,
        requireAllergenDisclosure: true,
      },
    });
    expect(policy.success).toBe(true);
    expect(policyDraftSchema.safeParse({ version: "bad/version", rules: {} }).success).toBe(false);
  });

  it("requires a Receiver's explicit acceptance and recorded inspection observations", () => {
    const checks = { sealIntact: true, packagingIntact: true, labelMatched: true, withinWindow: true };
    expect(inspectionSchema.safeParse({ acceptanceConfirmed: true, notes: "Packaging checked", ...checks }).success).toBe(true);
    expect(inspectionSchema.safeParse({ acceptanceConfirmed: false, notes: "Packaging checked", ...checks }).success).toBe(false);
    expect(inspectionSchema.safeParse({ acceptanceConfirmed: true, notes: "  ", ...checks }).success).toBe(false);
    expect(inspectionSchema.safeParse({ acceptanceConfirmed: true, notes: "ok", ...checks, ignored: true }).success).toBe(false);
  });

  it("will not accept an inspection that skips the arrival checks", () => {
    // The question a receiver asks - was the seal intact, did the label match - cannot be answered
    // by a note alone, so the structured checks are required rather than optional.
    expect(inspectionSchema.safeParse({ acceptanceConfirmed: true, notes: "Packaging checked" }).success).toBe(false);
    expect(inspectionSchema.safeParse({
      acceptanceConfirmed: true, notes: "Checked",
      sealIntact: true, packagingIntact: true, labelMatched: true,
    }).success).toBe(false);
    // A failed check is still a recorded decision, not a validation error: the receiver may accept
    // knowingly, and that choice is what the record has to show.
    expect(inspectionSchema.safeParse({
      acceptanceConfirmed: true, notes: "Seal was broken but food looked fine",
      sealIntact: false, packagingIntact: true, labelMatched: true, withinWindow: true,
    }).success).toBe(true);
  });

  it("bounds a temperature reading to values a thermometer could plausibly show", () => {
    const base = { acceptanceConfirmed: true, notes: "Checked", sealIntact: true, packagingIntact: true, labelMatched: true, withinWindow: true };
    expect(inspectionSchema.safeParse({ ...base, temperatureC: 63.5 }).success).toBe(true);
    expect(inspectionSchema.safeParse({ ...base, temperatureC: -18 }).success).toBe(true);
    expect(inspectionSchema.safeParse({ ...base, temperatureC: 999 }).success).toBe(false);
    expect(inspectionSchema.safeParse({ ...base, temperatureC: -100 }).success).toBe(false);
    expect(inspectionSchema.safeParse({ ...base, photoSha256: "not-a-digest" }).success).toBe(false);
    expect(inspectionSchema.safeParse({ ...base, photoSha256: "a".repeat(64) }).success).toBe(true);
  });

  it("records harm only with a description of it", () => {
    const base = { incidentType: "other" as const, severity: "high" as const, description: "Reported by a receiver" };
    expect(incidentSchema.safeParse({ ...base, harmReported: true }).success).toBe(false);
    expect(incidentSchema.safeParse({ ...base, harmReported: true, harmDetails: "Two people reported pain" }).success).toBe(true);
    expect(incidentSchema.safeParse(base).data?.harmReported).toBe(false);
  });

  it("will not close an incident without saying what changed", () => {
    const base = { resolution: "Investigated with both organisations", harmReported: false };
    expect(incidentClosureSchema.safeParse(base).success).toBe(false);
    expect(incidentClosureSchema.safeParse({ ...base, correctiveAction: "Too short" }).success).toBe(false);
    expect(incidentClosureSchema.safeParse({ ...base, correctiveAction: "Cold-holding limit added to the approved policy and re-briefed" }).success).toBe(true);
    expect(incidentClosureSchema.safeParse({ ...base, correctiveAction: "Cold-holding limit added to the approved policy", harmReported: true }).success).toBe(false);
  });

  it("requires an insurance declaration to have a real, future expiry", () => {
    expect(organizationInsuranceSchema.safeParse({ insurancePolicyReference: "POL-1", insuranceExpiresOn: "2020-01-01" }).success).toBe(false);
    expect(organizationInsuranceSchema.safeParse({ insurancePolicyReference: "POL-1", insuranceExpiresOn: "2999-01-01" }).success).toBe(true);
    expect(organizationInsuranceSchema.safeParse({ insurancePolicyReference: "", insuranceExpiresOn: "2999-01-01" }).success).toBe(false);
  });

  it("requires an IANA-like timezone string and uppercase ISO country code shape", () => {
    expect(serviceAreaSchema.safeParse({ label: "Sambalpur", countryCode: "IN", timezone: "Asia/Kolkata" }).success).toBe(true);
    expect(serviceAreaSchema.safeParse({ label: "Area", countryCode: "India", timezone: "not a timezone" }).success).toBe(false);
  });
});

describe("cryptographic helpers", () => {
  it("generates six-digit codes and verifies a code only for its delivery ID", () => {
    const code = createDeliveryCode();
    expect(code).toMatch(/^\d{6}$/);
    const hash = hashDeliveryCode("delivery-1", code).toString("hex");
    expect(verifyDeliveryCode("delivery-1", code, hash)).toBe(true);
    expect(verifyDeliveryCode("delivery-2", code, hash)).toBe(false);
    expect(verifyDeliveryCode("delivery-1", "000000", "invalid")).toBe(false);
  });

  it("encrypts with an authenticated versioned envelope and rejects tampering", () => {
    const plaintext = "https://example.test/reset?token=secret-value";
    const envelope = encryptValue(plaintext, "EMAIL_ENCRYPTION_KEY");
    expect(envelope).toMatch(/^v1\./);
    expect(decryptValue(envelope, "EMAIL_ENCRYPTION_KEY")).toBe(plaintext);
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptValue(tampered, "EMAIL_ENCRYPTION_KEY")).toThrow();
  });

  it("creates a high-entropy auth secret", () => {
    expect(newAuthSecret()).toMatch(/^[A-Za-z0-9_-]{60,}$/);
  });
});
