-- Public homepage impact is a narrow, read-only aggregate. No partner names,
-- user identifiers, donation details, addresses or incident data are returned.
CREATE FUNCTION public.app_public_impact()
RETURNS TABLE (
  verified_servings numeric,
  verified_deliveries bigint,
  verified_organizations bigint,
  active_helpers bigint,
  verified_generators bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    COALESCE((
      SELECT sum(receipt.quantity)
      FROM public.delivery_receipts AS receipt
      WHERE receipt.verified = true AND receipt.unit = 'servings'
    ), 0::numeric),
    (
      SELECT count(*)
      FROM public.delivery_receipts AS receipt
      WHERE receipt.verified = true
    ),
    (
      SELECT count(*)
      FROM public.organizations AS organization
      WHERE organization.status::text = 'verified'
    ),
    (
      SELECT count(*)
      FROM public.helper_profiles AS helper
      WHERE helper.status::text = 'active'
    ),
    (
      SELECT count(*)
      FROM public.organizations AS organization
      WHERE organization.status::text = 'verified'
        AND organization.type::text = 'generator'
    );
$$;

REVOKE ALL ON FUNCTION public.app_public_impact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_public_impact() TO annapurna_app;
