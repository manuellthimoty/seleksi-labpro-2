import { Hono } from "hono";
import { html } from "hono/html";
import { getCookie } from "hono/cookie";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../lib/hono-env.js";
import { db } from "../db/index.js";
import { profileCacheTable, processedEventsTable } from "../db/schema/index.js";
import { checkLocalSession } from "../lib/local-session.js";
import { getActivityLog } from "../lib/activity-log.js";

const home = new Hono<AppEnv>();

const APP_LABEL = "APP A";

function formatDate(date: Date): string {
    return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "medium" });
}

home.get('/', async (c) => {
    const sessionToken = getCookie(c, 'local_session');
    const result = await checkLocalSession(sessionToken);

    const errorCode = c.req.query('error');
    const errorMessage = c.req.query('message');

    const profile = result.ok
        ? (await db.select().from(profileCacheTable).where(eq(profileCacheTable.externalUserId, result.session.externalUserId)).limit(1))[0]
        : undefined;

    const activityLog = getActivityLog();
    const processedEvents = await db
        .select()
        .from(processedEventsTable)
        .orderBy(desc(processedEventsTable.processedAt))
        .limit(50);

    return c.html(html`<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>${APP_LABEL}</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { font-size: 2.5rem; letter-spacing: 0.1em; }
        .banner { padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
        .banner-error { background: #fdecea; color: #611a15; border: 1px solid #f5c6cb; }
        .banner-info { background: #eef; color: #223; border: 1px solid #ccd; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
        th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
        th { background: #f5f5f5; }
        button { padding: 0.5rem 1rem; cursor: pointer; }
    </style>
</head>
<body>
    <h1>${APP_LABEL}</h1>

    ${errorMessage ? html`<div class="banner banner-error">${errorMessage}${errorCode ? html` (${errorCode})` : ''}</div>` : ''}

    ${result.ok && profile ? html`
        <h2>Hello, ${profile.name}</h2>
        <p>Email: ${profile.email}</p>
        <p>Groups: ${Array.isArray(profile.groups) ? (profile.groups as string[]).join(', ') : '-'}</p>
        <table>
            <tr><th>Status Local Session</th><td>${result.session.status}</td></tr>
            <tr><th>Dibuat</th><td>${formatDate(result.session.createdAt)}</td></tr>
            <tr><th>Kedaluwarsa</th><td>${formatDate(result.session.expiresAt)}</td></tr>
        </table>
        <form method="POST" action="/logout">
            <button type="submit">Logout</button>
        </form>
    ` : html`
        <p>Kamu belum login.</p>
        <a href="/login"><button type="button">Login</button></a>
    `}

    <h2>Activity Log</h2>
    <table>
        <tr><th>Waktu</th><th>Event</th><th>Pesan</th><th>Request ID</th></tr>
        ${activityLog.length === 0
            ? html`<tr><td colspan="4">Belum ada aktivitas.</td></tr>`
            : activityLog.map((entry) => html`
                <tr>
                    <td>${formatDate(new Date(entry.createdAt))}</td>
                    <td>${entry.eventType}</td>
                    <td>${entry.message}</td>
                    <td>${entry.requestId ?? '-'}</td>
                </tr>
            `)}
    </table>

    <h2>Processed Events</h2>
    <table>
        <tr><th>Event ID</th><th>Jenis Event</th><th>Waktu Diproses</th><th>Hasil</th></tr>
        ${processedEvents.length === 0
            ? html`<tr><td colspan="4">Belum ada event yang diproses.</td></tr>`
            : processedEvents.map((event) => html`
                <tr>
                    <td>${event.eventId}</td>
                    <td>${event.eventType}</td>
                    <td>${formatDate(event.processedAt)}</td>
                    <td>${event.result}</td>
                </tr>
            `)}
    </table>
</body>
</html>`);
});

export default home;    
