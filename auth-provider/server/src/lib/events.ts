export interface SessionRevokedEvent {
    eventType: 'SessionRevoked';
    sessionId: string;
    userId: string;
    revokedAt: string;
    reason: string;
}

export function publishSessionRevoked(event: SessionRevokedEvent): void {
    console.log('[event:SessionRevoked]', JSON.stringify(event));
}

export interface PasswordChangedEvent {
    eventType: 'PasswordChanged';
    userId: string;
    changedAt: string;
}

export function publishPasswordChanged(event: PasswordChangedEvent): void {
    console.log('[event:PasswordChanged]', JSON.stringify(event));
}
