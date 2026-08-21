import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { eventsTable } from '../db/schema/index.js';
import type { EventPayload } from './events.js';

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672';
const POLL_INTERVAL_MS = Number(process.env.EVENT_PUBLISHER_INTERVAL_MS) || 2000;
const BATCH_SIZE = Number(process.env.EVENT_PUBLISHER_BATCH_SIZE) || 50;

export const EVENTS_EXCHANGE = 'auth.events';
export const routingKeyFor = (eventType: string) => `event.${eventType}`;

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

function resetConnection() {
    connection = null;
    channel = null;
}

async function getChannel(): Promise<ConfirmChannel> {
    if (channel) return channel;

    const conn = await amqp.connect(RABBITMQ_URL);
    conn.on('error', resetConnection);
    conn.on('close', resetConnection);

    const ch = await conn.createConfirmChannel();
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });

    connection = conn;
    channel = ch;
    return ch;
}

/**
 * Dipakai readiness probe. Make ulang koneksi publisher kalau masih hidup;
 * kalau udah putus, dia nyoba connect baru 
 */
export async function pingBroker(): Promise<void> {
    await getChannel();
}

async function publishWithConfirm(payload: EventPayload): Promise<void> {
    const ch = await getChannel();
    await new Promise<void>((resolve, reject) => {
        ch.publish(
            EVENTS_EXCHANGE,
            routingKeyFor(payload.eventType),
            Buffer.from(JSON.stringify(payload)),
            {
                persistent: true,
                messageId: payload.eventId,
                type: payload.eventType,
                contentType: 'application/json',
                timestamp: Math.floor(Date.parse(payload.occurredAt) / 1000),
            },
            (err) => (err ? reject(err) : resolve()),
        );
    });
}

export async function drainOutbox(): Promise<number> {
    const pending = await db
        .select({ id: eventsTable.id, payload: eventsTable.payload })
        .from(eventsTable)
        .where(and(isNull(eventsTable.publishedAt), eq(eventsTable.status, 'pending')))
        .orderBy(asc(eventsTable.createdAt))
        .limit(BATCH_SIZE);

    let publishedCount = 0;
    for (const row of pending) {
        await publishWithConfirm(row.payload as EventPayload);

        const [marked] = await db
            .update(eventsTable)
            .set({ status: 'published', publishedAt: new Date() })
            .where(and(eq(eventsTable.id, row.id), isNull(eventsTable.publishedAt)))
            .returning({ id: eventsTable.id });

        if (!marked) {
            console.warn(`[event-publisher] event ${row.id} sudah ditandai published oleh proses lain`);
            continue;
        }
        publishedCount += 1;
    }

    return publishedCount;
}

export function startEventPublisher(): () => Promise<void> {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
        if (stopped) return;
        try {
            const count = await drainOutbox();
            if (count > 0) {
                console.log(`[event-publisher] ${count} event dipublish ke ${EVENTS_EXCHANGE}`);
            }
        } catch (err) {
            resetConnection();
            console.error(`[event-publisher] gagal publish: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!stopped) {
            timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
    };

    console.log(`[event-publisher] jalan tiap ${POLL_INTERVAL_MS}ms (batch ${BATCH_SIZE})`);
    timer = setTimeout(tick, 0);

    return async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        try {
            await connection?.close();
        } catch {
            // koneksi putus maybe
        }
        resetConnection();
    };
}
