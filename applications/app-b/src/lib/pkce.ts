import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generateCodeVerifier(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function computeCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  return { codeVerifier, codeChallenge: computeCodeChallenge(codeVerifier) };
}
