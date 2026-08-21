import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    usersTable,
    groupsTable,
    userGroupsTable,
    applicationsTable,
    applicationRedirectUrisTable,
    applicationGroupPoliciesTable,
} from '../db/schema/index.js';
import { hashPassword } from '../lib/password.js';
import { generateToken } from '../lib/token.js';
import { logAuditEvent } from '../lib/audit-log.js';
import { setUserStatus, publicUserColumns } from '../lib/user-status.js';
import { emitAccessLostEvents } from '../lib/access-policy.js';
import { layout, flashFromQuery } from '../views/layout.js';
import { requireAdminPage } from '../middleware/require-admin-page.js';
import type { AppEnv } from '../lib/hono-env.js';

const admin = new Hono<AppEnv>();

// semua halaman /admin wajib login DAN role admin
admin.use('*', requireAdminPage);

const field = (body: Record<string, unknown>, key: string) => String(body[key] ?? '').trim();

// Semua aksi form berakhir dengan redirect (pola Post/Redirect/Get) supaya
// refresh halaman gak nge-submit ulang. Pesan hasilnya dititip lewat query.
function back(c: Context, path: string, flash: { ok?: string; err?: string }) {
    const params = new URLSearchParams();
    if (flash.ok) params.set('ok', flash.ok);
    if (flash.err) params.set('err', flash.err);
    const query = params.toString();
    return c.redirect(query ? path + '?' + query : path, 302);
}

//dashboard

admin.get('/', async (c) => {
    const [[users], [groups], [apps]] = await Promise.all([
        db.select({ n: count() }).from(usersTable),
        db.select({ n: count() }).from(groupsTable),
        db.select({ n: count() }).from(applicationsTable),
    ]);

    const body = html`
        <table>
            <tr><th>Users</th><td>${users.n}</td><td><a href="/admin/users">kelola</a></td></tr>
            <tr><th>Groups</th><td>${groups.n}</td><td><a href="/admin/groups">kelola</a></td></tr>
            <tr><th>Applications</th><td>${apps.n}</td><td><a href="/admin/applications">kelola</a></td></tr>
        </table>
        `;
    return c.html(layout('Dashboard', body, flashFromQuery(c.req.query())));
});

//users

admin.get('/users', async (c) => {
    const list = await db.select(publicUserColumns).from(usersTable);
    const memberships = await db
        .select({ userId: userGroupsTable.userId, groupName: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id));

    const groupsOf = (userId: string) =>
        memberships.filter((m) => m.userId === userId).map((m) => m.groupName).join(', ') || '-';

    const body = html`
        <p><a href="/admin/users/new"><button type="button">Create New User</button></a></p>
        <table>
            <tr><th>Nama</th><th>Email</th><th>Status</th><th>Role</th><th>Group</th><th></th></tr>
            ${list.map((u) => html`
                <tr>
                    <td>${u.name}</td>
                    <td>${u.email}</td>
                    <td>${u.status}</td>
                    <td>${u.role}</td>
                    <td>${groupsOf(u.id)}</td>
                    <td><a href="/admin/users/${u.id}">detail</a></td>
                </tr>`)}
        </table>`;
    return c.html(layout('Users', body, flashFromQuery(c.req.query())));
});

admin.get('/users/new', (c) => {
    const body = html`
        <form method="POST" action="/admin/users">
            <fieldset>
                <label>Nama <input name="name" required /></label>
                <label>Email <input name="email" type="email" required /></label>
                <label>Password <input name="password" type="password" minlength="8" required /></label>
            </fieldset>
            <button type="submit">Simpan</button>
            <a href="/admin/users">batal</a>
        </form>`;
    return c.html(layout('Create User', body, flashFromQuery(c.req.query())));
});

admin.post('/users', async (c) => {
    const body = await c.req.parseBody();
    const name = field(body, 'name');
    const email = field(body, 'email');
    const password = field(body, 'password');

    if (!name || !email || password.length < 8) {
        return back(c, '/admin/users/new', { err: 'Nama, email wajib diisi dan password minimal 8 karakter.' });
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
        return back(c, '/admin/users/new', { err: 'Email itu sudah dipakai akun lain.' });
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(usersTable).values({ name, email, passwordHash }).returning(publicUserColumns);
    await logAuditEvent({ eventType: 'user.create', result: 'success', userId: user.id, actorId: c.get('userId') });

    return back(c, '/admin/users', { ok: 'User ' + user.email + ' dibuat.' });
});

admin.get('/users/:id', async (c) => {
    const id = c.req.param('id');
    const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) return c.html(layout('Users', html`<p>User tidak ditemukan.</p>`), 404);

    const memberGroups = await db
        .select({ id: groupsTable.id, name: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id))
        .where(eq(userGroupsTable.userId, id));
    const allGroups = await db.select().from(groupsTable);
    const joinable = allGroups.filter((g) => !memberGroups.some((m) => m.id === g.id));

    const body = html`
        <form method="POST" action="/admin/users/${user.id}">
            <fieldset>
                <label>Nama <input name="name" value="${user.name}" required /></label>
                <label>Email <input name="email" type="email" value="${user.email}" required /></label>
            </fieldset>
            <button type="submit">Simpan perubahan</button>
        </form>

        <h2>Status</h2>
        <p>Sekarang: <strong>${user.status}</strong></p>
        <form method="POST" action="/admin/users/${user.id}/status">
            <input type="hidden" name="status" value="${user.status === 'active' ? 'inactive' : 'active'}" />
            <button type="submit">${user.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        </form>
        ${user.status === 'active'
            ? html`<p class="muted">Menonaktifkan user mencabut semua central session-nya dan menerbitkan event SessionRevoked ke App A/B.</p>`
            : ''}

        <h2>Group</h2>
        <table>
            <tr><th>Group</th></tr>
            ${memberGroups.length === 0
                ? html`<tr><td>Belum masuk group mana pun.</td></tr>`
                : memberGroups.map((g) => html`<tr><td><a href="/admin/groups/${g.id}">${g.name}</a></td></tr>`)}
        </table>
        ${joinable.length > 0
            ? html`<form method="POST" action="/admin/users/${user.id}/groups">
                    <select name="groupId">${joinable.map((g) => html`<option value="${g.id}">${g.name}</option>`)}</select>
                    <button type="submit">Tambahkan ke group</button>
                  </form>`
            : html`<p class="muted">Sudah masuk semua group yang ada.</p>`}

        <p><a href="/admin/users">kembali ke daftar user</a></p>`;
    return c.html(layout('User: ' + user.name, body, flashFromQuery(c.req.query())));
});

admin.post('/users/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const name = field(body, 'name');
    const email = field(body, 'email');
    if (!name || !email) return back(c, '/admin/users/' + id, { err: 'Nama dan email wajib diisi.' });

    const [dupe] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (dupe && dupe.id !== id) return back(c, '/admin/users/' + id, { err: 'Email itu sudah dipakai akun lain.' });

    const [user] = await db
        .update(usersTable)
        .set({ name, email, updatedAt: new Date() })
        .where(eq(usersTable.id, id))
        .returning(publicUserColumns);
    if (!user) return back(c, '/admin/users', { err: 'User tidak ditemukan.' });

    await logAuditEvent({ eventType: 'user.update', result: 'success', userId: id, actorId: c.get('userId') });
    return back(c, '/admin/users/' + id, { ok: 'Perubahan disimpan.' });
});

admin.post('/users/:id/status', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const status = field(body, 'status') === 'inactive' ? 'inactive' : 'active';

    const result = await setUserStatus(id, status);
    if (!result) return back(c, '/admin/users', { err: 'User tidak ditemukan.' });

    await logAuditEvent({
        eventType: status === 'active' ? 'user.activate' : 'user.deactivate',
        result: 'success',
        userId: id,
        actorId: c.get('userId'),
        metadata: { revokedSessionCount: result.revokedSessionCount },
    });

    const extra = status === 'inactive' ? ' ' + result.revokedSessionCount + ' central session dicabut.' : '';
    return back(c, '/admin/users/' + id, { ok: 'Status jadi ' + status + '.' + extra });
});

admin.post('/users/:id/groups', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const groupId = field(body, 'groupId');
    if (!groupId) return back(c, '/admin/users/' + id, { err: 'Group belum dipilih.' });

    await db.insert(userGroupsTable).values({ userId: id, groupId }).onConflictDoNothing();
    await logAuditEvent({
        eventType: 'user.groups.assign',
        result: 'success',
        userId: id,
        actorId: c.get('userId'),
        metadata: { groupIds: [groupId] },
    });
    return back(c, '/admin/users/' + id, { ok: 'User ditambahkan ke group.' });
});

//groups
admin.get('/groups', async (c) => {
    const list = await db.select().from(groupsTable);
    const counts = await db
        .select({ groupId: userGroupsTable.groupId, n: count() })
        .from(userGroupsTable)
        .groupBy(userGroupsTable.groupId);

    const body = html`
        <p><a href="/admin/groups/new"><button type="button">Create New Group</button></a></p>
        <table>
            <tr><th>Nama</th><th>Deskripsi</th><th>Jumlah member</th><th></th></tr>
            ${list.map((g) => html`
                <tr>
                    <td>${g.name}</td>
                    <td>${g.description ?? '-'}</td>
                    <td>${counts.find((x) => x.groupId === g.id)?.n ?? 0}</td>
                    <td><a href="/admin/groups/${g.id}">detail</a></td>
                </tr>`)}
        </table>`;
    return c.html(layout('Groups', body, flashFromQuery(c.req.query())));
});

admin.get('/groups/new', (c) => {
    const body = html`
        <form method="POST" action="/admin/groups">
            <fieldset>
                <label>Nama <input name="name" required /></label>
                <label>Deskripsi <input name="description" /></label>
            </fieldset>
            <button type="submit">Simpan</button>
            <a href="/admin/groups">batal</a>
        </form>`;
    return c.html(layout('Create Group', body, flashFromQuery(c.req.query())));
});

admin.post('/groups', async (c) => {
    const body = await c.req.parseBody();
    const name = field(body, 'name');
    const description = field(body, 'description');
    if (!name) return back(c, '/admin/groups/new', { err: 'Nama group wajib diisi.' });

    const [existing] = await db.select({ id: groupsTable.id }).from(groupsTable).where(eq(groupsTable.name, name)).limit(1);
    if (existing) return back(c, '/admin/groups/new', { err: 'Nama group itu sudah dipakai.' });

    const [group] = await db.insert(groupsTable).values({ name, description: description || null }).returning();
    await logAuditEvent({ eventType: 'group.create', result: 'success', actorId: c.get('userId'), metadata: { groupId: group.id } });
    return back(c, '/admin/groups', { ok: 'Group ' + group.name + ' dibuat.' });
});

admin.get('/groups/:id', async (c) => {
    const id = c.req.param('id');
    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, id)).limit(1);
    if (!group) return c.html(layout('Groups', html`<p>Group tidak ditemukan.</p>`), 404);

    const members = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(userGroupsTable)
        .innerJoin(usersTable, eq(userGroupsTable.userId, usersTable.id))
        .where(eq(userGroupsTable.groupId, id));
    const allUsers = await db.select(publicUserColumns).from(usersTable);
    const addable = allUsers.filter((u) => !members.some((m) => m.id === u.id));

    const body = html`
        <p class="muted">${group.description ?? 'Tanpa deskripsi'}</p>
        <h2>Member</h2>
        <table>
            <tr><th>Nama</th><th>Email</th><th></th></tr>
            ${members.length === 0
                ? html`<tr><td colspan="3">Belum ada member.</td></tr>`
                : members.map((m) => html`
                    <tr>
                        <td><a href="/admin/users/${m.id}">${m.name}</a></td>
                        <td>${m.email}</td>
                        <td>
                            <form class="inline" method="POST" action="/admin/groups/${group.id}/members/${m.id}/remove">
                                <button type="submit">keluarkan</button>
                            </form>
                        </td>
                    </tr>`)}
        </table>
        ${addable.length > 0
            ? html`<form method="POST" action="/admin/groups/${group.id}/members">
                    <select name="userId">${addable.map((u) => html`<option value="${u.id}">${u.name} (${u.email})</option>`)}</select>
                    <button type="submit">Tambah member</button>
                  </form>`
            : html`<p class="muted">Semua user sudah jadi member group ini.</p>`}
        <p><a href="/admin/groups">kembali ke daftar group</a></p>`;
    return c.html(layout('Group: ' + group.name, body, flashFromQuery(c.req.query())));
});

admin.post('/groups/:id/members', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const userId = field(body, 'userId');
    if (!userId) return back(c, '/admin/groups/' + id, { err: 'User belum dipilih.' });

    await db.insert(userGroupsTable).values({ userId, groupId: id }).onConflictDoNothing();
    await logAuditEvent({
        eventType: 'user.groups.assign',
        result: 'success',
        userId,
        actorId: c.get('userId'),
        metadata: { groupIds: [id] },
    });
    return back(c, '/admin/groups/' + id, { ok: 'Member ditambahkan.' });
});

admin.post('/groups/:id/members/:userId/remove', async (c) => {
    const id = c.req.param('id');
    const userId = c.req.param('userId');

    await db.delete(userGroupsTable).where(and(eq(userGroupsTable.groupId, id), eq(userGroupsTable.userId, userId)));
    await logAuditEvent({
        eventType: 'user.groups.remove',
        result: 'success',
        userId,
        actorId: c.get('userId'),
        metadata: { groupId: id },
    });
    return back(c, '/admin/groups/' + id, {
        ok: 'Member dikeluarkan. Catatan: kehilangan akses karena keluar group belum menerbitkan event otomatis.',
    });
});

// applications

admin.get('/applications', async (c) => {
    const list = await db.select().from(applicationsTable);
    const body = html`
        <p><a href="/admin/applications/new"><button type="button">Register New Application</button></a></p>
        <table>
            <tr><th>Nama</th><th>client_id</th><th>Status</th><th>Launch URL</th><th></th></tr>
            ${list.map((a) => html`
                <tr>
                    <td>${a.name}</td>
                    <td>${a.clientId}</td>
                    <td>${a.status}</td>
                    <td>${a.launchUrl}</td>
                    <td><a href="/admin/applications/${a.id}">detail</a></td>
                </tr>`)}
        </table>`;
    return c.html(layout('Applications', body, flashFromQuery(c.req.query())));
});

admin.get('/applications/new', (c) => {
    const body = html`
        <form method="POST" action="/admin/applications">
            <fieldset>
                <label>Nama <input name="name" required /></label>
                <label>Launch URL <input name="launchUrl" type="url" required placeholder="http://localhost:6000" /></label>
                <label>Redirect URI <input name="redirectUri" type="url" required placeholder="http://localhost:6000/callback" /></label>
                <label>Logout Notification URL <input name="logoutNotificationUrl" type="url" required placeholder="http://app-c:6000/internal/logout" /></label>
            </fieldset>
            <button type="submit">Register</button>
            <a href="/admin/applications">batal</a>
        </form>
        <p class="muted">client_id dan client_secret di-generate otomatis. Secret cuma ditampilkan sekali setelah register.</p>`;
    return c.html(layout('Register Application', body, flashFromQuery(c.req.query())));
});

admin.post('/applications', async (c) => {
    const body = await c.req.parseBody();
    const name = field(body, 'name');
    const launchUrl = field(body, 'launchUrl');
    const redirectUri = field(body, 'redirectUri');
    const logoutNotificationUrl = field(body, 'logoutNotificationUrl');

    if (!name || !launchUrl || !redirectUri || !logoutNotificationUrl) {
        return back(c, '/admin/applications/new', { err: 'Semua field wajib diisi.' });
    }

    const clientId = generateToken(16);
    const clientSecret = generateToken(32);
    const clientSecretHash = await hashPassword(clientSecret);

    const [application] = await db
        .insert(applicationsTable)
        .values({ name, clientId, clientSecretHash, launchUrl, logoutNotificationUrl })
        .returning();
    await db.insert(applicationRedirectUrisTable).values({ applicationId: application.id, redirectUri });
    await logAuditEvent({
        eventType: 'application.register',
        result: 'success',
        applicationId: application.id,
        actorId: c.get('userId'),
    });

    return back(c, '/admin/applications/' + application.id, {
        ok: 'Terdaftar. client_id=' + clientId + ' client_secret=' + clientSecret + ' (secret ini gak bakal ditampilkan lagi)',
    });
});

admin.get('/applications/:id', async (c) => {
    const id = c.req.param('id');
    const [application] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) return c.html(layout('Applications', html`<p>Application tidak ditemukan.</p>`), 404);

    const uris = await db.select().from(applicationRedirectUrisTable).where(eq(applicationRedirectUrisTable.applicationId, id));
    const policies = await db
        .select({
            id: applicationGroupPoliciesTable.id,
            groupName: groupsTable.name,
            effect: applicationGroupPoliciesTable.effect,
        })
        .from(applicationGroupPoliciesTable)
        .innerJoin(groupsTable, eq(applicationGroupPoliciesTable.groupId, groupsTable.id))
        .where(eq(applicationGroupPoliciesTable.applicationId, id));
    const allGroups = await db.select().from(groupsTable);

    const body = html`
        <table>
            <tr><th>client_id</th><td>${application.clientId}</td></tr>
            <tr><th>Status</th><td>${application.status}</td></tr>
            <tr><th>Launch URL</th><td>${application.launchUrl}</td></tr>
            <tr><th>Logout Notification URL</th><td>${application.logoutNotificationUrl}</td></tr>
        </table>
        <form method="POST" action="/admin/applications/${application.id}/status">
            <input type="hidden" name="status" value="${application.status === 'active' ? 'inactive' : 'active'}" />
            <button type="submit">${application.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        </form>

        <h2>Redirect URI</h2>
        <table>
            <tr><th>URI</th></tr>
            ${uris.map((u) => html`<tr><td>${u.redirectUri}</td></tr>`)}
        </table>
        <form method="POST" action="/admin/applications/${application.id}/redirect-uris">
            <input name="redirectUri" type="url" required placeholder="http://localhost:6000/callback" />
            <button type="submit">Tambah redirect URI</button>
        </form>

        <h2>Policy (group yang boleh akses)</h2>
        <table>
            <tr><th>Group</th><th>Effect</th><th></th></tr>
            ${policies.length === 0
                ? html`<tr><td colspan="3">Belum ada policy. Tanpa allow, semua user ditolak.</td></tr>`
                : policies.map((p) => html`
                    <tr>
                        <td>${p.groupName}</td>
                        <td>${p.effect}</td>
                        <td>
                            <form class="inline" method="POST" action="/admin/applications/${application.id}/policies/${p.id}/remove">
                                <button type="submit">cabut</button>
                            </form>
                        </td>
                    </tr>`)}
        </table>
        <form method="POST" action="/admin/applications/${application.id}/policies">
            <select name="groupId">${allGroups.map((g) => html`<option value="${g.id}">${g.name}</option>`)}</select>
            <select name="effect"><option value="allow">allow</option><option value="deny">deny</option></select>
            <button type="submit">Tambah policy</button>
        </form>
        <p class="muted">Menambah deny atau mencabut allow bisa bikin user kehilangan akses; event AccessPolicyChanged otomatis terbit buat mereka.</p>

        <p><a href="/admin/applications">kembali ke daftar application</a></p>`;
    return c.html(layout('Application: ' + application.name, body, flashFromQuery(c.req.query())));
});

admin.post('/applications/:id/status', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const status = field(body, 'status') === 'inactive' ? 'inactive' : 'active';

    const [application] = await db
        .update(applicationsTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(applicationsTable.id, id))
        .returning();
    if (!application) return back(c, '/admin/applications', { err: 'Application tidak ditemukan.' });

    await logAuditEvent({
        eventType: status === 'active' ? 'application.activate' : 'application.deactivate',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
    });
    return back(c, '/admin/applications/' + id, { ok: 'Status application jadi ' + status + '.' });
});

admin.post('/applications/:id/redirect-uris', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const redirectUri = field(body, 'redirectUri');
    if (!redirectUri) return back(c, '/admin/applications/' + id, { err: 'Redirect URI wajib diisi.' });

    const [existing] = await db
        .select({ id: applicationRedirectUrisTable.id })
        .from(applicationRedirectUrisTable)
        .where(and(eq(applicationRedirectUrisTable.applicationId, id), eq(applicationRedirectUrisTable.redirectUri, redirectUri)))
        .limit(1);
    if (existing) return back(c, '/admin/applications/' + id, { err: 'Redirect URI itu sudah terdaftar.' });

    await db.insert(applicationRedirectUrisTable).values({ applicationId: id, redirectUri });
    await logAuditEvent({
        eventType: 'application.redirect_uri.add',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { redirectUri },
    });
    return back(c, '/admin/applications/' + id, { ok: 'Redirect URI ditambahkan.' });
});

admin.post('/applications/:id/policies', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.parseBody();
    const groupId = field(body, 'groupId');
    const effect = field(body, 'effect') === 'deny' ? 'deny' : 'allow';
    if (!groupId) return back(c, '/admin/applications/' + id, { err: 'Group belum dipilih.' });

    const [existing] = await db
        .select({ id: applicationGroupPoliciesTable.id })
        .from(applicationGroupPoliciesTable)
        .where(
            and(
                eq(applicationGroupPoliciesTable.applicationId, id),
                eq(applicationGroupPoliciesTable.groupId, groupId),
                eq(applicationGroupPoliciesTable.effect, effect),
            ),
        )
        .limit(1);
    if (existing) return back(c, '/admin/applications/' + id, { err: 'Policy itu sudah ada.' });

    const lost = await db.transaction(async (tx) =>
        emitAccessLostEvents(tx, {
            applicationId: id,
            groupId,
            reason: 'policy_assigned',
            metadata: { effect },
            applyChange: async () => {
                await tx.insert(applicationGroupPoliciesTable).values({ applicationId: id, groupId, effect });
            },
        }),
    );

    await logAuditEvent({
        eventType: 'application.policy.assign',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { groupId, effect, accessLostUserCount: lost.length },
    });
    return back(c, '/admin/applications/' + id, {
        ok: 'Policy ' + effect + ' ditambahkan. ' + lost.length + ' user kehilangan akses.',
    });
});

admin.post('/applications/:id/policies/:policyId/remove', async (c) => {
    const id = c.req.param('id');
    const policyId = c.req.param('policyId');

    const [target] = await db
        .select()
        .from(applicationGroupPoliciesTable)
        .where(and(eq(applicationGroupPoliciesTable.id, policyId), eq(applicationGroupPoliciesTable.applicationId, id)))
        .limit(1);
    if (!target) return back(c, '/admin/applications/' + id, { err: 'Policy tidak ditemukan.' });

    const lost = await db.transaction(async (tx) =>
        emitAccessLostEvents(tx, {
            applicationId: id,
            groupId: target.groupId,
            reason: 'policy_revoked',
            metadata: { effect: target.effect },
            applyChange: async () => {
                await tx.delete(applicationGroupPoliciesTable).where(eq(applicationGroupPoliciesTable.id, policyId));
            },
        }),
    );

    await logAuditEvent({
        eventType: 'application.policy.revoke',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { groupId: target.groupId, effect: target.effect, accessLostUserCount: lost.length },
    });
    return back(c, '/admin/applications/' + id, {
        ok: 'Policy dicabut. ' + lost.length + ' user kehilangan akses.',
    });
});

export default admin;
