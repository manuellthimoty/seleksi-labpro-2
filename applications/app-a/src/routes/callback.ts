import { Hono } from "hono";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../lib/hono-env.js";
import { db } from "../db/index.js";
import { localSessionsTable, profileCacheTable } from "../db/schema/index.js";
import { exchangeCodeForToken, fetchUserinfo, AuthProviderError } from "../lib/auth-provider-client.js";
import { generateSessionToken, hashSessionToken } from "../lib/session-token.js";
import { formatError } from "../lib/error.js";
import { logActivity } from "../lib/activity-log.js";

const callback = new Hono<AppEnv>();

const LOCAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // samain dengan TTL central session

const callbackQuerySchema = z.object({
    code: z.string(),
    state: z.string(),
});

interface PendingOauth {
    state: string;
    codeVerifier: string;
}

callback.get('/auth/callback', async (c) => {
    const requestId = c.get('requestId');

    const pendingRaw = getCookie(c, 'oauth_pending');
    deleteCookie(c, 'oauth_pending', { path: '/' });

    const errorParam = c.req.query('error');
    if (errorParam) {
        logActivity('oauth.callback.denied', `Auth Provider menolak login: ${errorParam}`, requestId);
        return c.json(formatError('ACCESS_DENIED', 'Login ditolak oleh Auth Provider', requestId), 403);
    }

    const parsed = callbackQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { code, state } = parsed.data;

    if (!pendingRaw) {
        logActivity('oauth.callback.rejected', 'oauth_pending cookie tidak ada (hilang/kedaluwarsa)', requestId);
        return c.json(formatError('INVALID_STATE', 'Sesi login sudah kedaluwarsa, silakan login ulang', requestId), 400);
    }

    let pending: PendingOauth;
    try {
        pending = JSON.parse(pendingRaw) as PendingOauth;
    } catch {
        logActivity('oauth.callback.rejected', 'oauth_pending cookie rusak', requestId);
        return c.json(formatError('INVALID_STATE', 'Sesi login tidak valid, silahkan login ulang', requestId), 400);
    }

    if (pending.state !== state) { // ga cocok
        logActivity('oauth.callback.rejected', 'state tidak cocok — potensi CSRF', requestId);
        return c.json(formatError('INVALID_STATE', 'state tidak cocok', requestId), 400);
    }

    logActivity('oauth.callback.received', 'Menerima authorization code dari Auth Provider', requestId);

    let tokenResponse;
    try {
        tokenResponse = await exchangeCodeForToken({ code, codeVerifier: pending.codeVerifier });
    } catch (err) {
        const message = err instanceof AuthProviderError ? err.message : 'Gagal menukar authorization code ke token';
        logActivity('oauth.token.failed', message, requestId);
        return c.json(formatError('TOKEN_EXCHANGE_FAILED', message, requestId), 400);
    }
    logActivity('oauth.token.received', 'Access token diterima dari Auth Provider', requestId);

    let userinfo;
    try {
        userinfo = await fetchUserinfo(tokenResponse.access_token);
    } catch (err) {
        const message = err instanceof AuthProviderError ? err.message : 'Gagal mengambil identitas user';
        logActivity('oauth.userinfo.failed', message, requestId);
        return c.json(formatError('USERINFO_FAILED', message, requestId), 400);
    }
    logActivity('oauth.userinfo.received', `Identitas diterima: ${userinfo.email}`, requestId);

    const now = new Date();
    await db
        .insert(profileCacheTable)
        .values({
            externalUserId: userinfo.sub,
            name: userinfo.name,
            email: userinfo.email,
            groups: userinfo.groups,
            syncedAt: now,
        })
        .onConflictDoUpdate({
            target: profileCacheTable.externalUserId,
            set: {
                name: userinfo.name,
                email: userinfo.email,
                groups: userinfo.groups,
                syncedAt: now,
                updatedAt: now,
            },
        });

    const rawSessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(rawSessionToken);
    const expiresAt = new Date(now.getTime() + LOCAL_SESSION_TTL_MS);

    await db.insert(localSessionsTable).values({
        sessionTokenHash,
        externalUserId: userinfo.sub,
        centralSessionId: userinfo.sid,
        status: 'active',
        expiresAt,
        lastActivityAt: now,
    });

    setCookie(c, 'local_session', rawSessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: LOCAL_SESSION_TTL_MS / 1000,
        path: '/',
    });

    logActivity('local_session.created', `Local session dibuat untuk ${userinfo.email}`, requestId);

    return c.redirect('/', 302);
});

export default callback;
