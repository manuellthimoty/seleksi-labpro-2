import { timestamp, pgEnum, uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";
import { applicationsTable } from "./applications.js";
import { ssoSessionsTable } from "./sso-sessions.js";

export const accessTokenStatusEnum = pgEnum('access_token_status', ['active', 'revoked', 'expired']);

export const accessTokensTable = pgTable("access_tokens", {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: varchar('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  applicationId: uuid('application_id').notNull().references(() => applicationsTable.id),
  ssoSessionId: uuid('sso_session_id').notNull().references(() => ssoSessionsTable.id),
  scopes: varchar('scopes').notNull(),
  status: accessTokenStatusEnum().notNull().default('active'),
  issuedAt: timestamp('issued_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
});
