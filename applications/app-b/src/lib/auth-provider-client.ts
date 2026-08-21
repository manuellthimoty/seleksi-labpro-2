//PUBLIC_URL dipakai buat redirect BROWSER (getAuthorizeUrl)
//yang bisa diakses dari browser user, misal host-mapped port di docker-compose.
//INTERNAL_URL dipakai App A sendiri manggil back-channel (exchangeCodeForToken,fetchUserinfo) server-to-server
const AUTH_PROVIDER_PUBLIC_URL = process.env.AUTH_PROVIDER_PUBLIC_URL ?? "http://localhost:3000";
const AUTH_PROVIDER_INTERNAL_URL = process.env.AUTH_PROVIDER_INTERNAL_URL ?? "http://localhost:3000";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "app-b";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? "app-b-secret";
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI ?? "http://localhost:5000/callback";

export class AuthProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AuthProviderError";
  }
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface UserinfoResponse {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  sid: string;
}

async function parseErrorBody(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return {
    code: body?.error?.code ?? "UNKNOWN_ERROR",
    message: body?.error?.message ?? `Auth Provider returned ${res.status}`,
  };
}

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_PROVIDER_INTERNAL_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri ?? OAUTH_REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      code_verifier: params.codeVerifier,
    }),
  });

  if (!res.ok) {
    const { code, message } = await parseErrorBody(res);
    throw new AuthProviderError(message, res.status, code);
  }

  return res.json() as Promise<TokenResponse>;
}

export async function fetchUserinfo(accessToken: string): Promise<UserinfoResponse> {
  const url = new URL(`${AUTH_PROVIDER_INTERNAL_URL}/userinfo`);
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const { code, message } = await parseErrorBody(res);
    throw new AuthProviderError(message, res.status, code);
  }

  return res.json() as Promise<UserinfoResponse>;
}

export function getAuthorizeUrl(params: { state: string; codeChallenge: string; redirectUri?: string }): string {
  const url = new URL("/authorize", AUTH_PROVIDER_PUBLIC_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri ?? OAUTH_REDIRECT_URI);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
