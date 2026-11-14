import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { withUserContext, type AppTransaction } from "@/db";
import {
  auditEvents,
  deliveryCodes,
  deliveryDestinationDetails,
  deliveryJobs,
  dataRequests,
  donationOffers,
  donationPrivateDetails,
  donations,
  helperProfiles,
  notifications,
  organizationMemberships,
  organizations,
  policyVersions,
  privateDocuments,
  receipts,
  recallRecords,
  safetyIncidents,
  serviceAreas,
  supportCases,
  userProfiles,
  custodyEvents,
} from "@/db/schema";
import { HttpError } from "@/lib/http";
import { canAccessOrganization, hasAnyRole, type Identity } from "@/lib/identity";
import {
  createDeliveryCode,
  decryptValue,
  encryptValue,
  hashDeliveryCode,
} from "@/security/crypto";
import {
  policyRulesSchema,
  type adminDecisionSchema,
  type donationCreateSchema,
  type helperDecisionSchema,
  type incidentResolutionSchema,
  type incidentSchema,
  type recallClosureSchema,
  type recallRequestSchema,
  type offerResponseSchema,
  type onboardingSchema,
  type pickupSchema,
  type policyApprovalSchema,
  type policyDraftSchema,
  type serviceAreaSchema,
  type serviceAreaUpdateSchema,
  type supportCaseCreateSchema,
  type supportCaseUpdateSchema,
  type dataRequestCreateSchema,
  type dataRequestUpdateSchema,
} from "@/domain/validation";
import { z } from "zod";

type OnboardingInput = z.infer<typeof onboardingSchema>;
type DonationInput = z.infer<typeof donationCreateSchema>;
type OfferResponse = z.infer<typeof offerResponseSchema>;
type PickupInput = z.infer<typeof pickupSchema>;
type IncidentInput = z.infer<typeof incidentSchema>;
type RecallRequest = z.infer<typeof recallRequestSchema>;
type RecallClosure = z.infer<typeof recallClosureSchema>;
type IncidentResolution = z.infer<typeof incidentResolutionSchema>;
type AdminDecision = z.infer<typeof adminDecisionSchema>;
type HelperDecision = z.infer<typeof helperDecisionSchema>;
type PolicyDraft = z.infer<typeof policyDraftSchema>;
type PolicyApproval = z.infer<typeof policyApprovalSchema>;
type ServiceAreaInput = z.infer<typeof serviceAreaSchema>;
type ServiceAreaUpdate = z.infer<typeof serviceAreaUpdateSchema>;
type SupportCaseCreate = z.infer<typeof supportCaseCreateSchema>;
type SupportCaseUpdate = z.infer<typeof supportCaseUpdateSchema>;
type DataRequestCreate = z.infer<typeof dataRequestCreateSchema>;
type DataRequestUpdate = z.infer<typeof dataRequestUpdateSchema>;

type Policy = z.infer<typeof policyRulesSchema> & { version: string };

function withDomainContext<T>(userId: string, callback: (tx: AppTransaction) => Promise<T>) {
  return withUserContext(userId, callback, { domainTransition: true });
}

function requireMember(identity: Identity, organizationId: string, roles?: string[]): void {
  if (!canAccessOrganization(identity, organizationId, roles)) {
    throw new HttpError(403, "You do not have permission to act for this organisation.", "ORGANIZATION_ACCESS_DENIED");
  }
}

function requireOperations(identity: Identity): void {
  if (!hasAnyRole(identity, ["operations_admin"])) {
    throw new HttpError(403, "Operations access is required for this action.", "OPERATIONS_ACCESS_REQUIRED");
  }
}

function assertOperationsEnabled(): void {
  if (process.env.OPERATIONS_ENABLED !== "true") {
    throw new HttpError(423, "Donation operations are paused until a human-approved operating policy and launch gate are in place.", "OPERATIONS_PAUSED");
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new HttpError(422, "Choose a recognised IANA time zone.", "TIMEZONE_INVALID");
  }
}

async function activePolicy(tx: AppTransaction): Promise<Policy> {
  const [row] = await tx.select({ version: policyVersions.version, rules: policyVersions.rules })
    .from(policyVersions)
    .where(and(
      eq(policyVersions.status, "approved"),
      lte(policyVersions.effectiveFrom, new Date()),
    ))
    .orderBy(desc(policyVersions.effectiveFrom))
    .limit(1);
  if (!row) throw new HttpError(423, "No human-approved food eligibility policy is active. Donation operations are unavailable.", "NO_ACTIVE_POLICY");
  const parsed = policyRulesSchema.safeParse(row.rules);
  if (!parsed.success) throw new HttpError(503, "The active operating policy is incomplete. Contact the safety officer.", "POLICY_INVALID");
  return { ...parsed.data, version: row.version };
}

async function audit(
  tx: AppTransaction,
  identity: Identity | null,
  action: string,
  entityType: string,
  entityId: string,
  reason?: string,
  details: Record<string, unknown> = {},
  organizationId?: string,
): Promise<void> {
  await tx.insert(auditEvents).values({
    actorUserId: identity?.id ?? null,
    action,
    entityType,
    entityId,
    reason,
    organizationId,
    details,
  });
}

async function notifyOrganization(
  tx: AppTransaction,
  organizationId: string,
  donationId: string | null,
  kind: string,
  title: string,
  body: string,
  href: string,
): Promise<void> {
  await tx.execute(sql`
    select app_notify_organization_members(
      ${organizationId}::uuid,
      ${donationId}::uuid,
      ${kind}, ${title}, ${body}, ${href}
    )
  `);
}

async function notifyUser(
  tx: AppTransaction,
  userId: string,
  organizationId: string | null,
  kind: string,
  title: string,
  body: string,
  href: string,
): Promise<void> {
  await tx.execute(sql`
    select public.app_notify_user(
      ${userId}, ${organizationId}::uuid, ${kind}, ${title}, ${body}, ${href}
    )
  `);
}

export async function getOnboarding(identity: Identity) {
  return withUserContext(identity.id, async (tx) => {
    const [profile] = await tx.select({ requestedRole: userProfiles.requestedRole, status: userProfiles.accountStatus })
      .from(userProfiles).where(eq(userProfiles.userId, identity.id)).limit(1);
    const organizationRows = await tx.select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.type,
      status: organizations.status,
      role: organizationMemberships.role,
      membershipStatus: organizationMemberships.status,
      cityOrDistrict: organizations.cityOrDistrict,
      submittedAt: organizations.updatedAt,
      reason: organizations.reviewReason,
    })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, identity.id))
      .orderBy(desc(organizations.updatedAt));
    const [helper] = await tx.select({ status: helperProfiles.status, serviceAreaId: helperProfiles.serviceAreaId })
      .from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
    const areas = await tx.select({ id: serviceAreas.id, label: serviceAreas.label })
      .from(serviceAreas).where(eq(serviceAreas.active, true)).orderBy(serviceAreas.label);
    return { profile, organizations: organizationRows, helper: helper ?? null, serviceAreas: areas };
  });
}

export async function requestOnboarding(identity: Identity, input: OnboardingInput) {
  return withDomainContext(identity.id, async (tx) => {
    if (input.serviceAreaId) {
      const [area] = await tx.select({ id: serviceAreas.id }).from(serviceAreas)
        .where(and(eq(serviceAreas.id, input.serviceAreaId), eq(serviceAreas.active, true))).limit(1);
      if (!area) throw new HttpError(422, "Choose a currently active service area.", "SERVICE_AREA_INACTIVE");
    }
    await tx.update(userProfiles)
      .set({ requestedRole: input.role, updatedAt: new Date() })
      .where(eq(userProfiles.userId, identity.id));

    if (input.role === "helper") {
      const [existingHelper] = await tx.select({ status: helperProfiles.status }).from(helperProfiles)
        .where(eq(helperProfiles.userId, identity.id)).limit(1);
      if (existingHelper && !["pending", "rejected"].includes(existingHelper.status)) {
        throw new HttpError(409, "Your Helper profile is already under review or has a current decision. Contact operations if you need to update it.", "HELPER_REQUEST_EXISTS");
      }
      await tx.insert(helperProfiles).values({
        userId: identity.id,
        serviceAreaId: input.serviceAreaId ?? null,
        availabilityNotes: input.availabilityNotes,
        trainingAcknowledgedAt: new Date(),
      }).onConflictDoUpdate({
        target: helperProfiles.userId,
        set: {
          status: "pending",
          serviceAreaId: input.serviceAreaId ?? null,
          availabilityNotes: input.availabilityNotes,
          trainingAcknowledgedAt: new Date(),
          approvedBy: null,
          approvedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          updatedAt: new Date(),
        },
      });
      await audit(tx, identity, "helper.onboarding_requested", "helper_profile", identity.id, undefined, { status: "pending" });
      return { kind: "helper", status: "pending" as const };
    }

    const type = input.role;
    const [organization] = await tx.insert(organizations).values({
      name: input.organizationName,
      type,
      status: "submitted",
      serviceAreaId: input.serviceAreaId ?? null,
      operatingAddress: input.operatingAddress,
      cityOrDistrict: input.cityOrDistrict,
      stateOrRegion: input.stateOrRegion,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactEmail: input.contactEmail.toLowerCase(),
      contactPhone: input.contactPhone,
      receivingCapacity: input.role === "receiver" ? String(input.receivingCapacity ?? 0) : null,
      capacityUnit: input.role === "receiver" ? input.capacityUnit : null,
      foodCapabilities: input.role === "receiver" ? input.foodCapabilities : [],
      createdBy: identity.id,
    }).returning({ id: organizations.id, name: organizations.name, type: organizations.type, status: organizations.status });
    if (!organization) throw new HttpError(500, "Organisation request could not be created.");

    await tx.insert(organizationMemberships).values({
      organizationId: organization.id,
      userId: identity.id,
      role: "owner",
      status: "pending",
    });
    await audit(tx, identity, "organization.onboarding_submitted", "organization", organization.id, undefined, { type, status: "submitted" }, organization.id);
    return { kind: "organization", organization };
  });
}

export async function createDonation(identity: Identity, input: DonationInput, requestId?: string) {
  assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    const [organization] = await tx.select({
      id: organizations.id,
      status: organizations.status,
      serviceAreaId: organizations.serviceAreaId,
      cityOrDistrict: organizations.cityOrDistrict,
      stateOrRegion: organizations.stateOrRegion,
    }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
    if (!organization) throw new HttpError(404, "The selected Generator organisation was not found.", "ORGANIZATION_NOT_FOUND");
    requireMember(identity, organization.id, ["owner", "manager", "operator"]);
    if (organization.status !== "verified") throw new HttpError(403, "Only a human-verified Generator can list food.", "ORGANIZATION_NOT_VERIFIED");

    const policy = await activePolicy(tx);
    const preparedAt = new Date(input.preparedAt);
    const packedAt = input.packedAt ? new Date(input.packedAt) : null;
    const bestBeforeAt = new Date(input.bestBeforeAt);
    const pickupEarliestAt = new Date(input.pickupEarliestAt);
    const pickupLatestAt = new Date(input.pickupLatestAt);
    const now = Date.now();
    if (!policy.allowedCategories.includes(input.category)) throw new HttpError(422, "This food category is not enabled by the current human-approved policy.", "CATEGORY_NOT_ALLOWED");
    if (!policy.allowedFoodTypes.includes(input.foodType)) throw new HttpError(422, "This food type is not enabled by the current operating policy.", "FOOD_TYPE_NOT_ALLOWED");
    if (pickupEarliestAt.getTime() - now < policy.minimumPickupLeadMinutes * 60_000) throw new HttpError(422, "The collection window is too soon for the active policy.", "PICKUP_LEAD_TOO_SHORT");
    if (bestBeforeAt.getTime() - pickupLatestAt.getTime() < policy.minimumExpiryAfterPickupMinutes * 60_000) throw new HttpError(422, "The declared food window does not meet the active policy.", "EXPIRY_WINDOW_TOO_SHORT");
    if (policy.requireAllergenDisclosure && input.allergens.length === 0 && !input.ingredients.trim()) {
      throw new HttpError(422, "Declare known allergens or provide an ingredients note before listing.", "ALLERGEN_DECLARATION_REQUIRED");
    }
    if (!organization.serviceAreaId) throw new HttpError(422, "A reviewed service area must be assigned before listing.", "SERVICE_AREA_REQUIRED");

    // INSERT RETURNING cannot evaluate an RLS policy that looks up the new row
    // in the same statement snapshot. Allocate the identifier before insertion.
    const donation = { id: randomUUID(), status: "offered" as const, createdAt: new Date() };
    await tx.insert(donations).values({
      id: donation.id,
      createdAt: donation.createdAt,
      generatorOrganizationId: organization.id,
      serviceAreaId: organization.serviceAreaId,
      pickupCity: organization.cityOrDistrict,
      pickupState: organization.stateOrRegion,
      createdBy: identity.id,
      name: input.name,
      category: input.category,
      foodType: input.foodType,
      description: input.description,
      quantity: String(input.quantity),
      unit: input.unit,
      ingredients: input.ingredients,
      allergens: input.allergens,
      preparedAt,
      packedAt,
      bestBeforeAt,
      pickupEarliestAt,
      pickupLatestAt,
      storageInstructions: input.storageInstructions,
      temperatureRequirement: input.temperatureRequirement,
      policyVersion: policy.version,
      status: "offered",
    });
    await tx.insert(donationPrivateDetails).values({
      donationId: donation.id,
      pickupAddress: input.pickupAddress,
      pickupInstructions: input.pickupInstructions,
    });

    const candidateResult = await tx.execute<{ id: string }>(sql`
      select id from app_find_receiver_candidates(
        ${organization.id}::uuid,
        ${organization.serviceAreaId}::uuid,
        ${input.category},
        ${String(input.quantity)}::numeric,
        ${input.unit}
      )
    `);
    const candidates = candidateResult.rows;

    const responseExpiresAt = new Date(Math.min(pickupLatestAt.getTime(), now + policy.offerResponseMinutes * 60_000));
    for (const candidate of candidates) {
      const [offer] = await tx.insert(donationOffers).values({
        donationId: donation.id,
        receiverOrganizationId: candidate.id,
        expiresAt: responseExpiresAt,
      }).onConflictDoNothing().returning({ id: donationOffers.id });
      if (!offer) continue;
      await notifyOrganization(
        tx,
        candidate.id,
        donation.id,
        "donation.offer",
        "A food offer is available",
        `${input.name} is available for review. Check the food details and your current capacity before responding.`,
        `/app/offers/${offer.id}`,
      );
    }

    await tx.insert(custodyEvents).values({
      donationId: donation.id,
      actorUserId: identity.id,
      eventType: "listing.created",
      occurredAt: new Date(),
      details: { policyVersion: policy.version, matchedReceiverCount: candidates.length },
    });
    await audit(tx, identity, "donation.created", "donation", donation.id, undefined, {
      status: "offered",
      policyVersion: policy.version,
      matchedReceiverCount: candidates.length,
      requestId,
    }, organization.id);
    return { ...donation, matchedReceiverCount: candidates.length };
  });
}

export async function listDonations(identity: Identity) {
  return withUserContext(identity.id, async (tx) => {
    const generatorIds = identity.memberships.filter((membership) => membership.organizationType === "generator").map((membership) => membership.organizationId);
    const receiverIds = identity.memberships.filter((membership) => membership.organizationType === "receiver").map((membership) => membership.organizationId);
    const scopes = [];
    if (generatorIds.length) scopes.push(inArray(donations.generatorOrganizationId, generatorIds));
    if (receiverIds.length) scopes.push(inArray(donations.receiverOrganizationId, receiverIds));
    if (!scopes.length) return [];
    return tx.select({
      id: donations.id,
      name: donations.name,
      category: donations.category,
      quantity: donations.quantity,
      unit: donations.unit,
      status: donations.status,
      preparedAt: donations.preparedAt,
      bestBeforeAt: donations.bestBeforeAt,
      pickupLatestAt: donations.pickupLatestAt,
      createdAt: donations.createdAt,
      policyVersion: donations.policyVersion,
    }).from(donations).where(or(...scopes)).orderBy(desc(donations.createdAt)).limit(100);
  });
}

export async function getDonationDetail(identity: Identity, donationId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [donation] = await tx.select().from(donations).where(eq(donations.id, donationId)).limit(1);
    if (!donation) throw new HttpError(404, "Donation not found.", "DONATION_NOT_FOUND");
    const [privateDetails] = await tx.select({
      pickupAddress: donationPrivateDetails.pickupAddress,
      pickupInstructions: donationPrivateDetails.pickupInstructions,
    }).from(donationPrivateDetails).where(eq(donationPrivateDetails.donationId, donation.id)).limit(1);
    const assignedJob = await tx.select({ helperUserId: deliveryJobs.helperUserId, id: deliveryJobs.id })
      .from(deliveryJobs).where(eq(deliveryJobs.donationId, donation.id)).limit(1);
    const authorized = canAccessOrganization(identity, donation.generatorOrganizationId, ["owner", "manager", "operator", "viewer"]) ||
      (donation.receiverOrganizationId !== null && canAccessOrganization(identity, donation.receiverOrganizationId, ["owner", "manager", "operator", "viewer"])) ||
      assignedJob[0]?.helperUserId === identity.id || hasAnyRole(identity, ["operations_admin", "safety_officer"]);
    if (!authorized) throw new HttpError(403, "You do not have access to this donation.", "DONATION_ACCESS_DENIED");
    const timeline = await tx.select({ eventType: custodyEvents.eventType, occurredAt: custodyEvents.occurredAt, details: custodyEvents.details })
      .from(custodyEvents).where(eq(custodyEvents.donationId, donation.id)).orderBy(custodyEvents.occurredAt);
    const [receipt] = await tx.select({ reference: receipts.reference, quantity: receipts.quantity, unit: receipts.unit, collectedAt: receipts.collectedAt, deliveredAt: receipts.deliveredAt })
      .from(receipts).where(eq(receipts.donationId, donation.id)).limit(1);
    const participantCanSeePickup = canAccessOrganization(identity, donation.generatorOrganizationId, ["owner", "manager", "operator"]) || assignedJob[0]?.helperUserId === identity.id ||
      (donation.receiverOrganizationId !== null && canAccessOrganization(identity, donation.receiverOrganizationId, ["owner", "manager", "operator"])) ||
      hasAnyRole(identity, ["operations_admin", "safety_officer"]);
    return {
      id: donation.id,
      name: donation.name,
      category: donation.category,
      foodType: donation.foodType,
      description: donation.description,
      quantity: donation.quantity,
      unit: donation.unit,
      ingredients: donation.ingredients,
      allergens: donation.allergens,
      preparedAt: donation.preparedAt,
      packedAt: donation.packedAt,
      bestBeforeAt: donation.bestBeforeAt,
      pickupEarliestAt: donation.pickupEarliestAt,
      pickupLatestAt: donation.pickupLatestAt,
      storageInstructions: donation.storageInstructions,
      temperatureRequirement: donation.temperatureRequirement,
      pickupAddress: participantCanSeePickup ? privateDetails?.pickupAddress ?? null : null,
      pickupInstructions: participantCanSeePickup ? privateDetails?.pickupInstructions ?? null : null,
      status: donation.status,
      policyVersion: donation.policyVersion,
      timeline,
      receipt: receipt ?? null,
    };
  });
}

export async function listOffers(identity: Identity) {
  return withUserContext(identity.id, async (tx) => {
    const receiverIds = identity.memberships.filter((membership) => membership.organizationType === "receiver").map((membership) => membership.organizationId);
    if (!receiverIds.length) return [];
    return tx.select({
      id: donationOffers.id,
      donationId: donations.id,
      name: donations.name,
      category: donations.category,
      foodType: donations.foodType,
      quantity: donations.quantity,
      unit: donations.unit,
      preparedAt: donations.preparedAt,
      bestBeforeAt: donations.bestBeforeAt,
      pickupEarliestAt: donations.pickupEarliestAt,
      pickupLatestAt: donations.pickupLatestAt,
      status: donationOffers.status,
      expiresAt: donationOffers.expiresAt,
      pickupCity: donations.pickupCity,
    }).from(donationOffers)
      .innerJoin(donations, eq(donations.id, donationOffers.donationId))
      .where(inArray(donationOffers.receiverOrganizationId, receiverIds))
      .orderBy(desc(donationOffers.createdAt)).limit(100);
  });
}

export async function getOfferDetail(identity: Identity, offerId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [offer] = await tx.select({
      id: donationOffers.id,
      donationId: donations.id,
      receiverOrganizationId: donationOffers.receiverOrganizationId,
      status: donationOffers.status,
      expiresAt: donationOffers.expiresAt,
      name: donations.name,
      category: donations.category,
      foodType: donations.foodType,
      description: donations.description,
      quantity: donations.quantity,
      unit: donations.unit,
      ingredients: donations.ingredients,
      allergens: donations.allergens,
      preparedAt: donations.preparedAt,
      packedAt: donations.packedAt,
      bestBeforeAt: donations.bestBeforeAt,
      pickupEarliestAt: donations.pickupEarliestAt,
      pickupLatestAt: donations.pickupLatestAt,
      storageInstructions: donations.storageInstructions,
      temperatureRequirement: donations.temperatureRequirement,
      donationStatus: donations.status,
      pickupCity: donations.pickupCity,
      pickupState: donations.pickupState,
    }).from(donationOffers)
      .innerJoin(donations, eq(donations.id, donationOffers.donationId))
      .where(eq(donationOffers.id, offerId)).limit(1);
    if (!offer) throw new HttpError(404, "Offer not found.", "OFFER_NOT_FOUND");
    requireMember(identity, offer.receiverOrganizationId, ["owner", "manager", "operator", "viewer"]);
    return {
      ...offer,
      isOpen: offer.status === "pending" && offer.donationStatus === "offered" && offer.expiresAt.getTime() > Date.now(),
    };
  });
}

export async function respondToOffer(identity: Identity, offerId: string, input: OfferResponse) {
  if (input.action === "accept") assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    // Every responder locks the shared donation before locking any offer. If
    // different Receivers lock their own offers first, withdrawing competing
    // offers can deadlock against a responder waiting for the donation lock.
    const [offerScope] = await tx.select({
      donationId: donationOffers.donationId,
      receiverOrganizationId: donationOffers.receiverOrganizationId,
    }).from(donationOffers).where(eq(donationOffers.id, offerId)).limit(1);
    if (!offerScope) throw new HttpError(404, "This offer is no longer available.", "OFFER_NOT_FOUND");
    requireMember(identity, offerScope.receiverOrganizationId, ["owner", "manager", "operator"]);
    const [lockedDonation] = await tx.select({ id: donations.id, status: donations.status })
      .from(donations).where(eq(donations.id, offerScope.donationId)).for("update").limit(1);
    if (!lockedDonation) throw new HttpError(404, "This offer is no longer available.", "OFFER_NOT_FOUND");
    const [offer] = await tx.select({
      id: donationOffers.id,
      donationId: donationOffers.donationId,
      receiverOrganizationId: donationOffers.receiverOrganizationId,
      offerStatus: donationOffers.status,
      expiresAt: donationOffers.expiresAt,
      quantityAccepted: donationOffers.quantityAccepted,
      donationName: donations.name,
      donationStatus: donations.status,
      donationQuantity: donations.quantity,
      donationUnit: donations.unit,
      generatorOrganizationId: donations.generatorOrganizationId,
      bestBeforeAt: donations.bestBeforeAt,
      pickupLatestAt: donations.pickupLatestAt,
    })
      .from(donationOffers)
      .innerJoin(donations, eq(donations.id, donationOffers.donationId))
      .where(eq(donationOffers.id, offerId))
      .for("update", { of: donationOffers });
    if (!offer) throw new HttpError(404, "This offer is no longer available.", "OFFER_NOT_FOUND");
    requireMember(identity, offer.receiverOrganizationId, ["owner", "manager", "operator"]);
    const [receiver] = await tx.select({ status: organizations.status })
      .from(organizations).where(eq(organizations.id, offer.receiverOrganizationId)).limit(1);
    if (receiver?.status !== "verified") throw new HttpError(403, "Only a verified Receiver can accept an offer.", "ORGANIZATION_NOT_VERIFIED");
    if (offer.offerStatus !== "pending" || offer.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "This offer has expired or already received a response.", "OFFER_CLOSED");
    if (offer.donationStatus !== "offered" || offer.bestBeforeAt.getTime() <= Date.now() || offer.pickupLatestAt.getTime() <= Date.now()) {
      throw new HttpError(409, "This food offer is no longer within its allowed collection window.", "DONATION_EXPIRED");
    }

    if (input.action === "reject") {
      await tx.update(donationOffers).set({
        status: "rejected",
        responseReason: input.reason,
        respondedBy: identity.id,
        respondedAt: new Date(),
      }).where(eq(donationOffers.id, offer.id));
      await audit(tx, identity, "offer.rejected", "donation_offer", offer.id, input.reason, { donationId: offer.donationId }, offer.receiverOrganizationId);
      await notifyOrganization(tx, offer.generatorOrganizationId, offer.donationId, "offer.rejected", "A Receiver declined an offer", `${offer.donationName} was declined. Review any further responses in your dashboard.`, `/app/listings/${offer.donationId}`);
      return { status: "rejected" as const };
    }

    const policy = await activePolicy(tx);
    const acceptedQuantity = input.quantityAccepted ?? Number(offer.donationQuantity);
    if (acceptedQuantity > Number(offer.donationQuantity)) throw new HttpError(422, "Accepted quantity cannot exceed the listed quantity.", "QUANTITY_TOO_LARGE");
    if (!policy.allowPartialAcceptance && acceptedQuantity !== Number(offer.donationQuantity)) {
      throw new HttpError(422, "The active policy does not permit partial acceptance.", "PARTIAL_ACCEPTANCE_DISABLED");
    }

    // The donation was locked before the offer; reject a reservation that lost the race.
    if (lockedDonation.status !== "offered") throw new HttpError(409, "Another Receiver has already reserved this donation.", "OFFER_ALREADY_RESERVED");

    // Allocate the ID before INSERT; the SELECT policy cannot look up an inserted
    // delivery row through a stable function during the same RETURNING statement.
    const job = { id: randomUUID() };
    await tx.insert(deliveryJobs).values({
      id: job.id,
      donationId: offer.donationId,
      offerId: offer.id,
      generatorOrganizationId: offer.generatorOrganizationId,
      receiverOrganizationId: offer.receiverOrganizationId,
      status: "open",
    });
    // Establish the Receiver's scoped access before reading private pickup details.
    // The transaction rolls this change back if any later handover step fails.
    await tx.update(donations).set({
      status: "reserved",
      receiverOrganizationId: offer.receiverOrganizationId,
      quantity: String(acceptedQuantity),
      updatedAt: new Date(),
    }).where(eq(donations.id, offer.donationId));
    const [privatePickup] = await tx.select({
      pickupAddress: donationPrivateDetails.pickupAddress,
      pickupInstructions: donationPrivateDetails.pickupInstructions,
    }).from(donationPrivateDetails).where(eq(donationPrivateDetails.donationId, offer.donationId)).limit(1);
    const [receiverPrivate] = await tx.select({
      name: organizations.name,
      address: organizations.operatingAddress,
      city: organizations.cityOrDistrict,
      contactName: organizations.contactName,
    }).from(organizations).where(eq(organizations.id, offer.receiverOrganizationId)).limit(1);
    if (!privatePickup || !receiverPrivate) throw new HttpError(409, "Required private handover details are not available.", "HANDOVER_DETAILS_MISSING");
    await tx.insert(deliveryDestinationDetails).values({
      deliveryJobId: job.id,
      receiverName: receiverPrivate.name,
      receiverAddress: receiverPrivate.address,
      receiverCity: receiverPrivate.city,
      receivingContactName: receiverPrivate.contactName,
    });
    await tx.update(donationOffers).set({
      status: "accepted",
      quantityAccepted: String(acceptedQuantity),
      respondedBy: identity.id,
      respondedAt: new Date(),
    }).where(eq(donationOffers.id, offer.id));
    await tx.update(donationOffers)
      .set({ status: "withdrawn", respondedAt: new Date(), responseReason: "Another Receiver accepted the offer." })
      .where(and(eq(donationOffers.donationId, offer.donationId), eq(donationOffers.status, "pending"), sql`${donationOffers.id} <> ${offer.id}`));
    await tx.insert(custodyEvents).values({
      donationId: offer.donationId,
      deliveryJobId: job?.id,
      actorUserId: identity.id,
      eventType: "offer.accepted",
      details: { quantity: acceptedQuantity, unit: offer.donationUnit },
    });
    await audit(tx, identity, "offer.accepted", "donation_offer", offer.id, undefined, { donationId: offer.donationId, deliveryJobId: job?.id }, offer.receiverOrganizationId);
    await notifyOrganization(tx, offer.generatorOrganizationId, offer.donationId, "offer.accepted", "A Receiver accepted your offer", `${offer.donationName} is reserved. A Helper can now claim the delivery.`, `/app/listings/${offer.donationId}`);
    return { status: "accepted" as const, deliveryJobId: job?.id };
  });
}

export async function claimDelivery(identity: Identity, jobId: string) {
  assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    const [helper] = await tx.select({ status: helperProfiles.status, serviceAreaId: helperProfiles.serviceAreaId })
      .from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
    if (!helper || helper.status !== "active") throw new HttpError(403, "Only an approved Helper can claim a delivery.", "HELPER_NOT_APPROVED");

    const [job] = await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      status: deliveryJobs.status,
      helperUserId: deliveryJobs.helperUserId,
      claimExpiresAt: deliveryJobs.claimExpiresAt,
      generatorOrganizationId: deliveryJobs.generatorOrganizationId,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      pickupLatestAt: donations.pickupLatestAt,
      donationStatus: donations.status,
      donationName: donations.name,
      serviceAreaId: donations.serviceAreaId,
    })
      .from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(eq(deliveryJobs.id, jobId))
      .for("update");
    if (!job) throw new HttpError(404, "This delivery is no longer available.", "DELIVERY_NOT_FOUND");
    if (job.status === "assigned" && job.claimExpiresAt && job.claimExpiresAt.getTime() > Date.now()) throw new HttpError(409, "Another Helper has already claimed this delivery.", "DELIVERY_CLAIMED");
    if (job.status !== "open" && !(job.status === "assigned" && job.claimExpiresAt && job.claimExpiresAt.getTime() <= Date.now())) {
      throw new HttpError(409, "This delivery is not open for assignment.", "DELIVERY_NOT_OPEN");
    }
    if (job.pickupLatestAt.getTime() <= Date.now() || !["reserved", "assigned"].includes(job.donationStatus)) {
      throw new HttpError(409, "The collection window has expired or the food is on hold.", "DONATION_NOT_CLAIMABLE");
    }
    if (!helper.serviceAreaId || helper.serviceAreaId !== job.serviceAreaId) throw new HttpError(403, "This delivery is outside your approved service area.", "SERVICE_AREA_MISMATCH");

    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + 30 * 60_000);
    const [updated] = await tx.update(deliveryJobs).set({
      status: "assigned",
      helperUserId: identity.id,
      claimedAt: now,
      claimExpiresAt,
      updatedAt: now,
    }).where(eq(deliveryJobs.id, job.id)).returning({ id: deliveryJobs.id });
    if (!updated) throw new HttpError(409, "Another Helper claimed this delivery first.", "DELIVERY_CLAIMED");
    await tx.update(donations).set({ status: "assigned", updatedAt: now }).where(eq(donations.id, job.donationId));
    await tx.insert(custodyEvents).values({
      donationId: job.donationId,
      deliveryJobId: job.id,
      actorUserId: identity.id,
      eventType: "helper.assigned",
      occurredAt: now,
      details: { claimExpiresAt: claimExpiresAt.toISOString() },
    });
    await audit(tx, identity, "delivery.claimed", "delivery_job", job.id, undefined, { claimExpiresAt: claimExpiresAt.toISOString() });
    await notifyOrganization(tx, job.generatorOrganizationId, job.donationId, "delivery.assigned", "A Helper claimed your donation", `${job.donationName} has an assigned Helper.`, `/app/deliveries/${job.id}`);
    await notifyOrganization(tx, job.receiverOrganizationId, job.donationId, "delivery.assigned", "A Helper is assigned", `${job.donationName} is assigned for collection.`, `/app/deliveries/${job.id}`);
    await notifyUser(tx, identity.id, null, "delivery.assigned", "Delivery assigned to you", `You have 30 minutes to confirm collection of ${job.donationName}.`, `/app/deliveries/${job.id}`);
    return { id: job.id, status: "assigned" as const, claimExpiresAt };
  });
}

export async function confirmPickup(identity: Identity, jobId: string, input: PickupInput) {
  assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    const [job] = await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      status: deliveryJobs.status,
      helperUserId: deliveryJobs.helperUserId,
      claimExpiresAt: deliveryJobs.claimExpiresAt,
      generatorOrganizationId: deliveryJobs.generatorOrganizationId,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      bestBeforeAt: donations.bestBeforeAt,
      pickupEarliestAt: donations.pickupEarliestAt,
      pickupLatestAt: donations.pickupLatestAt,
      quantity: donations.quantity,
      unit: donations.unit,
      name: donations.name,
    })
      .from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(eq(deliveryJobs.id, jobId))
      .for("update");
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    if (job.helperUserId !== identity.id) throw new HttpError(403, "Only the assigned Helper can confirm collection.", "HELPER_NOT_ASSIGNED");
    const [helperProfile] = await tx.select({ status: helperProfiles.status }).from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
    if (helperProfile?.status !== "active") throw new HttpError(403, "Your Helper approval is not active. Contact operations.", "HELPER_NOT_APPROVED");
    if (job.status !== "assigned") throw new HttpError(409, "This delivery is not waiting for collection.", "DELIVERY_STATE_INVALID");
    const now = new Date();
    if (job.claimExpiresAt && job.claimExpiresAt.getTime() <= now.getTime()) throw new HttpError(409, "The assignment window expired. Ask operations to reassign this delivery.", "ASSIGNMENT_EXPIRED");
    if (job.pickupEarliestAt.getTime() > now.getTime()) throw new HttpError(409, "The agreed collection window has not opened yet. Contact operations if timing must change.", "PICKUP_WINDOW_NOT_OPEN");
    if (job.pickupLatestAt.getTime() <= now.getTime() || job.bestBeforeAt.getTime() <= now.getTime()) throw new HttpError(409, "The listed food window has expired. Do not collect it; contact operations.", "DONATION_EXPIRED");

    const code = createDeliveryCode();
    const codeExpiresAt = new Date(Math.min(job.bestBeforeAt.getTime(), now.getTime() + 2 * 60 * 60_000));
    await tx.update(deliveryJobs).set({ status: "collected", collectedAt: now, collectionCondition: input.condition, updatedAt: now }).where(eq(deliveryJobs.id, job.id));
    await tx.update(donations).set({ status: "collected", updatedAt: now }).where(eq(donations.id, job.donationId));
    await tx.insert(deliveryCodes).values({
      deliveryJobId: job.id,
      codeHash: hashDeliveryCode(job.id, code).toString("hex"),
      encryptedCode: encryptValue(code, "OTP_ENCRYPTION_KEY"),
      encryptionKeyVersion: "v1",
      expiresAt: codeExpiresAt,
    });
    await tx.insert(custodyEvents).values({
      donationId: job.donationId,
      deliveryJobId: job.id,
      actorUserId: identity.id,
      eventType: "food.collected",
      occurredAt: now,
      details: { condition: input.condition, verificationExpiresAt: codeExpiresAt.toISOString() },
    });
    await audit(tx, identity, "delivery.collected", "delivery_job", job.id, undefined, { condition: input.condition, verificationExpiresAt: codeExpiresAt.toISOString() });
    await notifyOrganization(tx, job.receiverOrganizationId, job.donationId, "delivery.collected", "Food has been collected", `${job.name} is on the way. Share the verification code only with the assigned Helper after physical arrival and your acceptance checks.`, `/app/deliveries/${job.id}`);
    await notifyOrganization(tx, job.generatorOrganizationId, job.donationId, "delivery.collected", "Your donation has been collected", `${job.name} is on the way to its Receiver.`, `/app/deliveries/${job.id}`);
    return { status: "collected" as const, collectedAt: now };
  });
}

/** The assigned Helper reports physical arrival; this is a declaration, not location proof. */
export async function confirmDeliveryArrival(identity: Identity, jobId: string) {
  assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    const [job] = await tx.select({ id: deliveryJobs.id, donationId: deliveryJobs.donationId,
      status: deliveryJobs.status, helperUserId: deliveryJobs.helperUserId, arrivedAt: deliveryJobs.arrivedAt,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId, bestBeforeAt: donations.bestBeforeAt,
      name: donations.name }).from(deliveryJobs).innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(eq(deliveryJobs.id, jobId)).for("update");
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    if (job.helperUserId !== identity.id) throw new HttpError(403, "Only the assigned Helper can report arrival.", "HELPER_NOT_ASSIGNED");
    const [helper] = await tx.select({ status: helperProfiles.status }).from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
    if (helper?.status !== "active") throw new HttpError(403, "Your Helper approval is not active.", "HELPER_NOT_APPROVED");
    if (job.status !== "collected") throw new HttpError(409, "Arrival can only be recorded for food in transit.", "DELIVERY_STATE_INVALID");
    if (job.arrivedAt) return { arrivedAt: job.arrivedAt };
    if (job.bestBeforeAt.getTime() <= Date.now()) throw new HttpError(409, "The food has expired. Do not hand it over; contact operations.", "DONATION_EXPIRED");
    const arrivedAt = new Date();
    await tx.update(deliveryJobs).set({ arrivedAt, arrivalReportedBy: identity.id, updatedAt: arrivedAt }).where(eq(deliveryJobs.id, job.id));
    await tx.insert(custodyEvents).values({ donationId: job.donationId, deliveryJobId: job.id, actorUserId: identity.id,
      eventType: "delivery.arrival_reported", occurredAt: arrivedAt, details: {} });
    await audit(tx, identity, "delivery.arrival_reported", "delivery_job", job.id);
    await notifyOrganization(tx, job.receiverOrganizationId, job.donationId, "delivery.arrived", "Helper reports arrival", `${job.name} has reportedly arrived. Check the handover and record your decision.`, `/app/deliveries/${job.id}`);
    return { arrivedAt };
  });
}

/** The Receiver declares its own checks and acceptance; the platform does not certify the food. */
export async function confirmDeliveryInspection(identity: Identity, jobId: string, input: { acceptanceConfirmed: true; notes: string }) {
  assertOperationsEnabled();
  const notes = input.notes.trim();
  if (input.acceptanceConfirmed !== true || !notes || notes.length > 500) throw new HttpError(422, "Confirm acceptance and record your inspection observations.", "INSPECTION_INVALID");
  return withDomainContext(identity.id, async (tx) => {
    const [job] = await tx.select({ id: deliveryJobs.id, donationId: deliveryJobs.donationId,
      status: deliveryJobs.status, receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      arrivedAt: deliveryJobs.arrivedAt, inspectionConfirmedAt: deliveryJobs.inspectionConfirmedAt,
      inspectionNotes: deliveryJobs.inspectionNotes, bestBeforeAt: donations.bestBeforeAt, name: donations.name }).from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId)).where(eq(deliveryJobs.id, jobId)).for("update");
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    requireMember(identity, job.receiverOrganizationId, ["owner", "manager", "operator"]);
    const [receiver] = await tx.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, job.receiverOrganizationId)).limit(1);
    if (receiver?.status !== "verified") throw new HttpError(403, "The receiving organisation is not currently verified.", "ORGANIZATION_NOT_VERIFIED");
    if (job.status !== "collected" || !job.arrivedAt) throw new HttpError(409, "The assigned Helper must report arrival first.", "ARRIVAL_NOT_RECORDED");
    if (job.inspectionConfirmedAt) {
      if (job.inspectionNotes !== notes) throw new HttpError(409, "These acceptance observations are already recorded and cannot be changed. Contact operations to add a correction.", "INSPECTION_ALREADY_RECORDED");
      return { inspectionConfirmedAt: job.inspectionConfirmedAt };
    }
    if (job.bestBeforeAt.getTime() <= Date.now()) throw new HttpError(409, "The food has expired. Do not accept it; contact operations.", "DONATION_EXPIRED");
    const inspectionConfirmedAt = new Date();
    await tx.update(deliveryJobs).set({ inspectionConfirmedAt, inspectionConfirmedBy: identity.id, inspectionNotes: notes, updatedAt: inspectionConfirmedAt }).where(eq(deliveryJobs.id, job.id));
    await tx.insert(custodyEvents).values({ donationId: job.donationId, deliveryJobId: job.id, actorUserId: identity.id,
      eventType: "receiver.inspection_confirmed", occurredAt: inspectionConfirmedAt, details: { notes } });
    await audit(tx, identity, "receiver.inspection_confirmed", "delivery_job", job.id, undefined, {}, job.receiverOrganizationId);
    return { inspectionConfirmedAt };
  });
}

export async function getReceiverDeliveryCode(identity: Identity, jobId: string): Promise<{ code: string; expiresAt: Date }> {
  assertOperationsEnabled();
  return withUserContext(identity.id, async (tx) => {
    const [job] = await tx.select({
      id: deliveryJobs.id,
      status: deliveryJobs.status,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      helperUserId: deliveryJobs.helperUserId,
      arrivedAt: deliveryJobs.arrivedAt,
      inspectionConfirmedAt: deliveryJobs.inspectionConfirmedAt,
    }).from(deliveryJobs).where(eq(deliveryJobs.id, jobId)).limit(1);
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    requireMember(identity, job.receiverOrganizationId, ["owner", "manager", "operator"]);
    if (job.status !== "collected" || !job.arrivedAt || !job.inspectionConfirmedAt) throw new HttpError(409, "The code is available only after arrival and your recorded acceptance checks.", "CODE_NOT_READY");
    const [record] = await tx.select({
      encryptedCode: deliveryCodes.encryptedCode,
      expiresAt: deliveryCodes.expiresAt,
      consumedAt: deliveryCodes.consumedAt,
      lockedAt: deliveryCodes.lockedAt,
    }).from(deliveryCodes).where(eq(deliveryCodes.deliveryJobId, job.id)).limit(1);
    if (!record || record.consumedAt || record.lockedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(410, "The verification code is no longer active. Contact operations for the audited fallback process.", "CODE_UNAVAILABLE");
    }
    return { code: decryptValue(record.encryptedCode, "OTP_ENCRYPTION_KEY"), expiresAt: record.expiresAt };
  });
}

export async function verifyDelivery(identity: Identity, jobId: string, code: string) {
  assertOperationsEnabled();
  return withDomainContext(identity.id, async (tx) => {
    const [job] = await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      status: deliveryJobs.status,
      helperUserId: deliveryJobs.helperUserId,
      generatorOrganizationId: deliveryJobs.generatorOrganizationId,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      collectedAt: deliveryJobs.collectedAt,
      arrivedAt: deliveryJobs.arrivedAt,
      inspectionConfirmedAt: deliveryJobs.inspectionConfirmedAt,
      name: donations.name,
      quantity: donations.quantity,
      unit: donations.unit,
    })
      .from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(eq(deliveryJobs.id, jobId))
      .for("update");
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    if (job.helperUserId !== identity.id) throw new HttpError(403, "Only the assigned Helper can complete this delivery.", "HELPER_NOT_ASSIGNED");
    const [helperProfile] = await tx.select({ status: helperProfiles.status }).from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
    if (helperProfile?.status !== "active") throw new HttpError(403, "Your Helper approval is not active. Contact operations.", "HELPER_NOT_APPROVED");
    if (job.status !== "collected") throw new HttpError(409, "This delivery is not ready for verification.", "DELIVERY_STATE_INVALID");
    if (!job.arrivedAt || !job.inspectionConfirmedAt) throw new HttpError(409, "Arrival and Receiver acceptance must be recorded before verification.", "INSPECTION_NOT_RECORDED");
    if (!job.collectedAt) throw new HttpError(500, "Collection history is incomplete. Do not complete delivery; contact operations.", "CUSTODY_DATA_INVALID");
    // Helpers cannot SELECT delivery_codes. This narrowly-scoped database function checks the keyed
    // candidate hash in constant time, increments attempts, and consumes a valid code atomically.
    const candidateHash = hashDeliveryCode(job.id, code).toString("hex");
    const verification = await tx.execute<{ result: string; attempts_remaining: number; locked: boolean }>(sql`
      select * from app_consume_delivery_code(${job.id}::uuid, ${candidateHash})
    `);
    const outcome = verification.rows[0];
    if (!outcome) throw new HttpError(503, "Delivery verification is temporarily unavailable.", "VERIFICATION_UNAVAILABLE");
    if (outcome.result === "invalid") {
      const attempts = 5 - Number(outcome.attempts_remaining);
      await audit(tx, identity, "delivery.verification_failed", "delivery_job", job.id, undefined, { attempts, locked: outcome.locked });
      return { verified: false as const, attemptsRemaining: Number(outcome.attempts_remaining), locked: outcome.locked };
    }
    if (outcome.result !== "verified") {
      throw new HttpError(410, "The verification code is expired, locked, or already used. Operations must use the audited fallback process.", "CODE_UNAVAILABLE");
    }

    const now = new Date();

    await tx.update(deliveryJobs).set({ status: "delivered", deliveredAt: now, updatedAt: now }).where(eq(deliveryJobs.id, job.id));
    await tx.update(donations).set({ status: "delivered", updatedAt: now }).where(eq(donations.id, job.donationId));
    const reference = `AL-${now.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [receipt] = await tx.insert(receipts).values({
      reference,
      donationId: job.donationId,
      deliveryJobId: job.id,
      generatorOrganizationId: job.generatorOrganizationId,
      receiverOrganizationId: job.receiverOrganizationId,
      helperUserId: identity.id,
      quantity: String(job.quantity),
      unit: job.unit,
      collectedAt: job.collectedAt,
      deliveredAt: now,
      verified: true,
    }).returning({ id: receipts.id, reference: receipts.reference, deliveredAt: receipts.deliveredAt });
    await tx.insert(custodyEvents).values({
      donationId: job.donationId,
      deliveryJobId: job.id,
      actorUserId: identity.id,
      eventType: "delivery.verified",
      occurredAt: now,
      details: { receiptReference: reference },
    });
    await audit(tx, identity, "delivery.verified", "delivery_job", job.id, undefined, { receiptReference: reference });
    await notifyOrganization(tx, job.generatorOrganizationId, job.donationId, "delivery.completed", "Delivery verified", `${job.name} has been received. Receipt ${reference} is available.`, `/app/deliveries/${job.id}`);
    await notifyOrganization(tx, job.receiverOrganizationId, job.donationId, "delivery.completed", "Delivery received", `${job.name} has been recorded as received. Receipt ${reference} is available.`, `/app/deliveries/${job.id}`);
    await notifyUser(tx, identity.id, null, "delivery.completed", "Delivery complete", `Receipt ${reference} has been recorded.`, `/app/deliveries/${job.id}`);
    return { verified: true as const, receipt };
  });
}

export async function listDeliveries(identity: Identity) {
  return withUserContext(identity.id, async (tx) => {
    const generatorIds = identity.memberships.filter((membership) => membership.organizationType === "generator").map((membership) => membership.organizationId);
    const receiverIds = identity.memberships.filter((membership) => membership.organizationType === "receiver").map((membership) => membership.organizationId);
    const ownScopes = [];
    if (generatorIds.length) ownScopes.push(inArray(deliveryJobs.generatorOrganizationId, generatorIds));
    if (receiverIds.length) ownScopes.push(inArray(deliveryJobs.receiverOrganizationId, receiverIds));
    if (identity.helperStatus === "active") ownScopes.push(eq(deliveryJobs.helperUserId, identity.id));
    const own = ownScopes.length ? await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      name: donations.name,
      quantity: donations.quantity,
      unit: donations.unit,
      status: deliveryJobs.status,
      collectedAt: deliveryJobs.collectedAt,
      deliveredAt: deliveryJobs.deliveredAt,
      pickupLatestAt: donations.pickupLatestAt,
      pickupCity: donations.pickupCity,
      isAssignedToMe: sql<boolean>`${deliveryJobs.helperUserId} = ${identity.id}`,
    }).from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(or(...ownScopes)).orderBy(desc(deliveryJobs.createdAt)).limit(100) : [];

    let open: typeof own = [];
    if (identity.helperStatus === "active") {
      const [profile] = await tx.select({ serviceAreaId: helperProfiles.serviceAreaId })
        .from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);
      if (profile?.serviceAreaId) {
        open = await tx.select({
          id: deliveryJobs.id,
          donationId: deliveryJobs.donationId,
          name: donations.name,
          quantity: donations.quantity,
          unit: donations.unit,
          status: deliveryJobs.status,
          collectedAt: deliveryJobs.collectedAt,
          deliveredAt: deliveryJobs.deliveredAt,
          pickupLatestAt: donations.pickupLatestAt,
          pickupCity: donations.pickupCity,
          isAssignedToMe: sql<boolean>`${deliveryJobs.helperUserId} = ${identity.id}`,
        }).from(deliveryJobs)
          .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
          .where(and(
            or(eq(deliveryJobs.status, "open"), and(eq(deliveryJobs.status, "assigned"), lte(deliveryJobs.claimExpiresAt, new Date()))),
            eq(donations.serviceAreaId, profile.serviceAreaId),
          )).orderBy(donations.pickupLatestAt).limit(100);
      }
    }
    const byId = new Map([...own, ...open].map((row) => [row.id, row]));
    return [...byId.values()].sort((left, right) => left.pickupLatestAt.getTime() - right.pickupLatestAt.getTime());
  });
}

export async function getDeliveryDetail(identity: Identity, jobId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [job] = await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      offerId: deliveryJobs.offerId,
      generatorOrganizationId: deliveryJobs.generatorOrganizationId,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      helperUserId: deliveryJobs.helperUserId,
      status: deliveryJobs.status,
      claimedAt: deliveryJobs.claimedAt,
      claimExpiresAt: deliveryJobs.claimExpiresAt,
      collectedAt: deliveryJobs.collectedAt,
      arrivedAt: deliveryJobs.arrivedAt,
      inspectionConfirmedAt: deliveryJobs.inspectionConfirmedAt,
      inspectionNotes: deliveryJobs.inspectionNotes,
      deliveredAt: deliveryJobs.deliveredAt,
      collectionCondition: deliveryJobs.collectionCondition,
      deliveryCondition: deliveryJobs.deliveryCondition,
      exceptionReason: deliveryJobs.exceptionReason,
      name: donations.name,
      category: donations.category,
      foodType: donations.foodType,
      quantity: donations.quantity,
      unit: donations.unit,
      ingredients: donations.ingredients,
      allergens: donations.allergens,
      preparedAt: donations.preparedAt,
      bestBeforeAt: donations.bestBeforeAt,
      pickupEarliestAt: donations.pickupEarliestAt,
      pickupLatestAt: donations.pickupLatestAt,
      serviceAreaId: donations.serviceAreaId,
      storageInstructions: donations.storageInstructions,
      temperatureRequirement: donations.temperatureRequirement,
      pickupAddress: donationPrivateDetails.pickupAddress,
      pickupInstructions: donationPrivateDetails.pickupInstructions,
      receiverName: deliveryDestinationDetails.receiverName,
      receiverAddress: deliveryDestinationDetails.receiverAddress,
      receiverCity: deliveryDestinationDetails.receiverCity,
      receiverContactName: deliveryDestinationDetails.receivingContactName,
      pickupCity: donations.pickupCity,
      donationStatus: donations.status,
    }).from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .leftJoin(donationPrivateDetails, eq(donationPrivateDetails.donationId, donations.id))
      .leftJoin(deliveryDestinationDetails, eq(deliveryDestinationDetails.deliveryJobId, deliveryJobs.id))
      .where(eq(deliveryJobs.id, jobId)).limit(1);
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");

    const generatorMember = canAccessOrganization(identity, job.generatorOrganizationId, ["owner", "manager", "operator", "viewer"]);
    const receiverMember = canAccessOrganization(identity, job.receiverOrganizationId, ["owner", "manager", "operator", "viewer"]);
    const receiverOperator = canAccessOrganization(identity, job.receiverOrganizationId, ["owner", "manager", "operator"]);
    const assignedHelper = job.helperUserId === identity.id;
    const [helper] = identity.helperStatus === "active" ? await tx.select({ serviceAreaId: helperProfiles.serviceAreaId })
      .from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1) : [];
    const isEligibleOpenHelper = Boolean(helper?.serviceAreaId && job.serviceAreaId === helper.serviceAreaId) &&
      (job.status === "open" || (job.status === "assigned" && job.claimExpiresAt && job.claimExpiresAt.getTime() <= Date.now()));
    const operations = hasAnyRole(identity, ["operations_admin", "safety_officer"]);
    if (!generatorMember && !receiverMember && !assignedHelper && !isEligibleOpenHelper && !operations) {
      throw new HttpError(403, "You do not have access to this delivery.", "DELIVERY_ACCESS_DENIED");
    }

    const timeline = await tx.select({ eventType: custodyEvents.eventType, occurredAt: custodyEvents.occurredAt, details: custodyEvents.details })
      .from(custodyEvents).where(eq(custodyEvents.deliveryJobId, job.id)).orderBy(custodyEvents.occurredAt);
    const [receipt] = await tx.select({ reference: receipts.reference, quantity: receipts.quantity, unit: receipts.unit, collectedAt: receipts.collectedAt, deliveredAt: receipts.deliveredAt })
      .from(receipts).where(eq(receipts.deliveryJobId, job.id)).limit(1);

    const assignedDetails = assignedHelper || generatorMember || receiverMember || operations;
    return {
      id: job.id,
      donationId: job.donationId,
      status: job.status,
      claimedAt: job.claimedAt,
      claimExpiresAt: job.claimExpiresAt,
      collectedAt: job.collectedAt,
      arrivedAt: job.arrivedAt,
      inspectionConfirmedAt: job.inspectionConfirmedAt,
      inspectionNotes: assignedDetails ? job.inspectionNotes : null,
      deliveredAt: job.deliveredAt,
      collectionCondition: job.collectionCondition,
      deliveryCondition: job.deliveryCondition,
      exceptionReason: job.exceptionReason,
      name: job.name,
      category: job.category,
      foodType: job.foodType,
      quantity: job.quantity,
      unit: job.unit,
      ingredients: assignedDetails ? job.ingredients : null,
      allergens: assignedDetails ? job.allergens : [],
      preparedAt: assignedDetails ? job.preparedAt : null,
      bestBeforeAt: job.bestBeforeAt,
      pickupEarliestAt: job.pickupEarliestAt,
      pickupLatestAt: job.pickupLatestAt,
      pickupCity: job.pickupCity,
      pickupAddress: assignedDetails ? job.pickupAddress : null,
      pickupInstructions: assignedDetails ? job.pickupInstructions : null,
      storageInstructions: assignedDetails ? job.storageInstructions : null,
      temperatureRequirement: assignedDetails ? job.temperatureRequirement : null,
      receiverName: (receiverMember || assignedHelper || generatorMember || operations) ? job.receiverName : null,
      receiverAddress: (receiverMember || assignedHelper || operations) ? job.receiverAddress : null,
      receiverCity: (receiverMember || assignedHelper || generatorMember || operations) ? job.receiverCity : null,
      receiverContactName: assignedHelper ? job.receiverContactName : null,
      timeline,
      receipt: receipt ?? null,
      isAssignedToMe: assignedHelper,
      canClaim: Boolean(process.env.OPERATIONS_ENABLED === "true" && isEligibleOpenHelper && !assignedHelper && (job.status === "open" || (job.claimExpiresAt && job.claimExpiresAt.getTime() <= Date.now()))),
      canPickup: process.env.OPERATIONS_ENABLED === "true" && assignedHelper && job.status === "assigned",
      canReportArrival: process.env.OPERATIONS_ENABLED === "true" && assignedHelper && job.status === "collected" && !job.arrivedAt,
      canConfirmInspection: process.env.OPERATIONS_ENABLED === "true" && receiverOperator && job.status === "collected" && Boolean(job.arrivedAt) && !job.inspectionConfirmedAt,
      canVerify: process.env.OPERATIONS_ENABLED === "true" && assignedHelper && job.status === "collected" && Boolean(job.inspectionConfirmedAt),
      canViewCode: process.env.OPERATIONS_ENABLED === "true" && receiverOperator && job.status === "collected" && Boolean(job.inspectionConfirmedAt),
      canReportIncident: generatorMember || receiverMember || assignedHelper || operations,
    };
  });
}

export type PrivateDocumentMetadata = {
  storageKey: string;
  originalName: string;
  declaredContentType: string;
  detectedContentType: string;
  byteSize: number;
  sha256: string;
  documentType: string;
  scanStatus: "clean" | "unscanned";
};

export async function assertDocumentUploadAccess(identity: Identity, organizationId: string): Promise<void> {
  await withUserContext(identity.id, async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, createdBy: organizations.createdBy, status: organizations.status })
      .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) throw new HttpError(404, "Organisation not found.", "ORGANIZATION_NOT_FOUND");
    const canUpload = organization.createdBy === identity.id || canAccessOrganization(identity, organizationId, ["owner", "manager", "operator"]);
    if (!canUpload || ["rejected", "suspended", "expired"].includes(organization.status)) {
      throw new HttpError(403, "You cannot upload evidence for this organisation.", "DOCUMENT_UPLOAD_FORBIDDEN");
    }
  });
}

export async function createPrivateDocumentRecord(identity: Identity, organizationId: string, document: PrivateDocumentMetadata) {
  return withDomainContext(identity.id, async (tx) => {
    const [organization] = await tx.select({ id: organizations.id, createdBy: organizations.createdBy, status: organizations.status })
      .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) throw new HttpError(404, "Organisation not found.", "ORGANIZATION_NOT_FOUND");
    const canUpload = organization.createdBy === identity.id || canAccessOrganization(identity, organizationId, ["owner", "manager", "operator"]);
    if (!canUpload || ["rejected", "suspended", "expired"].includes(organization.status)) {
      throw new HttpError(403, "You cannot upload evidence for this organisation.", "DOCUMENT_UPLOAD_FORBIDDEN");
    }
    const [saved] = await tx.insert(privateDocuments).values({
      organizationId,
      uploadedBy: identity.id,
      storageKey: document.storageKey,
      originalName: document.originalName,
      declaredContentType: document.declaredContentType,
      detectedContentType: document.detectedContentType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      documentType: document.documentType,
      scanStatus: document.scanStatus,
    }).returning({ id: privateDocuments.id, createdAt: privateDocuments.createdAt, scanStatus: privateDocuments.scanStatus });
    if (!saved) throw new HttpError(500, "The document record could not be saved.", "DOCUMENT_RECORD_FAILED");
    await audit(tx, identity, "organization.document_uploaded", "private_document", saved.id, undefined, {
      organizationId,
      documentType: document.documentType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      scanStatus: document.scanStatus,
    }, organizationId);
    return { ...saved, name: document.originalName, documentType: document.documentType, byteSize: document.byteSize };
  });
}

export async function listPrivateDocumentRecords(identity: Identity, organizationId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [organization] = await tx.select({ createdBy: organizations.createdBy }).from(organizations)
      .where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) throw new HttpError(404, "Organisation not found.", "ORGANIZATION_NOT_FOUND");
    const staff = hasAnyRole(identity, ["operations_admin", "safety_officer"]);
    const member = canAccessOrganization(identity, organizationId, ["owner", "manager", "operator"]);
    if (organization.createdBy !== identity.id && !member && !staff) {
      throw new HttpError(403, "You cannot access evidence for this organisation.", "DOCUMENT_ACCESS_FORBIDDEN");
    }
    return tx.select({
      id: privateDocuments.id,
      name: privateDocuments.originalName,
      documentType: privateDocuments.documentType,
      contentType: privateDocuments.detectedContentType,
      byteSize: privateDocuments.byteSize,
      scanStatus: privateDocuments.scanStatus,
      createdAt: privateDocuments.createdAt,
      expiresAt: privateDocuments.expiresAt,
    }).from(privateDocuments).where(eq(privateDocuments.organizationId, organizationId))
      .orderBy(desc(privateDocuments.createdAt)).limit(100);
  });
}

export async function getPrivateDocumentRecord(identity: Identity, documentId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [document] = await tx.select().from(privateDocuments).where(eq(privateDocuments.id, documentId)).limit(1);
    if (!document) throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
    const [organization] = await tx.select({ createdBy: organizations.createdBy }).from(organizations)
      .where(eq(organizations.id, document.organizationId)).limit(1);
    const canView = organization?.createdBy === identity.id ||
      canAccessOrganization(identity, document.organizationId, ["owner", "manager", "operator"]) ||
      hasAnyRole(identity, ["operations_admin", "safety_officer"]);
    if (!canView) throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
    await audit(tx, identity, "organization.document_downloaded", "private_document", document.id, undefined, {
      organizationId: document.organizationId,
      scanStatus: document.scanStatus,
    }, document.organizationId);
    return document;
  });
}

export async function reportDeliveryIncident(identity: Identity, jobId: string, input: IncidentInput) {
  return withDomainContext(identity.id, async (tx) => {
    const [job] = await tx.select({
      id: deliveryJobs.id,
      donationId: deliveryJobs.donationId,
      status: deliveryJobs.status,
      helperUserId: deliveryJobs.helperUserId,
      generatorOrganizationId: deliveryJobs.generatorOrganizationId,
      receiverOrganizationId: deliveryJobs.receiverOrganizationId,
      donationStatus: donations.status,
    }).from(deliveryJobs)
      .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
      .where(eq(deliveryJobs.id, jobId)).for("update");
    if (!job) throw new HttpError(404, "Delivery not found.", "DELIVERY_NOT_FOUND");
    const participant = job.helperUserId === identity.id ||
      canAccessOrganization(identity, job.generatorOrganizationId, ["owner", "manager", "operator"]) ||
      canAccessOrganization(identity, job.receiverOrganizationId, ["owner", "manager", "operator"]);
    if (!participant && !hasAnyRole(identity, ["safety_officer", "operations_admin"])) {
      throw new HttpError(403, "Only a delivery participant or authorised safety staff can report an incident.", "INCIDENT_ACCESS_DENIED");
    }

    const applyHold = job.status !== "delivered" && job.status !== "cancelled" && job.status !== "refused";
    const [incident] = await tx.insert(safetyIncidents).values({
      donationId: job.donationId,
      deliveryJobId: job.id,
      reportedBy: identity.id,
      incidentType: input.incidentType,
      severity: input.severity,
      description: input.description,
      status: "open",
      holdApplied: applyHold,
    }).returning({ id: safetyIncidents.id });
    if (applyHold) {
      await tx.update(donations).set({ status: "on_hold", holdReason: `Incident ${incident?.id}`, updatedAt: new Date() }).where(eq(donations.id, job.donationId));
      await tx.update(deliveryJobs).set({ status: "on_hold", exceptionReason: `Incident ${incident?.id}`, updatedAt: new Date() }).where(eq(deliveryJobs.id, job.id));
      await tx.update(deliveryCodes).set({ lockedAt: new Date() }).where(and(eq(deliveryCodes.deliveryJobId, job.id), isNull(deliveryCodes.consumedAt)));
    }
    await tx.insert(custodyEvents).values({
      donationId: job.donationId,
      deliveryJobId: job.id,
      actorUserId: identity.id,
      eventType: "safety.incident_reported",
      details: { incidentId: incident?.id, incidentType: input.incidentType, severity: input.severity, holdApplied: applyHold },
    });
    await audit(tx, identity, "safety.incident_reported", "food_safety_incident", incident?.id ?? job.id, undefined, { incidentType: input.incidentType, severity: input.severity, holdApplied: applyHold });
    await notifyOrganization(tx, job.generatorOrganizationId, job.donationId, "safety.incident", "A safety concern was reported", "Operations and the safety officer have been notified. Follow the approved hold and escalation procedure.", `/app/incidents/${incident?.id}`);
    await notifyOrganization(tx, job.receiverOrganizationId, job.donationId, "safety.incident", "A safety concern was reported", "Operations and the safety officer have been notified. Follow the approved hold and escalation procedure.", `/app/incidents/${incident?.id}`);
    return { id: incident?.id, holdApplied: applyHold };
  });
}

export async function listHelperReviews(identity: Identity) {
  requireOperations(identity);
  return withUserContext(identity.id, async (tx) => {
    const helpers = await tx.select({
      userId: helperProfiles.userId,
      displayName: userProfiles.displayName,
      status: helperProfiles.status,
      serviceAreaId: helperProfiles.serviceAreaId,
      serviceAreaLabel: serviceAreas.label,
      availabilityNotes: helperProfiles.availabilityNotes,
      trainingAcknowledgedAt: helperProfiles.trainingAcknowledgedAt,
      submittedAt: helperProfiles.createdAt,
      reviewedAt: helperProfiles.reviewedAt,
    }).from(helperProfiles)
      .innerJoin(userProfiles, eq(userProfiles.userId, helperProfiles.userId))
      .leftJoin(serviceAreas, eq(serviceAreas.id, helperProfiles.serviceAreaId))
      .where(inArray(helperProfiles.status, ["pending", "active", "suspended", "rejected"]))
      .orderBy(desc(helperProfiles.updatedAt)).limit(100);
    const areas = await tx.select({ id: serviceAreas.id, label: serviceAreas.label }).from(serviceAreas)
      .where(eq(serviceAreas.active, true)).orderBy(serviceAreas.label);
    return { helpers, serviceAreas: areas };
  });
}

export async function listServiceAreas(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Service-area access is restricted to authorised operations staff.", "SERVICE_AREA_ACCESS_REQUIRED");
  }
  return withUserContext(identity.id, (tx) => tx.select().from(serviceAreas).orderBy(serviceAreas.label));
}

export async function createServiceArea(identity: Identity, input: ServiceAreaInput) {
  requireOperations(identity);
  assertTimezone(input.timezone);
  return withDomainContext(identity.id, async (tx) => {
    const [area] = await tx.insert(serviceAreas).values({
      label: input.label,
      countryCode: input.countryCode,
      stateOrRegion: input.stateOrRegion,
      cityOrDistrict: input.cityOrDistrict,
      timezone: input.timezone,
      active: input.active,
    }).returning({
      id: serviceAreas.id,
      label: serviceAreas.label,
      countryCode: serviceAreas.countryCode,
      stateOrRegion: serviceAreas.stateOrRegion,
      cityOrDistrict: serviceAreas.cityOrDistrict,
      timezone: serviceAreas.timezone,
      active: serviceAreas.active,
    });
    if (!area) throw new HttpError(500, "The service area could not be saved.", "SERVICE_AREA_CREATE_FAILED");
    await audit(tx, identity, "service_area.created", "service_area", area.id, undefined, { active: area.active, countryCode: area.countryCode });
    return area;
  });
}

export async function updateServiceArea(identity: Identity, areaId: string, input: ServiceAreaUpdate) {
  requireOperations(identity);
  if (input.timezone) assertTimezone(input.timezone);
  return withDomainContext(identity.id, async (tx) => {
    const [existing] = await tx.select({ id: serviceAreas.id, active: serviceAreas.active, label: serviceAreas.label })
      .from(serviceAreas).where(eq(serviceAreas.id, areaId)).for("update");
    if (!existing) throw new HttpError(404, "Service area not found.", "SERVICE_AREA_NOT_FOUND");
    const [area] = await tx.update(serviceAreas).set(input).where(eq(serviceAreas.id, areaId)).returning({
      id: serviceAreas.id,
      label: serviceAreas.label,
      countryCode: serviceAreas.countryCode,
      stateOrRegion: serviceAreas.stateOrRegion,
      cityOrDistrict: serviceAreas.cityOrDistrict,
      timezone: serviceAreas.timezone,
      active: serviceAreas.active,
    });
    if (!area) throw new HttpError(500, "The service area could not be updated.", "SERVICE_AREA_UPDATE_FAILED");
    await audit(tx, identity, "service_area.updated", "service_area", area.id, undefined, {
      previousLabel: existing.label,
      previousActive: existing.active,
      label: area.label,
      active: area.active,
    });
    return area;
  });
}

export async function decideHelper(identity: Identity, helperUserId: string, input: HelperDecision) {
  requireOperations(identity);
  return withDomainContext(identity.id, async (tx) => {
    const [helper] = await tx.select({
      userId: helperProfiles.userId,
      status: helperProfiles.status,
      serviceAreaId: helperProfiles.serviceAreaId,
      approvedBy: helperProfiles.approvedBy,
      approvedAt: helperProfiles.approvedAt,
      displayName: userProfiles.displayName,
    }).from(helperProfiles)
      .innerJoin(userProfiles, eq(userProfiles.userId, helperProfiles.userId))
      .where(eq(helperProfiles.userId, helperUserId)).for("update", { of: helperProfiles });
    if (!helper) throw new HttpError(404, "Helper request not found.", "HELPER_NOT_FOUND");
    if (input.decision === "approve" && helper.status !== "pending") {
      throw new HttpError(409, "Only a pending Helper request can be approved.", "HELPER_REVIEW_CLOSED");
    }
    if (input.decision === "reject" && helper.status !== "pending") {
      throw new HttpError(409, "Only a pending Helper request can be rejected.", "HELPER_REVIEW_CLOSED");
    }
    if (input.decision === "suspend" && helper.status !== "active") {
      throw new HttpError(409, "Only an active Helper can be suspended.", "HELPER_NOT_ACTIVE");
    }
    const nextStatus = input.decision === "approve" ? "active" : input.decision === "reject" ? "rejected" : "suspended";
    const serviceAreaId = input.serviceAreaId ?? helper.serviceAreaId;
    if (input.decision === "approve") {
      if (!serviceAreaId) throw new HttpError(422, "Assign an active service area before approving a Helper.", "SERVICE_AREA_REQUIRED");
      const [area] = await tx.select({ id: serviceAreas.id }).from(serviceAreas)
        .where(and(eq(serviceAreas.id, serviceAreaId), eq(serviceAreas.active, true))).limit(1);
      if (!area) throw new HttpError(422, "Assign a currently active service area before approving a Helper.", "SERVICE_AREA_INACTIVE");
    }
    await tx.update(helperProfiles).set({
      status: nextStatus,
      serviceAreaId,
      approvedBy: input.decision === "approve" ? identity.id : helper.approvedBy,
      approvedAt: input.decision === "approve" ? new Date() : helper.approvedAt,
      reviewedBy: identity.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(helperProfiles.userId, helperUserId));
    await audit(tx, identity, `helper.${input.decision}`, "helper_profile", helperUserId, input.reason, {
      fromStatus: helper.status,
      toStatus: nextStatus,
      serviceAreaId,
    });
    await notifyUser(tx, helperUserId, null, "helper.review", `Helper request ${nextStatus.replaceAll("_", " ")}`,
      input.reason, "/app/onboarding");
    return { userId: helperUserId, status: nextStatus, serviceAreaId };
  });
}

export async function listSafetyIncidents(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Safety review access is required.", "SAFETY_ACCESS_REQUIRED");
  }
  return withUserContext(identity.id, async (tx) => tx.select({
    id: safetyIncidents.id,
    donationId: safetyIncidents.donationId,
    deliveryJobId: safetyIncidents.deliveryJobId,
    donationName: donations.name,
    incidentType: safetyIncidents.incidentType,
    severity: safetyIncidents.severity,
    description: safetyIncidents.description,
    status: safetyIncidents.status,
    holdApplied: safetyIncidents.holdApplied,
    resolution: safetyIncidents.resolution,
    createdAt: safetyIncidents.createdAt,
    closedAt: safetyIncidents.closedAt,
  }).from(safetyIncidents)
    .innerJoin(donations, eq(donations.id, safetyIncidents.donationId))
    .orderBy(desc(safetyIncidents.createdAt)).limit(100));
}

export async function resolveSafetyIncident(identity: Identity, incidentId: string, input: IncidentResolution) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Safety review access is required.", "SAFETY_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const [incident] = await tx.select({
      id: safetyIncidents.id,
      donationId: safetyIncidents.donationId,
      reportedBy: safetyIncidents.reportedBy,
      status: safetyIncidents.status,
      holdApplied: safetyIncidents.holdApplied,
    }).from(safetyIncidents).where(eq(safetyIncidents.id, incidentId)).for("update");
    if (!incident) throw new HttpError(404, "Incident not found.", "INCIDENT_NOT_FOUND");
    if (incident.status !== "open") throw new HttpError(409, "This incident has already been reviewed.", "INCIDENT_ALREADY_CLOSED");
    const now = new Date();
    await tx.update(safetyIncidents).set({
      status: "resolved",
      resolution: input.resolution,
      closedBy: identity.id,
      closedAt: now,
      updatedAt: now,
    }).where(eq(safetyIncidents.id, incident.id));
    const [donation] = await tx.select({ generatorOrganizationId: donations.generatorOrganizationId, receiverOrganizationId: donations.receiverOrganizationId, name: donations.name })
      .from(donations).where(eq(donations.id, incident.donationId)).limit(1);
    if (donation) {
      await notifyOrganization(tx, donation.generatorOrganizationId, incident.donationId, "safety.incident_resolved", "Safety incident reviewed", `${donation.name}: the incident record has been resolved. Any applied safety hold remains until a separate authorised release decision is recorded.`, "/app/admin");
      if (donation.receiverOrganizationId) await notifyOrganization(tx, donation.receiverOrganizationId, incident.donationId, "safety.incident_resolved", "Safety incident reviewed", `${donation.name}: the incident record has been resolved. Any applied safety hold remains until a separate authorised release decision is recorded.`, "/app/admin");
    }
    await notifyUser(tx, incident.reportedBy, null, "safety.incident_resolved", "Your safety report was reviewed", input.resolution, "/app/operations");
    await audit(tx, identity, "safety.incident_resolved", "food_safety_incident", incident.id, input.resolution, {
      donationId: incident.donationId,
      holdApplied: incident.holdApplied,
      holdReleased: false,
    });
    return { id: incident.id, status: "resolved" as const, holdReleased: false };
  });
}

/**
 * Recall a donation: stop it, record why, and name every receipt already issued
 * for it.
 *
 * Before this existed, a recall was a status change and an incident row, which
 * could not answer "who received food from this batch?". The record written here
 * is append-only evidence: it is closed with a note, never deleted, and the
 * affected receipt count is snapshotted so a later correction cannot rewrite what
 * the notice claimed at the time.
 */
export async function recallDonation(identity: Identity, donationId: string, input: RecallRequest) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Recall access is required.", "RECALL_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const [donation] = await tx.select({
      id: donations.id,
      name: donations.name,
      status: donations.status,
      generatorOrganizationId: donations.generatorOrganizationId,
      receiverOrganizationId: donations.receiverOrganizationId,
    }).from(donations).where(eq(donations.id, donationId)).for("update");
    if (!donation) throw new HttpError(404, "Donation not found.", "DONATION_NOT_FOUND");
    if (donation.status === "recalled") {
      throw new HttpError(409, "This donation already has an active recall.", "RECALL_ALREADY_ACTIVE");
    }
    const recallable: Array<typeof donation.status> = ["offered", "reserved", "assigned", "collected", "delivered", "expired", "on_hold"];
    if (!recallable.includes(donation.status)) {
      throw new HttpError(409, `A donation in state ${donation.status} holds no food to recall.`, "RECALL_NOT_APPLICABLE");
    }

    const affectedReceipts = await tx.select({
      reference: receipts.reference,
      quantity: receipts.quantity,
      unit: receipts.unit,
      deliveredAt: receipts.deliveredAt,
      receiverOrganizationId: receipts.receiverOrganizationId,
    }).from(receipts).where(eq(receipts.donationId, donation.id)).orderBy(receipts.deliveredAt);

    const now = new Date();
    await tx.update(donations).set({ status: "recalled", updatedAt: now }).where(eq(donations.id, donation.id));
    const [recall] = await tx.insert(recallRecords).values({
      donationId: donation.id,
      reason: input.reason,
      affectedReceiptCount: affectedReceipts.length,
      recalledStatus: donation.status,
      initiatedBy: identity.id,
      initiatedAt: now,
      updatedAt: now,
    }).returning({ id: recallRecords.id, initiatedAt: recallRecords.initiatedAt });

    await tx.insert(custodyEvents).values({
      donationId: donation.id,
      actorUserId: identity.id,
      eventType: "donation.recalled",
      occurredAt: now,
      details: {
        recallId: recall.id,
        previousStatus: donation.status,
        reason: input.reason,
        affectedReceiptCount: affectedReceipts.length,
      },
    });

    const notice = `${donation.name} has been recalled. Do not distribute any part of this batch. Reason recorded by operations: ${input.reason}`;
    await notifyOrganization(tx, donation.generatorOrganizationId, donation.id, "safety.donation_recalled", "Donation recalled", notice, "/app/listings");
    if (donation.receiverOrganizationId) {
      await notifyOrganization(tx, donation.receiverOrganizationId, donation.id, "safety.donation_recalled", "Donation recalled", notice, "/app/offers");
    }
    const jobRows = await tx.select({ helperUserId: deliveryJobs.helperUserId })
      .from(deliveryJobs).where(eq(deliveryJobs.donationId, donation.id));
    for (const job of jobRows) {
      if (!job.helperUserId) continue;
      await notifyUser(tx, job.helperUserId, null, "safety.donation_recalled", "Delivery recalled", notice, "/app/deliveries");
    }

    await audit(tx, identity, "donation.recalled", "donation", donation.id, input.reason, {
      recallId: recall.id,
      previousStatus: donation.status,
      affectedReceiptCount: affectedReceipts.length,
    });

    return {
      id: recall.id,
      donationId: donation.id,
      status: "open" as const,
      previousStatus: donation.status,
      initiatedAt: recall.initiatedAt,
      affectedReceiptCount: affectedReceipts.length,
      affectedReceipts: affectedReceipts.map((receipt) => ({
        reference: receipt.reference,
        quantity: receipt.quantity,
        unit: receipt.unit,
        deliveredAt: receipt.deliveredAt,
      })),
    };
  });
}

/**
 * Recent donations for the recall picker. Operations and safety staff need to
 * identify a batch by name and status, not by pasting a UUID they obtained
 * somewhere else.
 */
export async function listRecentDonationsForOperations(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Recall access is required.", "RECALL_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const rows = await tx.select({
      id: donations.id,
      name: donations.name,
      status: donations.status,
      category: donations.category,
      quantity: donations.quantity,
      unit: donations.unit,
      generatorOrganizationId: donations.generatorOrganizationId,
      generatedAt: donations.createdAt,
    }).from(donations).orderBy(desc(donations.createdAt)).limit(50);
    return { donations: rows };
  });
}

export async function listRecalls(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "support_agent", "safety_officer", "security_admin"])) {
    throw new HttpError(403, "Recall review access is required.", "RECALL_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const rows = await tx.select({
      id: recallRecords.id,
      donationId: recallRecords.donationId,
      donationName: donations.name,
      status: recallRecords.status,
      reason: recallRecords.reason,
      affectedReceiptCount: recallRecords.affectedReceiptCount,
      recalledStatus: recallRecords.recalledStatus,
      initiatedBy: recallRecords.initiatedBy,
      initiatedAt: recallRecords.initiatedAt,
      closedAt: recallRecords.closedAt,
      closureNote: recallRecords.closureNote,
    }).from(recallRecords)
      .innerJoin(donations, eq(donations.id, recallRecords.donationId))
      .orderBy(desc(recallRecords.initiatedAt))
      .limit(100);
    return { recalls: rows };
  });
}

/**
 * Close a recall. The donation stays in the recalled state: lifting a recall is a
 * record-keeping decision, and re-listing recalled food needs a new listing a
 * human can see and review.
 */
export async function closeRecall(identity: Identity, recallId: string, input: RecallClosure) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Recall access is required.", "RECALL_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const [recall] = await tx.select({
      id: recallRecords.id,
      donationId: recallRecords.donationId,
      status: recallRecords.status,
    }).from(recallRecords).where(eq(recallRecords.id, recallId)).for("update");
    if (!recall) throw new HttpError(404, "Recall not found.", "RECALL_NOT_FOUND");
    if (recall.status !== "open") throw new HttpError(409, "This recall is already closed.", "RECALL_ALREADY_CLOSED");
    const now = new Date();
    await tx.update(recallRecords).set({
      status: "closed",
      closedBy: identity.id,
      closedAt: now,
      closureNote: input.closureNote,
      updatedAt: now,
    }).where(eq(recallRecords.id, recall.id));
    const [donation] = await tx.select({
      name: donations.name,
      generatorOrganizationId: donations.generatorOrganizationId,
      receiverOrganizationId: donations.receiverOrganizationId,
    }).from(donations).where(eq(donations.id, recall.donationId)).limit(1);
    if (donation) {
      const notice = `${donation.name}: the recall record has been closed. The donation stays recalled and will not return to distribution on its own.`;
      await notifyOrganization(tx, donation.generatorOrganizationId, recall.donationId, "safety.recall_closed", "Recall closed", notice, "/app/listings");
      if (donation.receiverOrganizationId) {
        await notifyOrganization(tx, donation.receiverOrganizationId, recall.donationId, "safety.recall_closed", "Recall closed", notice, "/app/offers");
      }
    }
    await audit(tx, identity, "donation.recall_closed", "donation", recall.donationId, input.closureNote, { recallId: recall.id });
    return { id: recall.id, status: "closed" as const, closedAt: now };
  });
}

/**
 * Append an account-security audit event for actions handled by Better Auth
 * itself (password change, session revocation). Those routes must not write to
 * audit_events directly: keeping one append-only path means the guard trigger and
 * the shape of the record stay in a single place.
 */
export async function recordAccountSecurityEvent(
  identity: Identity,
  action: string,
  details: Record<string, unknown>,
) {
  return withDomainContext(identity.id, async (tx) => {
    await audit(tx, identity, action, "user_account", identity.id, undefined, details);
  });
}

export async function listPolicyVersions(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Policy review access is required.", "POLICY_ACCESS_REQUIRED");
  }
  return withUserContext(identity.id, async (tx) => tx.select({
    id: policyVersions.id,
    version: policyVersions.version,
    status: policyVersions.status,
    rules: policyVersions.rules,
    createdBy: policyVersions.createdBy,
    approvedBy: policyVersions.approvedBy,
    approvedAt: policyVersions.approvedAt,
    effectiveFrom: policyVersions.effectiveFrom,
    createdAt: policyVersions.createdAt,
  }).from(policyVersions).orderBy(desc(policyVersions.createdAt)).limit(100));
}

export async function createPolicyDraft(identity: Identity, input: PolicyDraft) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
    throw new HttpError(403, "Policy authoring access is required.", "POLICY_ACCESS_REQUIRED");
  }
  const rules = policyRulesSchema.safeParse(input.rules);
  if (!rules.success) throw new HttpError(422, "Policy rules are incomplete or invalid.", "POLICY_RULES_INVALID");
  return withDomainContext(identity.id, async (tx) => {
    const [existing] = await tx.select({ id: policyVersions.id }).from(policyVersions)
      .where(eq(policyVersions.version, input.version)).limit(1);
    if (existing) throw new HttpError(409, "That policy version already exists.", "POLICY_VERSION_EXISTS");
    const [policy] = await tx.insert(policyVersions).values({
      version: input.version,
      status: "draft",
      rules: rules.data,
      createdBy: identity.id,
    }).returning({ id: policyVersions.id, version: policyVersions.version, status: policyVersions.status });
    if (!policy) throw new HttpError(500, "The policy draft could not be saved.", "POLICY_DRAFT_FAILED");
    await audit(tx, identity, "food_policy.draft_created", "policy_version", policy.id, undefined, { version: policy.version });
    return policy;
  });
}

export async function approvePolicy(identity: Identity, policyId: string, input: PolicyApproval) {
  if (!hasAnyRole(identity, ["safety_officer"])) {
    throw new HttpError(403, "A separately authorised Safety Officer must approve operating policy.", "SAFETY_APPROVAL_REQUIRED");
  }
  const effectiveFrom = new Date(input.effectiveFrom);
  if (!Number.isFinite(effectiveFrom.getTime())) throw new HttpError(422, "Choose a valid policy effective time.", "POLICY_EFFECTIVE_TIME_INVALID");
  return withDomainContext(identity.id, async (tx) => {
    const [policy] = await tx.select({ id: policyVersions.id, version: policyVersions.version, status: policyVersions.status, createdBy: policyVersions.createdBy, rules: policyVersions.rules })
      .from(policyVersions).where(eq(policyVersions.id, policyId)).for("update");
    if (!policy) throw new HttpError(404, "Policy draft not found.", "POLICY_NOT_FOUND");
    if (policy.status !== "draft") throw new HttpError(409, "Only an unapproved draft can be approved.", "POLICY_NOT_DRAFT");
    if (!policy.createdBy || policy.createdBy === identity.id) throw new HttpError(403, "A Safety Officer cannot approve a policy they authored. Ask a second authorised reviewer.", "POLICY_TWO_PERSON_REVIEW_REQUIRED");
    const rules = policyRulesSchema.safeParse(policy.rules);
    if (!rules.success) throw new HttpError(422, "Policy rules are incomplete or invalid.", "POLICY_RULES_INVALID");
    const now = new Date();
    await tx.update(policyVersions).set({
      status: "approved",
      approvedBy: identity.id,
      approvedAt: now,
      effectiveFrom,
    }).where(eq(policyVersions.id, policy.id));
    await audit(tx, identity, "food_policy.approved", "policy_version", policy.id, undefined, {
      version: policy.version,
      effectiveFrom: effectiveFrom.toISOString(),
      twoPersonReview: true,
    });
    return { id: policy.id, version: policy.version, status: "approved" as const, effectiveFrom };
  });
}

export async function listOrganizationReview(identity: Identity) {
  requireOperations(identity);
  return withUserContext(identity.id, async (tx) => tx.select({
    id: organizations.id,
    name: organizations.name,
    type: organizations.type,
    status: organizations.status,
    serviceAreaId: organizations.serviceAreaId,
    serviceAreaLabel: serviceAreas.label,
    cityOrDistrict: organizations.cityOrDistrict,
    stateOrRegion: organizations.stateOrRegion,
    contactName: organizations.contactName,
    contactEmail: organizations.contactEmail,
    submittedAt: organizations.createdAt,
  }).from(organizations)
    .leftJoin(serviceAreas, eq(serviceAreas.id, organizations.serviceAreaId))
    .where(inArray(organizations.status, ["submitted", "under_review", "information_required"]))
    .orderBy(organizations.createdAt));
}

export async function decideOrganizationVerification(identity: Identity, organizationId: string, input: AdminDecision) {
  requireOperations(identity);
  return withDomainContext(identity.id, async (tx) => {
    const [organization] = await tx.select({
      id: organizations.id,
      status: organizations.status,
      name: organizations.name,
      serviceAreaId: organizations.serviceAreaId,
    }).from(organizations).where(eq(organizations.id, organizationId)).for("update");
    if (!organization) throw new HttpError(404, "Organisation not found.", "ORGANIZATION_NOT_FOUND");
    if (["verified", "rejected", "suspended", "expired"].includes(organization.status) && input.decision !== "suspend") {
      throw new HttpError(409, "This verification case is already closed. Revalidation must be recorded as a new case.", "VERIFICATION_CASE_CLOSED");
    }
    const nextStatus = {
      approve: "verified",
      request_information: "information_required",
      reject: "rejected",
      suspend: "suspended",
    }[input.decision] as "verified" | "information_required" | "rejected" | "suspended";
    const serviceAreaId = input.serviceAreaId ?? organization.serviceAreaId;
    if (input.decision === "approve" && !serviceAreaId) {
      throw new HttpError(422, "Assign an active service area before verifying this organisation.", "SERVICE_AREA_REQUIRED");
    }
    if (serviceAreaId) {
      const [area] = await tx.select({ id: serviceAreas.id }).from(serviceAreas)
        .where(and(eq(serviceAreas.id, serviceAreaId), eq(serviceAreas.active, true))).limit(1);
      if (!area) throw new HttpError(422, "Choose a currently active service area.", "SERVICE_AREA_INACTIVE");
    }
    await tx.update(organizations).set({
      status: nextStatus,
      serviceAreaId,
      reviewedBy: identity.id,
      reviewReason: input.reason,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(organizations.id, organization.id));
    if (input.decision === "approve") {
      await tx.update(organizationMemberships).set({ status: "active", updatedAt: new Date() })
        .where(and(eq(organizationMemberships.organizationId, organization.id), eq(organizationMemberships.status, "pending")));
    }
    if (input.decision === "suspend" || input.decision === "reject") {
      await tx.update(organizationMemberships).set({ status: "suspended", updatedAt: new Date() })
        .where(and(eq(organizationMemberships.organizationId, organization.id), eq(organizationMemberships.status, "active")));
    }
    await audit(tx, identity, `organization.${input.decision}`, "organization", organization.id, input.reason, { fromStatus: organization.status, toStatus: nextStatus }, organization.id);
    await notifyOrganization(tx, organization.id, null, "organization.verification", `Organisation review: ${nextStatus.replaceAll("_", " ")}`, input.reason, "/app/onboarding");
    return { id: organization.id, status: nextStatus };
  });
}

export async function getDashboard(identity: Identity) {
  return withUserContext(identity.id, async (tx) => {
    const organizationIds = identity.memberships.map((membership) => membership.organizationId);
    const generatorIds = identity.memberships.filter((membership) => membership.organizationType === "generator").map((membership) => membership.organizationId);
    const receiverIds = identity.memberships.filter((membership) => membership.organizationType === "receiver").map((membership) => membership.organizationId);
    const [profile] = await tx.select({ requestedRole: userProfiles.requestedRole })
      .from(userProfiles).where(eq(userProfiles.userId, identity.id)).limit(1);
    const [helper] = await tx.select({ status: helperProfiles.status, serviceAreaId: helperProfiles.serviceAreaId })
      .from(helperProfiles).where(eq(helperProfiles.userId, identity.id)).limit(1);

    let generatorListings: Array<Record<string, unknown>> = [];
    let receiverOffers: Array<Record<string, unknown>> = [];
    let myDeliveries: Array<Record<string, unknown>> = [];
    let openDeliveries: Array<Record<string, unknown>> = [];
    const metrics = { listings: 0, awaitingReceiver: 0, activeDeliveries: 0, verifiedDeliveries: 0 };
    if (generatorIds.length) {
      const [listingCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(donations)
        .where(inArray(donations.generatorOrganizationId, generatorIds));
      metrics.listings = listingCount?.count ?? 0;
    }
    if (receiverIds.length) {
      const [offerCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(donationOffers)
        .where(and(inArray(donationOffers.receiverOrganizationId, receiverIds), eq(donationOffers.status, "pending")));
      metrics.awaitingReceiver = offerCount?.count ?? 0;
    }
    const receiptConditions = [];
    if (generatorIds.length) receiptConditions.push(inArray(receipts.generatorOrganizationId, generatorIds));
    if (receiverIds.length) receiptConditions.push(inArray(receipts.receiverOrganizationId, receiverIds));
    if (helper?.status === "active") receiptConditions.push(eq(receipts.helperUserId, identity.id));
    if (receiptConditions.length) {
      const [receiptCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(receipts)
        .where(and(eq(receipts.verified, true), or(...receiptConditions)));
      metrics.verifiedDeliveries = receiptCount?.count ?? 0;
    }
    const activeDeliveryConditions = [];
    if (receiverIds.length) activeDeliveryConditions.push(inArray(deliveryJobs.receiverOrganizationId, receiverIds));
    if (helper?.status === "active") activeDeliveryConditions.push(eq(deliveryJobs.helperUserId, identity.id));
    if (activeDeliveryConditions.length) {
      const [activeCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(deliveryJobs)
        .where(and(inArray(deliveryJobs.status, ["open", "assigned", "collected"]), or(...activeDeliveryConditions)));
      metrics.activeDeliveries = activeCount?.count ?? 0;
    }

    if (generatorIds.length) {
      generatorListings = await tx.select({
        id: donations.id,
        name: donations.name,
        quantity: donations.quantity,
        unit: donations.unit,
        status: donations.status,
        bestBeforeAt: donations.bestBeforeAt,
        createdAt: donations.createdAt,
      }).from(donations).where(inArray(donations.generatorOrganizationId, generatorIds)).orderBy(desc(donations.createdAt)).limit(8);
    }
    if (receiverIds.length) {
      receiverOffers = await tx.select({
        id: donationOffers.id,
        donationId: donations.id,
        name: donations.name,
        category: donations.category,
        quantity: donations.quantity,
        unit: donations.unit,
        expiresAt: donationOffers.expiresAt,
        offerStatus: donationOffers.status,
      }).from(donationOffers).innerJoin(donations, eq(donations.id, donationOffers.donationId))
        .where(and(inArray(donationOffers.receiverOrganizationId, receiverIds), eq(donationOffers.status, "pending")))
        .orderBy(donationOffers.expiresAt).limit(8);
      myDeliveries = await tx.select({
        id: deliveryJobs.id,
        donationId: deliveryJobs.donationId,
        name: donations.name,
        status: deliveryJobs.status,
        collectedAt: deliveryJobs.collectedAt,
        deliveredAt: deliveryJobs.deliveredAt,
      }).from(deliveryJobs).innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
        .where(inArray(deliveryJobs.receiverOrganizationId, receiverIds))
        .orderBy(desc(deliveryJobs.createdAt)).limit(8);
    }
    if (helper?.status === "active") {
      myDeliveries = await tx.select({
        id: deliveryJobs.id,
        donationId: deliveryJobs.donationId,
        name: donations.name,
        status: deliveryJobs.status,
        collectedAt: deliveryJobs.collectedAt,
        deliveredAt: deliveryJobs.deliveredAt,
      }).from(deliveryJobs).innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
        .where(eq(deliveryJobs.helperUserId, identity.id)).orderBy(desc(deliveryJobs.createdAt)).limit(8);
      if (helper.serviceAreaId) {
        openDeliveries = await tx.select({
          id: deliveryJobs.id,
          donationId: deliveryJobs.donationId,
          name: donations.name,
          quantity: donations.quantity,
          unit: donations.unit,
          pickupLatestAt: donations.pickupLatestAt,
          status: deliveryJobs.status,
          pickupCity: donations.pickupCity,
        }).from(deliveryJobs)
          .innerJoin(donations, eq(donations.id, deliveryJobs.donationId))
          .where(and(
            or(
              eq(deliveryJobs.status, "open"),
              and(eq(deliveryJobs.status, "assigned"), lte(deliveryJobs.claimExpiresAt, new Date())),
            ),
            eq(donations.serviceAreaId, helper.serviceAreaId),
          ))
          .orderBy(donations.pickupLatestAt).limit(8);
      }
    }

    const [notificationCount] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(notifications).where(and(eq(notifications.userId, identity.id), isNull(notifications.readAt)));

    let platformMetrics: Record<string, number> | null = null;
    if (hasAnyRole(identity, ["operations_admin", "safety_officer"])) {
      const [organizationsPending] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizations)
        .where(inArray(organizations.status, ["submitted", "under_review", "information_required"]));
      const [activeDeliveries] = await tx.select({ count: sql<number>`count(*)::int` }).from(deliveryJobs)
        .where(inArray(deliveryJobs.status, ["open", "assigned", "collected"]));
      const [openIncidents] = await tx.select({ count: sql<number>`count(*)::int` }).from(safetyIncidents)
        .where(eq(safetyIncidents.status, "open"));
      platformMetrics = {
        organizationsPending: organizationsPending?.count ?? 0,
        activeDeliveries: activeDeliveries?.count ?? 0,
        openIncidents: openIncidents?.count ?? 0,
      };
    }

    return {
      profile: profile ?? null,
      helper: helper ?? null,
      organizations: identity.memberships,
      organizationCount: organizationIds.length,
      notificationCount: notificationCount?.count ?? 0,
      metrics,
      generatorListings,
      receiverOffers,
      myDeliveries,
      openDeliveries,
      platformMetrics,
      demoMode: process.env.DEMO_MODE === "true",
    };
  });
}

export async function createSupportCase(identity: Identity, input: SupportCaseCreate) {
  if (input.organizationId && !canAccessOrganization(identity, input.organizationId)) {
    throw new HttpError(403, "Choose an organisation linked to your account.", "ORGANIZATION_ACCESS_DENIED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const reference = `AL-SUP-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [supportCase] = await tx.insert(supportCases).values({
      reference,
      createdBy: identity.id,
      organizationId: input.organizationId ?? null,
      subject: input.subject,
      description: input.description,
      status: "open",
    }).returning({ id: supportCases.id, reference: supportCases.reference, status: supportCases.status, createdAt: supportCases.createdAt });
    if (!supportCase) throw new HttpError(500, "Your support request could not be saved.", "SUPPORT_CASE_CREATE_FAILED");
    await audit(tx, identity, "support.case_created", "support_case", supportCase.id, undefined, { reference: supportCase.reference }, input.organizationId ?? undefined);
    return supportCase;
  });
}

export async function listSupportCases(identity: Identity) {
  const staff = hasAnyRole(identity, ["support_agent", "operations_admin"]);
  return withUserContext(identity.id, async (tx) => {
    const rows = await tx.select({
      id: supportCases.id,
      reference: supportCases.reference,
      subject: supportCases.subject,
      description: supportCases.description,
      status: supportCases.status,
      organizationId: supportCases.organizationId,
      createdBy: supportCases.createdBy,
      createdByName: userProfiles.displayName,
      assignedTo: supportCases.assignedTo,
      createdAt: supportCases.createdAt,
      updatedAt: supportCases.updatedAt,
    }).from(supportCases)
      .leftJoin(userProfiles, eq(userProfiles.userId, supportCases.createdBy))
      .where(staff ? undefined : eq(supportCases.createdBy, identity.id))
      .orderBy(desc(supportCases.updatedAt)).limit(staff ? 100 : 30);
    return rows;
  });
}

export async function updateSupportCase(identity: Identity, caseId: string, input: SupportCaseUpdate) {
  if (!hasAnyRole(identity, ["support_agent", "operations_admin"])) {
    throw new HttpError(403, "Support staff access is required.", "SUPPORT_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const [existing] = await tx.select({
      id: supportCases.id,
      reference: supportCases.reference,
      status: supportCases.status,
      createdBy: supportCases.createdBy,
      assignedTo: supportCases.assignedTo,
    }).from(supportCases).where(eq(supportCases.id, caseId)).for("update");
    if (!existing) throw new HttpError(404, "Support case not found.", "SUPPORT_CASE_NOT_FOUND");
    const [updated] = await tx.update(supportCases).set({
      status: input.status,
      assignedTo: existing.assignedTo ?? identity.id,
      updatedAt: new Date(),
    }).where(eq(supportCases.id, caseId)).returning({ id: supportCases.id, status: supportCases.status });
    await audit(tx, identity, "support.case_updated", "support_case", existing.id, undefined, {
      reference: existing.reference,
      fromStatus: existing.status,
      toStatus: updated?.status,
    });
    await notifyUser(tx, existing.createdBy, null, "support.case_updated", `Support request ${existing.reference} updated`,
      `Your request status is now ${input.status.replaceAll("_", " ")}. Sign in to review the support workspace.`, "/app/support");
    return updated;
  });
}

export async function createDataRequest(identity: Identity, input: DataRequestCreate) {
  return withDomainContext(identity.id, async (tx) => {
    const [request] = await tx.insert(dataRequests).values({
      userId: identity.id,
      requestType: input.requestType,
      description: input.description,
      status: "submitted",
    }).returning({ id: dataRequests.id, requestType: dataRequests.requestType, status: dataRequests.status, createdAt: dataRequests.createdAt });
    if (!request) throw new HttpError(500, "Your privacy request could not be saved.", "DATA_REQUEST_CREATE_FAILED");
    await audit(tx, identity, "privacy.data_request_created", "data_request", request.id, undefined, { requestType: request.requestType });
    return request;
  });
}

export async function listDataRequests(identity: Identity) {
  const staff = hasAnyRole(identity, ["operations_admin", "security_admin", "support_agent"]);
  return withUserContext(identity.id, async (tx) => tx.select({
    id: dataRequests.id,
    userId: dataRequests.userId,
    userName: userProfiles.displayName,
    requestType: dataRequests.requestType,
    description: dataRequests.description,
    status: dataRequests.status,
    resolution: dataRequests.resolution,
    assignedTo: dataRequests.assignedTo,
    reviewedBy: dataRequests.reviewedBy,
    completedAt: dataRequests.completedAt,
    createdAt: dataRequests.createdAt,
  }).from(dataRequests)
    .leftJoin(userProfiles, eq(userProfiles.userId, dataRequests.userId))
    .where(staff ? undefined : eq(dataRequests.userId, identity.id))
    .orderBy(desc(dataRequests.createdAt)).limit(staff ? 100 : 30));
}

export async function updateDataRequest(identity: Identity, requestId: string, input: DataRequestUpdate) {
  if (!hasAnyRole(identity, ["operations_admin", "security_admin"])) {
    throw new HttpError(403, "Only authorised privacy or security staff can decide a personal-data request.", "DATA_REQUEST_ACCESS_REQUIRED");
  }
  return withDomainContext(identity.id, async (tx) => {
    const [existing] = await tx.select({
      id: dataRequests.id,
      userId: dataRequests.userId,
      status: dataRequests.status,
      requestType: dataRequests.requestType,
    }).from(dataRequests).where(eq(dataRequests.id, requestId)).for("update");
    if (!existing) throw new HttpError(404, "Privacy request not found.", "DATA_REQUEST_NOT_FOUND");
    const now = new Date();
    const completedAt = input.status === "completed" || input.status === "rejected" ? now : null;
    const [updated] = await tx.update(dataRequests).set({
      status: input.status,
      resolution: input.resolution,
      assignedTo: identity.id,
      reviewedBy: identity.id,
      completedAt,
    }).where(eq(dataRequests.id, requestId)).returning({ id: dataRequests.id, status: dataRequests.status, completedAt: dataRequests.completedAt });
    await audit(tx, identity, "privacy.data_request_updated", "data_request", existing.id, input.resolution, {
      requestType: existing.requestType,
      fromStatus: existing.status,
      toStatus: input.status,
    });
    await notifyUser(tx, existing.userId, null, "privacy.data_request_updated", "Privacy request update",
      `Your ${existing.requestType.replaceAll("_", " ")} request is ${input.status.replaceAll("_", " ")}. ${input.resolution}`,
      "/app/support");
    return updated;
  });
}

export async function listNotifications(identity: Identity) {
  return withUserContext(identity.id, async (tx) => tx.select({
    id: notifications.id,
    kind: notifications.kind,
    title: notifications.title,
    body: notifications.body,
    href: notifications.href,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  }).from(notifications).where(eq(notifications.userId, identity.id)).orderBy(desc(notifications.createdAt)).limit(50));
}

export async function markNotificationRead(identity: Identity, notificationId: string) {
  return withUserContext(identity.id, async (tx) => {
    const [row] = await tx.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, identity.id)))
      .returning({ id: notifications.id });
    if (!row) throw new HttpError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
    return row;
  });
}

export async function adminOverview(identity: Identity) {
  if (!hasAnyRole(identity, ["operations_admin", "safety_officer", "support_agent", "security_admin"])) {
    throw new HttpError(403, "You do not have access to the operations workspace.", "OPERATIONS_ACCESS_REQUIRED");
  }
  return withUserContext(identity.id, async (tx) => {
    const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(organizations)
      .where(inArray(organizations.status, ["submitted", "under_review", "information_required"]));
    const [openIncidents] = await tx.select({ count: sql<number>`count(*)::int` }).from(safetyIncidents)
      .where(eq(safetyIncidents.status, "open"));
    const [verifiedReceipts] = await tx.select({ count: sql<number>`count(*)::int` }).from(receipts)
      .where(eq(receipts.verified, true));
    const outboxResult = await tx.execute<{ pending: string; failed: string }>(sql`
      select count(*) filter (where status in ('pending', 'processing'))::text as pending,
             count(*) filter (where status = 'failed')::text as failed
      from email_outbox
    `);
    const outbox = outboxResult.rows[0];
    return {
      pendingOrganizations: pending?.count ?? 0,
      openIncidents: openIncidents?.count ?? 0,
      verifiedDeliveries: verifiedReceipts?.count ?? 0,
      emailOutbox: { pending: Number(outbox?.pending ?? 0), failed: Number(outbox?.failed ?? 0) },
    };
  });
}
