import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accessTokensTable, applicationsTable, usersTable, userGroupsTable, groupsTable } from '../db/schema/index.js';
import { hashToken } from '../lib/token-hash.js';
import { formatError } from '../lib/error.js';
import type { AppEnv } from '../lib/hono-env.js';

const userinfo = new Hono<AppEnv>();

const userinfoQuerySchema = z.object({
    client_id: z.string(),
});

userinfo.get('/userinfo', async (c) => {
    const requestId = c.get('requestId');

    const authHeader = c.req.header('authorization');
    const [scheme, rawToken] = (authHeader ?? '').split(' ');
    if (scheme !== 'Bearer' || !rawToken) {
        return c.json(formatError('UNAUTHORIZED', 'Missing Auth header', requestId), 401);
    }

    const parsed = userinfoQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { client_id } = parsed.data;

    const [application] = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.clientId, client_id)).limit(1);
    if (!application) {
        return c.json(formatError('INVALID_CLIENT', 'Unknown client_id', requestId), 401);
    }

    const tokenHash = hashToken(rawToken);
    const [accessToken] = await db.select().from(accessTokensTable).where(eq(accessTokensTable.tokenHash, tokenHash)).limit(1);
    if (!accessToken || accessToken.status !== 'active' || accessToken.expiresAt.getTime() < Date.now()) {
        return c.json(formatError('INVALID_TOKEN', 'Access token is invalid, revoked, or expired', requestId), 401);
    }

    // token diterbitkan buat application tertentu 
    // cegah App B pakai token yang aslinya buat App A
    if (accessToken.applicationId !== application.id) {
        return c.json(formatError('TOKEN_NOT_BOUND_TO_CLIENT', 'Access token was not issued to this client', requestId), 403);
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, accessToken.userId)).limit(1);
    if (!user || user.status !== 'active') {
        return c.json(formatError('UNAUTHORIZED', 'User is no longer active', requestId), 401);
    }

    const memberGroups = await db
        .select({ name: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id))
        .where(eq(userGroupsTable.userId, user.id));

    return c.json({
        sub: user.id,
        email: user.email,
        name: user.name,
        groups: memberGroups.map((g) => g.name),
        // diapke App A/B buat ngisi local_sessions.central_session_id
        sid: accessToken.ssoSessionId,
    });
});

export default userinfo;
