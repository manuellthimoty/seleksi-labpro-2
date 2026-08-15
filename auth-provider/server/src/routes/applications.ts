import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applicationsTable, applicationRedirectUrisTable } from '../db/schema/index.js';
import { generateToken } from '../lib/token.js';
import { hashPassword } from '../lib/password.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
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
    logoutNotificationUrl: z.string().url().optional(),
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

export default applications;
