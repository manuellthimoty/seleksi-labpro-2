import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { connectRabbitMQ, consumeMainQueue } from "./lib/rabbitmq.js";
import { handleMessage } from "./consumer.js";

function startHealthServer() {
    const app = new Hono();
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

    consumeMainQueue(channel, (msg) => {
        handleMessage(channel, msg).catch((err) => {
            console.error("[sync-worker] unhandled error processing message, nack tanpa retry:", err);
            channel.nack(msg, false, false);
        });
    });

    console.log("[sync-worker] listening on sync-worker.events");

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, async () => {
            console.log(`[sync-worker] ${signal} diterima, shutting down...`);
            try {
                await channel.close();
                await connection.close();
            } catch {
                // biasanya dh mati
            }
            process.exit(0);
        });
    }
}

main().catch((err) => {
    console.error("[sync-worker] gagal start:", err);
    process.exit(1);
});
