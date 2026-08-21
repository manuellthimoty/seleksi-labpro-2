import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { pool } from './db/index.js';
import type { AppEnv } from './lib/hono-env.js';
import { requestId } from './middleware/request-id.js';
import home from './routes/home.js';
import login from './routes/login.js';
import callback from './routes/callback.js';
import logout from './routes/logout.js';
import internal from './routes/internal.js';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/', home);
app.route('/', login);
app.route('/', callback);
app.route('/', logout);
app.route('/', internal);

const port = Number(process.env.PORT) || 4000;

const server = serve({
    fetch : app.fetch,
    port,
});

console.log(`app A listening on port ${port}`);

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000;
let shutdownStarted = false;

async function shutdown(signal: string) {
    if (shutdownStarted) return;
    shutdownStarted = true;
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
