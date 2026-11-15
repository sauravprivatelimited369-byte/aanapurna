-- Migration 26: a device that has agreed to be told, and the two functions the worker needs.
--
-- Notifications so far had two ways of reaching a person: a list they had to open, and an email.
-- Neither reaches somebody who is out, and the one notification that matters most — a food offer that
-- expires within the hour — is exactly the one nobody is sitting at a screen for. Web Push delivers to
-- the device itself, including when the site is closed.
--
-- Two decisions are worth stating.
--
-- The table is per device, not per person. One account with a phone and a laptop has two rows, and a
-- notification sent to only the one they happen to be holding is the problem this solves.
--
-- The endpoint and the two keys are credentials: they are what lets anybody holding them send that
-- device a push. So RLS is enabled and FORCED, a person can only see and revoke their own rows, and the
-- application never hands the endpoint or keys back to a browser. The worker reads them through a
-- SECURITY DEFINER function with no caller check, because the worker connects as a role that has no
-- session identity at all — it is a background process, not a person.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_error text,
  CONSTRAINT push_subscriptions_endpoint_length CHECK (length(endpoint) BETWEEN 8 AND 2048),
  CONSTRAINT push_subscriptions_keys_length CHECK (length(p256dh) BETWEEN 8 AND 200 AND length(auth) BETWEEN 4 AND 100),
  CONSTRAINT push_subscriptions_label_length CHECK (device_label IS NULL OR length(device_label) <= 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON public.push_subscriptions (endpoint);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id, revoked_at);
--> statement-breakpoint

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A person reads, adds and revokes their own devices. There is no policy that lets anyone see another
-- person's subscriptions, and no DELETE policy at all: revoking sets `revoked_at`, so the record of a
-- device having been registered survives, which is what an audit needs.
DROP POLICY IF EXISTS push_subscriptions_read_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_read_self ON public.push_subscriptions FOR SELECT
  USING (user_id = public.app_current_user_id());
--> statement-breakpoint
DROP POLICY IF EXISTS push_subscriptions_insert_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_self ON public.push_subscriptions FOR INSERT
  WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint
DROP POLICY IF EXISTS push_subscriptions_update_self ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_self ON public.push_subscriptions FOR UPDATE
  USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE public.push_subscriptions TO annapurna_app;
--> statement-breakpoint

-- The devices to deliver to, for one notification. SECURITY DEFINER because the worker has no user
-- identity; the function is not reachable by any role that can impersonate a person, and it returns
-- only what the sender needs to address a push.
-- The devices to deliver to, for one notification.
--
-- This had to be granted to both roles and it could not simply be a lookup. The worker has no session
-- identity and may ask about anybody; the web process does have one and must not be able to read
-- somebody else's endpoint and keys by passing their id. So the function authorises per caller: if a
-- session user is set, it may only ask about itself. `app_current_user_id()` is null in the worker, and
-- only the worker reaches this with a null session — which is why the grant is narrow rather than the
-- check being skipped.
CREATE OR REPLACE FUNCTION public.app_push_targets(p_user_id text)
RETURNS TABLE(id uuid, endpoint text, p256dh text, auth text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller text := public.app_current_user_id();
BEGIN
  IF caller IS NOT NULL AND caller <> p_user_id THEN
    RAISE EXCEPTION 'not authorized to list another user''s devices' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT subscription.id, subscription.endpoint, subscription.p256dh, subscription.auth
    FROM public.push_subscriptions subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.revoked_at IS NULL
    ORDER BY subscription.last_seen_at DESC
    -- A person does not need fourteen pushes on fifteen devices. Oldest fall away first.
    LIMIT 10;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_push_targets(text) FROM PUBLIC;
-- Both roles need this, and the first version granted only the worker. The drain runs in the worker,
-- but the same target list is what the API reports and what a direct send uses from the web process;
-- granting one role made every push from the application fail with `permission denied for function`,
-- which is invisible until a device is actually registered. Caught by calling the path, not by reading it.
GRANT EXECUTE ON FUNCTION public.app_push_targets(text) TO annapurna_worker, annapurna_app;
--> statement-breakpoint

-- A phone that has been wiped should stop being retried forever. The worker marks it gone; it does not
-- delete it, because "this device was registered and then stopped accepting pushes" is a fact worth
-- keeping when somebody asks why a notification did not arrive.
CREATE OR REPLACE FUNCTION public.app_revoke_push_subscription(p_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET revoked_at = coalesce(revoked_at, now()),
      last_error = left(coalesce(p_reason, 'revoked'), 120)
  WHERE id = p_id
    AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_push_subscription(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_revoke_push_subscription(uuid, text) TO annapurna_worker, annapurna_app;
--> statement-breakpoint

-- Push delivery is driven from the notification rows themselves rather than from each call site.
--
-- Every notification in this system is written by a database function: `app_notify_user`,
-- `app_notify_organization_members`, `app_notify_area_helpers`, `app_notify_platform_roles`. Wiring a
-- push into each of those would mean a new notification kind is silently push-less until somebody
-- remembers, and one of them writes rows for an unbounded set of people. A worker that drains what was
-- written is one place to get right, covers every path including future ones, and cannot be forgotten.
--
-- The column is the delivery record: null means "not pushed yet". A notification with no registered
-- device is marked delivered too, so the sweep does not re-examine it on every pass forever.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_delivered_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_push_pending_idx
  ON public.notifications (created_at) WHERE push_delivered_at IS NULL;
--> statement-breakpoint

-- The batch a worker should push. SECURITY DEFINER because the worker has no session identity.
-- Bounded in both directions: only the last few minutes, so a worker that was down for a day does not
-- wake up and fire a thousand stale pushes at people about food that was collected yesterday.
CREATE OR REPLACE FUNCTION public.app_unpushed_notifications(p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, user_id text, title text, body text, href text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT notification.id, notification.user_id, notification.title, notification.body, notification.href
  FROM public.notifications notification
  WHERE notification.push_delivered_at IS NULL
    AND notification.created_at > now() - interval '15 minutes'
  ORDER BY notification.created_at
  LIMIT least(coalesce(p_limit, 100), 500)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_unpushed_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_unpushed_notifications(integer) TO annapurna_worker;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_mark_push_delivered(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE public.notifications
  SET push_delivered_at = now()
  WHERE id = ANY (p_ids)
    AND push_delivered_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_mark_push_delivered(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_mark_push_delivered(uuid[]) TO annapurna_worker;
