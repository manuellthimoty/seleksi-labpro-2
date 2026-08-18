import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../lib/hono-env.js";
import { db } from "../db/index.js";
import { localSessionsTable } from "../db/schema/index.js";
import { hashSessionToken } from "../lib/session-token.js";
import { logActivity } from "../lib/activity-log.js";

const logout = new Hono<AppEnv>();

logout.post('/logout', async (c) => {
    const sessionToken = getCookie(c, 'local_session');
    deleteCookie(c, 'local_session', { path: '/' });

    if (sessionToken) {
        const tokenHash = hashSessionToken(sessionToken);
        await db
            .update(localSessionsTable)
            .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'local_logout' })
            .where(eq(localSessionsTable.sessionTokenHash, tokenHash));
    }

    logActivity('local_session.logout', 'User logout lokal dari App A', c.get('requestId'));

    return c.redirect('/', 302);
});

export default logout;
