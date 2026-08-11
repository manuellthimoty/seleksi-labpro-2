import { timestamp, uuid, pgTable, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";
import { groupsTable } from "./groups.js";

export const userGroupsTable = pgTable("user_groups", {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  groupId: uuid('group_id').notNull().references(() => groupsTable.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('user_groups_user_id_group_id_unique').on(table.userId, table.groupId),
]);
