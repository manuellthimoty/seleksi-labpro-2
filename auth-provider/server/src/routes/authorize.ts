import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db } from '../db/index.js';
import {
    applicationsTable,
    applicationRedirectUrisTable,
    applicationGroupPoliciesTable,
    userGroupsTable,
    authorizationCodesTable,
    usersTable,
} from '../db/schema/index.js';
import { validSession } from '../lib/session.js';
import { generateToken } from '../lib/token.js';
import { hashToken } from '../lib/token-hash.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import type { AppEnv } from '../lib/hono-env.js';

const authorize = new Hono<AppEnv>();

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000; // 5 menit

const authorizeQuerySchema = z.object({
    response_type: z.literal('code'),
    client_id: z.string(),
    redirect_uri: z.string().url(),
    state: z.string(),
    code_challenge: z.string(),
    code_challenge_method: z.literal('S256'),
});

authorize.get('/authorize', async (c) => {
    const requestId = c.get('requestId');
    const parsed = authorizeQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { client_id, redirect_uri, state, code_challenge } = parsed.data;

    // client_id & redirect_uri belum terverifikasi di titik ini
    // jadi, jgn lgsung redirect ke redirect_uri, balikin JSON error langsung
    const [application] = await db
        .select()
        .from(applicationsTable)
        .where(eq(applicationsTable.clientId, client_id))
        .limit(1);
    if (!application) {
        return c.json(formatError('INVALID_CLIENT', 'Unknown client_id', requestId), 400);
    }

    // status application harus active
    if (application.status !== 'active') {
        return c.json(formatError('CLIENT_INACTIVE', 'This client is inactive', requestId), 400);
    }

    const [registeredUri] = await db
        .select({ id: applicationRedirectUrisTable.id })
        .from(applicationRedirectUrisTable)
        .where(
            and(
                eq(applicationRedirectUrisTable.applicationId, application.id),
                eq(applicationRedirectUrisTable.redirectUri, redirect_uri),
            ),
        )
        .limit(1);
    if (!registeredUri) {
        return c.json(formatError('INVALID_REDIRECT_URI', 'redirect_uri is not registered for this client', requestId), 400);
    }

    // dari sini redirect_uri sudah terverifikasi milik application ini, aman dipakai buat redirect 
    const sessionToken = getCookie(c, 'session_id');
    const session = sessionToken ? await validSession(sessionToken) : null;
    if (!session) {
        const nextUrl = new URL(c.req.url);
        const loginUrl = new URL('/login', nextUrl.origin);
        loginUrl.searchParams.set('redirect_to', nextUrl.pathname + nextUrl.search);
        return c.redirect(loginUrl.toString(), 302);
    }

    // status user harus active 
    // asumsi aja terdapat user udh dideactive, tp session masih valid
    const [user] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
    if (!user || user.status !== 'active') {
        await logAuditEvent({
            eventType: 'authorization.denied',
            result: 'failure',
            userId: session.userId,
            applicationId: application.id,
            sessionId: session.id,
            metadata: { reason: 'user_inactive' },
        });
        const deniedUrl = new URL(redirect_uri);
        deniedUrl.searchParams.set('error', 'access_denied');
        deniedUrl.searchParams.set('state', state);
        return c.redirect(deniedUrl.toString(), 302);
    }

    const memberGroups = await db
        .select({ id: userGroupsTable.groupId })
        .from(userGroupsTable)
        .where(eq(userGroupsTable.userId, session.userId));
    const groupIds = memberGroups.map((g) => g.id);

    const policies = groupIds.length
        ? await db
              .select({ effect: applicationGroupPoliciesTable.effect })
              .from(applicationGroupPoliciesTable)
              .where(
                  and(
                      eq(applicationGroupPoliciesTable.applicationId, application.id),
                      inArray(applicationGroupPoliciesTable.groupId, groupIds),
                  ),
              )
        : [];

    const isDenied = policies.some((p) => p.effect === 'deny');
    const isAllowed = policies.some((p) => p.effect === 'allow');
    if (isDenied || !isAllowed) {
        await logAuditEvent({
            eventType: 'authorization.denied',
            result: 'failure',
            userId: session.userId,
            applicationId: application.id,
            sessionId: session.id,
        });
        const deniedUrl = new URL(redirect_uri);
        deniedUrl.searchParams.set('error', 'access_denied');
        deniedUrl.searchParams.set('state', state);
        return c.redirect(deniedUrl.toString(), 302);
    }

    const rawCode = generateToken();
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS);

    await db.insert(authorizationCodesTable).values({
        codeHash,
        userId: session.userId,
        applicationId: application.id,
        ssoSessionId: session.id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        expiresAt,
    });

    await logAuditEvent({
        eventType: 'authorization.code.issue',
        result: 'success',
        userId: session.userId,
        applicationId: application.id,
        sessionId: session.id,
    });

    const successUrl = new URL(redirect_uri);
    successUrl.searchParams.set('code', rawCode);
    successUrl.searchParams.set('state', state);
    return c.redirect(successUrl.toString(), 302);
});

export default authorize;
