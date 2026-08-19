import { timestamp, pgEnum, uuid, pgTable, varchar, integer, unique } from "drizzle-orm/pg-core";
import { eventsTable } from "./events.js";
import { applicationsTable } from "./applications.js";

export const eventDeliveryStatusEnum = pgEnum('event_delivery_status', [
  'pending',
  'processing',
  'succeeded',
  'retrying',
  'failed',
]);

export const eventDeliveriesTable = pgTable("event_deliveries", {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => eventsTable.id),
  applicationId: uuid('application_id').notNull().references(() => applicationsTable.id),
  status: eventDeliveryStatusEnum().notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  nextRetryAt: timestamp('next_retry_at'),
  processedAt: timestamp('processed_at'),
  lastError: varchar('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('event_deliveries_event_id_application_id_unique').on(table.eventId, table.applicationId),
]);
