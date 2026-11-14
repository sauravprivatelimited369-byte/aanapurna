import { describe, expect, it } from "vitest";
import { DEMO_WORKSPACE, DEMO_WORKSPACE_NOTICE, demoWorkspaceProblems } from "@/domain/demo-workspace";

describe("public sample walkthrough", () => {
  it("satisfies the same record rules as real data", () => {
    expect(demoWorkspaceProblems()).toEqual([]);
  });

  it("is flagged as sample data and says so in plain words", () => {
    expect(DEMO_WORKSPACE.isDemoData).toBe(true);
    expect(DEMO_WORKSPACE_NOTICE.toLowerCase()).toContain("fictional");
    expect(DEMO_WORKSPACE.sample.caption.toLowerCase()).toContain("not an impact claim");
  });

  it("never carries a delivery code value, only its shape", () => {
    expect(DEMO_WORKSPACE.verification.maskedExample).not.toMatch(/\d/);
    const serialised = JSON.stringify(DEMO_WORKSPACE);
    expect(serialised).not.toMatch(/\bcode\s*[:=]\s*\d{4,}/i);
    expect(serialised).not.toMatch(/\botp\s*[:=]\s*\d{4,}/i);
  });

  it("keeps every sample contact on a reserved domain and no phone numbers anywhere", () => {
    for (const organization of DEMO_WORKSPACE.organizations) {
      expect(organization.contact.endsWith("@example.org")).toBe(true);
    }
    const serialised = JSON.stringify(DEMO_WORKSPACE);
    expect(serialised).not.toMatch(/\+?\d[\d\s]{8,}/);
    expect(serialised).not.toMatch(/@(?!example\.org)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("shows exactly one winning Helper and an auditable conflict for the other", () => {
    const claimed = DEMO_WORKSPACE.dispatch.candidates.filter((candidate) => candidate.result === "claimed");
    const conflicted = DEMO_WORKSPACE.dispatch.candidates.filter((candidate) => candidate.result === "conflict");
    expect(claimed).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(claimed[0].helper).not.toBe(conflicted[0].helper);
  });

  it("counts only the verified receipt, not what was listed or accepted", () => {
    expect(DEMO_WORKSPACE.receipt.verified).toBe(true);
    expect(DEMO_WORKSPACE.receipt.quantity).toBeLessThanOrEqual(DEMO_WORKSPACE.offer.acceptedQuantity);
    expect(DEMO_WORKSPACE.receipt.quantity).toBeLessThan(DEMO_WORKSPACE.listing.quantity);
    expect(DEMO_WORKSPACE.sample.verifiedPortions).toBe(DEMO_WORKSPACE.receipt.quantity);
    expect(DEMO_WORKSPACE.sample.verifiedDeliveries).toBe(1);
  });

  it("walks the custody chain in order from listing to verification", () => {
    const events = DEMO_WORKSPACE.custody.map((event) => event.event);
    expect(events[0]).toMatch(/submitted/i);
    expect(events.at(-1)).toMatch(/verified/i);
    expect(DEMO_WORKSPACE.custody.some((event) => /arrival|collect/i.test(event.event))).toBe(true);
  });

  it("detects a broken workspace rather than trusting the fixture", () => {
    const broken = {
      ...DEMO_WORKSPACE,
      offer: { ...DEMO_WORKSPACE.offer, acceptedQuantity: DEMO_WORKSPACE.listing.quantity + 1 },
      receipt: { ...DEMO_WORKSPACE.receipt, quantity: 0 },
      custody: [...DEMO_WORKSPACE.custody].reverse(),
      verification: { ...DEMO_WORKSPACE.verification, maskedExample: "482913" },
    };
    const problems = demoWorkspaceProblems(broken);
    expect(problems.some((problem) => problem.includes("cannot exceed the offered quantity"))).toBe(true);
    expect(problems.some((problem) => problem.includes("receipt quantity must be positive"))).toBe(true);
    expect(problems.some((problem) => problem.includes("ordered oldest first"))).toBe(true);
    expect(problems.some((problem) => problem.includes("verification code value"))).toBe(true);
  });
});
