import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const processedEventsTable = pgTable("processed_events", {
  eventId: uuid('event_id').primaryKey(),
  eventType: varchar('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
  result: varchar('result').notNull(),
});
