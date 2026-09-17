CREATE TYPE "public"."recovery_code_status" AS ENUM('active', 'claimed', 'consumed', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."webauthn_ceremony_type" AS ENUM('signup', 'authentication', 'add_credential', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."webauthn_device_type" AS ENUM('single_device', 'multi_device');--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"selector" varchar(22) NOT NULL,
	"digest" "bytea" NOT NULL,
	"pepper_key_version" integer NOT NULL,
	"status" "recovery_code_status" DEFAULT 'active' NOT NULL,
	"claim_id" uuid,
	"claimed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_codes_digest_length_check" CHECK (octet_length("recovery_codes"."digest") = 32),
	CONSTRAINT "recovery_codes_pepper_key_version_check" CHECK ("recovery_codes"."pepper_key_version" > 0),
	CONSTRAINT "recovery_codes_state_check" CHECK ((
        ("recovery_codes"."status" = 'active' and "recovery_codes"."claim_id" is null and "recovery_codes"."claimed_at" is null and "recovery_codes"."consumed_at" is null and "recovery_codes"."revoked_at" is null)
        or ("recovery_codes"."status" = 'claimed' and "recovery_codes"."claim_id" is not null and "recovery_codes"."claimed_at" is not null and "recovery_codes"."consumed_at" is null and "recovery_codes"."revoked_at" is null)
        or ("recovery_codes"."status" = 'consumed' and "recovery_codes"."claim_id" is not null and "recovery_codes"."claimed_at" is not null and "recovery_codes"."consumed_at" is not null and "recovery_codes"."revoked_at" is null)
        or ("recovery_codes"."status" = 'revoked' and "recovery_codes"."consumed_at" is null and "recovery_codes"."revoked_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" "bytea" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_digest_length_check" CHECK (octet_length("sessions"."token_digest") = 32),
	CONSTRAINT "sessions_expiry_check" CHECK ("sessions"."idle_expires_at" > "sessions"."created_at" and "sessions"."absolute_expires_at" >= "sessions"."idle_expires_at"),
	CONSTRAINT "sessions_revoked_at_check" CHECK ("sessions"."revoked_at" is null or "sessions"."revoked_at" >= "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webauthn_user_handle" "bytea" NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"email" varchar(320),
	"email_normalized" varchar(320),
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_webauthn_user_handle_length_check" CHECK (octet_length("users"."webauthn_user_handle") = 32),
	CONSTRAINT "users_email_pair_check" CHECK (("users"."email" is null and "users"."email_normalized" is null) or ("users"."email" is not null and "users"."email_normalized" is not null))
);
--> statement-breakpoint
CREATE TABLE "webauthn_ceremonies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "webauthn_ceremony_type" NOT NULL,
	"challenge_digest" "bytea" NOT NULL,
	"user_id" uuid,
	"recovery_code_id" uuid,
	"pending_user_handle" "bytea",
	"pending_display_name" varchar(200),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_ceremonies_challenge_digest_length_check" CHECK (octet_length("webauthn_ceremonies"."challenge_digest") = 32),
	CONSTRAINT "webauthn_ceremonies_pending_user_handle_length_check" CHECK ("webauthn_ceremonies"."pending_user_handle" is null or octet_length("webauthn_ceremonies"."pending_user_handle") = 32),
	CONSTRAINT "webauthn_ceremonies_expiry_check" CHECK ("webauthn_ceremonies"."expires_at" > "webauthn_ceremonies"."created_at"),
	CONSTRAINT "webauthn_ceremonies_consumed_at_check" CHECK ("webauthn_ceremonies"."consumed_at" is null or "webauthn_ceremonies"."consumed_at" >= "webauthn_ceremonies"."created_at"),
	CONSTRAINT "webauthn_ceremonies_attempts_check" CHECK ("webauthn_ceremonies"."attempt_count" >= 0 and "webauthn_ceremonies"."max_attempts" > 0 and "webauthn_ceremonies"."attempt_count" <= "webauthn_ceremonies"."max_attempts"),
	CONSTRAINT "webauthn_ceremonies_recovery_binding_check" CHECK ("webauthn_ceremonies"."type" <> 'recovery' or "webauthn_ceremonies"."recovery_code_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" "bytea" NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"device_type" "webauthn_device_type" NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"aaguid" uuid,
	"label" varchar(100),
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credentials_credential_id_length_check" CHECK (octet_length("webauthn_credentials"."credential_id") between 1 and 1023),
	CONSTRAINT "webauthn_credentials_public_key_length_check" CHECK (octet_length("webauthn_credentials"."public_key") > 0),
	CONSTRAINT "webauthn_credentials_counter_check" CHECK ("webauthn_credentials"."counter" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_ceremonies" ADD CONSTRAINT "webauthn_ceremonies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_ceremonies" ADD CONSTRAINT "webauthn_ceremonies_recovery_code_id_recovery_codes_id_fk" FOREIGN KEY ("recovery_code_id") REFERENCES "public"."recovery_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_selector_unique" ON "recovery_codes" USING btree ("selector");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_claim_id_unique" ON "recovery_codes" USING btree ("claim_id") WHERE "recovery_codes"."claim_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_one_active_per_user_unique" ON "recovery_codes" USING btree ("user_id") WHERE "recovery_codes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "recovery_codes_user_id_index" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_digest_unique" ON "sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_idle_expires_at_index" ON "sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_absolute_expires_at_index" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_webauthn_user_handle_unique" ON "users" USING btree ("webauthn_user_handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree ("email_normalized") WHERE "users"."email_normalized" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_ceremonies_challenge_digest_unique" ON "webauthn_ceremonies" USING btree ("challenge_digest");--> statement-breakpoint
CREATE INDEX "webauthn_ceremonies_user_id_index" ON "webauthn_ceremonies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webauthn_ceremonies_recovery_code_id_index" ON "webauthn_ceremonies" USING btree ("recovery_code_id");--> statement-breakpoint
CREATE INDEX "webauthn_ceremonies_expires_at_index" ON "webauthn_ceremonies" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_unique" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_id_index" ON "webauthn_credentials" USING btree ("user_id");