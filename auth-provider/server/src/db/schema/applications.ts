import { timestamp, pgEnum, uuid, pgTable, varchar } from "drizzle-orm/pg-core";

export const applicationStatusEnum = pgEnum('application_status', ['active', 'inactive']);

export const applicationsTable = pgTable("applications", {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name').notNull(),
  clientId: varchar('client_id').notNull().unique(),
  clientSecretHash: varchar('client_secret_hash').notNull(),
  status: applicationStatusEnum().notNull().default('active'),
  launchUrl: varchar('launch_url').notNull(),
  logoutNotificationUrl: varchar('logout_notification_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
