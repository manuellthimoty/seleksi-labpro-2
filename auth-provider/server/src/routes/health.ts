import { Hono } from 'hono';
import { readinessReport } from '../lib/health.js';
import { isShuttingDown } from '../lib/lifecycle.js';
import type { AppEnv } from '../lib/hono-env.js';

const health = new Hono<AppEnv>();

health.get('/health/live', (c) => c.json({ status: 'ok' }));

health.get('/health/ready', async (c) => {
    if (isShuttingDown()) {
        return c.json({ status: 'unavailable', reason: 'sedang shutdown', checks: {} }, 503);
    }

    const report = await readinessReport();
    return c.json(report, report.status === 'ok' ? 200 : 503);
});

health.get('/health', (c) => c.json({ status: 'ok' }));

if (process.env.ENABLE_SHUTDOWN_DEMO === 'true') {
    health.get('/health/slow', async (c) => {
        const requested = Number(c.req.query('ms')) || 5000;
        const ms = Math.min(Math.max(requested, 0), 30_000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return c.json({ status: 'ok', sleptMs: ms });
    });
}

export default health;
