import { timestamp, pgEnum, uuid, pgTable, varchar, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";
import { applicationsTable } from "./applications.js";
import { ssoSessionsTable } from "./sso-sessions.js";

export const eventStatusEnum = pgEnum('event_status', ['pending', 'published', 'failed']);

export const eventsTable = pgTable("events", {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type').notNull(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  centralSessionId: uuid('central_session_id').references(() => ssoSessionsTable.id),
  applicationId: uuid('application_id').references(() => applicationsTable.id),
  payload: jsonb('payload').notNull(),
  status: eventStatusEnum().notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
});
