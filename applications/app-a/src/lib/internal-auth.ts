import { timingSafeEqual } from "node:crypto";

const INTERNAL_SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET ?? "placeholder";

export function verifyInternalSecret(providedSecret: string | undefined): boolean {
    if (!providedSecret) return false;

    const provided = Buffer.from(providedSecret);
    const expected = Buffer.from(INTERNAL_SHARED_SECRET);
    if (provided.length !== expected.length) return false;

    return timingSafeEqual(provided, expected);
}
