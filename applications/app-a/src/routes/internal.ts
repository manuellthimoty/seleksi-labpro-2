import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../lib/hono-env.js";
import { db } from "../db/index.js";
import { localSessionsTable, processedEventsTable } from "../db/schema/index.js";
import { verifyInternalSecret } from "../lib/internal-auth.js";
import { formatError } from "../lib/error.js";
import { logActivity } from "../lib/activity-log.js";

const internal = new Hono<AppEnv>();

const EVENT_REVOKE_REASON: Record<string, string> = {
    SessionRevoked: "sso_logout",
    PasswordChanged: "password_changed",
    AccessPolicyChanged: "access_policy_changed",
};

const internalLogoutSchema = z
    .object({
        event_id: z.string().uuid(),
        event_type: z.enum(["SessionRevoked", "PasswordChanged", "AccessPolicyChanged"]),
        external_user_id: z.string().uuid().optional(),
        central_session_id: z.string().uuid().optional(),
    })
    .refine((data) => data.external_user_id ?? data.central_session_id, {
        message: "external_user_id atau central_session_id wajib diisi salah satu",
    });

internal.post('/internal/logout', async (c) => {
    const requestId = c.get('requestId');

    const providedSecret = c.req.header('x-internal-secret');
    if (!verifyInternalSecret(providedSecret)) {
        return c.json(formatError('UNAUTHORIZED', 'Invalid or missing internal secret', requestId), 401);
    }

    const parsed = internalLogoutSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { event_id, event_type, external_user_id, central_session_id } = parsed.data;

    const [existing] = await db
        .select({ result: processedEventsTable.result })
        .from(processedEventsTable)
        .where(eq(processedEventsTable.eventId, event_id))
        .limit(1);
    if (existing) {
        return c.json({ data: { eventId: event_id, result: existing.result, deduplicated: true } });
    }

    const matchCondition = central_session_id
        ? eq(localSessionsTable.centralSessionId, central_session_id)
        : eq(localSessionsTable.externalUserId, external_user_id!);

    const revoked = await db
        .update(localSessionsTable)
        .set({
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: EVENT_REVOKE_REASON[event_type],
        })
        .where(and(matchCondition, eq(localSessionsTable.status, 'active')))
        .returning({ id: localSessionsTable.id });

    const result = revoked.length > 0
        ? `local session dihapus (${revoked.length})`
        : 'tidak ada local session aktif yang cocok';

    try {
        await db.insert(processedEventsTable).values({
            eventId: event_id,
            eventType: event_type,
            processedAt: new Date(),
            result,
        });
    } catch (err) {
        const pgError = err as { code?: string };
        if (pgError.code === '23505') {
            return c.json({ data: { eventId: event_id, result, deduplicated: true } });
        }
        throw err;
    }

    logActivity('internal.logout.processed', `${event_type}: ${result}`, requestId);

    return c.json({ data: { eventId: event_id, result, deduplicated: false } });
});

export default internal;
