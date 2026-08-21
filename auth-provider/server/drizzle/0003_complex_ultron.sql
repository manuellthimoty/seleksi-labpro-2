CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
-- safety backfill: kolom ini baru jadi NOT NULL, row lama (dibuat sebelum
-- migration ini) yang masih NULL perlu diisi dulu biar ALTER-nya gak gagal
UPDATE "applications" SET "logout_notification_url" = 'about:blank' WHERE "logout_notification_url" IS NULL;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "logout_notification_url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;