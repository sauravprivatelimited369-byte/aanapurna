/**
 * Destructive test fixture: use ONLY an empty, disposable, locally hosted database.
 * This script temporarily enables operations in this process only and creates synthetic
 * approvals. It never changes .env and must never be run against a real pilot database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg, { Pool } from "pg";
import type { Identity } from "../../src/lib/identity";

if (process.env.RUN_LOCAL_DOMAIN_TEST !== "true" || process.env.NODE_ENV === "production" || process.env.OPERATIONS_ENABLED !== "false") {
  throw new Error("Requires explicit RUN_LOCAL_DOMAIN_TEST=true, NODE_ENV != production and OPERATIONS_ENABLED=false in an isolated empty development database.");
}
let server: string | null = null;
for (const name of ["DATABASE_URL", "AUTH_DATABASE_URL", "WORKER_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const url = new URL(process.env[name] ?? "invalid:");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || url.search || url.hash || url.pathname !== "/annapurna_link_test") {
    throw new Error(`${name} must point to an isolated local annapurna_link_test database without query parameters.`);
  }
  const roles: Record<string, string> = { DATABASE_URL: "annapurna_app", AUTH_DATABASE_URL: "annapurna_auth", WORKER_DATABASE_URL: "annapurna_worker", MIGRATION_DATABASE_URL: "annapurna_migrator" };
  if (decodeURIComponent(url.username) !== roles[name]) throw new Error(`${name} must use its expected database role.`);
  const endpoint = `${url.hostname === "localhost" ? "127.0.0.1" : url.hostname}:${url.port || "5432"}`;
  if (server && endpoint !== server) throw new Error("All database URLs must target the same isolated PostgreSQL instance.");
  server = endpoint;
}

async function main() {
const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
let phase = "checking empty database";
try {
  // Refuse every non-empty application table, not just the main domain tables.
  // Synthetic approvals must never be added to a database containing real data.
  const tables = await admin.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const { tablename } of tables.rows) {
    const rows = await admin.query<{ count: string }>(`SELECT count(*)::text count FROM public.${pg.escapeIdentifier(tablename)}`);
    assert.equal(rows.rows[0]?.count, "0", `The isolated test database must be empty; ${tablename} contains data.`);
  }
  const appRole = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'annapurna_app'");
  assert.deepEqual(appRole.rows[0], { rolsuper: false, rolbypassrls: false });
  // The flag affects only this process. No server is started and the config file is not changed.
  process.env.OPERATIONS_ENABLED = "true";
  const service = await import("../../src/domain/service");
  const db = await import("../../src/db");
  const prefix = `test-${randomUUID()}`;
  const ids = Object.fromEntries(["admin", "safety", "generator", "receiver", "receiver2", "helper1", "helper2", "outsider"].map((role) => [role, `${prefix}-${role}`]));
  const identity = (role: string): Identity => ({
    id: ids[role]!, name: `Fictional ${role}`, email: `${role}@example.test`,
    platformRoles: role === "admin" ? ["operations_admin"] : role === "safety" ? ["safety_officer"] : [],
    memberships: [], requestedRole: null, helperStatus: null,
  });
  const [operations, safety, generator, receiver, receiver2, helper1, helper2, outsider] = ["admin", "safety", "generator", "receiver", "receiver2", "helper1", "helper2", "outsider"].map(identity);
  assert(operations && safety && generator && receiver && receiver2 && helper1 && helper2 && outsider);
  phase = "creating fictional identities";
  for (const [role, id] of Object.entries(ids)) {
    await admin.query(`INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)`, [id, `Fictional ${role}`, `${prefix}-${role}@example.test`]);
    await admin.query(`INSERT INTO public.user_profiles (user_id,account_status,display_name,demo_account) VALUES ($1,'active',$2,true)`, [id, `Fictional ${role}`]);
  }
  await admin.query("INSERT INTO public.platform_roles (user_id,role,reason) VALUES ($1,'operations_admin','Fictional test fixture'),($2,'safety_officer','Fictional test fixture')", [operations.id, safety.id]);
  phase = "creating test-only area and policy";
  const area = await service.createServiceArea(operations, { label: "Fictional test area", countryCode: "IN", stateOrRegion: "", cityOrDistrict: "", timezone: "Asia/Kolkata", active: true });
  const draft = await service.createPolicyDraft(operations, { version: prefix, rules: { allowedCategories: ["produce"], allowedFoodTypes: ["vegetarian"], minimumPickupLeadMinutes: 0, minimumExpiryAfterPickupMinutes: 0, offerResponseMinutes: 60, allowPartialAcceptance: false, requireAllergenDisclosure: true } });
  await service.approvePolicy(safety, draft.id, { effectiveFrom: new Date(Date.now() - 60_000).toISOString() });
  phase = "organisation and Helper onboarding";
  const common = { operatingAddress: "Fictional test address", cityOrDistrict: "Test district", stateOrRegion: "", postalCode: "", contactName: "Test contact", contactEmail: "fixture@example.test", contactPhone: "", serviceAreaId: area.id };
  const genRequest = await service.requestOnboarding(generator, { ...common, role: "generator", organizationName: "Fictional Generator" });
  const recRequest = await service.requestOnboarding(receiver, { ...common, role: "receiver", organizationName: "Fictional Receiver", receivingCapacity: 100, capacityUnit: "servings", foodCapabilities: ["produce"] });
  const rec2Request = await service.requestOnboarding(receiver2, { ...common, role: "receiver", organizationName: "Second Fictional Receiver", receivingCapacity: 100, capacityUnit: "servings", foodCapabilities: ["produce"] });
  assert(genRequest.kind === "organization" && genRequest.organization && recRequest.kind === "organization" && recRequest.organization && rec2Request.kind === "organization" && rec2Request.organization);
  for (const org of [genRequest.organization, recRequest.organization, rec2Request.organization]) {
    await service.decideOrganizationVerification(operations, org.id, { decision: "approve", reason: "Synthetic test-only approval", serviceAreaId: area.id });
  }
  for (const helper of [helper1, helper2]) {
    await service.requestOnboarding(helper, { role: "helper", serviceAreaId: area.id, availabilityNotes: "", trainingAcknowledged: true });
    await service.decideHelper(operations, helper.id, { decision: "approve", reason: "Synthetic test-only approval", serviceAreaId: area.id });
    helper.helperStatus = "active";
  }
  for (const [who, org] of [[generator, genRequest.organization], [receiver, recRequest.organization], [receiver2, rec2Request.organization]] as const) {
    const row = await admin.query<{ id: string }>("SELECT id FROM public.organization_memberships WHERE user_id=$1 AND organization_id=$2", [who.id, org.id]);
    who.memberships.push({ id: row.rows[0]!.id, organizationId: org.id, organizationName: org.name, organizationType: org.type, organizationStatus: "verified", role: "owner", status: "active" });
  }
  phase = "creating donation and offer";
  const time = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const pickupEarliestAt = time(0.10);
  const { donationCreateSchema } = await import("../../src/domain/validation");
  const listingInput = donationCreateSchema.parse({ organizationId: genRequest.organization.id, name: "Fictional produce", category: "produce", foodType: "vegetarian", description: "Test only", quantity: 12, unit: "servings", ingredients: "Test ingredient", allergens: [], preparedAt: time(-10), packedAt: null, bestBeforeAt: time(180), pickupEarliestAt, pickupLatestAt: time(90), storageInstructions: "Fictional handling instructions", temperatureRequirement: "", pickupAddress: "Fictional pickup", pickupInstructions: "", declarationsAccepted: true });
  assert.equal(donationCreateSchema.safeParse({ ...listingInput, quantity: -1 }).success, false);
  assert.equal(donationCreateSchema.safeParse({ ...listingInput, bestBeforeAt: time(-1) }).success, false);
  process.env.OPERATIONS_ENABLED = "false";
  await assert.rejects(service.createDonation(generator, listingInput), (error: unknown) => error instanceof Error && "code" in error && error.code === "OPERATIONS_PAUSED");
  process.env.OPERATIONS_ENABLED = "true";
  await assert.rejects(service.createDonation(generator, { ...listingInput, category: "not-in-policy" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CATEGORY_NOT_ALLOWED");
  const donation = await service.createDonation(generator, listingInput);
  const offers = await service.listOffers(receiver);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]!.donationId, donation.id);
  const impactBefore = await admin.query<{ verified_deliveries: string }>("SELECT verified_deliveries FROM public.app_public_impact()");
  assert.equal(Number(impactBefore.rows[0]!.verified_deliveries), 0);
  phase = "accepting offer";
  const accepted = await service.respondToOffer(receiver, offers[0]!.id, { action: "accept" });
  assert(accepted.deliveryJobId);
  const jobId = accepted.deliveryJobId;
  phase = "claiming concurrently";
  const openDetails = await service.getDeliveryDetail(helper1, jobId);
  assert.equal(openDetails.pickupAddress, null);
  assert.equal(openDetails.receiverAddress, null);
  await assert.rejects(service.getReceiverDeliveryCode(receiver, jobId));
  const claims = await Promise.allSettled([service.claimDelivery(helper1, jobId), service.claimDelivery(helper2, jobId)]);
  if (claims.every((result) => result.status === "rejected")) {
    for (const result of claims) if (result.status === "rejected") console.error("Claim rejection:", result.reason?.cause?.message ?? result.reason?.message ?? "unknown");
  }
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1, "Exactly one Helper must claim the job.");
  const rejectedClaim = claims.find((result) => result.status === "rejected");
  assert(rejectedClaim?.status === "rejected" && [404, 409].includes(rejectedClaim.reason?.status), "Losing Helper must receive a safe unavailable/conflict error.");
  const winner = claims[0]!.status === "fulfilled" ? helper1 : helper2;
  const loser = winner === helper1 ? helper2 : helper1;
  phase = "pickup and code privacy";
  await assert.rejects(service.confirmPickup(loser, jobId, { condition: "Test condition" }));
  await assert.rejects(service.confirmPickup(winner, jobId, { condition: "Test condition" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PICKUP_WINDOW_NOT_OPEN");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, new Date(pickupEarliestAt).getTime() - Date.now()) + 30));
  await service.confirmPickup(winner, jobId, { condition: "Test condition" });
  await assert.rejects(service.getReceiverDeliveryCode(receiver, jobId));
  await assert.rejects(service.confirmDeliveryInspection(receiver, jobId, { acceptanceConfirmed: true, notes: "Test checks" }));
  await assert.rejects(service.confirmDeliveryArrival(loser, jobId));
  await assert.rejects(service.confirmDeliveryArrival(generator, jobId));
  const { sql } = await import("drizzle-orm");
  await db.withUserContext(receiver.id, async (tx) => {
    const rows = await tx.execute(sql`select * from delivery_codes where delivery_job_id = ${jobId}::uuid`);
    assert.equal(rows.rows.length, 0, "Receiver cannot read code before arrival and inspection.");
  });
  await assert.rejects(db.withUserContext(receiver.id, async (tx) => {
    await tx.execute(sql`update delivery_jobs set arrived_at=now(), arrival_reported_by=${receiver.id} where id=${jobId}::uuid`);
  }, { domainTransition: true }));
  await service.confirmDeliveryArrival(winner, jobId);
  await service.confirmDeliveryArrival(winner, jobId); // idempotent retry
  await assert.rejects(db.withUserContext(winner.id, async (tx) => {
    await tx.execute(sql`select * from app_consume_delivery_code(${jobId}::uuid, ${"0".repeat(64)})`);
  }));
  await assert.rejects(service.getReceiverDeliveryCode(receiver, jobId));
  await assert.rejects(service.confirmDeliveryInspection(receiver2, jobId, { acceptanceConfirmed: true, notes: "Test checks" }));
  await assert.rejects(service.confirmDeliveryInspection(winner, jobId, { acceptanceConfirmed: true, notes: "Test checks" }));
  await service.confirmDeliveryInspection(receiver, jobId, { acceptanceConfirmed: true, notes: "Fictional acceptance checks completed" });
  await service.confirmDeliveryInspection(receiver, jobId, { acceptanceConfirmed: true, notes: "Fictional acceptance checks completed" }); // idempotent retry
  await assert.rejects(service.confirmDeliveryInspection(receiver, jobId, { acceptanceConfirmed: true, notes: "Changed observations" }));
  await assert.rejects(service.getReceiverDeliveryCode(generator, jobId));
  await assert.rejects(service.getReceiverDeliveryCode(winner, jobId));
  await assert.rejects(service.getReceiverDeliveryCode(outsider, jobId));
  await assert.rejects(service.getReceiverDeliveryCode(receiver2, jobId));
  const { code } = await service.getReceiverDeliveryCode(receiver, jobId);
  assert.match(code, /^\d{6}$/);
  for (const who of [winner, generator, outsider, receiver2]) {
    await db.withUserContext(who.id, async (tx) => {
      const rows = await tx.execute(sql`select * from delivery_codes where delivery_job_id = ${jobId}::uuid`);
      assert.equal(rows.rows.length, 0, "Non-receivers must not read the delivery code row through RLS.");
    });
  }
  await db.withUserContext(receiver.id, async (tx) => {
    const rows = await tx.execute(sql`select id from delivery_codes where delivery_job_id = ${jobId}::uuid`);
    assert.equal(rows.rows.length, 1);
  });
  await db.withUserContext(outsider.id, async (tx) => {
    const rows = await tx.execute(sql`select id from donations where id = ${donation.id}::uuid`);
    assert.equal(rows.rows.length, 0, "An unrelated user must not read a donation through RLS.");
  });
  phase = "wrong code and concurrent verification";
  const wrong = code === "000000" ? "000001" : "000000";
  const failed = await service.verifyDelivery(winner, jobId, wrong);
  assert.equal(failed.verified, false);
  if (!failed.verified) assert.equal(failed.attemptsRemaining, 4);
  const outcomes = await Promise.allSettled([service.verifyDelivery(winner, jobId, code), service.verifyDelivery(winner, jobId, code)]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled" && result.value.verified).length, 1);
  const receiptRows = await admin.query<{ count: number; quantity: string }>("SELECT count(*)::int count, coalesce(sum(quantity),0)::text quantity FROM public.delivery_receipts WHERE delivery_job_id=$1", [jobId]);
  assert.equal(receiptRows.rows[0]!.count, 1);
  assert.equal(Number(receiptRows.rows[0]!.quantity), 12);
  await assert.rejects(service.getReceiverDeliveryCode(receiver, jobId));
  await db.withUserContext(receiver.id, async (tx) => {
    const rows = await tx.execute(sql`select id from delivery_codes where delivery_job_id = ${jobId}::uuid`);
    assert.equal(rows.rows.length, 0, "Consumed code records must not be readable by the Receiver.");
  });
  await assert.rejects(service.verifyDelivery(winner, jobId, code));
  const impactAfter = await admin.query<{ verified_deliveries: string; verified_servings: string }>("SELECT verified_deliveries, verified_servings FROM public.app_public_impact()");
  assert.equal(Number(impactAfter.rows[0]!.verified_deliveries), 1);
  assert.equal(Number(impactAfter.rows[0]!.verified_servings), 12);
  const notices = await admin.query<{ count: number }>("SELECT count(*)::int count FROM public.notifications WHERE kind='delivery.completed' AND href=$1", [`/app/deliveries/${jobId}`]);
  assert.equal(notices.rows[0]!.count, 3, "Each participant receives one completion notification.");
  const leaked = await admin.query<{ count: number }>("SELECT (SELECT count(*) FROM public.audit_events WHERE details::text LIKE $1) + (SELECT count(*) FROM public.notifications WHERE body LIKE $1 OR title LIKE $1) AS count", [`%${code}%`]);
  assert.equal(Number(leaked.rows[0]!.count), 0, "OTP must not appear in audit details or notification text.");
  phase = "five incorrect codes lock a fresh delivery";
  async function createJob() {
    const earliest = time(0.05);
    const listing = await service.createDonation(generator, { organizationId: genRequest.organization!.id, name: "Another fictional listing", category: "produce", foodType: "vegetarian", description: "Test only", quantity: 5, unit: "servings", ingredients: "Test ingredient", allergens: [], preparedAt: time(-10), packedAt: null, bestBeforeAt: time(180), pickupEarliestAt: earliest, pickupLatestAt: time(90), storageInstructions: "Fictional instructions", temperatureRequirement: "", pickupAddress: "Fictional pickup", pickupInstructions: "", declarationsAccepted: true });
    const available = (await service.listOffers(receiver)).find((item) => item.donationId === listing.id);
    assert(available);
    const response = await service.respondToOffer(receiver, available.id, { action: "accept" });
    assert(response.deliveryJobId);
    return { id: response.deliveryJobId, earliest, listingId: listing.id };
  }
  const second = await createJob();
  await service.claimDelivery(winner, second.id);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, new Date(second.earliest).getTime() - Date.now()) + 30));
  await service.confirmPickup(winner, second.id, { condition: "Test condition" });
  await service.confirmDeliveryArrival(winner, second.id);
  await service.confirmDeliveryInspection(receiver, second.id, { acceptanceConfirmed: true, notes: "Test checks completed" });
  const secondCode = (await service.getReceiverDeliveryCode(receiver, second.id)).code;
  const wrongSecond = secondCode === "000000" ? "000001" : "000000";
  for (let i = 1; i <= 5; i++) {
    const result = await service.verifyDelivery(winner, second.id, wrongSecond);
    assert.equal(result.verified, false);
    if (!result.verified) {
      assert.equal(result.attemptsRemaining, 5 - i);
      assert.equal(result.locked, i === 5);
    }
  }
  await assert.rejects(service.verifyDelivery(winner, second.id, secondCode));
  await assert.rejects(service.getReceiverDeliveryCode(receiver, second.id));
  const secondReceipts = await admin.query<{ count: number }>("SELECT count(*)::int count FROM public.delivery_receipts WHERE delivery_job_id=$1", [second.id]);
  assert.equal(secondReceipts.rows[0]!.count, 0);
  phase = "incident hold blocks dispatch";
  const third = await createJob();
  await service.reportDeliveryIncident(receiver, third.id, { incidentType: "quality_concern", severity: "high", description: "Fictional test incident" });
  await assert.rejects(service.claimDelivery(winner, third.id));
  const held = await admin.query<{ donation_status: string; job_status: string }>("SELECT d.status::text donation_status, j.status::text job_status FROM public.donations d JOIN public.delivery_jobs j ON j.donation_id=d.id WHERE j.id=$1", [third.id]);
  assert.deepEqual(held.rows[0], { donation_status: "on_hold", job_status: "on_hold" });
  phase = "concurrent Receiver reservations";
  const competing = await service.createDonation(generator, { organizationId: genRequest.organization.id, name: "Concurrent reservation test", category: "produce", foodType: "vegetarian", description: "Test only", quantity: 3, unit: "servings", ingredients: "Test ingredient", allergens: [], preparedAt: time(-10), packedAt: null, bestBeforeAt: time(180), pickupEarliestAt: time(1), pickupLatestAt: time(90), storageInstructions: "Fictional instructions", temperatureRequirement: "", pickupAddress: "Fictional pickup", pickupInstructions: "", declarationsAccepted: true });
  const offerA = (await service.listOffers(receiver)).find((item) => item.donationId === competing.id);
  const offerB = (await service.listOffers(receiver2)).find((item) => item.donationId === competing.id);
  assert(offerA && offerB);
  const reservations = await Promise.allSettled([service.respondToOffer(receiver, offerA.id, { action: "accept" }), service.respondToOffer(receiver2, offerB.id, { action: "accept" })]);
  assert.equal(reservations.filter((result) => result.status === "fulfilled").length, 1, "Only one Receiver can reserve a donation.");
  const reserveFailure = reservations.find((result) => result.status === "rejected");
  if (reserveFailure?.status === "rejected" && ![404, 409].includes(reserveFailure.reason?.status)) console.error("Reservation rejection:", reserveFailure.reason?.cause?.message ?? reserveFailure.reason?.message ?? "unknown");
  assert(reserveFailure?.status === "rejected" && [404, 409].includes(reserveFailure.reason?.status), "Losing Receiver must receive a safe unavailable/conflict error.");
  const jobCount = await admin.query<{ count: number }>("SELECT count(*)::int count FROM public.delivery_jobs WHERE donation_id=$1", [competing.id]);
  assert.equal(jobCount.rows[0]!.count, 1);
  console.log("PASS: synthetic onboarding/review, matching, competing claims/reservations, pickup window, RLS code privacy, OTP lock/replay, one receipt/impact and incident hold.");
  await db.pool.end();
  await db.authPool.end();
} catch (error) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : "unknown";
  console.error(`FAIL during ${phase}: ${cause}`);
  process.exitCode = 1;
} finally {
  await admin.end();
  // Imported pools may be open on failure; end them without printing query parameters or secrets.
  const db = await import("../../src/db").catch(() => null);
  await db?.pool.end().catch(() => undefined);
  await db?.authPool.end().catch(() => undefined);
}

}
void main().catch(() => { console.error("Local domain test failed unexpectedly."); process.exitCode = 1; });
