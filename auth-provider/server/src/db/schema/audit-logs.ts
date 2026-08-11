import { timestamp, uuid, pgTable, varchar, jsonb } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: varchar('event_type').notNull(),
  actorId: uuid('actor_id'),
  userId: uuid('user_id'),
  applicationId: uuid('application_id'),
  sessionId: uuid('session_id'),
  result: varchar('result').notNull(),
  metadata: jsonb('metadata'),
  ipAddress: varchar('ip_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
