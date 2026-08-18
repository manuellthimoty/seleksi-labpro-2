import { randomUUID } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../lib/hono-env.js';

export const requestId = createMiddleware<AppEnv>(async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
});
