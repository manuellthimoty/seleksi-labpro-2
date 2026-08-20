import { timestamp, pgEnum, uuid, pgTable, varchar, jsonb } from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum('event_status', ['pending', 'published', 'failed']);

export const eventsTable = pgTable("events", {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type').notNull(),
  userId: uuid('user_id').notNull(),
  centralSessionId: uuid('central_session_id'),
  applicationId: uuid('application_id'),
  payload: jsonb('payload').notNull(),
  status: eventStatusEnum().notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
});
