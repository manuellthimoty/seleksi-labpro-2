import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { requestId } from './middleware/request-id.js';
import { requireAuth } from './middleware/require-auth.js';
import { requireAdmin } from './middleware/require-admin.js';
import type { AppEnv } from './lib/hono-env.js';
import auth from './routes/auth.js';
import authorize from './routes/authorize.js';
import token from './routes/token.js';
import userinfo from './routes/userinfo.js';
import logout from './routes/logout.js';
import users from './routes/users.js';
import groups from './routes/groups.js';
import applications from './routes/applications.js';
import admin from './routes/admin.js';
import health from './routes/health.js';
import { pool } from './db/index.js';
import { beginShutdown } from './lib/lifecycle.js';
import { startEventPublisher } from './lib/event-publisher.js';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.get('/', (c) => {
    return c.text('auth server don');
});

app.route('/', health);

// public
app.route('/', auth);
app.route('/', authorize);
app.route('/', token);
app.route('/', userinfo);
app.route('/', logout);

app.use('/users/*', requireAuth, requireAdmin);
app.route('/users', users);

app.use('/groups/*', requireAuth, requireAdmin);
app.route('/groups', groups);

app.use('/applications/*', requireAuth, requireAdmin);
app.route('/applications', applications);

app.route('/admin', admin);

const port = Number(process.env.PORT) || 3000;

const server = serve({
    fetch: app.fetch,
    port,
});

console.log(`Auth listening on port ${port}`);

const stopEventPublisher = process.env.EVENT_PUBLISHER_ENABLED === 'false' ? null : startEventPublisher();

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000;
let shutdownStarted = false;

async function shutdown(signal: string) {
    if (shutdownStarted) return;
    shutdownStarted = true;

    beginShutdown();
    console.log(`[shutdown] ${signal} diterima, berhenti nerima request baru`);

    const forceTimer = setTimeout(() => {
        console.warn(`[shutdown] masih ada request setelah ${SHUTDOWN_TIMEOUT_MS}ms, ditutup paksa`);
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    }, SHUTDOWN_TIMEOUT_MS);

    await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
    });
    clearTimeout(forceTimer);
    console.log('[shutdown] request in-flight selesai, listener ditutup');

    await stopEventPublisher?.();
    console.log('[shutdown] koneksi RabbitMQ ditutup');

    await pool.end();
    console.log('[shutdown] pool Postgres ditutup');

    console.log('[shutdown] selesai');
    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        void shutdown(signal);
    });
}
