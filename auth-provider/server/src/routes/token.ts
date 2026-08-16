import { Hono } from 'hono';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applicationsTable, authorizationCodesTable, accessTokensTable } from '../db/schema/index.js';
import { verifyPassword } from '../lib/password.js';
import { generateToken } from '../lib/token.js';
import { hashToken } from '../lib/token-hash.js';
import { formatError } from '../lib/error.js';
import { logAuditEvent } from '../lib/audit-log.js';
import type { AppEnv } from '../lib/hono-env.js';

const token = new Hono<AppEnv>();

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 jam
const DEFAULT_SCOPES = 'openid profile email';

const tokenRequestSchema = z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string(),
    redirect_uri: z.string().url(),
    client_id: z.string(),
    client_secret: z.string(),
    code_verifier: z.string(),
});

function base64UrlSha256(input: string) {
    return createHash('sha256').update(input).digest('base64url');
}

token.post('/token', async (c) => {
    const requestId = c.get('requestId');
    const parsed = tokenRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json(formatError('VALIDATION_ERROR', parsed.error.issues[0].message, requestId), 400);
    }
    const { code, redirect_uri, client_id, client_secret, code_verifier } = parsed.data;

    const [application] = await db.select().from(applicationsTable).where(eq(applicationsTable.clientId, client_id)).limit(1);
    if (!application || application.status !== 'active') {
        return c.json(formatError('INVALID_CLIENT', 'Unknown or inactive client_id', requestId), 401);
    }
    const validSecret = await verifyPassword(client_secret, application.clientSecretHash);
    if (!validSecret) {
        return c.json(formatError('INVALID_CLIENT', 'client_secret is incorrect', requestId), 401);
    }

    // cocokin hashnya
    const codeHash = hashToken(code);
    const [authCode] = await db
        .select()
        .from(authorizationCodesTable)
        .where(eq(authorizationCodesTable.codeHash, codeHash))
        .limit(1);

    if (!authCode) {
        return c.json(formatError('INVALID_GRANT', 'Authorization code is invalid', requestId), 400);
    }
    if (authCode.usedAt) {
        // code dipakai 2x (maybe indikasi kebocoran/replay)
        // cabut token yg sempat diterbitkan dari code ini sebagai mitigasi
        await db
            .update(accessTokensTable)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(
                and(
                    eq(accessTokensTable.ssoSessionId, authCode.ssoSessionId),
                    eq(accessTokensTable.applicationId, authCode.applicationId),
                ),
            );
        await logAuditEvent({
            eventType: 'authorization.code.replay',
            result: 'failure',
            userId: authCode.userId,
            applicationId: authCode.applicationId,
            sessionId: authCode.ssoSessionId,
        });
        return c.json(formatError('INVALID_GRANT', 'Authorization code has already been used', requestId), 400);
    }
    if (authCode.expiresAt.getTime()< Date.now()) {
        return c.json(formatError('INVALID_GRANT', 'Authorization code has expired', requestId), 400);
    }
    if (authCode.applicationId !== application.id) {
        return c.json(formatError('INVALID_GRANT', 'Authorization code was not issued to this client', requestId), 400);
    }
    if (authCode.redirectUri !== redirect_uri) {
        return c.json(formatError('INVALID_GRANT', 'redirect_uri does not match', requestId), 400);
    }

    const computedChallenge = base64UrlSha256(code_verifier);
    if (computedChallenge !== authCode.codeChallenge) {
        return c.json(formatError('INVALID_GRANT', 'code_verifier does not match code_challenge', requestId), 400);
    }

    // klaim cuma berhasil kalau belum ada request lain yang keduluan menandainya used
    const [claimed] = await db
        .update(authorizationCodesTable)
        .set({ usedAt: new Date() })
        .where(and(eq(authorizationCodesTable.id, authCode.id), isNull(authorizationCodesTable.usedAt)))
        .returning({ id: authorizationCodesTable.id });
    if (!claimed) {
        return c.json(formatError('INVALID_GRANT', 'Authorization code has already been used', requestId), 400);
    }

    const rawAccessToken = generateToken();
    const accessTokenHash = hashToken(rawAccessToken);
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await db.insert(accessTokensTable).values({
        tokenHash: accessTokenHash,
        userId: authCode.userId,
        applicationId: authCode.applicationId,
        ssoSessionId: authCode.ssoSessionId,
        scopes: DEFAULT_SCOPES,
        expiresAt,
    });

    await logAuditEvent({
        eventType: 'access_token.issue',
        result: 'success',
        userId: authCode.userId,
        applicationId: authCode.applicationId,
        sessionId: authCode.ssoSessionId,
    });

    return c.json({
        access_token: rawAccessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_MS / 1000,
        scope: DEFAULT_SCOPES,
    });
});

export default token;
