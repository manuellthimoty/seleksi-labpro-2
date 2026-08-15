import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groupsTable } from '../db/schema/index.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import type { AppEnv } from '../lib/hono-env.js';

const groups = new Hono<AppEnv>();

const createGroupSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
});

groups.post('/', async (c) => {
    const requestId = c.get('requestId');
    const parsed = createGroupSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
 
    const [existing] = await db.select({ id: groupsTable.id }).from(groupsTable).where(eq(groupsTable.name, parsed.data.name)).limit(1);
    if (existing) {
        return c.json(formatError('NAME_TAKEN', 'Group name is already in use', requestId), 409);
    }

    const [group] = await db.insert(groupsTable).values(parsed.data).returning();

    await logAuditEvent({ eventType: 'group.create', result: 'success', actorId: c.get('userId'), metadata: { groupId: group.id } });

    return c.json({ data: group }, 201);
});

groups.get('/', async (c) => {
    const list = await db.select().from(groupsTable);
    return c.json({ data: list });
});

const updateGroupSchema = z
    .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

groups.patch('/:id', async (c) => {
    const requestId =c.get('requestId');
    const id =c.req.param('id');
    const parsed=updateGroupSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }

    if (parsed.data.name) {
        const [existing] = await db.select({ id: groupsTable.id }).from(groupsTable).where(eq(groupsTable.name, parsed.data.name)).limit(1);
        if (existing && existing.id !== id) {
            return c.json(formatError('NAME_TAKEN', 'Group name is already in use', requestId), 409);
        }
    }

    const [group] = await db
        .update(groupsTable)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(groupsTable.id, id))
        .returning();
    if (!group) {
        return c.json(formatError('NOT_FOUND', 'Group not found', requestId), 404);
    }

    await logAuditEvent({ eventType: 'group.update', result: 'success', actorId: c.get('userId'), metadata: { groupId: id } });

    return c.json({ data: group });
});

export default groups;
