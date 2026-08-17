import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../lib/hono-env.js";
import { generateState } from "../lib/oauth-state.js";
import { generatePkcePair } from "../lib/pkce.js";
import { getAuthorizeUrl } from "../lib/auth-provider-client.js";

const login = new Hono<AppEnv>();

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000; // 10 menit

login.get('/login', async (c) => {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();

    setCookie(c, 'oauth_pending', JSON.stringify({ state, codeVerifier }), {
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