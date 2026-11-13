import { z } from "zod";

const safeText = (max: number) => z.string().trim().min(1).max(max);

export const onboardingSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("generator"),
    organizationName: safeText(160),
    operatingAddress: safeText(500),
    cityOrDistrict: safeText(120),
    stateOrRegion: z.string().trim().max(120).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    contactName: safeText(120),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().trim().max(32).optional().default(""),
    serviceAreaId: z.string().uuid().optional().nullable(),
  }).strict(),
  z.object({
    role: z.literal("receiver"),
    organizationName: safeText(160),
    operatingAddress: safeText(500),
    cityOrDistrict: safeText(120),
    stateOrRegion: z.string().trim().max(120).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    contactName: safeText(120),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().trim().max(32).optional().default(""),
    serviceAreaId: z.string().uuid().optional().nullable(),
    receivingCapacity: z.number().positive().max(100_000).optional(),
    capacityUnit: z.enum(["servings", "kg", "g", "litre", "portion", "box"]).optional().default("servings"),
    foodCapabilities: z.array(z.string().trim().min(1).max(64)).max(30).optional().default([]),
  }).strict(),
  z.object({
    role: z.literal("helper"),
    serviceAreaId: z.string().uuid().optional().nullable(),
    availabilityNotes: z.string().trim().max(500).optional().default(""),
    trainingAcknowledged: z.literal(true),
  }).strict(),
]);

export const donationCreateSchema = z.object({
  organizationId: z.string().uuid(),
  name: safeText(160),
  category: safeText(64),
  foodType: z.enum(["vegetarian", "non_vegetarian", "mixed", "other"]),
  description: z.string().trim().max(1_000).optional().default(""),
  quantity: z.number().positive().max(100_000),
  unit: z.enum(["servings", "kg", "g", "litre", "portion", "box"]),
  ingredients: z.string().trim().max(1_000).optional().default(""),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  preparedAt: z.string().datetime({ offset: true }),
  packedAt: z.string().datetime({ offset: true }).optional().nullable(),
  bestBeforeAt: z.string().datetime({ offset: true }),
  pickupEarliestAt: z.string().datetime({ offset: true }),
  pickupLatestAt: z.string().datetime({ offset: true }),
  storageInstructions: safeText(500),
  temperatureRequirement: z.string().trim().max(200).optional().default(""),
  pickupAddress: safeText(500),
  pickupInstructions: z.string().trim().max(500).optional().default(""),
  declarationsAccepted: z.literal(true),
}).strict().superRefine((value, context) => {
  const prepared = new Date(value.preparedAt).getTime();
  const packed = value.packedAt ? new Date(value.packedAt).getTime() : undefined;
  const bestBefore = new Date(value.bestBeforeAt).getTime();
  const earliest = new Date(value.pickupEarliestAt).getTime();
  const latest = new Date(value.pickupLatestAt).getTime();
  const now = Date.now();

  if (prepared > now) context.addIssue({ code: "custom", path: ["preparedAt"], message: "Preparation time cannot be in the future." });
  if (packed !== undefined && packed < prepared) context.addIssue({ code: "custom", path: ["packedAt"], message: "Packaging cannot be earlier than preparation." });
  if (bestBefore <= now) context.addIssue({ code: "custom", path: ["bestBeforeAt"], message: "This food's best-before time must be in the future." });
  if (earliest < now) context.addIssue({ code: "custom", path: ["pickupEarliestAt"], message: "Collection window must begin in the future." });
  if (latest <= earliest) context.addIssue({ code: "custom", path: ["pickupLatestAt"], message: "Latest collection must be after earliest collection." });
  if (bestBefore <= latest) context.addIssue({ code: "custom", path: ["bestBeforeAt"], message: "Food must remain within its declared date through the collection window." });
});

export const offerResponseSchema = z.object({
  action: z.enum(["accept", "reject"]),
  quantityAccepted: z.number().positive().max(100_000).optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "reject" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Add a brief reason for declining this offer." });
  }
});

export const pickupSchema = z.object({
  condition: safeText(500),
}).strict();

export const inspectionSchema = z.object({
  acceptanceConfirmed: z.literal(true),
  notes: safeText(500),
}).strict();

export const verifyDeliverySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const incidentSchema = z.object({
  incidentType: z.enum(["damaged_packaging", "temperature_concern", "allergen_mismatch", "quality_concern", "delay", "failed_collection", "other"]),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  description: safeText(1_000),
}).strict();

export const adminDecisionSchema = z.object({
  decision: z.enum(["approve", "request_information", "reject", "suspend"]),
  reason: safeText(500),
  serviceAreaId: z.string().uuid().optional().nullable(),
}).strict();

export const helperDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "suspend"]),
  reason: safeText(500),
  serviceAreaId: z.string().uuid().optional().nullable(),
}).strict();

export const incidentResolutionSchema = z.object({
  resolution: safeText(800),
}).strict();

export const policyRulesSchema = z.object({
  allowedCategories: z.array(z.string().trim().min(1).max(64)).min(1).max(40),
  allowedFoodTypes: z.array(z.enum(["vegetarian", "non_vegetarian", "mixed", "other"])).min(1),
  minimumPickupLeadMinutes: z.number().int().min(0).max(10_080),
  minimumExpiryAfterPickupMinutes: z.number().int().min(0).max(10_080),
  offerResponseMinutes: z.number().int().min(5).max(240),
  allowPartialAcceptance: z.boolean(),
  requireAllergenDisclosure: z.boolean(),
}).strict();

export const policyDraftSchema = z.object({
  version: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  rules: policyRulesSchema,
}).strict();

export const policyApprovalSchema = z.object({
  effectiveFrom: z.string().datetime({ offset: true }),
}).strict();

const ianaTimezone = z.string().trim().min(1).max(80).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, "Choose a recognised IANA time zone.");

export const serviceAreaSchema = z.object({
  label: safeText(120),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("IN"),
  stateOrRegion: z.string().trim().max(120).optional().default(""),
  cityOrDistrict: z.string().trim().max(120).optional().default(""),
  timezone: ianaTimezone.default("Asia/Kolkata"),
  active: z.boolean().default(false),
}).strict();

export const serviceAreaUpdateSchema = serviceAreaSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Change at least one service-area field." },
);

export const supportCaseCreateSchema = z.object({
  organizationId: z.string().uuid().optional().nullable(),
  subject: safeText(160),
  description: safeText(2_000),
}).strict();

export const supportCaseUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "awaiting_user", "resolved", "closed"]),
}).strict();

export const dataRequestCreateSchema = z.object({
  requestType: z.enum(["access", "export", "rectification", "erasure", "restriction", "objection", "other"]),
  description: z.string().trim().max(1_000).optional().default(""),
}).strict();

export const dataRequestUpdateSchema = z.object({
  status: z.enum(["in_review", "awaiting_user", "completed", "rejected"]),
  resolution: safeText(800),
}).strict();
