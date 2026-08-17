import { json, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const profileCacheTable = pgTable("profile_cache", {
  externalUserId: uuid('external_user_id').primaryKey(),
  name: varchar('name').notNull(),
  email: varchar('email').notNull(),
  groups: json('groups'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
