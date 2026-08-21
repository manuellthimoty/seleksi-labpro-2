import { timestamp, pgEnum, uuid, pgTable, varchar } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum('user_status', ['active', 'inactive']);
export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const usersTable = pgTable("users", {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar().notNull(),
  email: varchar().notNull().unique(),
  passwordHash: varchar('password_hash').notNull(),
  status: userStatusEnum().notNull().default('active'),
  role: userRoleEnum().notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

