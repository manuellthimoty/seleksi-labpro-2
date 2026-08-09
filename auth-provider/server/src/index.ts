import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/',(c) => {
    return c.text('auth server don');
});

const port = 3000;

serve({
    fetch : app.fetch,
    port,
});

console.log(`Auth listening on port ${port}`);