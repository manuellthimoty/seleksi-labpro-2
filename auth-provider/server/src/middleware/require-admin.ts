import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema/index.js';
import { formatError } from '../lib/error.js';
import type { AppEnv } from '../lib/hono-env.js';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get('userId');
    const requestId = c.get('requestId');

    const [user] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

    if (!user || user.role !== 'admin') {
        return c.json(formatError('FORBIDDEN', 'Admin access required', requestId), 403);
    }

    await next();
});
