import { z } from "zod";

export const RestaurantDirectoryListingSchema = z.object({
  name: z.string().min(1).max(160),
  address: z.string().max(500),
  locality: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  cuisines: z.array(z.string().min(1).max(80)).max(20),
  directoryUrl: z.string().url(),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  sources: z.array(z.object({
    name: z.string().min(1).max(80),
    url: z.string().url().nullable(),
  })).max(30),
  website: z.string().url().nullable(),
});

export const RestaurantDirectoryResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("live"), listing: RestaurantDirectoryListingSchema }),
  z.object({
    status: z.literal("snapshot"),
    listing: RestaurantDirectoryListingSchema,
    snapshotCapturedOn: z.string().date(),
    warning: z.string().min(1).max(500),
  }),
]);

export type RestaurantDirectoryListing = z.infer<typeof RestaurantDirectoryListingSchema>;
export type RestaurantDirectoryResponse = z.infer<typeof RestaurantDirectoryResponseSchema>;
