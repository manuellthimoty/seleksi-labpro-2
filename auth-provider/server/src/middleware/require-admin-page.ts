import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { db } from '../db/index.js';
import { usersTable } from '../db/schema/index.js';
import { validSession } from '../lib/session.js';
import { layout } from '../views/layout.js';
import type { AppEnv } from '../lib/hono-env.js';

export const requireAdminPage = createMiddleware<AppEnv>(async (c, next) => {
    const sessionToken = getCookie(c, 'session_id');
    const session = sessionToken ? await validSession(sessionToken) : null;

    if (!session) {
        const target = new URL(c.req.url).pathname;
        return c.redirect(`/login?redirect_to=${encodeURIComponent(target)}`, 302);
    }

    const [user] = await db
        .select({ name: usersTable.name, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, session.userId))
        .limit(1);

    if (!user || user.role !== 'admin') {
        const body = html`
            <p>Halaman Control Panel cuma buat akun dengan role <strong>admin</strong>.</p>
            <p class="muted">Kamu login sebagai ${user?.name ?? 'pengguna tidak dikenal'}.</p>
            <p><a href="/login">Login pakai akun lain</a></p>`;
        return c.html(layout('403 - Akses ditolak', body), 403);
    }

    c.set('userId', session.userId);
    await next();
});
