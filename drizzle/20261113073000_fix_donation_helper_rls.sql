-- Qualify the outer donations ID. An unqualified `id` inside this subquery
-- resolves to delivery_jobs.id, preventing the assigned Helper from progressing
-- the related donation. Keep the existing authorization conditions unchanged.
DROP POLICY donations_update ON public.donations;
--> statement-breakpoint
CREATE POLICY donations_update ON public.donations FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_can_view_donation(id))
WITH CHECK (public.app_is_domain_transition() AND (
  public.app_has_org_role(generator_organization_id, ARRAY['owner','manager','operator'])
  OR (receiver_organization_id IS NOT NULL AND public.app_has_org_role(receiver_organization_id, ARRAY['owner','manager','operator']))
  OR EXISTS (SELECT 1 FROM public.delivery_jobs job
             WHERE job.donation_id = donations.id AND public.app_is_active_assigned_helper(job.id))
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
));
