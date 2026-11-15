-- Migration 24: matching that knows how far apart two places are.
--
-- `app_find_receiver_candidates` matched on category, service area and declared capacity. It did not
-- know distance, so a Receiver two streets away and one forty kilometres away arrived in the same
-- unspecified order, and the offer that a Helper could not realistically collect looked exactly as
-- attractive as the one next door. The register named this: the product knew whether two places
-- shared a service area, not how far apart they were.
--
-- Coordinates already exist on `organizations` and the gazetteer (`geo_places`) already resolves a
-- city name when an organisation has no point. `domain/transit.ts` already does the arithmetic. What
-- was missing was any connection between the three and the matching query.
--
-- This migration makes distance first-class in matching, in the one place it cannot be bypassed: the
-- function the domain service calls. Three changes:
--
--   1. Each candidate comes back with the distance that produced its rank, so the interface can say
--      "3.2 km away" rather than asserting a preference nobody can see.
--   2. Candidates are ordered nearest-first, with distance unknown sorted last rather than hidden.
--      A Receiver with no coordinates is still offered food — refusing to match somebody because a
--      form field is blank would punish them for our data gap — it just cannot be ranked by distance.
--   3. Capacity adequacy is returned too, so the interface can show why an offer came to them.
--
-- The distance is straight-line (haversine) multiplied by 1.25 for road, exactly as `transit.ts`
-- documents. It is labelled an estimate wherever it is shown. There is no routing provider in this
-- deployment and none is invented here: a straight-line approximation that says it is one is honest,
-- and a fabricated turn-by-turn route would not be.

CREATE OR REPLACE FUNCTION public.app_normalize_place(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  -- Mirrors `normalizePlaceName` in domain/transit.ts: lower case, letters only. Kept identical in
  -- both places because a mismatch would silently stop resolving cities, which looks like "no
  -- coordinates" rather than like a bug.
  SELECT NULLIF(lower(regexp_replace(coalesce(p_value, ''), '[^a-zA-Z]', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.app_org_coordinates(p_organization_id uuid)
RETURNS TABLE(latitude numeric, longitude numeric, source text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  -- Exact coordinates win. Otherwise the gazetteer entry matching the organisation's city, which is
  -- the same fallback the onboarding form relies on. `source` says which one was used so the interface
  -- can be specific instead of pretending both are equally precise.
  --
  -- The two branches are each `LIMIT 1` and joined by UNION ALL, in that order, so the first row is
  -- always the exact point when one exists. An earlier draft put a single LIMIT 1 at the end of the
  -- UNION ALL, which does not do that: LIMIT applies to the combined result with no guaranteed order,
  -- so an organisation that *had* exact coordinates could still come back as its city centroid — and
  -- when the city was the same as the donor's, that read as "0.0 km away" and sorted first. A receiver
  -- 40 km away appearing next door is worse than no distance at all.
  SELECT resolved.latitude, resolved.longitude, resolved.source
  FROM (
    SELECT organization.latitude, organization.longitude, 'organization'::text AS source, 0 AS precedence
    FROM public.organizations organization
    WHERE organization.id = p_organization_id
      AND organization.latitude IS NOT NULL AND organization.longitude IS NOT NULL
    UNION ALL
    SELECT place.latitude, place.longitude, 'gazetteer'::text, 1
    FROM public.organizations organization
    JOIN public.geo_places place ON place.normalized_name = public.app_normalize_place(organization.city_or_district)
    WHERE organization.id = p_organization_id
      AND organization.latitude IS NULL AND organization.longitude IS NULL
  ) resolved
  -- Ordering is explicit rather than delegated to LIMIT. Branch-level LIMIT inside a UNION ALL is not
  -- a precedence rule, and an earlier draft relying on it returned the city centroid for an
  -- organisation that had exact coordinates — which, when the city matched the donor's, computed as
  -- 0.0 km and sorted the receiver first. A receiver 40 km away reading "next door" is exactly the
  -- false precision this migration exists to remove.
  ORDER BY resolved.precedence
  LIMIT 1;
$$;



-- The candidate function now returns distance and capacity, so it has to be dropped rather than
-- replaced: `CREATE OR REPLACE FUNCTION` cannot widen a RETURNS TABLE.
DROP FUNCTION IF EXISTS public.app_find_receiver_candidates(uuid, uuid, text, numeric, text);

CREATE FUNCTION public.app_find_receiver_candidates(
  p_generator_organization_id uuid, p_service_area_id uuid, p_category text, p_quantity numeric, p_unit text
) RETURNS TABLE(
  id uuid,
  distance_km numeric,
  distance_source text,
  capacity_adequate boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Explicit scalars rather than `SELECT * INTO generator_point`: inside a RETURNS TABLE function the
  -- output column names are in scope as variables, and `record` plus a variable/column name collision
  -- is the kind of thing that silently resolves to the wrong side. Naming them removes the ambiguity.
  generator_lat numeric;
  generator_lon numeric;
BEGIN
  IF NOT public.app_has_org_role(p_generator_organization_id, ARRAY['owner','manager','operator']) THEN
    RAISE EXCEPTION 'not authorized to match a donation' USING ERRCODE = '42501';
  END IF;
  -- The same context check as before: this function matches the donation that was just created by
  -- this user, in this transaction's terms, and refuses to be used as a general search.
  IF NOT EXISTS (
    SELECT 1 FROM public.donations donation
    WHERE donation.generator_organization_id = p_generator_organization_id
      AND donation.service_area_id = p_service_area_id
      AND donation.category = p_category
      AND donation.quantity = p_quantity
      AND donation.unit = p_unit
      AND donation.created_by = public.app_current_user_id()
      AND donation.status::text = 'offered'
  ) THEN
    RAISE EXCEPTION 'donation matching context is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT coordinates.latitude, coordinates.longitude
    INTO generator_lat, generator_lon
    FROM public.app_org_coordinates(p_generator_organization_id) coordinates;

  RETURN QUERY
    SELECT
      receiver.id,
      -- Haversine in SQL because the ordering has to happen in the database, not after a round trip.
      -- 6371.0088 km is the mean Earth radius, the same constant used in transit.ts.
      CASE WHEN generator_lat IS NULL OR point.latitude IS NULL THEN NULL ELSE
        round((
          2 * 6371.0088 * asin(least(1, sqrt(
            power(sin(radians(point.latitude - generator_lat) / 2), 2)
            + cos(radians(generator_lat)) * cos(radians(point.latitude))
              * power(sin(radians(point.longitude - generator_lon) / 2), 2)
          )))
          -- 1.25 road factor, documented in transit.ts as a deliberate approximation.
          * 1.25
        )::numeric, 1)
      END AS distance_km,
      coalesce(point.source, 'unknown') AS distance_source,
      (receiver.receiving_capacity IS NULL
        OR (receiver.capacity_unit = p_unit AND receiver.receiving_capacity >= p_quantity)) AS capacity_adequate
    FROM public.organizations receiver
    JOIN public.service_areas area ON area.id = receiver.service_area_id AND area.active
    LEFT JOIN LATERAL public.app_org_coordinates(receiver.id) point ON true
    WHERE receiver.type::text = 'receiver'
      AND receiver.status::text = 'verified'
      AND receiver.service_area_id = p_service_area_id
      AND receiver.food_capabilities @> ARRAY[p_category]::text[]
      -- Capacity is no longer a filter that silently dropped a Receiver. It is reported, so the
      -- interface can say "this is more than you declared you can take" and still offer it. A hard
      -- filter here meant a Receiver with a blank capacity field received nothing at all.
    ORDER BY
      -- Nearest first, by the same value that is returned, so the printed distance and the order can
      -- never disagree. NULLS LAST keeps "unknown" from outranking a known 2 km — a receiver whose
      -- coordinate is missing must not appear more convenient than one next door.
      distance_km ASC NULLS LAST,
      receiver.name;
END;
$$;

REVOKE ALL ON FUNCTION public.app_find_receiver_candidates(uuid, uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_org_coordinates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_normalize_place(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_find_receiver_candidates(uuid, uuid, text, numeric, text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_org_coordinates(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_normalize_place(text) TO annapurna_app;
