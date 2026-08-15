import { db } from "../db/index.js";
import { auditLogsTable } from "../db/schema/index.js";

interface AuditLogInput {
  eventType: string;
  result: string;
  actorId?: string;
  userId?: string;
  applicationId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  await db.insert(auditLogsTable).values(input);
}
