ALTER TABLE "private_documents" ADD COLUMN "scan_status" text DEFAULT 'unscanned' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "requested_role" "requested_role";