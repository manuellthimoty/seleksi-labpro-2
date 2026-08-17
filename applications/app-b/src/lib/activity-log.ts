import { randomUUID } from "node:crypto";

export interface ActivityLogEntry {
  id: string;
  eventType: string;
  message: string;
  requestId?: string;
  createdAt: string;
}

const MAX_ENTRIES = 200;
const entries: ActivityLogEntry[] = [];

export function logActivity(eventType: string, message: string, requestId?: string): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: randomUUID(),
    eventType,
    message,
    requestId,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  return entry;
}

export function getActivityLog(): ActivityLogEntry[] {
  return [...entries].reverse();
}
