import { timestamp, uuid, pgTable, varchar } from "drizzle-orm/pg-core";

export const groupsTable = pgTable("groups", {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name').notNull().unique(),
  description: varchar('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
