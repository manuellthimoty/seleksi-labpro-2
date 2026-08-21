// sblmnya ternyata cookie nya itu kyk refrence
// kalo A dihapus, B juga ikutan kehapus
const prefix = (process.env.COOKIE_PREFIX ?? process.env.OAUTH_CLIENT_ID ?? 'app').replace(/-/g, '_');

export const SESSION_COOKIE = `${prefix}_local_session`;
export const PENDING_COOKIE = `${prefix}_oauth_pending`;
