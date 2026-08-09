import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono() ; 

const appLabelA = 'APP A';

app.get('/',(c) => {
    return c.text('app A runn');
})

const port = 4000;

serve({
    fetch : app.fetch,
    port,
});

console.log(`app A listening on port ${port}`);
