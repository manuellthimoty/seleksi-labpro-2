
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { AppEnv } from '../lib/hono-env.js';
import { formatError } from '../lib/error.js';
import { usersTable } from '../db/schema/users.js';
import { verifyPassword } from '../lib/password.js';
import { format } from 'path';
import { generateToken } from '../lib/token.js';
import { hashToken } from '../lib/token-hash.js';
import { ssoSessionsTable } from '../db/schema/sso-sessions.js';
import { setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { logAuditEvent } from '../lib/audit-log.js';

const SESSION_TTL_MS = 7*24*60*60*1000;

const auth = new Hono<AppEnv>();

// Login gagal wajib ninggalin jejak: tanpa ini percobaan brute force gak
// keliatan sama sekali di audit log. userId cuma diisi kalau emang ketemu,
// biar email ngasal gak bikin baris dengan user_id ngambang.
async function logLoginFailure(reason: string, userId?: string, ipAddress?: string) {
    await logAuditEvent({ eventType: 'user.login', result: 'failure', userId, ipAddress, metadata: { reason } });
}

const PostLoginSchema = z.object({
    email : z.string(),
    password : z.string(),
});

auth.post('/login',async (c) =>{
    const requestId = c.get('requestId');
    const parsed = PostLoginSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { email , password} = parsed.data;

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email,email));
    if(!user){
        await logLoginFailure('user_not_found', undefined, c.req.header('x-forwarded-for'));
        return c.json(formatError('INVALID_CREDENTIALS', 'Email or password is incorrect', requestId), 401);
    }
    const rightPassword = await verifyPassword(password,user.passwordHash);
    if(!rightPassword){
        await logLoginFailure('wrong_password', user.id, c.req.header('x-forwarded-for'));
        return c.json(formatError('INVALID_CREDENTIALS', 'Email or password is incorrect', requestId), 401);
    }

    if(user.status === 'inactive'){
        await logLoginFailure('account_inactive', user.id, c.req.header('x-forwarded-for'));
        return c.json(formatError('ACCOUNT_INACTIVE', 'Email or password is incorrect', requestId), 403);
    }

    const newToken = generateToken();
    const hashedToken = hashToken(newToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await db.insert(ssoSessionsTable).values({
        userId: user.id,
        sessionTokenHash: hashedToken,
        expiresAt,
        lastActivityAt: now,
    });

    setCookie(c, 'session_id', newToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: SESSION_TTL_MS / 1000,
        path: '/',
    });

    await logAuditEvent({
        eventType: 'user.login',
        result: 'success',
        userId: user.id,
        ipAddress: c.req.header('x-forwarded-for'),
    });

    // role ikut dibalikin biar halaman login tau harus ngelempar admin ke Control Panel
    return c.json({ data: { id: user.id, name: user.name, email: user.email, role: user.role } });
})

// cuma izinin path relatif satu-slash, tolak "//evil.com" (protocol-relative) cegah open redirect
function isSafeRedirectTarget(target: string): boolean {
    return target.startsWith('/') && !target.startsWith('//') && !target.includes('\\');
}

auth.get('/login', (c) => {
    const rawRedirectTo = c.req.query('redirect_to') ?? '/';
    const redirectTo = isSafeRedirectTarget(rawRedirectTo) ? rawRedirectTo : '/';

    return c.html(html`<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Login</title></head>
<body>
    <h1>Login</h1>
    <form id="login-form" data-redirect-to="${redirectTo}">
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Password" required />
        <button type="submit">Login</button>
    </form>
    <p id="login-error" style="color:red"></p>
    <script>
        const form = document.getElementById('login-form');
        const errorEl = document.getElementById('login-error');
        form.addEventListener('submit', async (event) => {  
            event.preventDefault();
            errorEl.textContent = '';
            const res = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ email: form.email.value, password: form.password.value }),
            });
            if (res.ok) {
                const body = await res.json().catch(() => null);
                const target = form.dataset.redirectTo;
                // admin yang login tanpa tujuan khusus langsung dibawa ke Control Panel;
                // kalau datang dari /authorize, tujuan aslinya tetap diutamakan
                const isAdmin = body && body.data && body.data.role === 'admin';
                window.location.href = (target === '/' && isAdmin) ? '/admin' : target;
                return;
            }
            const body = await res.json().catch(() => null);
            errorEl.textContent = body?.error?.message ?? 'Login failed';
        });
    </script>
</body>
</html>`);
});

export default auth;

