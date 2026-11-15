/**
 * Distance and arrival estimates.
 *
 * The register said the application knew only whether two places shared a service area - not how
 * far apart they were - so it could not refuse a delivery nobody could make in time, and could not
 * tell anyone when food would arrive.
 *
 * There is no routing provider in this project and no geocoding call at runtime, so this works from
 * two sources: exact coordinates when an organisation has them, and a checked-in gazetteer matched
 * against the city the onboarding form already records. When neither yields a point, the answer is
 * "unknown" and the caller must say so. It never guesses.
 */

export type Coordinates = { latitude: number; longitude: number };

export type TransitEstimate = {
  distanceKm: number;
  etaMinutes: number;
};

const EARTH_RADIUS_KM = 6371.0088;

/** Straight-line distance in kilometres. Road distance is longer; the caller applies a factor. */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Road distance is not the straight line. A 1.25 factor is the usual urban allowance for the fact
 * that nobody drives through buildings; it is a documented approximation, not a claim of accuracy.
 */
export const ROAD_FACTOR = 1.25;

/** Minutes are rounded up: an ETA that reads "0 minutes" for a 900 m trip is a lie in the other direction. */
export function estimateTransit(input: {
  from: Coordinates;
  to: Coordinates;
  averageSpeedKmph?: number;
  handoverMinutes?: number;
}): TransitEstimate {
  const speed = input.averageSpeedKmph ?? 20;
  if (!Number.isFinite(speed) || speed < 5 || speed > 80) {
    throw new Error("averageSpeedKmph must be between 5 and 80");
  }
  const distanceKm = haversineKm(input.from, input.to) * ROAD_FACTOR;
  const drivingMinutes = (distanceKm / speed) * 60;
  const etaMinutes = Math.ceil(drivingMinutes + (input.handoverMinutes ?? 0));
  return { distanceKm: Math.round(distanceKm * 100) / 100, etaMinutes };
}

/** Normalise a free-text city or district so "Cuttack " and "CUTTACK" match the same row. */
export function normalizePlaceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export type TransitAssessment =
  | { known: false; reason: "NO_PICKUP_COORDINATES" | "NO_DESTINATION_COORDINATES" }
  | {
      known: true;
      distanceKm: number;
      etaMinutes: number;
      withinLimit: boolean | null;
      limitKm: number | null;
    };

/**
 * Decide whether a delivery is inside a service area's transit limit.
 * `limitKm` null means the area has no limit configured, so the estimate is informational only.
 */
export function assessTransit(input: {
  from: Coordinates | null;
  to: Coordinates | null;
  averageSpeedKmph: number;
  handoverMinutes?: number;
  limitKm: number | null;
}): TransitAssessment {
  if (!input.from) return { known: false, reason: "NO_PICKUP_COORDINATES" };
  if (!input.to) return { known: false, reason: "NO_DESTINATION_COORDINATES" };
  const estimate = estimateTransit({
    from: input.from,
    to: input.to,
    averageSpeedKmph: input.averageSpeedKmph,
    handoverMinutes: input.handoverMinutes,
  });
  return {
    known: true,
    distanceKm: estimate.distanceKm,
    etaMinutes: estimate.etaMinutes,
    withinLimit: input.limitKm === null ? null : estimate.distanceKm <= input.limitKm,
    limitKm: input.limitKm,
  };
}

/** Short, factual label for the interface. No promise of an exact arrival time. */
export function describeTransit(assessment: TransitAssessment): string {
  if (!assessment.known) {
    return assessment.reason === "NO_PICKUP_COORDINATES"
      ? "Distance unknown: the collection address has no coordinates yet."
      : "Distance unknown: the receiving address has no coordinates yet.";
  }
  const hours = Math.floor(assessment.etaMinutes / 60);
  const minutes = assessment.etaMinutes % 60;
  const duration = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  return `${assessment.distanceKm} km by road, about ${duration}.`;
}
