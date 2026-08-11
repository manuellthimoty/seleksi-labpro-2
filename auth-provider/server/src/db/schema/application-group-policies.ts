import { timestamp, pgEnum, uuid, pgTable, unique } from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications.js";
import { groupsTable } from "./groups.js";

export const policyEffectEnum = pgEnum('policy_effect', ['allow', 'deny']);

export const applicationGroupPoliciesTable = pgTable("application_group_policies", {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applicationsTable.id),
  groupId: uuid('group_id').notNull().references(() => groupsTable.id),
  effect: policyEffectEnum().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('app_group_policies_application_id_group_id_effect_unique').on(table.applicationId, table.groupId, table.effect),
]);
