CREATE TYPE "public"."activity_event_type" AS ENUM('wish_changed');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"event_type" "activity_event_type" NOT NULL,
	"wish_id" uuid,
	"wish_title" varchar(200) NOT NULL,
	"changed_fields" text[] NOT NULL,
	"added_group_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"removed_group_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_wish_title_length_check" CHECK (char_length(btrim("activities"."wish_title")) between 1 and 200),
	CONSTRAINT "activities_changed_fields_check" CHECK ("activities"."changed_fields" <@ ARRAY['title', 'description', 'link', 'priceText']::text[]),
	CONSTRAINT "activities_change_data_check" CHECK (cardinality("activities"."changed_fields") > 0 or cardinality("activities"."added_group_ids") > 0 or cardinality("activities"."removed_group_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_recipient_created_at_index" ON "activities" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_wish_id_index" ON "activities" USING btree ("wish_id");