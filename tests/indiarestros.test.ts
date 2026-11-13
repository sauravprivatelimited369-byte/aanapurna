import { afterEach, describe, expect, it, vi } from "vitest";
import { getHallaBowlDirectoryListing } from "@/integrations/indiarestros";

const hallaBowlRecord = {
  id: "IRR-NZ0P6WDRGS",
  name: "halla bowl",
  names: ["Halla Bowl", "HALLA BOWL"],
  url: "https://indiarestros.com/r/halla-bowl-joka-nz0p6wdrgs",
  cuisine_labels: ["Bengali", "North Indian", "Chinese"],
  address: {
    street: "Aristro Club, 680, Diamond Harbour Rd",
    locality: "Joka",
    city: "Kolkata",
    district: "South 24 Parganas",
    state: "West Bengal",
    pincode: "700104",
  },
  sources: [
    { src: "overture" },
    { src: "google", url: "https://www.google.com/maps?cid=6947617791363582730" },
    { src: "magicpin", url: "https://magicpin.in/Kolkata/Joka/Restaurant/Halla-Bowl/store/3b3ac3" },
  ],
  updated: "2026-10-25T08:17:44Z",
  website: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IndiaRestros public restaurant adapter", () => {
  it("loads the attributed Halla Bowl listing without requiring an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(hallaBowlRecord), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const listing = await getHallaBowlDirectoryListing();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://indiarestros.com/api/v1/restaurants/IRR-NZ0P6WDRGS",
      expect.objectContaining({ headers: { Accept: "application/json" }, next: { revalidate: 3600 } }),
    );
    expect(listing).toMatchObject({
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
    });
  });

  it("rejects an API record that tries to supply a non-IndiaRestros directory URL", async () => {
    const untrustedRecord = {
      ...hallaBowlRecord,
      url: "https://example.test/fake-restaurant",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(untrustedRecord), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getHallaBowlDirectoryListing()).rejects.toThrow("untrusted source URL");
  });

  it("surfaces an unavailable public data source instead of inventing a successful listing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("service unavailable", { status: 503 })));
    await expect(getHallaBowlDirectoryListing()).rejects.toThrow("status 503");
  });
});
