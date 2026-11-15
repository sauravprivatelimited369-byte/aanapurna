import { describe, expect, it } from "vitest";
import { evaluateReadiness, OWNER_ACTIONS, type AttestationRecord, type ReadinessInput } from "@/domain/readiness";

const now = new Date("2026-11-15T06:00:00.000Z");

function attestation(key: string, value: Record<string, unknown>, expiresAt: string | null = null): AttestationRecord {
  return {
    key,
    label: key,
    value,
    evidenceReference: "evidence",
    recordedBy: "user-1",
    recordedAt: now.toISOString(),
    expiresAt,
  };
}

const goodEmail = { configured: true, testSink: false, localOnly: false, missingSettings: [] };
const goodScanner = { mode: "clamav", hostConfigured: true };

const fullInput: ReadinessInput = {
  now,
  attestations: [
    attestation("legal_entity", { entityName: "Fictional Foods", jurisdiction: "IN-OD" }),
    attestation("insurance", { policyReference: "POL-1" }, "2027-01-01T00:00:00.000Z"),
    attestation("data_protection_contact", { contactName: "A Person", contactEmail: "privacy@example.test" }),
    attestation("penetration_test", { reportReference: "PT-1", completedOn: "2026-06-01" }),
  ],
  onCallShifts: [
    { userId: "user-1", startsAt: "2026-11-15T00:00:00.000Z", endsAt: "2026-11-16T12:00:00.000Z", channel: "phone" },
  ],
  email: goodEmail,
  scanner: goodScanner,
};

function keys(input: ReadinessInput): string[] {
  return evaluateReadiness(input).missing;
}

describe("launch readiness", () => {
  it("starts incomplete with every owner requirement named", () => {
    const result = evaluateReadiness({ now, attestations: [], onCallShifts: [], email: goodEmail, scanner: goodScanner });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([
      "legal_entity",
      "insurance",
      "data_protection_contact",
      "on_call",
      "penetration_test",
    ]);
    for (const item of result.items) expect(item.ownerAction.length).toBeGreaterThan(20);
  });

  it("is complete once every storeable fact is present and current", () => {
    const result = evaluateReadiness(fullInput);
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("fails when the insurance expiry has passed, without anyone editing a document", () => {
    const lapsed = { ...fullInput, attestations: fullInput.attestations.map((item) => item.key === "insurance" ? { ...item, expiresAt: "2026-01-01T00:00:00.000Z" } : item) };
    expect(keys(lapsed)).toContain("insurance");
  });

  it("treats a policy with no expiry as unproven", () => {
    const undated = { ...fullInput, attestations: fullInput.attestations.map((item) => item.key === "insurance" ? { ...item, expiresAt: null } : item) };
    expect(keys(undated)).toContain("insurance");
  });

  it("requires a penetration test less than a year old", () => {
    const stale = { ...fullInput, attestations: fullInput.attestations.map((item) => item.key === "penetration_test" ? { ...item, value: { reportReference: "PT-1", completedOn: "2024-01-01" } } : item) };
    expect(keys(stale)).toContain("penetration_test");
  });

  it("does not count a rota entry that has already ended", () => {
    const past = { ...fullInput, onCallShifts: [{ userId: "user-1", startsAt: "2026-11-13T00:00:00.000Z", endsAt: "2026-11-14T00:00:00.000Z", channel: "phone" }] };
    expect(keys(past)).toContain("on_call");
  });

  it("does not count coverage that ends within twelve hours", () => {
    const thin = { ...fullInput, onCallShifts: [{ userId: "user-1", startsAt: "2026-11-15T00:00:00.000Z", endsAt: "2026-11-15T12:00:00.000Z", channel: "phone" }] };
    expect(keys(thin)).toContain("on_call");
  });

  it("refuses to call a capture sink or loopback mailbox delivered email", () => {
    expect(keys({ ...fullInput, email: { ...goodEmail, testSink: true } })).toContain("email_delivery");
    expect(keys({ ...fullInput, email: { ...goodEmail, localOnly: true } })).toContain("email_delivery");
    expect(keys({ ...fullInput, email: { configured: false, testSink: false, localOnly: false, missingSettings: ["SMTP_URL"] } })).toContain("email_delivery");
  });

  it("refuses to call uploads scanned without a scanner host", () => {
    expect(keys({ ...fullInput, scanner: { mode: "clamav", hostConfigured: false } })).toContain("malware_scanner");
    expect(keys({ ...fullInput, scanner: { mode: "disabled", hostConfigured: false } })).toContain("malware_scanner");
  });

  it("lets the database gate override a locally optimistic reading", () => {
    const result = evaluateReadiness({ ...fullInput, declared: { insurance: false } });
    expect(result.missing).toContain("insurance");
    const item = result.items.find((entry) => entry.key === "insurance");
    expect(item?.detail).toContain("launch gate");
  });

  it("accepts a declared gate that the stored records already satisfy", () => {
    const result = evaluateReadiness({ ...fullInput, declared: { on_call: true } });
    expect(result.missing).toEqual([]);
  });

  it("reports only names and instructions, never the stored values", () => {
    const result = evaluateReadiness({ now, attestations: [], onCallShifts: [], email: goodEmail, scanner: goodScanner });
    for (const item of result.items) {
      expect(item.detail).not.toContain("privacy@example.test");
      expect(item.detail).not.toContain("POL-");
    }
    expect(Object.keys(OWNER_ACTIONS)).toHaveLength(7);
  });
});
