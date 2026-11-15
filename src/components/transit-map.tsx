/**
 * A schematic of where a collection is and where it is going.
 *
 * This is deliberately not a slippy map. There is no tile provider in this deployment and no
 * routing service, so a real basemap would mean loading third-party tiles at runtime — which cannot
 * be tested from the build environment and would make a page depend on a network call that can fail
 * silently into an empty grey box. It would also imply a precision this product does not have: the
 * coordinates are either an organisation's own declared point or a city centroid, and neither is a
 * doorstep.
 *
 * So this draws an equal-area projection of the two points onto a fixed viewBox, joined by a straight
 * line, with the real distance printed beside it. The line is labelled as straight-line distance and
 * the road estimate is shown separately, because they are different numbers and conflating them would
 * be a quiet lie. When a coordinate is missing the component says which one and draws nothing rather
 * than guessing a position — a dot in the wrong place is worse than no dot.
 *
 * Accessibility: the SVG is decorative and marked aria-hidden. Every fact it shows is also in text,
 * so a screen reader gets the distance without needing a picture of it.
 */

export type MapPoint = { label: string; latitude: number; longitude: number };

const WIDTH = 320;
const HEIGHT = 180;
const PADDING = 34;

/**
 * Equirectangular projection. At the scale of one state the distortion is small enough that a
 * schematic is honest as long as it is labelled as one; this is not a survey instrument.
 */
function project(point: MapPoint, bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }) {
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.01);
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.01);
  const x = PADDING + ((point.longitude - bounds.minLon) / lonSpan) * (WIDTH - PADDING * 2);
  // Latitude increases northwards, SVG y increases downwards.
  const y = HEIGHT - PADDING - ((point.latitude - bounds.minLat) / latSpan) * (HEIGHT - PADDING * 2);
  return { x, y };
}

export function TransitMap({ from, to, distanceKm, etaMinutes, source }: {
  from: MapPoint | null;
  to: MapPoint | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  source: "organization" | "gazetteer" | "unknown" | null;
}) {
  if (!from || !to) {
    return (
      <div className="transit-map transit-map--unknown">
        <p className="transit-map__note">
          {!from
            ? "No map: the collection point has no coordinates yet."
            : "No map: the receiving address has no coordinates yet."}
          {" "}The distance cannot be estimated without both.
        </p>
      </div>
    );
  }

  const bounds = {
    minLat: Math.min(from.latitude, to.latitude),
    maxLat: Math.max(from.latitude, to.latitude),
    minLon: Math.min(from.longitude, to.longitude),
    maxLon: Math.max(from.longitude, to.longitude),
  };
  const a = project(from, bounds);
  const b = project(to, bounds);

  return (
    <figure className="transit-map">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden="true" focusable="false">
        <rect className="transit-map__frame" x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" />
        <line className="transit-map__route" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <circle className="transit-map__point transit-map__point--from" cx={a.x} cy={a.y} r="6" />
        <circle className="transit-map__point transit-map__point--to" cx={b.x} cy={b.y} r="6" />
        <text className="transit-map__label" x={a.x} y={a.y - 12} textAnchor="middle">Collection</text>
        <text className="transit-map__label" x={b.x} y={b.y + 22} textAnchor="middle">Receiving</text>
      </svg>
      <figcaption className="transit-map__note">
        {distanceKm === null
          ? "Distance not known."
          : `${distanceKm} km straight line${etaMinutes === null ? "" : `, about ${Math.floor(etaMinutes / 60) > 0 ? `${Math.floor(etaMinutes / 60)} h ` : ""}${etaMinutes % 60} min by road`}.`}
        {source === "gazetteer" && " The receiving point is the city centre, not an exact address."}
        {" "}Schematic only — not a road route.
      </figcaption>
    </figure>
  );
}
