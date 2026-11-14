-- Recall records and worker liveness.
--
-- Recall used to be a status change plus an incident row: nothing tied a recalled
-- batch to the receipts that had already been issued for it, so nobody could
-- answer "who received food from this batch?". This migration adds the record
-- that answers it, with at most one open recall per donation and a snapshot of
-- the affected receipt count so a later correction cannot rewrite history.
--
-- It also grants the worker role what it needs to publish its own heartbeat into
-- service_health, and the web role read access to it, which is what makes a dead
-- worker visible instead of silently queueing notifications forever.

CREATE TABLE public.recall_records (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "donation_id" uuid NOT NULL REFERENCES public.donations("id"),
  "status" text DEFAULT 'open' NOT NULL,
  "reason" text NOT NULL,
  "affected_receipt_count" integer DEFAULT 0 NOT NULL,
  "recalled_status" text NOT NULL,
  "initiated_by" text NOT NULL REFERENCES public."user"("id"),
  "initiated_at" timestamptz DEFAULT now() NOT NULL,
  "closed_by" text REFERENCES public."user"("id"),
  "closed_at" timestamptz,
  "closure_note" text,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT recall_records_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT recall_records_reason_check CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  CONSTRAINT recall_records_affected_count_check CHECK (affected_receipt_count >= 0),
  CONSTRAINT recall_records_closure_fields_check CHECK (
    (status = 'open' AND closed_by IS NULL AND closed_at IS NULL)
    OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND closure_note IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX recall_records_donation_idx ON public.recall_records USING btree ("donation_id", "status");
--> statement-breakpoint
CREATE INDEX recall_records_open_idx ON public.recall_records USING btree ("initiated_at");
--> statement-breakpoint
-- A donation cannot carry two open recalls at once; a closed one may be followed
-- by a new one if the batch is later found to be affected again.
CREATE UNIQUE INDEX recall_records_one_open_per_donation ON public.recall_records ("donation_id") WHERE status = 'open';
--> statement-breakpoint

ALTER TABLE public.recall_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recall_records_select ON public.recall_records FOR SELECT
USING (
  public.app_has_platform_role(ARRAY['operations_admin','support_agent','safety_officer','security_admin'])
  OR public.app_can_view_donation(donation_id)
);
--> statement-breakpoint
CREATE POLICY recall_records_insert ON public.recall_records FOR INSERT
WITH CHECK (
  public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
  AND initiated_by = public.app_current_user_id()
);
--> statement-breakpoint
CREATE POLICY recall_records_update ON public.recall_records FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))
WITH CHECK (public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
-- No DELETE policy or grant: a recall record is evidence and is closed, not removed.
GRANT SELECT, INSERT, UPDATE ON TABLE public.recall_records TO annapurna_app;
--> statement-breakpoint

-- Worker heartbeat. The worker process writes its own row; the web application
-- only reads it. Neither statement grants anything to a public role.
GRANT SELECT ON TABLE public.service_health TO annapurna_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_health TO annapurna_worker;
