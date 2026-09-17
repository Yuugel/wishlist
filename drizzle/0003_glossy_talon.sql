CREATE TABLE "wish_groups" (
	"wish_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wish_groups_wish_id_group_id_pk" PRIMARY KEY("wish_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"link" varchar(2048),
	"price_text" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishes_title_length_check" CHECK (char_length(btrim("wishes"."title")) between 1 and 200),
	CONSTRAINT "wishes_description_length_check" CHECK ("wishes"."description" is null or char_length("wishes"."description") <= 5000),
	CONSTRAINT "wishes_link_length_check" CHECK ("wishes"."link" is null or char_length(btrim("wishes"."link")) between 1 and 2048),
	CONSTRAINT "wishes_price_text_length_check" CHECK ("wishes"."price_text" is null or char_length(btrim("wishes"."price_text")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "wish_groups" ADD CONSTRAINT "wish_groups_wish_id_wishes_id_fk" FOREIGN KEY ("wish_id") REFERENCES "public"."wishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wish_groups" ADD CONSTRAINT "wish_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishes" ADD CONSTRAINT "wishes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wish_groups_group_id_index" ON "wish_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "wishes_owner_id_index" ON "wishes" USING btree ("owner_id");