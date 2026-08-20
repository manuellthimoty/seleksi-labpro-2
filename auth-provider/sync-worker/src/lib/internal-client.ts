const INTERNAL_SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET ?? "dev-internal-secret-change-me";
const CALL_TIMEOUT_MS = 5000;

export interface InternalLogoutPayload {
    event_id: string;
    event_type: string;
    external_user_id?: string;
    central_session_id?: string;
}

export interface InternalLogoutResult {
    ok: boolean;
    status?: number;
    error?: string;
}

export async function callInternalLogout(url: string, payload: InternalLogoutPayload): Promise<InternalLogoutResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": INTERNAL_SHARED_SECRET,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        return { ok: true, status: res.status };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}
