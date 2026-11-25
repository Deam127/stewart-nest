// The Stewart Nest — logins, passwords, admin (user management) and automatic database upgrades.
import { json, bad, body, randomHex, sha256, getCookie } from './util.js';

const SESSION_DAYS = 60;
const MIN_LEN = 6;

// ---------- automatic schema upgrades ----------
// Runs once per server start. Brings an existing database up to date without wiping data,
// so there's nothing to run by hand after updating the app files.
let schemaChecked = false;
const UPGRADES = {
  3: [
    'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN hash_algo TEXT NOT NULL DEFAULT 'sha256-pin'",
    'ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    "UPDATE users SET is_admin = 1 WHERE id = 'lee-roy'",
    // Old 4-digit PINs still work once, then everyone must choose a proper password
    "UPDATE users SET must_change = 1 WHERE pin_hash IS NOT NULL AND hash_algo = 'sha256-pin'",
    `CREATE TABLE IF NOT EXISTS meal_ratings (
       date       TEXT NOT NULL,
       recipe_id  TEXT NOT NULL,
       user_id    TEXT NOT NULL,
       stars      INTEGER,
       verdict    TEXT,
       comment    TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (date, recipe_id, user_id))`,
  ],
};
export async function ensureSchema(db) {
  if (schemaChecked) return;
  let v = 0;
  try { v = Number((await db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first())?.value || 2); } catch { return; }
  for (const target of Object.keys(UPGRADES).map(Number).sort((a, b) => a - b)) {
    if (v >= target) continue;
    for (const sql of UPGRADES[target]) {
      try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    }
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)").bind(String(target)).run();
    v = target;
  }
  schemaChecked = true;
}

// ---------- password hashing (PBKDF2-SHA256) ----------
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function checkPassword(u, password) {
  if (!u.pin_hash) return false;
  const h = u.hash_algo === 'pbkdf2' ? await pbkdf2(password, u.salt) : await sha256(u.salt + password);
  // constant-time-ish compare
  let diff = h.length ^ u.pin_hash.length;
  for (let i = 0; i < Math.min(h.length, u.pin_hash.length); i++) diff |= h.charCodeAt(i) ^ u.pin_hash.charCodeAt(i);
  return diff === 0;
}
async function setPassword(db, userId, password, mustChange = 0) {
  const salt = randomHex(16);
  await db.prepare("UPDATE users SET pin_hash = ?, salt = ?, hash_algo = 'pbkdf2', must_change = ?, failed = 0, locked_until = NULL WHERE id = ?")
    .bind(await pbkdf2(password, salt), salt, mustChange, userId).run();
}
const weak = (p) => !p || p.length < MIN_LEN ? `Password must be at least ${MIN_LEN} characters` : null;

export async function currentUser(req, db) {
  const token = getCookie(req, 'nest_session');
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.name, u.full_name, u.colour, u.emoji, u.is_parent, u.is_admin, u.must_change FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).bind(token).first();
}

async function startSession(db, url, userId, extra = {}) {
  const token = randomHex(32);
  await db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(token, userId).run();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true, ...extra }, 200, {
    'set-cookie': `nest_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  });
}

// Public endpoints (before login). Returns a Response or null.
export async function authPublic({ req, db, url, path, method }) {
  if (path === 'users' && method === 'GET') {
    const { results } = await db.prepare(`SELECT id, name, full_name, colour, emoji, is_parent, is_admin,
      pin_hash IS NOT NULL AS has_password FROM users WHERE active = 1 ORDER BY is_admin DESC, is_parent DESC, name`).all();
    // Only the admin can set up their own password on first login; everyone else gets one from the admin
    // (so nobody can claim someone else's profile).
    return json(results.map((u) => ({ ...u, can_set_up: !u.has_password && !!u.is_admin })));
  }

  if (path === 'login' && method === 'POST') {
    const { user, password } = await body(req);
    const u = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(user).first();
    if (!u) return bad('Unknown person', 404);
    if (u.locked_until && u.locked_until > new Date().toISOString())
      return bad('Too many wrong passwords. Try again in 15 minutes, or ask Lee Roy to reset it.', 429);
    if (!u.pin_hash) {
      if (!u.is_admin) return bad('Your password hasn\'t been set up yet. Ask Lee Roy to set one for you.', 403);
      const w = weak(password); if (w) return bad(w);
      await setPassword(db, u.id, password, 0);
      return startSession(db, url, u.id, { firstTime: true });
    }
    if (!(await checkPassword(u, password || ''))) {
      const failed = u.failed + 1;
      const lock = failed >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
      await db.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : failed, lock, u.id).run();
      return bad(lock ? 'Wrong password. Locked for 15 minutes.' : `Wrong password (${5 - failed} tries left)`, 401);
    }
    await db.prepare('UPDATE users SET failed = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
    return startSession(db, url, u.id, { mustChange: !!u.must_change });
  }
  return null;
}

// Endpoints for logged-in users. Returns a Response or null.
export async function authPrivate({ req, db, path, parts, method, me }) {
  if (path === 'logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(getCookie(req, 'nest_session')).run();
    return json({ ok: true }, 200, { 'set-cookie': 'nest_session=; Path=/; Max-Age=0' });
  }

  if (path === 'password' && method === 'POST') {
    const { old, password } = await body(req);
    const w = weak(password); if (w) return bad(w);
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
    if (!(await checkPassword(u, old || ''))) return bad('Current password is wrong', 401);
    if (old === password) return bad('Choose a new password, not the same one');
    await setPassword(db, me.id, password, 0);
    // sign out other devices
    await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(me.id, getCookie(req, 'nest_session')).run();
    return json({ ok: true });
  }

  // Must choose a new password before using anything else
  if (me.must_change && path !== 'me') return bad('Please choose a new password first', 403);

  // ---------- admin: manage family profiles ----------
  if (parts[0] === 'admin') {
    if (!me.is_admin) return bad('Only the admin (Lee Roy) can do that', 403);
    if (path === 'admin/users' && method === 'GET') {
      const { results } = await db.prepare(`SELECT id, name, full_name, colour, emoji, is_parent, is_admin, active, must_change,
        pin_hash IS NOT NULL AS has_password, locked_until > datetime('now') AS locked,
        (SELECT MAX(expires_at) FROM sessions WHERE user_id = users.id) AS last_session FROM users ORDER BY active DESC, is_admin DESC, is_parent DESC, name`).all();
      return json(results);
    }
    if (path === 'admin/users' && method === 'POST') {
      const b = await body(req);
      if (!b.name?.trim()) return bad('Name needed');
      const id = b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
      if (await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()) return bad('Someone with that name already exists');
      await db.prepare('INSERT INTO users (id, name, full_name, colour, emoji, is_parent, is_admin) VALUES (?, ?, ?, ?, ?, ?, 0)')
        .bind(id, b.name.trim(), b.full_name?.trim() || b.name.trim(), b.colour || '#7a6a9a', b.emoji || '🙂', b.is_parent ? 1 : 0).run();
      if (b.password) { const w = weak(b.password); if (w) return bad(w); await setPassword(db, id, b.password, 1); }
      return json({ ok: true, id });
    }
    if (parts[1] === 'users' && parts[2]) {
      const id = parts[2];
      const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      if (!u) return bad('Not found', 404);
      if (parts[3] === 'password' && method === 'POST') {
        const { password } = await body(req);
        const w = weak(password); if (w) return bad(w);
        await setPassword(db, id, password, id === me.id ? 0 : 1);
        if (id !== me.id) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        return json({ ok: true });
      }
      if (!parts[3] && method === 'PUT') {
        const b = await body(req);
        if (id === me.id && (b.is_admin === 0 || b.is_admin === false || b.active === 0 || b.active === false))
          return bad('You can\'t remove your own admin rights or switch yourself off');
        await db.prepare('UPDATE users SET name = ?, full_name = ?, colour = ?, emoji = ?, is_parent = ?, is_admin = ?, active = ? WHERE id = ?').bind(
          b.name ?? u.name, b.full_name ?? u.full_name, b.colour ?? u.colour, b.emoji ?? u.emoji,
          ('is_parent' in b ? (b.is_parent ? 1 : 0) : u.is_parent), ('is_admin' in b ? (b.is_admin ? 1 : 0) : u.is_admin),
          ('active' in b ? (b.active ? 1 : 0) : u.active), id).run();
        if ('active' in b && !b.active) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        return json({ ok: true });
      }
    }
  }
  return null;
}

export { SESSION_DAYS };
