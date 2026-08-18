import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AppEnv } from './lib/hono-env.js';
import { requestId } from './middleware/request-id.js';
import home from './routes/home.js';
import login from './routes/login.js';
import callback from './routes/callback.js';
import logout from './routes/logout.js';

const app = new Hono<AppEnv>();

app.use('*', requestId);

app.route('/', home);
app.route('/', login);
app.route('/', callback);
app.route('/', logout);

const port = Number(process.env.PORT) || 4000;

serve({
    fetch : app.fetch,
    port,
});

console.log(`app A listening on port ${port}`);
