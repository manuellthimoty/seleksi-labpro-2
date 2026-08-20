import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { eventsTable } from '../db/schema/index.js';

export type EventType = 'SessionRevoked' | 'PasswordChanged' | 'AccessPolicyChanged';

export interface EventPayload {
    eventId: string;
    eventType: EventType;
    userId: string;
    centralSessionId: string | null;
    applicationId: string | null;
    reason: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DbExecutor = Transaction;

interface RecordEventInput {
    eventType: EventType;
    userId: string;
    reason: string;
    centralSessionId?: string | null;
    applicationId?: string | null;
    metadata?: Record<string, unknown>;
}

export async function recordEvent(tx: DbExecutor, input: RecordEventInput): Promise<EventPayload> {
    const eventId = randomUUID();
    const occurredAt = new Date();

    const payload: EventPayload = {
        eventId,
        eventType: input.eventType,
        userId: input.userId,
        centralSessionId: input.centralSessionId ?? null,
        applicationId: input.applicationId ?? null,
        reason: input.reason,
        occurredAt: occurredAt.toISOString(),
        metadata: input.metadata ?? {},
    };

    await tx.insert(eventsTable).values({
        id: eventId,
        eventType: input.eventType,
        userId: input.userId,
        centralSessionId: input.centralSessionId ?? null,
        applicationId: input.applicationId ?? null,
        payload,
        status: 'pending',
        createdAt: occurredAt,
    });

    return payload;
}
