CREATE TYPE "public"."local_session_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "local_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_token_hash" varchar NOT NULL,
	"external_user_id" uuid NOT NULL,
	"central_session_id" uuid NOT NULL,
	"application_id" uuid,
	"status" "local_session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_activity_at" timestamp,
	"revoked_at" timestamp,
	"revoke_reason" varchar,
	CONSTRAINT "local_sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "profile_cache" (
	"external_user_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"groups" json,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"result" varchar NOT NULL
);
