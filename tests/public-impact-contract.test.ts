import { describe, expect, it } from "vitest";
import { PublicImpactResponseSchema } from "@/integrations/public-impact-contract";

const emptyMetrics = {
  verifiedServings: 0,
  verifiedDeliveries: 0,
  verifiedOrganizations: 0,
  activeHelpers: 0,
  verifiedGenerators: 0,
};

describe("public impact response contract", () => {
  it("accepts an explicit empty state rather than presenting sample values", () => {
    expect(PublicImpactResponseSchema.parse({ status: "empty", metrics: emptyMetrics })).toEqual({
      status: "empty",
      metrics: emptyMetrics,
    });
  });

  it("accepts only non-negative backend aggregates", () => {
    expect(PublicImpactResponseSchema.safeParse({
      status: "available",
      metrics: { ...emptyMetrics, verifiedServings: 12.5, verifiedDeliveries: 2 },
    }).success).toBe(true);
    expect(PublicImpactResponseSchema.safeParse({
      status: "available",
      metrics: { ...emptyMetrics, verifiedDeliveries: -1 },
    }).success).toBe(false);
  });

  it("rejects an empty or available status that contradicts the actual totals", () => {
    expect(PublicImpactResponseSchema.safeParse({
      status: "empty",
      metrics: { ...emptyMetrics, verifiedOrganizations: 1 },
    }).success).toBe(false);
    expect(PublicImpactResponseSchema.safeParse({ status: "available", metrics: emptyMetrics }).success).toBe(false);
  });
});
