import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AppEnv } from './lib/hono-env.js';
import { requestId } from './middleware/request-id.js';
import login from './routes/login.js';
import callback from './routes/callback.js';

const app = new Hono<AppEnv>();

const appLabelA = 'APP A';

app.use('*', requestId);

app.get('/',(c) => {
    return c.text('app A runn');
})

app.route('/', login);
app.route('/', callback);

const port = Number(process.env.PORT) || 4000;

serve({
    fetch : app.fetch,
    port,
});

console.log(`app A listening on port ${port}`);
