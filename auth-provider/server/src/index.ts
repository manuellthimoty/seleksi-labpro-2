import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { requestId } from './middleware/request-id.js';
import { requireAuth } from './middleware/require-auth.js';
import type { AppEnv } from './lib/hono-env.js';
import auth from './routes/auth.js';
import authorize from './routes/authorize.js';
import token from './routes/token.js';
import userinfo from './routes/userinfo.js';
import logout from './routes/logout.js';
import users from './routes/users.js';
import groups from './routes/groups.js';
import applications from './routes/applications.js';
import { startEventPublisher } from './lib/event-publisher.js';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.get('/', (c) => {
    return c.text('auth server don');
});

// public
app.route('/', auth);
app.route('/', authorize);
app.route('/', token);
app.route('/', userinfo);
app.route('/', logout);

// admin
app.use('/users/*', requireAuth);
app.route('/users', users);

app.use('/groups/*', requireAuth);
app.route('/groups', groups);

app.use('/applications/*', requireAuth);
app.route('/applications', applications);

const port = Number(process.env.PORT) || 3000;

serve({
    fetch: app.fetch,
    port,
});

console.log(`Auth listening on port ${port}`);

const stopEventPublisher = process.env.EVENT_PUBLISHER_ENABLED === 'false' ? null : startEventPublisher();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
        await stopEventPublisher?.();
        process.exit(0);
    });
}
