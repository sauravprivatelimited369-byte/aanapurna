ALTER TABLE "data_requests" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "data_requests" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.support_cases
  ADD CONSTRAINT support_cases_status_check CHECK (status IN ('open','in_progress','awaiting_user','resolved','closed'));
--> statement-breakpoint
ALTER TABLE public.data_requests
  ADD CONSTRAINT data_requests_status_check CHECK (status IN ('submitted','in_review','awaiting_user','completed','rejected'));
--> statement-breakpoint
DROP POLICY support_cases_update ON public.support_cases;
CREATE POLICY support_cases_update ON public.support_cases FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['support_agent','operations_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['support_agent','operations_admin']));
--> statement-breakpoint
DROP POLICY data_requests_update ON public.data_requests;
CREATE POLICY data_requests_update ON public.data_requests FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint
GRANT UPDATE (resolution, reviewed_by) ON TABLE public.data_requests TO annapurna_app;
