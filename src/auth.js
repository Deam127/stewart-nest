// The Stewart Nest — logins, passwords, admin (user management) and automatic database upgrades.
import { json, bad, body, randomHex, sha256, getCookie } from './util.js';
import { UPGRADES, REPAIR_DATA } from './migrations.js';
import { PERMS, permsFor } from './permissions.js';

const SESSION_DAYS = 60;

// keep each person's yearly birthday event in step with the birthday on their profile
async function syncBirthday(db, id, name, birthday, by) {
  const ev = await db.prepare("SELECT id FROM events WHERE person = ? AND category = 'birthday' AND active = 1").bind(id).first();
  if (!birthday) { if (ev) await db.prepare('UPDATE events SET active = 0 WHERE id = ?').bind(ev.id).run(); return; }
  const start = birthday.length === 5 ? `2026-${birthday}` : birthday;
  const title = `🎂 ${name}'s birthday`;
  if (ev) await db.prepare('UPDATE events SET start_date = ?, title = ? WHERE id = ?').bind(start, title, ev.id).run();
  else await db.prepare("INSERT INTO events (title, category, who, start_date, repeat, remind, person, created_by) VALUES (?, 'birthday', '', ?, 'yearly', 'week', ?, ?)").bind(title, start, id, by).run();
}
const okBirthday = (b) => /^(\d{4}-)?\d{2}-\d{2}$/.test(b || '');
const MIN_LEN = 6;

// ---------- automatic schema upgrades ----------
// Runs once per server start. Brings an existing database up to date without wiping data,
// so there's nothing to run by hand after updating the app files.
// Cloudflare doesn't let one request wait on a promise created by another, so each request checks for itself
// (cheap: one SELECT), and a version step is "claimed" in the database so two requests never apply it twice.
let schemaDone = false;
let repaired = false;

// Self-repair: every column/table the app needs, added if missing (safe to run any time).
// Protects against an upgrade that was interrupted part-way, e.g. online.
const NEED_COLUMNS = {
  users: { is_admin: 'INTEGER NOT NULL DEFAULT 0', must_change: 'INTEGER NOT NULL DEFAULT 0', hash_algo: "TEXT NOT NULL DEFAULT 'sha256-pin'",
    active: 'INTEGER NOT NULL DEFAULT 1', permissions: 'TEXT', kid_name: 'TEXT', birthday: 'TEXT', prefs: 'TEXT' },
  items: { pack_qty: 'REAL', pack_unit: 'TEXT', ref: 'TEXT' },
  recipes: { notes: 'TEXT' },
  events: { person: 'TEXT', layer: 'TEXT' },
  task_templates: { when_school: "TEXT NOT NULL DEFAULT 'any'", routine: 'TEXT' },
  tasks: { routine: 'TEXT' },
  shop_trips: { from_date: 'TEXT', to_date: 'TEXT' },
  chat_messages: { reply_to: 'INTEGER', deleted: 'INTEGER NOT NULL DEFAULT 0', card: 'TEXT', client_id: 'TEXT' },
};
const NEED_TABLES = [
  'CREATE TABLE IF NOT EXISTS chat_votes (message_id INTEGER NOT NULL, user_id TEXT NOT NULL, opt INTEGER NOT NULL, PRIMARY KEY (message_id, user_id))',
  `CREATE TABLE IF NOT EXISTS chat_reactions (message_id INTEGER NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (message_id, user_id, emoji))`,
  `CREATE TABLE IF NOT EXISTS meal_ratings (date TEXT NOT NULL, recipe_id TEXT NOT NULL, user_id TEXT NOT NULL, stars INTEGER, verdict TEXT, comment TEXT,
     updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (date, recipe_id, user_id))`,
  'CREATE TABLE IF NOT EXISTS recipe_items (recipe_id TEXT NOT NULL, item_id INTEGER NOT NULL, qty REAL NOT NULL, PRIMARY KEY (recipe_id, item_id))',
  'CREATE TABLE IF NOT EXISTS rotation (season TEXT NOT NULL, weekday INTEGER NOT NULL, recipe_id TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (season, weekday, recipe_id))',
  'CREATE TABLE IF NOT EXISTS event_skips (event_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (event_id, date))',
  'CREATE TABLE IF NOT EXISTS reminder_log (event_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (event_id, date, kind))',
  `CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_key TEXT NOT NULL, caption TEXT, date TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'memory', recipe_id TEXT, user_id TEXT, slideshow INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
];
// data that later upgrades set up — re-applied only where it's missing
const NEED_DATA = [
  'CREATE UNIQUE INDEX IF NOT EXISTS chat_client ON chat_messages (user_id, client_id)',
  "UPDATE users SET is_admin = 1 WHERE id = 'lee-roy'",
  "UPDATE users SET kid_name = 'Dad' WHERE id = 'lee-roy' AND kid_name IS NULL",
  "UPDATE users SET kid_name = 'Mom' WHERE id = 'shirley' AND kid_name IS NULL",
  "UPDATE users SET permissions = '{}' WHERE id = 'skyler' AND permissions IS NULL",
  "UPDATE users SET birthday = '05-22' WHERE id = 'lee-roy' AND birthday IS NULL",
  "UPDATE users SET birthday = '05-30' WHERE id = 'skyler' AND birthday IS NULL",
  "UPDATE users SET birthday = '05-31' WHERE id = 'shirley' AND birthday IS NULL",
  "INSERT OR IGNORE INTO settings (key, value) VALUES ('islam_family', 'Your sister''s family'), ('islam_method', '3'), ('islam_school', '1'), ('dogs', 'Niela & Luka')",
  ...REPAIR_DATA,
];
async function repair(db) {
  for (const sql of NEED_TABLES) await db.prepare(sql).run();
  for (const [table, cols] of Object.entries(NEED_COLUMNS)) {
    let have;
    try { have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name)); } catch { continue; }
    if (!have.size) continue;
    for (const [col, type] of Object.entries(cols)) {
      if (have.has(col)) continue;
      try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); console.log(`repair: added ${table}.${col}`); }
      catch (e) { if (!/duplicate column/i.test(e.message)) console.error('repair failed', table, col, e.message); }
    }
  }
  for (const sql of NEED_DATA) { try { await db.prepare(sql).run(); } catch (e) { console.error('repair data', e.message); } }
}

export async function ensureSchema(db) {
  if (schemaDone) return;
  let v;
  try { v = Number((await db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first())?.value || 0); } catch { return; }
  if (!v) { await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '2')").run(); v = 2; }
  const latest = Math.max(...Object.keys(UPGRADES).map(Number));
  for (const target of Object.keys(UPGRADES).map(Number).sort((a, b) => a - b)) {
    if (v >= target) continue;
    // claim this step; if another request already moved the version on, let it finish
    const claim = await db.prepare("UPDATE settings SET value = ? WHERE key = 'schema_version' AND value = ?").bind(String(target), String(v)).run();
    if (!claim.meta.changes) return;
    try {
      for (const sql of UPGRADES[target]) {
        try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(e.message)) { console.error('Upgrade failed:', sql.slice(0, 120)); throw e; } }
      }
    } catch (e) {
      await db.prepare("UPDATE settings SET value = ? WHERE key = 'schema_version'").bind(String(v)).run(); // release so it can retry
      throw e;
    }
    v = target;
  }
  if (v >= latest) {
    if (!repaired) { await repair(db); repaired = true; }
    schemaDone = true;
  }
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
  const u = await db.prepare(`SELECT u.id, u.name, u.full_name, u.colour, u.emoji, u.is_parent, u.is_admin, u.must_change, u.permissions, u.kid_name, u.prefs, u.birthday FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).bind(token).first();
  if (!u) return null;
  const { permissions, prefs, ...me } = u;
  let p = {}; try { p = JSON.parse(prefs || '{}'); } catch { /* none */ }
  return { ...me, prefs: p, perms: permsFor(u), is_child: !u.is_parent && !u.is_admin };
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
    const { results } = await db.prepare(`SELECT id, name, full_name, colour, emoji, is_parent, is_admin, kid_name,
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
      return bad('Too many wrong passwords. Try again in 15 minutes, or ask Dad (Lee Roy) to reset it.', 429);
    if (!u.pin_hash) {
      if (!u.is_admin) return bad('Your password hasn\'t been set up yet. Ask Dad (Lee Roy) to set one up for you.', 403);
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

  // personal preferences, e.g. which calendar layers to show
  if (path === 'prefs' && method === 'PUT') {
    const b = await body(req);
    const prefs = { ...me.prefs, ...(typeof b.islam === 'boolean' ? { islam: b.islam } : {}) };
    await db.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(JSON.stringify(prefs), me.id).run();
    return json({ ok: true, prefs });
  }

  // Must choose a new password before using anything else
  if (me.must_change && path !== 'me') return bad('Please choose a new password first', 403);

  // ---------- admin: manage family profiles ----------
  if (parts[0] === 'admin') {
    if (!me.is_admin) return bad('Only the admin (Lee Roy) can do that', 403);
    if (path === 'admin/users' && method === 'GET') {
      const { results } = await db.prepare(`SELECT id, name, full_name, colour, emoji, is_parent, is_admin, active, must_change, permissions, kid_name, birthday,
        pin_hash IS NOT NULL AS has_password, locked_until > datetime('now') AS locked,
        (SELECT MAX(expires_at) FROM sessions WHERE user_id = users.id) AS last_session FROM users ORDER BY active DESC, is_admin DESC, is_parent DESC, name`).all();
      return json({ perms: PERMS, users: results.map(({ permissions, ...u }) => ({ ...u, perms: permsFor({ ...u, permissions }) })) });
    }
    if (path === 'admin/users' && method === 'POST') {
      const b = await body(req);
      if (!b.name?.trim()) return bad('Name needed');
      const id = b.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
      if (await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()) return bad('Someone with that name already exists');
      await db.prepare('INSERT INTO users (id, name, full_name, colour, emoji, is_parent, is_admin) VALUES (?, ?, ?, ?, ?, ?, 0)')
        .bind(id, b.name.trim(), b.full_name?.trim() || b.name.trim(), b.colour || '#7a6a9a', b.emoji || '🙂', b.is_parent ? 1 : 0).run();
      if (b.password) { const w = weak(b.password); if (w) return bad(w); await setPassword(db, id, b.password, 1); }
      if (okBirthday(b.birthday)) { await db.prepare('UPDATE users SET birthday = ? WHERE id = ?').bind(b.birthday, id).run(); await syncBirthday(db, id, b.name.trim(), b.birthday, me.id); }
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
        const perms = b.perms && typeof b.perms === 'object' ? JSON.stringify(Object.fromEntries(Object.keys(PERMS).map((k) => [k, !!b.perms[k]]))) : u.permissions;
        await db.prepare('UPDATE users SET name = ?, full_name = ?, colour = ?, emoji = ?, is_parent = ?, is_admin = ?, active = ?, permissions = ?, kid_name = ? WHERE id = ?').bind(
          b.name ?? u.name, b.full_name ?? u.full_name, b.colour ?? u.colour, b.emoji ?? u.emoji,
          ('is_parent' in b ? (b.is_parent ? 1 : 0) : u.is_parent), ('is_admin' in b ? (b.is_admin ? 1 : 0) : u.is_admin),
          ('active' in b ? (b.active ? 1 : 0) : u.active), perms, ('kid_name' in b ? (b.kid_name || null) : u.kid_name), id).run();
        if ('active' in b && !b.active) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
        if ('birthday' in b) {
          const bd = okBirthday(b.birthday) ? b.birthday : null;
          await db.prepare('UPDATE users SET birthday = ? WHERE id = ?').bind(bd, id).run();
          await syncBirthday(db, id, b.name ?? u.name, bd, me.id);
        }
        return json({ ok: true });
      }
    }
  }
  return null;
}

export { SESSION_DAYS };
