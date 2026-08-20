import amqp, { type ChannelModel, type Channel, type ConsumeMessage } from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

export const EVENTS_EXCHANGE = "auth.events";
const MAIN_QUEUE = "sync-worker.events";
const MAIN_ROUTING_PATTERN = "event.*";

const RETRY_EXCHANGE = "auth.events.retry";
const RETRY_QUEUE = "sync-worker.events.retry";
const RETRY_DELAY_MS = 30_000;

const DLQ_EXCHANGE = "auth.events.dlq";
const DLQ_QUEUE = "sync-worker.events.dlq";

export async function connectRabbitMQ(): Promise<{ connection: ChannelModel; channel: Channel }> {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await assertTopology(channel);
    return { connection, channel };
}

async function assertTopology(channel: Channel): Promise<void> {
    await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });

    await channel.assertExchange(RETRY_EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DLQ_EXCHANGE, "topic", { durable: true });

    await channel.assertQueue(MAIN_QUEUE, {
        durable: true,
        arguments: {
            "x-dead-letter-exchange": RETRY_EXCHANGE,
        },
    });
    await channel.bindQueue(MAIN_QUEUE, EVENTS_EXCHANGE, MAIN_ROUTING_PATTERN);

    await channel.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: {
            "x-message-ttl": RETRY_DELAY_MS,
            "x-dead-letter-exchange": EVENTS_EXCHANGE,
        },
    });
    await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, "#");

    await channel.assertQueue(DLQ_QUEUE, { durable: true });
    await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "#");
}

export function consumeMainQueue(channel: Channel, onMessage: (msg: ConsumeMessage) => void): void {
    channel.consume(MAIN_QUEUE, (msg) => {
        if (msg) onMessage(msg);
    }, { noAck: false });
}

export function nackForRetry(channel: Channel, msg: ConsumeMessage): void {
    channel.nack(msg, false, false);
}

export function ackMessage(channel: Channel, msg: ConsumeMessage): void {
    channel.ack(msg);
}

export function publishToDlq(channel: Channel, msg: ConsumeMessage): void {
    channel.publish(DLQ_EXCHANGE, msg.fields.routingKey, msg.content, {
        ...msg.properties,
        headers: { ...msg.properties.headers, "x-original-exchange": msg.fields.exchange },
    });
}
