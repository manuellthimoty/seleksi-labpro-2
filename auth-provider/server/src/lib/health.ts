import { pool } from '../db/index.js';
import { pingBroker } from './event-publisher.js';

export interface ComponentCheck {
    status: 'ok' | 'error';
    latencyMs: number;
    message?: string;
}

export interface ReadinessReport {
    status: 'ok' | 'unavailable';
    checks: Record<string, ComponentCheck>;
}

const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 3000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
    return Promise.race([
        work,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} gak merespons dalam ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS),
        ),
    ]);
}

function safeMessage(err: unknown): string {
    const code = (err as { code?: unknown })?.code;
    if (typeof code === 'string' && code.length <= 32) {
        return `tidak bisa dijangkau (${code})`;
    }
    if (err instanceof Error && err.message.includes('gak merespons dalam')) {
        return err.message;
    }
    return 'tidak bisa dijangkau';
}

async function timed(label: string, work: () => Promise<unknown>): Promise<ComponentCheck> {
    const startedAt = Date.now();
    try {
        await withTimeout(work(), label);
        return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (err) {
        return { status: 'error', latencyMs: Date.now() - startedAt, message: safeMessage(err) };
    }
}

export function checkDatabase(): Promise<ComponentCheck> {
    return timed('database', () => pool.query('SELECT 1'));
}

export function checkBroker(): Promise<ComponentCheck> {
    return timed('broker', () => pingBroker());
}

export async function readinessReport(): Promise<ReadinessReport> {
    const [database, broker] = await Promise.all([checkDatabase(), checkBroker()]);
    const checks = { database, broker };
    const healthy = Object.values(checks).every((check) => check.status === 'ok');

    return { status: healthy ? 'ok' : 'unavailable', checks };
}
