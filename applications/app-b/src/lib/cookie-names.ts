
// Kalau App A dan App B sama-sama pakai nama `local_session`, cookie App B
// bakal NIMPA punya App A, dan logout di salah satunya menghapus cookie yang
// dipakai berdua.
//
// Prefix-nya dari env var supaya kode App A dan App B tetap identik persis
const prefix = (process.env.COOKIE_PREFIX ?? process.env.OAUTH_CLIENT_ID ?? 'app').replace(/-/g, '_');

export const SESSION_COOKIE = `${prefix}_local_session`;
export const PENDING_COOKIE = `${prefix}_oauth_pending`;
