import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, consumeMainQueue, stopConsuming, requeueMessage } from "./lib/rabbitmq.js";
import { handleMessage } from "./consumer.js";
import { pool } from "./db/index.js";

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000;

const inFlight = new Set<ConsumeMessage>();
let consuming = false;

function startHealthServer() {
    const app = new Hono();

    app.get('/health/live', (c) => c.json({ status: 'ok' }));

    app.get('/health/ready', async (c) => {
        const checks: Record<string, { status: string; message?: string }> = {
            consumer: consuming ? { status: 'ok' } : { status: 'error', message: 'belum consume dari queue' },
        };
        try {
            await pool.query('SELECT 1');
            checks.database = { status: 'ok' };
        } catch (err) {
            const code = (err as { code?: unknown })?.code;
            checks.database = {
                status: 'error',
                message: typeof code === 'string' ? `tidak bisa dijangkau (${code})` : 'tidak bisa dijangkau',
            };
        }

        const healthy = Object.values(checks).every((x) => x.status === 'ok');
        return c.json({ status: healthy ? 'ok' : 'unavailable', checks }, healthy ? 200 : 503);
    });

    app.get('/health', (c) => c.json({ status: 'ok' }));

    const port = Number(process.env.HEALTH_PORT) || 3100;
    serve({ fetch: app.fetch, port });
    console.log(`[sync-worker] health check listening on port ${port}`);
}

async function main() {
    startHealthServer();

    console.log("[sync-worker] connecting to RabbitMQ...");
    const { connection, channel } = await connectRabbitMQ();

    await channel.prefetch(5);

    let shuttingDown = false;
    const bailOut = (why: string) => (err?: unknown) => {
        if (shuttingDown) return;
        const detail = err instanceof Error ? `: ${err.message}` : '';
        console.error(`[sync-worker] koneksi RabbitMQ ${why}${detail}, keluar biar di-restart`);
        process.exit(1);
    };
    connection.on('error', bailOut('error'));
    connection.on('close', bailOut('ditutup'));
    channel.on('error', bailOut('channel error'));
    channel.on('close', bailOut('channel ditutup'));

    const consumerTag = await consumeMainQueue(channel, (msg) => {
        inFlight.add(msg);
        handleMessage(channel, msg)
            .catch((err) => {
                console.error("[sync-worker] unhandled error processing message, nack tanpa retry:", err);
                channel.nack(msg, false, false);
            })
            .finally(() => inFlight.delete(msg));
    });
    consuming = true;

    console.log("[sync-worker] listening on sync-worker.events");

    let shutdownStarted = false;

    async function shutdown(signal: string) {
        if (shutdownStarted) return;
        shutdownStarted = true;
        shuttingDown = true;

        console.log(`[shutdown] ${signal} diterima, berhenti ambil pesan baru`);
        try {
            await stopConsuming(channel, consumerTag);
        } catch {
            // channel bisa jadi udah ketutup duluan
        }
        consuming = false;

        const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
        if (inFlight.size > 0) {
            console.log(`[shutdown] nunggu ${inFlight.size} pesan yang lagi diproses`);
        }
        while (inFlight.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (inFlight.size > 0) {
            console.warn(`[shutdown] ${inFlight.size} pesan belum selesai setelah ${SHUTDOWN_TIMEOUT_MS}ms, dibalikin ke queue`);
            for (const msg of inFlight) {
                try {
                    requeueMessage(channel, msg);
                } catch {
                }
            }
        } else {
            console.log('[shutdown] semua pesan selesai diproses');
        }

        try {
            await channel.close();
            await connection.close();
            console.log('[shutdown] koneksi RabbitMQ ditutup');
        } catch {
            // koneksi mungkin udah putus duluan
        }

        await pool.end();
        console.log('[shutdown] pool Postgres ditutup');

        console.log('[shutdown] selesai');
        process.exit(0);
    }

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
            void shutdown(signal);
        });
    }
}

main().catch((err) => {
    console.error("[sync-worker] gagal start:", err);
    process.exit(1);
});
