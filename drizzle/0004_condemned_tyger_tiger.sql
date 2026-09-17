CREATE TYPE "public"."wish_takeover_status" AS ENUM('reserved', 'purchased');--> statement-breakpoint
CREATE TABLE "wish_takeovers" (
	"wish_id" uuid PRIMARY KEY NOT NULL,
	"taker_id" uuid NOT NULL,
	"status" "wish_takeover_status" DEFAULT 'reserved' NOT NULL,
	"purchased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_takeovers_status_timestamp_check" CHECK (("wish_takeovers"."status" = 'reserved' and "wish_takeovers"."purchased_at" is null) or ("wish_takeovers"."status" = 'purchased' and "wish_takeovers"."purchased_at" is not null)),
	CONSTRAINT "wish_takeovers_updated_at_check" CHECK ("wish_takeovers"."updated_at" >= "wish_takeovers"."created_at"),
	CONSTRAINT "wish_takeovers_purchased_at_check" CHECK ("wish_takeovers"."purchased_at" is null or "wish_takeovers"."purchased_at" >= "wish_takeovers"."created_at")
);
--> statement-breakpoint
ALTER TABLE "wish_takeovers" ADD CONSTRAINT "wish_takeovers_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_takeovers" ADD CONSTRAINT "wish_takeovers_taker_id_users_id_fk" FOREIGN KEY ("taker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wish_takeovers_taker_id_index" ON "wish_takeovers" USING btree ("taker_id");