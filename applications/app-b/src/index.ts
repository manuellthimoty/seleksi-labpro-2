import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AppEnv } from './lib/hono-env.js';
import { requestId } from './middleware/request-id.js';
import internal from './routes/internal.js';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.get('/', (c) => {
    return c.text('app B runn');
});

app.route('/', internal);

const port = Number(process.env.PORT) || 5000;

serve({
    fetch: app.fetch,
    port,
});

console.log(`app B listening on port ${port}`);
