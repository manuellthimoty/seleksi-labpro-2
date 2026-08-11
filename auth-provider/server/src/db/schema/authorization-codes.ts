import { timestamp, uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";
import { applicationsTable } from "./applications.js";
import { ssoSessionsTable } from "./sso-sessions.js";

export const authorizationCodesTable = pgTable("authorization_codes", {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: varchar('code_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  applicationId: uuid('application_id').notNull().references(() => applicationsTable.id),
  ssoSessionId: uuid('sso_session_id').notNull().references(() => ssoSessionsTable.id),
  redirectUri: varchar('redirect_uri').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
});
