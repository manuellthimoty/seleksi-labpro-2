import { timestamp, pgEnum, uuid, pgTable, integer, varchar, unique } from "drizzle-orm/pg-core";

export const eventDeliveryStatusEnum = pgEnum('event_delivery_status', [
  'pending',
  'processing',
  'succeeded',
  'retrying',
  'failed',
]);

export const eventDeliveriesTable = pgTable("event_deliveries", {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull(),
  applicationId: uuid('application_id').notNull(),
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
