import "server-only";
import { pool } from "@/db";

/**
 * The public projection of the Joka directory. It comes through `app_public_directory()`, which
 * returns only published rows and never the phone number, the notes or the consent state. A page
 * that cannot see a number cannot leak one.
 */
export type DirectoryEntry = {
  slug: string;
  name: string;
  category: "banquet" | "hotel" | "restaurant" | "campus";
  area: string;
  addressLine: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  ownerVerified: boolean;
  photoUrl: string | null;
  /** Present only when the owner agreed to be contacted publicly. */
  phone: string | null;
  lastCheckedOn: string;
};

export async function readPublicDirectory(): Promise<DirectoryEntry[]> {
  try {
    const { rows } = await pool.query<{ places: DirectoryEntry[] }>("select app_public_directory() as places");
    return rows[0]?.places ?? [];
  } catch {
    // A missing function means the migration has not run. An empty list is the honest answer; a
    // hard-coded fallback list would be stale data pretending to be a live directory.
    return [];
  }
}

export const directoryCategoryLabels: Record<DirectoryEntry["category"], string> = {
  banquet: "Banquet and event venues",
  hotel: "Hotels and guest houses",
  restaurant: "Restaurants and eateries",
  campus: "On campus",
};

export const directoryCategoryNotes: Record<DirectoryEntry["category"], string> = {
  banquet: "The largest surplus arrives in one late-evening window, which is what a pickup slot needs.",
  hotel: "Breakfast and buffet kitchens produce daily, usually late morning.",
  restaurant: "Smaller and less predictable volumes; only worth collecting at cluster density.",
  campus: "Institutional kitchens. Any arrangement is the institute's decision, not a shop manager's.",
};
