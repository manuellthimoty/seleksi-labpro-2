import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validSession } from '../lib/session.js';

const requireAuth = createMiddleware(async (c: Context, next) => {
    const sessionToken = c.req.cookie('session_id');
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
