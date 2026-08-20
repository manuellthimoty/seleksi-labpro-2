import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getCookie, deleteCookie } from 'hono/cookie';
import { db } from '../db/index.js';
import { applicationsTable, accessTokensTable, ssoSessionsTable } from '../db/schema/index.js';
import { verifyPassword } from '../lib/password.js';
import { hashToken } from '../lib/token-hash.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import { recordEvent } from '../lib/events.js';
import type { AppEnv } from '../lib/hono-env.js';

const logout = new Hono<AppEnv>();

const logoutSchema = z.object({
    client_id: z.string(),
    client_secret: z.string(),
    access_token: z.string(),
});

// Logout lokal per-application (bukan central/SSO logout)
// saat user klik "logout" di app itu doang, ekuivalen dgn ngerevoke access_token dr yang bersangkutan
// sso_sessions (central session) tetap hidup, jadi user masih login di app lain
logout.post('/logout', async (c) => {
    const requestId = c.get('requestId');
    const parsed = logoutSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { client_id, client_secret, access_token } = parsed.data;

    const [application] = await db.select().from(applicationsTable).where(eq(applicationsTable.clientId, client_id)).limit(1);
    if (!application) {
        return c.json(formatError('INVALID_CLIENT', 'Unknown client_id', requestId), 401);
    }
    const validSecret = await verifyPassword(client_secret, application.clientSecretHash);
    if (!validSecret) {
        return c.json(formatError('INVALID_CLIENT', 'client_secret is incorrect', requestId), 401);
    }

    const tokenHash = hashToken(access_token);

    const [revoked] = await db
        .update(accessTokensTable)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(
            and(
                eq(accessTokensTable.tokenHash, tokenHash),
                eq(accessTokensTable.applicationId, application.id),
                eq(accessTokensTable.status, 'active'),
            ),
        )
        .returning({ id: accessTokensTable.id, userId: accessTokensTable.userId, ssoSessionId: accessTokensTable.ssoSessionId });

    if (revoked) {
        await logAuditEvent({
            eventType: 'app.logout',
            result: 'success',
            userId: revoked.userId,
            applicationId: application.id,
            sessionId: revoked.ssoSessionId,
        });
    }
    return c.body(null, 204);
});

logout.post('/logout/sso', async (c) => {
    const sessionToken = getCookie(c, 'session_id');
    deleteCookie(c, 'session_id', { path: '/' });

    if (!sessionToken) {
        return c.body(null, 204);
    }

    const tokenHash = hashToken(sessionToken);

    const revoked = await db.transaction(async (tx) => {
        const [session] = await tx
            .update(ssoSessionsTable)
            .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'user_logout' })
            .where(and(eq(ssoSessionsTable.sessionTokenHash, tokenHash), eq(ssoSessionsTable.status, 'active')))
            .returning({ id: ssoSessionsTable.id, userId: ssoSessionsTable.userId });

        if (!session) {
            return null;
        }

        await tx
            .update(accessTokensTable)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(and(eq(accessTokensTable.ssoSessionId, session.id), eq(accessTokensTable.status, 'active')));

        const event = await recordEvent(tx, {
            eventType: 'SessionRevoked',
            userId: session.userId,
            centralSessionId: session.id,
            reason: 'sso_logout',
            metadata: { revokedBy: 'user' },
        });

        return { session, event };
    });

    if (!revoked) {
        return c.body(null, 204);
    }

    await logAuditEvent({
        eventType: 'sso_session.revoke',
        result: 'success',
        userId: revoked.session.userId,
        sessionId: revoked.session.id,
        metadata: { eventId: revoked.event.eventId },
    });

    return c.body(null, 204);
});

export default logout;
