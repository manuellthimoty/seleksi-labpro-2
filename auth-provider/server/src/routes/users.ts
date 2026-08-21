import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
    usersTable,
    groupsTable,
    userGroupsTable,
    applicationsTable,
    applicationGroupPoliciesTable,
    ssoSessionsTable,
    accessTokensTable,
} from '../db/schema/index.js';
import { hashPassword } from '../lib/password.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import { recordEvent } from '../lib/events.js';
import { setUserStatus } from '../lib/user-status.js';
import type { AppEnv } from '../lib/hono-env.js';

const users = new Hono<AppEnv>();

const publicUserColumns = {
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    status: usersTable.status,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
    updatedAt: usersTable.updatedAt,
};

const createUserSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
});

users.post('/', async (c) => {
    // ambil requestId yg udh di generate dr middleware
    const requestId = c.get('requestId');

    // validasi body : harus ada name, email, dan pw
    const parsed = createUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }


    const { name, email, password } = parsed.data;

    // cek kalo email skrg udh dipake user lain
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) {
        return c.json(formatError('EMAIL_TAKEN', 'Email is already registered', requestId), 409);
    }

    
    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(usersTable).values({ name, email, passwordHash }).returning(publicUserColumns);

    await logAuditEvent({ eventType: 'user.create', result: 'success', userId: user.id, actorId: c.get('userId') });

    return c.json({ data: user }, 201);
});

users.get('/', async (c) => {
    const list = await db.select(publicUserColumns).from(usersTable);
    return c.json({ data: list });
});

users.get('/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    const memberGroups = await db
        .select({ id: groupsTable.id, name: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id))
        .where(eq(userGroupsTable.userId, id));

    return c.json({ data: { ...user, groups: memberGroups } });
});

const updateUserSchema = z
    .object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

users.patch('/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = updateUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    const [user] = await db
        .update(usersTable)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(usersTable.id, id))
        .returning(publicUserColumns);
    if (!user) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    await logAuditEvent({ eventType: 'user.update', result: 'success', userId: id, actorId: c.get('userId') });

    return c.json({ data: user });
});
// status untuk skrg antara active or inactive
const statusSchema = z.object({ status: z.enum(['active', 'inactive']) });

users.patch('/:id/status', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = statusSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { status } = parsed.data;

    const result = await setUserStatus(id, status);
    if (!result) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    await logAuditEvent({
        eventType: status === 'active' ? 'user.activate' : 'user.deactivate',
        result: 'success',
        userId: id,
        actorId: c.get('userId'),
        metadata: { revokedSessionCount: result.revokedSessionCount },
    });

    return c.json({ data: result.user });
});

const changePasswordSchema = z.object({ password: z.string().min(8) });

users.patch('/:id/password', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = changePasswordSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const result = await db.transaction(async (tx) => {
        const [user] = await tx
            .update(usersTable)
            .set({ passwordHash, updatedAt: new Date() })
            .where(eq(usersTable.id, id))
            .returning(publicUserColumns);
        if (!user) {
            return null;
        }

        const revokedSessions = await tx
            .update(ssoSessionsTable)
            .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'password_change' })
            .where(and(eq(ssoSessionsTable.userId, id), eq(ssoSessionsTable.status, 'active')))
            .returning({ id: ssoSessionsTable.id });

        await tx
            .update(accessTokensTable)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(and(eq(accessTokensTable.userId, id), eq(accessTokensTable.status, 'active')));

        const event = await recordEvent(tx, {
            eventType: 'PasswordChanged',
            userId: id,
            reason: 'password_changed',
            metadata: { revokedSessionCount: revokedSessions.length },
        });

        return { user, revokedSessionCount: revokedSessions.length, event };
    });

    if (!result) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    await logAuditEvent({
        eventType: 'user.password_change',
        result: 'success',
        userId: id,
        actorId: c.get('userId'),
        metadata: { revokedSessionCount: result.revokedSessionCount, eventId: result.event.eventId },
    });

    return c.json({ data: result.user });
});

const assignGroupsSchema = z.object({ groupIds: z.array(z.string().uuid()).min(1) });

users.post('/:id/groups', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = assignGroupsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    const existingGroups = await db
        .select({ id: groupsTable.id })
        .from(groupsTable)
        .where(inArray(groupsTable.id, parsed.data.groupIds));
    if (existingGroups.length !== new Set(parsed.data.groupIds).size) {
        return c.json(formatError('GROUP_NOT_FOUND', 'One or more groupIds do not exist', requestId), 400);
    }

    await db
        .insert(userGroupsTable)
        .values(parsed.data.groupIds.map((groupId) => ({ userId: id, groupId })))
        .onConflictDoNothing();

    await logAuditEvent({
        eventType: 'user.groups.assign',
        result: 'success',
        userId: id,
        actorId: c.get('userId'),
        metadata: { groupIds: parsed.data.groupIds },
    });

    const memberGroups = await db
        .select({ id: groupsTable.id, name: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id))
        .where(eq(userGroupsTable.userId, id));

    return c.json({ data: { groups: memberGroups } });
});

users.get('/:id/access-overview', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!user) {
        return c.json(formatError('NOT_FOUND', 'User not found', requestId), 404);
    }

    const memberGroups = await db
        .select({ id: groupsTable.id, name: groupsTable.name })
        .from(userGroupsTable)
        .innerJoin(groupsTable, eq(userGroupsTable.groupId, groupsTable.id))
        .where(eq(userGroupsTable.userId, id));

    const groupIds = memberGroups.map((g) => g.id);

    const policyRows = groupIds.length ? await db
              .select({
                  applicationId: applicationsTable.id,
                  applicationName: applicationsTable.name,
                  applicationStatus: applicationsTable.status,
                  groupId: groupsTable.id,
                  groupName: groupsTable.name,
                  effect: applicationGroupPoliciesTable.effect,
              })
              .from(applicationGroupPoliciesTable)
              .innerJoin(applicationsTable, eq(applicationGroupPoliciesTable.applicationId, applicationsTable.id))
              .innerJoin(groupsTable, eq(applicationGroupPoliciesTable.groupId, groupsTable.id))
              .where(inArray(applicationGroupPoliciesTable.groupId, groupIds))
        : [];

    // satu application bs punya bbrp policy
    const applicationsById = new Map<string,
        { id: string; name: string; status: string; grantedVia: { groupId: string; groupName: string; effect: string }[] }
    >();
    for (const row of policyRows) {
        const entry = applicationsById.get(row.applicationId) ?? {
            id: row.applicationId,
            name: row.applicationName,
            status: row.applicationStatus,
            grantedVia: [],
        };
        entry.grantedVia.push({ groupId: row.groupId, groupName: row.groupName, effect: row.effect });
        applicationsById.set(row.applicationId, entry);
    }

    return c.json({
        data: {
            user,
            groups: memberGroups,
            applications: Array.from(applicationsById.values()),
        },
    });
});

export default users;
