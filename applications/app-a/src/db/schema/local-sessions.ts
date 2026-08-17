import { pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const localSessionStatusEnum = pgEnum('local_session_status', ['active', 'expired', 'revoked']);

export const localSessionsTable = pgTable("local_sessions", {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionTokenHash: varchar('session_token_hash').notNull().unique(),
  externalUserId: uuid('external_user_id').notNull(),
  centralSessionId: uuid('central_session_id').notNull(),
  applicationId: uuid('application_id'),
  status: localSessionStatusEnum().notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  lastActivityAt: timestamp('last_activity_at'),
  revokedAt: timestamp('revoked_at'),
  revokeReason: varchar('revoke_reason'),
});
