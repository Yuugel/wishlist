ALTER TABLE "activities" DROP CONSTRAINT "activities_change_data_check";--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_wish_title_length_check";--> statement-breakpoint
ALTER TYPE "public"."activity_event_type" RENAME TO "activity_event_type_old";--> statement-breakpoint
CREATE TYPE "public"."activity_event_type" AS ENUM('wish_changed', 'takeover_released_visibility_lost', 'wish_deleted', 'group_dissolved');--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "event_type" TYPE "public"."activity_event_type" USING "event_type"::text::"public"."activity_event_type";--> statement-breakpoint
DROP TYPE "public"."activity_event_type_old";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "wish_title" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "changed_fields" SET DEFAULT ARRAY[]::text[];--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "takeover_status" "wish_takeover_status";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "group_name" varchar(200);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_group_name_length_check" CHECK ("activities"."group_name" is null or char_length(btrim("activities"."group_name")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_event_data_check" CHECK ((
        "activities"."event_type" = 'wish_changed'
        and "activities"."wish_title" is not null
        and "activities"."takeover_status" is null
        and "activities"."group_name" is null
        and (cardinality("activities"."changed_fields") > 0 or cardinality("activities"."added_group_ids") > 0 or cardinality("activities"."removed_group_ids") > 0)
      ) or (
        "activities"."event_type" in ('takeover_released_visibility_lost', 'wish_deleted')
        and "activities"."wish_title" is not null
        and "activities"."takeover_status" is not null
        and "activities"."group_name" is null
        and cardinality("activities"."changed_fields") = 0
        and cardinality("activities"."added_group_ids") = 0
        and cardinality("activities"."removed_group_ids") = 0
      ) or (
        "activities"."event_type" = 'group_dissolved'
        and "activities"."wish_id" is null
        and "activities"."wish_title" is null
        and "activities"."takeover_status" is null
        and "activities"."group_name" is not null
        and cardinality("activities"."changed_fields") = 0
        and cardinality("activities"."added_group_ids") = 0
        and cardinality("activities"."removed_group_ids") = 0
      ));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_wish_title_length_check" CHECK ("activities"."wish_title" is null or char_length(btrim("activities"."wish_title")) between 1 and 200);