ALTER TABLE "rate_limit" DROP CONSTRAINT "rate_limit_pkey";--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD CONSTRAINT "rate_limit_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "rate_limit" ADD CONSTRAINT "rate_limit_key_unique" UNIQUE("key");