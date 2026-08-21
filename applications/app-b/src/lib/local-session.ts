import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { localSessionsTable } from "../db/schema/index.js";
import { hashSessionToken } from "./session-token.js";

export interface ValidLocalSession {
  id: string;
  externalUserId: string;
  status: "active" | "expired" | "revoked";
  createdAt: Date;
  expiresAt: Date;
}

export type LocalSessionInvalidReason = "missing" | "invalid" | "expired" | "revoked";

export type LocalSessionCheckResult =
  | { ok: true; session: ValidLocalSession }
  | { ok: false; reason: LocalSessionInvalidReason };

export async function checkLocalSession(sessionToken: string | undefined): Promise<LocalSessionCheckResult> {
  if (!sessionToken) {
    return { ok: false, reason: "missing" };
  }

  const tokenHash = hashSessionToken(sessionToken);
  const [session] = await db
    .select()
    .from(localSessionsTable)
    .where(eq(localSessionsTable.sessionTokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return { ok: false, reason: "invalid" };
  }
  if (session.status === "revoked") {
    return { ok: false, reason: "revoked" };
  }
  if (session.status === "expired" || session.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    session: {
      id: session.id,
      externalUserId: session.externalUserId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
  };
}
