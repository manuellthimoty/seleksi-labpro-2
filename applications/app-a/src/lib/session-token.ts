import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function generateSessionToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifySessionTokenHash(token: string, hash: string): boolean {
  const actual = Buffer.from(hashSessionToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
