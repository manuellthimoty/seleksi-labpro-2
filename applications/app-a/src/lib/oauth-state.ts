import { randomBytes } from "node:crypto";

export function generateState(byteLength = 16): string {
  return randomBytes(byteLength).toString("base64url");
}
