import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db", () => ({ pool: { query } }));

import { pool } from "@/db";
import { GET } from "@/app/api/public/impact/route";

describe("GET /api/public/impact", () => {
  beforeEach(() => vi.mocked(pool.query).mockReset());

  it("returns only validated, verified aggregates", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        verified_servings: "12.500",
        verified_deliveries: "2",
        verified_organizations: "3",
        active_helpers: "4",
        verified_generators: "1",
      }],
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate=300");
    expect(await response.json()).toEqual({
      status: "available",
      metrics: {
        verifiedServings: 12.5,
        verifiedDeliveries: 2,
        verifiedOrganizations: 3,
        activeHelpers: 4,
        verifiedGenerators: 1,
      },
    });
    expect(pool.query).toHaveBeenCalledWith("SELECT * FROM public.app_public_impact()");
  });

  it("returns an explicit empty result for all-zero backend aggregates", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        verified_servings: "0",
        verified_deliveries: "0",
        verified_organizations: "0",
        active_helpers: "0",
        verified_generators: "0",
      }],
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "empty" });
  });

  it("does not leak database errors or return invalid aggregates as impact", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        verified_servings: "-1",
        verified_deliveries: "0",
        verified_organizations: "0",
        active_helpers: "0",
        verified_generators: "0",
      }],
    } as never);

    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "unavailable",
      message: "Verified impact is temporarily unavailable.",
    });
  });

  it("returns unavailable when the aggregate query fails", async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error("private connection details"));

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private connection details");
  });
});
