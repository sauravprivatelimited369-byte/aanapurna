import "server-only";
import { z } from "zod";
import type { RestaurantDirectoryListing } from "@/integrations/restaurant-directory-contract";

const API_BASE = "https://indiarestros.com/api/v1";
const API_RESTAURANT_ID = "IRR-NZ0P6WDRGS";

const SourcedTextSchema = z.object({ v: z.string().nullable().optional(), src: z.string().optional() }).passthrough();
const RestaurantRecordSchema = z.object({
  id: z.string().regex(/^IRR-[A-Z0-9]+$/),
  name: z.string().min(1).max(160),
  names: z.array(z.string().min(1).max(160)).optional().default([]),
  url: z.string().url(),
  cuisine_labels: z.array(z.string().min(1).max(80)).optional().default([]),
  cuisines: z.array(z.string().min(1).max(80)).optional().default([]),
  address: z.object({
    street: z.string().nullable().optional(),
    locality: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    district: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    pincode: z.string().nullable().optional(),
  }).passthrough(),
  sources: z.array(z.object({ src: z.string().min(1).max(80), url: z.string().url().optional() }).passthrough()).optional().default([]),
  updated: z.string().datetime({ offset: true }).optional(),
  website: SourcedTextSchema.nullable().optional(),
}).passthrough();

/** Last API response captured on 2026-11-12; never present it as a live verification. */
export const HALLA_BOWL_LAST_KNOWN: RestaurantDirectoryListing = {
  name: "Halla Bowl",
  address: "Aristro Club, 680, Diamond Harbour Rd, Joka, Kolkata, West Bengal, 700104",
  locality: "Joka",
  city: "Kolkata",
  cuisines: ["Bengali", "North Indian", "Chinese"],
  directoryUrl: "https://indiarestros.com/r/halla-bowl-joka-nz0p6wdrgs",
  observedAt: "2026-10-25T08:17:44Z",
  sources: [
    { name: "overture", url: null },
    { name: "google", url: "https://www.google.com/maps?cid=6947617791363582730" },
    { name: "magicpin", url: "https://magicpin.in/Kolkata/Joka/Restaurant/Halla-Bowl/store/3b3ac3" },
  ],
  website: null,
};

function safePublicUrl(value: string, allowedHost?: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Restaurant directory returned an unsafe URL.");
  }
  if (allowedHost && url.hostname !== allowedHost) {
    throw new Error("Restaurant directory returned an untrusted source URL.");
  }
  return url.toString();
}

/** Fetch one fixed public record server-side. No API key or user data is sent. */
export async function getHallaBowlDirectoryListing(): Promise<RestaurantDirectoryListing> {
  const response = await fetch(`${API_BASE}/restaurants/${API_RESTAURANT_ID}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Restaurant directory request failed with status ${response.status}.`);

  const parsed = RestaurantRecordSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.id !== API_RESTAURANT_ID) {
    throw new Error("Restaurant directory returned an unexpected record.");
  }
  const record = parsed.data;
  const directoryUrl = safePublicUrl(record.url, "indiarestros.com");
  const addressParts = [
    record.address.street,
    record.address.locality,
    record.address.city,
    record.address.state,
    record.address.pincode,
  ].filter((part): part is string => Boolean(part?.trim()));
  const website = record.website?.v ? safePublicUrl(record.website.v) : null;

  return {
    name: record.names.find((name) => /halla\s*bowl/i.test(name)) ?? record.name,
    address: addressParts.join(", "),
    locality: record.address.locality?.trim() || "Joka",
    city: record.address.city?.trim() || "Kolkata",
    cuisines: record.cuisine_labels.length ? record.cuisine_labels : record.cuisines,
    directoryUrl,
    observedAt: record.updated ?? null,
    sources: [...new Map(record.sources.map((source) => [source.src, {
      name: source.src,
      url: source.url ? safePublicUrl(source.url) : null,
    }])).values()],
    website,
  };
}
