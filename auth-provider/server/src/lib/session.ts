import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { ssoSessionsTable } from "../db/schema/index.js";
import { hashToken } from "./token-hash.js";

export interface ValidSession {
  id: string;
  userId: string;
}

export async function validSession(sessionToken: string): Promise<ValidSession | null> {
  const tokenHash = hashToken(sessionToken);

  const [session] = await db
    .select({ id: ssoSessionsTable.id, userId: ssoSessionsTable.userId })
    .from(ssoSessionsTable)
    .where(
      and(
        eq(ssoSessionsTable.sessionTokenHash, tokenHash),
        eq(ssoSessionsTable.status, "active"),
        gt(ssoSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return session ?? null;
}
