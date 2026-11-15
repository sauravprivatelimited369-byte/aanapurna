-- Migration 25: let the application address the people a notification was written to.
--
-- Adding email delivery of in-app notifications ran into a wall that is there for a good reason:
-- `annapurna_app` has no SELECT on `public."user"`. Email addresses live in the auth tables and the
-- runtime role is not allowed to read them, so a notification email cannot simply be addressed from
-- application code. Reaching around that by granting the app role SELECT on "user" would hand every
-- application query the whole email directory, which is a worse trade than the feature is worth.
--
-- So the addresses are resolved by a SECURITY DEFINER function that answers one question: given an
-- organisation the caller may notify, which addresses belong to its active members? It performs the
-- same authorisation check `app_notify_organization_members` performs, returns addresses and nothing
-- else — no names, no ids, no account status — and the caller can only ask about an organisation it
-- already has a role in.
--
-- This is deliberately not a general "read any email" primitive. The authorisation is the point, and
-- it is the same predicate the notification itself used, so the people who are emailed are exactly
-- the people whose notification list was written.

CREATE OR REPLACE FUNCTION public.app_notification_recipients(p_organization_id uuid, p_donation_id uuid)
RETURNS TABLE(email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The same authorisation predicate `app_notify_organization_members` applies, and for the same
  -- reason: the addresses that may be emailed are the addresses of the people whose notification was
  -- just written. An earlier draft checked the caller's role *in the target organisation*, which is
  -- the wrong question — a Generator notifying a Receiver has no role there, so the check always
  -- failed and the email never left. The donation is what ties the two organisations together.
  IF NOT (
    public.app_has_org_role(p_organization_id, ARRAY['owner','manager','operator','viewer'])
    OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
    OR (p_donation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.donations donation
      WHERE donation.id = p_donation_id
        AND (
          (public.app_has_org_role(donation.generator_organization_id, ARRAY['owner','manager','operator'])
            AND EXISTS (SELECT 1 FROM public.donation_offers offer
              WHERE offer.donation_id = donation.id AND offer.receiver_organization_id = p_organization_id))
          OR EXISTS (SELECT 1 FROM public.donation_offers offer
            WHERE offer.donation_id = donation.id
              AND public.app_has_org_role(offer.receiver_organization_id, ARRAY['owner','manager','operator']))
          OR EXISTS (SELECT 1 FROM public.delivery_jobs job
            WHERE job.donation_id = donation.id
              AND public.app_is_active_assigned_helper(job.id)
              AND p_organization_id IN (job.generator_organization_id, job.receiver_organization_id))
        )
    ))
  ) THEN
    RAISE EXCEPTION 'not authorized to list notification recipients' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT DISTINCT member.email
    FROM (
      SELECT membership.user_id
      FROM public.organization_memberships membership
      WHERE membership.organization_id = p_organization_id
        AND membership.status::text = 'active'
      UNION
      SELECT organization.created_by
      FROM public.organizations organization
      WHERE organization.id = p_organization_id
    ) recipient
    JOIN public."user" member ON member.id = recipient.user_id
    WHERE member.email IS NOT NULL
      AND member.email <> '';
END;
$$;

REVOKE ALL ON FUNCTION public.app_notification_recipients(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_notification_recipients(uuid, uuid) TO annapurna_app;

-- The outbox insert policy allowed only `verification` and `password_reset`, which was right when
-- authentication mail was the only thing the application could send. A notification email is also
-- application-originated, so the kind list widens by exactly one entry. The other conditions stay:
-- a non-empty recipient and an encrypted payload, so nothing plaintext can be queued.
--
-- The kind is still an allow-list rather than a free string, and deliberately so. Adding a kind here
-- is a reviewable change; leaving it open would let any future code path write arbitrary mail through
-- a table the operations staff read.
DROP POLICY IF EXISTS email_outbox_create_app ON public.email_outbox;
CREATE POLICY email_outbox_create_app ON public.email_outbox
  FOR INSERT
  WITH CHECK (
    kind = ANY (ARRAY['verification'::text, 'password_reset'::text, 'notification'::text])
    AND recipient <> ''
    AND encrypted_payload LIKE 'v1.%'
  );
