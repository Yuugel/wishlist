CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"algorithm" varchar(32) NOT NULL,
	"salt" "bytea" NOT NULL,
	"derived_key" "bytea" NOT NULL,
	"cost" integer NOT NULL,
	"block_size" integer NOT NULL,
	"parallelization" integer NOT NULL,
	"key_length" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_credentials_algorithm_check" CHECK ("password_credentials"."algorithm" = 'scrypt'),
	CONSTRAINT "password_credentials_salt_length_check" CHECK (octet_length("password_credentials"."salt") between 16 and 64),
	CONSTRAINT "password_credentials_derived_key_length_check" CHECK (octet_length("password_credentials"."derived_key") = "password_credentials"."key_length" and "password_credentials"."key_length" between 16 and 64),
	CONSTRAINT "password_credentials_parameters_check" CHECK ("password_credentials"."cost" >= 16384 and "password_credentials"."block_size" > 0 and "password_credentials"."parallelization" > 0)
);
--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;