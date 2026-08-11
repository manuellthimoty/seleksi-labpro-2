import { timestamp, pgEnum, uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";

export const ssoSessionStatusEnum = pgEnum('sso_session_status', ['active', 'revoked', 'expired']);

export const ssoSessionsTable = pgTable("sso_sessions", {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  sessionTokenHash: varchar('session_token_hash').notNull().unique(),
  status: ssoSessionStatusEnum().notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
  revokeReason: varchar('revoke_reason'),
  ipAddress: varchar('ip_address'),
  userAgent: varchar('user_agent'),
});
