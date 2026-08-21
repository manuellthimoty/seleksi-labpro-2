let shuttingDown = false;

export function beginShutdown(): void {
    shuttingDown = true;
}

export function isShuttingDown(): boolean {
    return shuttingDown;
}
