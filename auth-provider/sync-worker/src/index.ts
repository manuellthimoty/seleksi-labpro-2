import { connectRabbitMQ, consumeMainQueue } from "./lib/rabbitmq.js";
import { handleMessage } from "./consumer.js";

async function main() {
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
                //
            }
            process.exit(0);
        });
    }
}

main().catch((err) => {
    console.error("[sync-worker] gagal start:", err);
    process.exit(1);
});
