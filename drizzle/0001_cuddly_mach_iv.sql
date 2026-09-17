CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"selector" varchar(22) NOT NULL,
	"digest" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_invites_digest_length_check" CHECK (octet_length("group_invites"."digest") = 32),
	CONSTRAINT "group_invites_expiry_check" CHECK ("group_invites"."expires_at" > "group_invites"."created_at")
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_length_check" CHECK (char_length(btrim("groups"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_invites_selector_unique" ON "group_invites" USING btree ("selector");--> statement-breakpoint
CREATE INDEX "group_invites_group_id_index" ON "group_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_invites_expires_at_index" ON "group_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "group_memberships_user_id_index" ON "group_memberships" USING btree ("user_id");