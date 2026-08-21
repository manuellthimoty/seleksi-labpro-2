import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applicationsTable, applicationRedirectUrisTable, applicationGroupPoliciesTable, groupsTable } from '../db/schema/index.js';
import { generateToken } from '../lib/token.js';
import { hashPassword } from '../lib/password.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import { recordEvent, type DbExecutor } from '../lib/events.js';
import { getGroupMemberIds, getUsersWithAccess } from '../lib/access-policy.js';
import type { AppEnv } from '../lib/hono-env.js';

const applications = new Hono<AppEnv>();

const publicApplicationColumns = {
    id: applicationsTable.id,
    name: applicationsTable.name,
    clientId: applicationsTable.clientId,
    status: applicationsTable.status,
    launchUrl: applicationsTable.launchUrl,
    logoutNotificationUrl: applicationsTable.logoutNotificationUrl,
    createdAt: applicationsTable.createdAt,
    updatedAt: applicationsTable.updatedAt,
};

async function getRedirectUris(applicationId: string) {
    const rows = await db
        .select({ redirectUri: applicationRedirectUrisTable.redirectUri })
        .from(applicationRedirectUrisTable)
        .where(eq(applicationRedirectUrisTable.applicationId, applicationId));
    return rows.map((r) => r.redirectUri);
}

const createApplicationSchema = z.object({
    name: z.string().min(1),
    redirectUris: z.array(z.string().url()).min(1),
    launchUrl: z.string().url(),
    logoutNotificationUrl: z.string().url(),
});

applications.post('/', async (c) => {
    const requestId = c.get('requestId');
    const parsed = createApplicationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { name, redirectUris, launchUrl, logoutNotificationUrl } = parsed.data;

    const clientId = generateToken(16);
    const clientSecret = generateToken(32);
    const clientSecretHash = await hashPassword(clientSecret);

    // masukin Id, Secret, dan hash Secretnya
    const [application] = await db
        .insert(applicationsTable)
        .values({ name, clientId, clientSecretHash, launchUrl, logoutNotificationUrl })
        .returning(publicApplicationColumns);

    await db.insert(applicationRedirectUrisTable).values(redirectUris.map((redirectUri) => ({ applicationId: application.id, redirectUri })));

    await logAuditEvent({
        eventType: 'application.register',
        result: 'success',
        applicationId: application.id,
        actorId: c.get('userId'),
    });

    return c.json({ data: { ...application, redirectUris, clientSecret } }, 201);
});

// ambil semuanya
applications.get('/', async (c) => {
    const list = await db.select(publicApplicationColumns).from(applicationsTable);
    return c.json({ data: list });
});

// ambil brdasarkan id
applications.get('/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const [application] = await db.select(publicApplicationColumns).from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    const redirectUris = await getRedirectUris(id);

    return c.json({ data: { ...application, redirectUris } });
});

const updateApplicationSchema = z
    .object({
        name: z.string().min(1).optional(),
        launchUrl: z.string().url().optional(),
        logoutNotificationUrl: z.string().url().optional(),
        redirectUris: z.array(z.string().url()).min(1).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required !' });

// ngepatch berdasarkan id
applications.patch('/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = updateApplicationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { redirectUris, ...rest } = parsed.data;

    const [application] = await db
        .update(applicationsTable)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(applicationsTable.id, id))
        .returning(publicApplicationColumns);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    if (redirectUris) {
        await db.delete(applicationRedirectUrisTable).where(eq(applicationRedirectUrisTable.applicationId, id));
        await db.insert(applicationRedirectUrisTable).values(redirectUris.map((redirectUri) => ({ applicationId: id, redirectUri })));
    }

    await logAuditEvent({ eventType: 'application.update', result: 'success', applicationId: id, actorId: c.get('userId') });

    return c.json({ data: { ...application, redirectUris: redirectUris ?? (await getRedirectUris(id)) } });
});

const statusSchema = z.object({ status: z.enum(['active', 'inactive']) });

applications.patch('/:id/status', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const parsed = statusSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    const [application] = await db
        .update(applicationsTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(applicationsTable.id, id))
        .returning(publicApplicationColumns);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    await logAuditEvent({
        eventType: parsed.data.status === 'active' ? 'application.activate' : 'application.deactivate',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
    });

    return c.json({ data: application });
});

applications.get('/:id/redirect-uris',async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const [application] = await db.select(publicApplicationColumns).from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    const redirectUris = await getRedirectUris(id);
    return c.json({ data: redirectUris });

})

const addRedirectUriSchema = z.object({
    redirectUri: z.string().url(),
});

applications.post('/:id/redirect-uris', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const parsed = addRedirectUriSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    const [application] = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    const [existing] = await db
        .select({ id: applicationRedirectUrisTable.id })
        .from(applicationRedirectUrisTable)
        .where(and(eq(applicationRedirectUrisTable.applicationId, id), eq(applicationRedirectUrisTable.redirectUri, parsed.data.redirectUri)))
        .limit(1);
    if (existing) {
        return c.json(formatError('REDIRECT_URI_EXISTS', 'Redirect URI already registered for this application', requestId), 409);
    }

    const [uri] = await db
        .insert(applicationRedirectUrisTable)
        .values({ applicationId: id, redirectUri: parsed.data.redirectUri })
        .returning();

    await logAuditEvent({
        eventType: 'application.redirect_uri.add',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { redirectUri: parsed.data.redirectUri },
    });

    return c.json({ data: uri }, 201);
});

applications.delete('/:id/redirect-uris/:uriId', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const uriId = c.req.param('uriId');

    const [deleted] = await db
        .delete(applicationRedirectUrisTable)
        .where(and(eq(applicationRedirectUrisTable.id, uriId), eq(applicationRedirectUrisTable.applicationId, id)))
        .returning();
    if (!deleted) {
        return c.json(formatError('NOT_FOUND', 'Redirect URI not found', requestId), 404);
    }

    await logAuditEvent({
        eventType: 'application.redirect_uri.remove',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { redirectUri: deleted.redirectUri },
    });

    return c.body(null, 204);
});
// nge list semua policies yg dipunyai p;ej suatu app
applications.get('/:id/policies', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const [application] = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    // di join sm groups table supaya keliatan nama groupnya
    const policies = await db
        .select({
            id: applicationGroupPoliciesTable.id,
            groupId: groupsTable.id,
            groupName: groupsTable.name,
            effect: applicationGroupPoliciesTable.effect,
            createdAt: applicationGroupPoliciesTable.createdAt,
        })
        .from(applicationGroupPoliciesTable)
        .innerJoin(groupsTable, eq(applicationGroupPoliciesTable.groupId, groupsTable.id))
        .where(eq(applicationGroupPoliciesTable.applicationId, id));

    return c.json({ data: policies });
});

async function emitAccessLostEvents(
    tx: DbExecutor,
    params: {
        applicationId: string;
        groupId: string;
        reason: string;
        metadata: Record<string, unknown>;
        applyChange: () => Promise<void>;
    },
): Promise<string[]> {
    const memberIds = await getGroupMemberIds(tx, params.groupId);
    const before = await getUsersWithAccess(tx, params.applicationId, memberIds);

    await params.applyChange();

    const after = await getUsersWithAccess(tx, params.applicationId, memberIds);
    const lostAccess = memberIds.filter((userId) => before.has(userId) && !after.has(userId));

    for (const userId of lostAccess) {
        await recordEvent(tx, {
            eventType: 'AccessPolicyChanged',
            userId,
            applicationId: params.applicationId,
            reason: params.reason,
            metadata: { groupId: params.groupId, ...params.metadata },
        });
    }

    return lostAccess;
}

const assignPolicySchema = z.object({
    groupId: z.string().uuid(),
    effect: z.enum(['allow', 'deny']).default('allow'),
});

applications.post('/:id/policies', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');

    const parsed = assignPolicySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { groupId, effect } = parsed.data;

    const [application] = await db.select({ id: applicationsTable.id }).from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
    if (!application) {
        return c.json(formatError('NOT_FOUND', 'Application not found', requestId), 404);
    }

    const [group] = await db.select({ id: groupsTable.id }).from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
    if (!group) {
        return c.json(formatError('NOT_FOUND', 'Group not found', requestId), 404);
    }

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
    if (existing) {
        return c.json(formatError('POLICY_EXISTS', 'This group already has this policy for the application', requestId), 409);
    }

    const { policy, lostAccess } = await db.transaction(async (tx) => {
        let inserted!: typeof applicationGroupPoliciesTable.$inferSelect;

        const lost = await emitAccessLostEvents(tx, {
            applicationId: id,
            groupId,
            reason: 'policy_assigned',
            metadata: { effect },
            applyChange: async () => {
                [inserted] = await tx
                    .insert(applicationGroupPoliciesTable)
                    .values({ applicationId: id, groupId, effect })
                    .returning();
            },
        });

        return { policy: inserted, lostAccess: lost };
    });

    await logAuditEvent({
        eventType: 'application.policy.assign',
        result: 'success',
        applicationId: id,
        actorId: c.get('userId'),
        metadata: { groupId, effect, accessLostUserCount: lostAccess.length },
    });

    return c.json({ data: policy }, 201);
});

applications.delete('/:id/policies/:policyId', async (c) => {
    const requestId = c.get('requestId');
    const id = c.req.param('id');
    const policyId = c.req.param('policyId');

    const [target] = await db
        .select()
        .from(applicationGroupPoliciesTable)
        .where(and(eq(applicationGroupPoliciesTable.id, policyId), eq(applicationGroupPoliciesTable.applicationId, id)))
        .limit(1);
    if (!target) {
        return c.json(formatError('NOT_FOUND', 'Policy not found', requestId), 404);
    }

    const lostAccess = await db.transaction(async (tx) =>
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
        metadata: { groupId: target.groupId, effect: target.effect, accessLostUserCount: lostAccess.length },
    });

    return c.body(null, 204);
});

export default applications;
