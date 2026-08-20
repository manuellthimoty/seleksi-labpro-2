import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { applicationsTable } from "../db/schema/index.js";

export interface TargetApplication {
    id: string;
    logoutNotificationUrl: string;
}

export async function resolveTargetApplications(applicationId: string | null): Promise<TargetApplication[]> {
    if (applicationId) {
        const [app] = await db
            .select({ id: applicationsTable.id, logoutNotificationUrl: applicationsTable.logoutNotificationUrl })
            .from(applicationsTable)
            .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.status, "active"), isNotNull(applicationsTable.logoutNotificationUrl)))
            .limit(1);
        return app?.logoutNotificationUrl ? [{ id: app.id, logoutNotificationUrl: app.logoutNotificationUrl }] : [];
    }

    const apps = await db
        .select({ id: applicationsTable.id, logoutNotificationUrl: applicationsTable.logoutNotificationUrl })
        .from(applicationsTable)
        .where(and(eq(applicationsTable.status, "active"), isNotNull(applicationsTable.logoutNotificationUrl)));

    return apps.filter((a): a is TargetApplication => Boolean(a.logoutNotificationUrl));
}
