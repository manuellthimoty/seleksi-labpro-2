import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AppEnv } from './lib/hono-env.js';
import login from './routes/login.js';

const app = new Hono<AppEnv>();

const appLabelA = 'APP A';

app.get('/',(c) => {
    return c.text('app A runn');
})

app.route('/', login);

const port = Number(process.env.PORT) || 4000;

serve({
    fetch : app.fetch,
    port,
});

console.log(`app A listening on port ${port}`);
