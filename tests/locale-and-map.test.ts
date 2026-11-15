import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { LocaleSwitcher } from "../src/components/locale-switcher";
import { TransitMap } from "../src/components/transit-map";

describe("language control", () => {
  it("renders three options, each in its own script, inside one select", () => {
    const html = renderToStaticMarkup(createElement(LocaleSwitcher, { current: "hi" as const }));
    expect(html).toContain("<select");
    expect(html.match(/<option/g)?.length).toBe(3);
    expect(html).toContain("English");
    expect(html).toContain("हिन्दी");
    expect(html).toContain("বাংলা");
    // Odia was removed on the owner's instruction; the control must not still offer it.
    expect(html).not.toContain("ଓଡ଼ିଆ");
    // Never more than one control: the old pill row overflowed at 320px with four names.
    expect(html.match(/<select/g)?.length).toBe(1);
  });
});

describe("transit schematic", () => {
  it("draws both points when coordinates exist", () => {
    const html = renderToStaticMarkup(createElement(TransitMap, {
      from: { label: "Collection", latitude: 21.4669, longitude: 83.9812 },
      to: { label: "Receiving", latitude: 21.484, longitude: 83.9812 },
      distanceKm: 2.4, etaMinutes: 12, source: "organization" as const,
    }));
    expect(html.match(/<circle/g)?.length).toBe(2);
    expect(html).toContain("2.4 km straight line");
    expect(html).toContain("Schematic only");
  });
  it("refuses to draw a point it does not have", () => {
    const html = renderToStaticMarkup(createElement(TransitMap, {
      from: { label: "Collection", latitude: 21.4669, longitude: 83.9812 },
      to: null, distanceKm: null, etaMinutes: null, source: "unknown" as const,
    }));
    expect(html).not.toContain("<svg");
    expect(html).toContain("no coordinates yet");
  });
  it("labels a city-centre estimate as one", () => {
    const html = renderToStaticMarkup(createElement(TransitMap, {
      from: { label: "Collection", latitude: 21.4669, longitude: 83.9812 },
      to: { label: "Receiving", latitude: 20.2961, longitude: 85.8245 },
      distanceKm: 230.1, etaMinutes: 690, source: "gazetteer" as const,
    }));
    expect(html).toContain("city centre, not an exact address");
  });
});
