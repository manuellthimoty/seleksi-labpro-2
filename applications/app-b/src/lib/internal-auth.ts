import { timingSafeEqual } from "node:crypto";

// Shared-secret sederhana buat autentikasi service-to-service (Sync Worker ->
// App B). Bukan session/cookie karena caller-nya bukan browser. 
const INTERNAL_SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET ?? "dev-internal-secret-change-me";

export function verifyInternalSecret(providedSecret: string | undefined): boolean {
    if (!providedSecret) return false;

    const provided = Buffer.from(providedSecret);
    const expected = Buffer.from(INTERNAL_SHARED_SECRET);
    if (provided.length !== expected.length) return false;

    return timingSafeEqual(provided, expected);
}
