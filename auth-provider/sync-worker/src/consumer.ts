import type { Channel, ConsumeMessage } from "amqplib";
import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { eventDeliveriesTable } from "./db/schema/index.js";
import { resolveTargetApplications } from "./lib/dispatch.js";
import { callInternalLogout } from "./lib/internal-client.js";
import { ackMessage, nackForRetry, publishToDlq } from "./lib/rabbitmq.js";

const MAX_ATTEMPTS = 5;

interface EventPayload {
    eventId: string;
    eventType: string;
    userId: string;
    centralSessionId: string | null;
    applicationId: string | null;
    reason: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
}

async function getOrCreateDelivery(eventId: string, applicationId: string) {
    const [existing] = await db
        .select()
        .from(eventDeliveriesTable)
        .where(and(eq(eventDeliveriesTable.eventId, eventId), eq(eventDeliveriesTable.applicationId, applicationId)))
        .limit(1);
    if (existing) return existing;

    const [created] = await db
        .insert(eventDeliveriesTable)
        .values({ eventId, applicationId, status: "pending" })
        .onConflictDoNothing()
        .returning();
    if (created) return created;

    const [row] = await db
        .select()
        .from(eventDeliveriesTable)
        .where(and(eq(eventDeliveriesTable.eventId, eventId), eq(eventDeliveriesTable.applicationId, applicationId)))
        .limit(1);
    return row!;
}

async function deliverToApplication(payload: EventPayload, app: { id: string; logoutNotificationUrl: string }): Promise<"succeeded" | "retrying" | "failed"> {
    const delivery = await getOrCreateDelivery(payload.eventId, app.id);

    if (delivery.status === "succeeded") {
        return "succeeded";
    }
    if (delivery.status === "failed") {
        return "failed";
    }

    const now = new Date();
    const result = await callInternalLogout(app.logoutNotificationUrl, {
        event_id: payload.eventId,
        event_type: payload.eventType,
        external_user_id: payload.userId,
        central_session_id: payload.centralSessionId ?? undefined,
    });

    const attemptCount = delivery.attemptCount + 1;

    if (result.ok) {
        await db
            .update(eventDeliveriesTable)
            .set({ status: "succeeded", attemptCount, lastAttemptAt: now, processedAt: now, lastError: null })
            .where(eq(eventDeliveriesTable.id, delivery.id));
        return "succeeded";
    }

    const nextStatus = attemptCount >= MAX_ATTEMPTS ? "failed" : "retrying";
    await db
        .update(eventDeliveriesTable)
        .set({ status: nextStatus, attemptCount, lastAttemptAt: now, lastError: result.error ?? `HTTP ${result.status}` })
        .where(eq(eventDeliveriesTable.id, delivery.id));
    return nextStatus;
}

export async function handleMessage(channel: Channel, msg: ConsumeMessage): Promise<void> {
    let payload: EventPayload;
    try {
        payload = JSON.parse(msg.content.toString("utf-8")) as EventPayload;
    } catch (err) {
        console.error("[sync-worker] payload gak valid JSON, buang ke DLQ:", err);
        publishToDlq(channel, msg);
        ackMessage(channel, msg);
        return;
    }

    const targets = await resolveTargetApplications(payload.applicationId);
    if (targets.length === 0) {
        console.warn(`[sync-worker] event ${payload.eventId} (${payload.eventType}) gak ada target app (logout_notification_url kosong?), skip`);
        ackMessage(channel, msg);
        return;
    }

    const outcomes = await Promise.allSettled(targets.map((app) => deliverToApplication(payload, app)));

    const results = outcomes.map((o) => (o.status === "fulfilled" ? o.value : "retrying" as const));
    const stillRetrying = results.some((r) => r === "retrying");

    if (stillRetrying) {
        nackForRetry(channel, msg);
        return;
    }

    const anyPermanentlyFailed = results.some((r) => r === "failed");
    if (anyPermanentlyFailed) {
        publishToDlq(channel, msg);
    }
    ackMessage(channel, msg);
}
