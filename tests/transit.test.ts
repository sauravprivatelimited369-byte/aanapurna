import { describe, expect, it } from "vitest";
import { assessTransit, describeTransit, estimateTransit, haversineKm, normalizePlaceName, ROAD_FACTOR } from "../src/domain/transit";

const bhubaneswar = { latitude: 20.296059, longitude: 85.824539 };
const cuttack = { latitude: 20.462521, longitude: 85.882988 };
const delhi = { latitude: 28.70406, longitude: 77.102493 };

describe("transit estimates", () => {
  it("measures a real distance between two known places", () => {
    // Bhubaneswar to Cuttack is roughly 20 km in a straight line.
    const km = haversineKm(bhubaneswar, cuttack);
    expect(km).toBeGreaterThan(17);
    expect(km).toBeLessThan(23);
  });

  it("applies the documented road factor and rounds up the ETA", () => {
    const straight = haversineKm(bhubaneswar, cuttack);
    const estimate = estimateTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 20 });
    expect(estimate.distanceKm).toBeCloseTo(straight * ROAD_FACTOR, 1);
    expect(estimate.etaMinutes).toBe(Math.ceil((straight * ROAD_FACTOR / 20) * 60));
  });

  it("refuses an implausible speed instead of producing a fantasy ETA", () => {
    expect(() => estimateTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 400 })).toThrow();
    expect(() => estimateTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 1 })).toThrow();
  });

  it("adds handover time to the estimate", () => {
    const base = estimateTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 20 });
    const withHandover = estimateTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 20, handoverMinutes: 10 });
    expect(withHandover.etaMinutes - base.etaMinutes).toBeGreaterThanOrEqual(10);
  });

  it("flags a route beyond the area limit", () => {
    const assessment = assessTransit({ from: bhubaneswar, to: delhi, averageSpeedKmph: 20, limitKm: 40 });
    expect(assessment.known).toBe(true);
    expect(assessment.known && assessment.withinLimit).toBe(false);
  });

  it("keeps the estimate informational when the area sets no limit", () => {
    const assessment = assessTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 20, limitKm: null });
    expect(assessment.known && assessment.withinLimit).toBeNull();
  });

  it("admits when a route cannot be measured", () => {
    const missing = assessTransit({ from: null, to: cuttack, averageSpeedKmph: 20, limitKm: 40 });
    expect(missing).toEqual({ known: false, reason: "NO_PICKUP_COORDINATES" });
    expect(describeTransit(missing)).toContain("Distance unknown");
    const noDestination = assessTransit({ from: bhubaneswar, to: null, averageSpeedKmph: 20, limitKm: 40 });
    expect(noDestination).toEqual({ known: false, reason: "NO_DESTINATION_COORDINATES" });
  });

  it("describes a known route without promising an exact arrival", () => {
    const assessment = assessTransit({ from: bhubaneswar, to: cuttack, averageSpeedKmph: 20, limitKm: 40 });
    expect(describeTransit(assessment)).toMatch(/km by road, about/);
    expect(describeTransit(assessment)).not.toMatch(/exactly|guaranteed/);
  });

  it("normalises free-text place names", () => {
    expect(normalizePlaceName(" Cuttack ")).toBe("cuttack");
    expect(normalizePlaceName("Bhubaneswar, Odisha")).toBe("bhubaneswarodisha");
    expect(normalizePlaceName("Khordha District")).toBe("khordhadistrict");
  });
});
