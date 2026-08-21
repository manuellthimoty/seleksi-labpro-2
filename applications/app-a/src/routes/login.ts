import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { PENDING_COOKIE } from "../lib/cookie-names.js";
import type { AppEnv } from "../lib/hono-env.js";
import { generateState } from "../lib/oauth-state.js";
import { generatePkcePair } from "../lib/pkce.js";
import { getAuthorizeUrl } from "../lib/auth-provider-client.js";
import { logActivity } from "../lib/activity-log.js";

const login = new Hono<AppEnv>();

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000; // 10 menit

login.get('/login', async (c) => {
    // kalau kesini gara2 di-redirect requireLocalSession (session
    // expired/revoked/hilang), catat alasannya biar keliatan di Activity Log
    const reason = c.req.query('error');
    if (reason) {
        logActivity('local_session.reauth', `Login ulang dipicu: ${reason}`, c.get('requestId'));
    }

    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();

    setCookie(c, PENDING_COOKIE, JSON.stringify({ state, codeVerifier }), {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: OAUTH_PENDING_TTL_MS / 1000,
        path: '/',
    });

    const authorizeUrl = getAuthorizeUrl({ state, codeChallenge });
    return c.redirect(authorizeUrl, 302);
});

export default login;