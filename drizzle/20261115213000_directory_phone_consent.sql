-- Migration 20: a number becomes public only after its owner says so.
--
-- Migration 19 held every phone number back, which is correct for a business that has never heard of
-- this project and wrong for one that has agreed to take part. The distinction is consent, not
-- convenience, so it gets a column of its own rather than a page-level switch: an operator can
-- publish one kitchen's line and leave the next thirty private, and the public reader enforces the
-- pair (consent recorded AND publish flag set) instead of trusting the caller.

--> statement-breakpoint
ALTER TABLE public.directory_places
  ADD COLUMN IF NOT EXISTS publish_phone boolean NOT NULL DEFAULT false;
--> statement-breakpoint
COMMENT ON COLUMN public.directory_places.publish_phone IS
  'Set only after the owner has agreed to be contacted publicly. The public reader requires this AND consent_status = consented before it returns a number.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_public_directory() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slug', place.slug,
    'name', place.name,
    'category', place.category,
    'area', place.area,
    'addressLine', place.address_line,
    'latitude', place.latitude,
    'longitude', place.longitude,
    'ownerVerified', place.owner_verified,
    'photoUrl', place.photo_url,
    -- Both conditions, in the database: a caller cannot publish a number the owner has not agreed to.
    'phone', CASE
      WHEN place.publish_phone AND place.consent_status = 'consented' THEN place.phone
      ELSE NULL
    END,
    'lastCheckedOn', place.last_checked_on
  ) ORDER BY place.category, place.name), '[]'::jsonb)
  FROM public.directory_places place
  WHERE place.published = true
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_public_directory() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_public_directory() TO annapurna_app;
