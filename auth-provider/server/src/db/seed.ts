import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { db, pool } from "./index.js";
import {
  usersTable,
  groupsTable,
  userGroupsTable,
  applicationsTable,
  applicationRedirectUrisTable,
  applicationGroupPoliciesTable,
} from "./schema/index.js";

async function getOrCreateUser(input: { name: string; email: string; password: string; status?: "active" | "inactive" }) {
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, input.email));
  if (existing[0]) return existing[0];

  const passwordHash = await argon2.hash(input.password);
  const [row] = await db
    .insert(usersTable)
    .values({
      name: input.name,
      email: input.email,
      passwordHash,
      status: input.status ?? "active",
    })
    .returning();
  return row;
}


async function getOrCreateGroup(input: { name: string; description?: string }) {
  const existing = await db.select().from(groupsTable).where(eq(groupsTable.name, input.name));
  if (existing[0]) return existing[0];

  const [row] = await db.insert(groupsTable).values(input).returning();
  return row;
}

async function addUserToGroup(userId: string, groupId: string) {
  const existing = await db
    .select()
    .from(userGroupsTable)
    .where(eq(userGroupsTable.userId, userId));
  if (existing.some((row) => row.groupId === groupId)) return;

  await db.insert(userGroupsTable).values({ userId, groupId });
}

async function getOrCreateApplication(input: {
  name: string;
  clientId: string;
  clientSecret: string;
  launchUrl: string;
  redirectUri: string;
}) {
  const existing = await db.select().from(applicationsTable).where(eq(applicationsTable.clientId, input.clientId));
  let application = existing[0];

  if (!application) {
    const clientSecretHash = await argon2.hash(input.clientSecret);
    [application] = await db
      .insert(applicationsTable)
      .values({
        name: input.name,
        clientId: input.clientId,
        clientSecretHash,
        launchUrl: input.launchUrl,
        status: "active",
      })
      .returning();
  }

  const existingRedirects = await db
    .select()
    .from(applicationRedirectUrisTable)
    .where(eq(applicationRedirectUrisTable.applicationId, application.id));
  if (!existingRedirects.some((row) => row.redirectUri === input.redirectUri)) {
    await db.insert(applicationRedirectUrisTable).values({
      applicationId: application.id,
      redirectUri: input.redirectUri,
    });
  }

  return application;
}

async function allowGroupForApplication(applicationId: string, groupId: string) {
  const existing = await db
    .select()
    .from(applicationGroupPoliciesTable)
    .where(eq(applicationGroupPoliciesTable.applicationId, applicationId));
  if (existing.some((row) => row.groupId === groupId && row.effect === "allow")) return;

  await db.insert(applicationGroupPoliciesTable).values({
    applicationId,
    groupId,
    effect: "allow",
  });
}

async function main() {
  console.log("Start DB Seeding");

  const adminsGroup = await getOrCreateGroup({ name: "admins", description: "Full access administrators" });
  const usersGroup = await getOrCreateGroup({ name: "users", description: "Regular end users" });

  const admin = await getOrCreateUser({ name: "Admin", email: "admin@example.com", password: "Admin123!" });
  await addUserToGroup(admin.id, adminsGroup.id);

  const dummyUsers = await Promise.all([
    getOrCreateUser({ name: "User One", email: "user1@example.com", password: "Password123!" }),
    getOrCreateUser({ name: "User Two", email: "user2@example.com", password: "Password123!" }),
    getOrCreateUser({ name: "User Three (inactive)", email: "user3@example.com", password: "Password123!", status: "inactive" }),
  ]);
  for (const user of dummyUsers) {
    await addUserToGroup(user.id, usersGroup.id);
  }

  const appA = await getOrCreateApplication({
    name: "App A",
    clientId: "app-a",
    clientSecret: "app-a-secret",
    launchUrl: "http://localhost:4000",
    redirectUri: "http://localhost:4000/callback",
  });
  const appB = await getOrCreateApplication({
    name: "App B",
    clientId: "app-b",
    clientSecret: "app-b-secret",
    launchUrl: "http://localhost:5000",
    redirectUri: "http://localhost:5000/callback",
  });

  await allowGroupForApplication(appA.id, adminsGroup.id);
  await allowGroupForApplication(appA.id, usersGroup.id);
  await allowGroupForApplication(appB.id, adminsGroup.id);
  await allowGroupForApplication(appB.id, usersGroup.id);

  console.log("Seed complete.");
}

await main();
await pool.end();
