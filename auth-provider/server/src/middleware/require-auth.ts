import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { validSession } from '../lib/session.js';
import { formatError } from '../lib/error.js';
import type { AppEnv } from '../lib/hono-env.js';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
    const requestId = c.get('requestId');

    const sessionToken = getCookie(c, 'session_id');
    if (!sessionToken) {
        return c.json(formatError('UNAUTHORIZED', 'Authentication required', requestId), 401);
    }

    const currentSession = await validSession(sessionToken);
    // session ada tapi gak valid lagi (expired/revoked/user nonaktif) tetap 401, bkn 400
    if (!currentSession) {
        return c.json(formatError('UNAUTHORIZED', 'Session is invalid, expired, or revoked', requestId), 401);
    }

    c.set('userId', currentSession.userId);

    await next();
});
