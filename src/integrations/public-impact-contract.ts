import { z } from "zod";

export const PublicImpactMetricsSchema = z.object({
  verifiedServings: z.number().finite().nonnegative(),
  verifiedDeliveries: z.number().int().nonnegative(),
  verifiedOrganizations: z.number().int().nonnegative(),
  activeHelpers: z.number().int().nonnegative(),
  verifiedGenerators: z.number().int().nonnegative(),
}).strict();

export const PublicImpactResponseSchema = z.object({
  status: z.enum(["available", "empty"]),
  metrics: PublicImpactMetricsSchema,
}).strict().superRefine((value, context) => {
  const hasActivity = Object.values(value.metrics).some((metric) => metric > 0);
  if (value.status === "available" && !hasActivity) {
    context.addIssue({ code: "custom", message: "Available impact requires at least one recorded metric." });
  }
  if (value.status === "empty" && hasActivity) {
    context.addIssue({ code: "custom", message: "An empty impact response cannot contain non-zero metrics." });
  }
});

export type PublicImpactResponse = z.infer<typeof PublicImpactResponseSchema>;
