import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export interface FlashMessage {
    ok?: string;
    err?: string;
}

export function layout(
    title: string,
    content: HtmlEscapedString | Promise<HtmlEscapedString>,
    flash: FlashMessage = {},
) {
    return html`<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>${title} - Control Panel</title>
    <style>
        body { font-family: sans-serif; max-width: 960px; margin: 1.5rem auto; padding: 0 1rem; }
        nav { display: flex; gap: 1rem; align-items: center; border-bottom: 2px solid #333; padding-bottom: .6rem; margin-bottom: 1.2rem; }
        nav a { text-decoration: none; color: #234; font-weight: bold; }
        nav .spacer { flex: 1; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1.2rem; }
        th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; font-size: .9rem; }
        th { background: #f5f5f5; }
        form.inline { display: inline; }
        fieldset { margin-bottom: 1rem; }
        label { display: block; margin-bottom: .4rem; }
        input, select { padding: .3rem; min-width: 260px; }
        button { padding: .35rem .8rem; cursor: pointer; }
        .flash { padding: .6rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
        .flash-ok { background: #e7f5e7; border: 1px solid #b6dab6; }
        .flash-err { background: #fdecea; border: 1px solid #f5c6cb; color: #611a15; }
        .muted { color: #777; font-size: .85rem; }
    </style>
</head>
<body>
    <nav>
        <a href="/admin">Dashboard</a>
        <a href="/admin/users">Users</a>
        <a href="/admin/groups">Groups</a>
        <a href="/admin/applications">Applications</a>
        <span class="spacer"></span>
        <form id="logout-form" class="inline"><button type="submit">Logout (SSO)</button></form>
    </nav>

    ${flash.ok ? html`<div class="flash flash-ok">${flash.ok}</div>` : ''}
    ${flash.err ? html`<div class="flash flash-err">${flash.err}</div>` : ''}

    <h1>${title}</h1>
    ${content}

    <script>
        document.getElementById('logout-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await fetch('/logout/sso', { method: 'POST', credentials: 'same-origin' });
            window.location.href = '/login';
        });
    </script>
</body>
</html>`;
}

export function flashFromQuery(query: Record<string, string>): FlashMessage {
    return { ok: query.ok, err: query.err };
}
