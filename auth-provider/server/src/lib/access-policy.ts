import { and, eq, inArray } from 'drizzle-orm';
import { applicationGroupPoliciesTable, userGroupsTable } from '../db/schema/index.js';
import { recordEvent, type DbExecutor } from './events.js';

export async function getGroupMemberIds(tx: DbExecutor, groupId: string): Promise<string[]> {
    const rows = await tx
        .select({ userId: userGroupsTable.userId })
        .from(userGroupsTable)
        .where(eq(userGroupsTable.groupId, groupId));
    return rows.map((r) => r.userId);
}

export async function getUsersWithAccess(
    tx: DbExecutor,
    applicationId: string,
    userIds: string[],
): Promise<Set<string>> {
    if (userIds.length === 0) {
        return new Set();
    }
    const rows = await tx
        .select({ userId: userGroupsTable.userId, effect: applicationGroupPoliciesTable.effect })
        .from(userGroupsTable)
        .innerJoin(
            applicationGroupPoliciesTable,
            eq(applicationGroupPoliciesTable.groupId, userGroupsTable.groupId),
        )
        .where(
            and(
                eq(applicationGroupPoliciesTable.applicationId, applicationId),
                inArray(userGroupsTable.userId, userIds),
            ),
        );

    const denied = new Set<string>();
    const allowed = new Set<string>();
    for (const row of rows) {
        (row.effect === 'deny' ? denied : allowed).add(row.userId);
    }

    return new Set([...allowed].filter((userId) => !denied.has(userId)));
}

export async function emitAccessLostEvents(
    tx: DbExecutor,
    params: {
        applicationId: string;
        groupId: string;
        reason: string;
        metadata: Record<string, unknown>;
        applyChange: () => Promise<void>;
    },
): Promise<string[]> {
    const memberIds = await getGroupMemberIds(tx, params.groupId);
    const before = await getUsersWithAccess(tx, params.applicationId, memberIds);

    await params.applyChange();

    const after = await getUsersWithAccess(tx, params.applicationId, memberIds);
    const lostAccess = memberIds.filter((userId) => before.has(userId) && !after.has(userId));

    for (const userId of lostAccess) {
        await recordEvent(tx, {
            eventType: 'AccessPolicyChanged',
            userId,
            applicationId: params.applicationId,
            reason: params.reason,
            metadata: { groupId: params.groupId, ...params.metadata },
        });
    }

    return lostAccess;
}
