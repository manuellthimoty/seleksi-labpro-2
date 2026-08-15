import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { validSession } from '../lib/session.js';
import type { AppEnv } from '../lib/hono-env.js';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
    const sessionToken = getCookie(c, 'session_id');
    if (!sessionToken) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: '...' } }, 401);
    }

    const currentSession = await validSession(sessionToken);
    if (!currentSession) {
        return c.json({ error: { code: 'INVALID', message: '...' } }, 400);
    }

    c.set('userId', currentSession.userId);

    await next();
});
