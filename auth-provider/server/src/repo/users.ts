import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { usersTable } from "../db/schema/index.js";

export async function isUserActive(userId: string): Promise<boolean> {
    const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, userId), eq(usersTable.status, "active")))
        .limit(1);

    return Boolean(user);
}
