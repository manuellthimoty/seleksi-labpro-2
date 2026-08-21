import { createMiddleware } from "hono/factory";
import { getCookie, deleteCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../lib/cookie-names.js";
import type { AppEnv } from "../lib/hono-env.js";
import { checkLocalSession, type LocalSessionInvalidReason } from "../lib/local-session.js";
import { logActivity } from "../lib/activity-log.js";

const REASON_MESSAGES: Record<LocalSessionInvalidReason, string> = {
    missing: "Kamu belum login.",
    invalid: "Sesi login tidak ditemukan, silakan login ulang.",
    expired: "Sesi login sudah kedaluwarsa, silakan login ulang.",
    revoked: "Sesi login sudah dicabut, silakan login ulang.",
};

export const requireLocalSession = createMiddleware<AppEnv>(async (c, next) => {
    const sessionToken = getCookie(c, SESSION_COOKIE);
    const result = await checkLocalSession(sessionToken);

    if (!result.ok) {
        // cookie basi gak ada gunanya lagi disimpen di browser
        deleteCookie(c, SESSION_COOKIE, { path: "/" });

        if (result.reason !== "missing") {
            logActivity("local_session.rejected", `Akses ditolak: ${result.reason}`, c.get("requestId"));
        }

        const loginUrl = new URL("/login", new URL(c.req.url).origin);
        loginUrl.searchParams.set("error", result.reason);
        loginUrl.searchParams.set("message", REASON_MESSAGES[result.reason]);
        return c.redirect(loginUrl.toString(), 302);
    }

    c.set("externalUserId", result.session.externalUserId);
    await next();
});
