import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accessTokensTable, ssoSessionsTable, usersTable } from '../db/schema/index.js';
import { recordEvent } from './events.js';

export const publicUserColumns = {
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    status: usersTable.status,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
    updatedAt: usersTable.updatedAt,
};

export async function setUserStatus(userId: string, status: 'active' | 'inactive') {
    return db.transaction(async (tx) => {
        const [user] = await tx
            .update(usersTable)
            .set({ status, updatedAt: new Date() })
            .where(eq(usersTable.id, userId))
            .returning(publicUserColumns);
        if (!user) {
            return null;
        }

        if (status === 'active') {
            return { user, revokedSessionCount: 0 };
        }

        const revokedSessions = await tx
            .update(ssoSessionsTable)
            .set({ status: 'revoked', revokedAt: new Date(), revokeReason: 'user_deactivated' })
            .where(and(eq(ssoSessionsTable.userId, userId), eq(ssoSessionsTable.status, 'active')))
            .returning({ id: ssoSessionsTable.id });

        await tx
            .update(accessTokensTable)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(and(eq(accessTokensTable.userId, userId), eq(accessTokensTable.status, 'active')));

        for (const session of revokedSessions) {
            await recordEvent(tx, {
                eventType: 'SessionRevoked',
                userId,
                centralSessionId: session.id,
                reason: 'user_deactivated',
                metadata: { revokedBy: 'admin' },
            });
        }

        return { user, revokedSessionCount: revokedSessions.length };
    });
}
