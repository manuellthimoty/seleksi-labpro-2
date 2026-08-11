import { timestamp, uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications.js";

export const applicationRedirectUrisTable = pgTable("application_redirect_uris", {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applicationsTable.id),
  redirectUri: varchar('redirect_uri').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
