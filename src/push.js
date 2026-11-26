// The Stewart Nest — phone notifications that arrive even when the app is closed (Web Push).
//
// Each phone that switches notifications on registers a push subscription here. When something happens
// (a chat message, a task, a reminder…) we send that phone an empty "wake up" push. The service worker
// (public/sw.js) then asks /api/badges what's new and shows the notification itself, so no message text
// travels through Google's or Apple's push servers and nothing needs encrypting.
//
// Needs two Cloudflare secrets, made by "Publish to Cloudflare.bat": VAPID_PUBLIC and VAPID_PRIVATE.
// For the laptop, put the same two lines in a .dev.vars file (see README).
import { AsyncLocalStorage } from 'node:async_hooks';
import { json, bad, body } from './util.js';

// the current request's env and ctx, so notify() anywhere can send pushes without waiting for them
const requestScope = new AsyncLocalStorage();
export const withRequest = (env, ctx, origin, fn) => requestScope.run({ env, ctx, origin }, fn);

const PUSH_TTL_SECONDS = 24 * 3600;
const JWT_HOURS = 12;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

let signingKey = null; // cached per isolate
async function vapidKey(env) {
  if (signingKey) return signingKey;
  const pub = fromB64url(env.VAPID_PUBLIC); // 65 bytes: 0x04 | x | y
  signingKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signingKey;
}
async function vapidHeader(env, endpoint, origin) {
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + JWT_HOURS * 3600, sub: origin || 'https://stewartza.co.za' };
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// Is it quiet time for this person right now (South African time)? Handles nights like 21:00–06:00.
function quietNow(prefs) {
  if (!prefs.quiet_from || !prefs.quiet_to) return false;
  const now = new Date(Date.now() + 2 * 3600e3).toISOString().slice(11, 16);
  const { quiet_from: a, quiet_to: b } = prefs;
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
async function wanted(db, ids, kind) {
  const { results } = await db.prepare(`SELECT id, prefs FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  return results.filter((u) => {
    let p = {}; try { p = JSON.parse(u.prefs || '{}') || {}; } catch { /* none */ }
    if (kind === 'chat' ? p.notify_chat === false : p.notify_other === false) return false;
    return !quietNow(p); // quiet time: no buzz; it's waiting in the app when they open it
  }).map((u) => u.id);
}
async function sendAll(db, env, origin, userIds, kind) {
  const ids = await wanted(db, [...new Set(userIds)].filter(Boolean), kind);
  if (!ids.length) return;
  const { results: subs } = await db.prepare(`SELECT endpoint FROM push_subs WHERE user_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  await Promise.all(subs.map(async ({ endpoint }) => {
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: {
        authorization: await vapidHeader(env, endpoint, origin), ttl: String(PUSH_TTL_SECONDS), urgency: 'high', 'content-length': '0' } });
      // the phone switched notifications off or the app was removed: forget it
      if (r.status === 404 || r.status === 410) await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
      else if (!r.ok) console.error('push', r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.error('push failed', e.message); }
  }));
}

// Wake these people's phones. Returns straight away; the sending finishes after the response.
export function pushTo(db, userIds, kind = 'other') {
  const scope = requestScope.getStore();
  if (!scope?.env?.VAPID_PUBLIC || !scope.env.VAPID_PRIVATE || !userIds?.length) return;
  const job = sendAll(db, scope.env, scope.origin, userIds, kind).catch((e) => console.error('push', e.message));
  scope.ctx?.waitUntil ? scope.ctx.waitUntil(job) : job;
}

// ---------- API: /api/push/… ----------
export async function pushApi({ req, env, db, path, method, me }) {
  if (path === 'push/key' && method === 'GET') return json({ key: env.VAPID_PUBLIC || null });
  if (path === 'push/subscribe' && method === 'POST') {
    const { endpoint, keys } = await body(req);
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return bad('Not a push subscription');
    await db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .bind(endpoint, me.id, String(keys?.p256dh || '').slice(0, 200), String(keys?.auth || '').slice(0, 100)).run();
    return json({ ok: true });
  }
  if (path === 'push/unsubscribe' && method === 'POST') {
    const { endpoint } = await body(req);
    await db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(endpoint || ''), me.id).run();
    return json({ ok: true });
  }
  return null;
}

export { quietNow };
