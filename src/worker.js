// The Stewart Nest — API (Cloudflare Worker + D1)
// Static files in /public are served by Workers Assets; everything under /api lands here.

const SESSION_DAYS = 60;
const AREAS = ['Kitchen', 'Bathroom', 'Main bedroom', 'Second bedroom', 'Lounge', 'Toilet',
  'Yard', 'Madilea', 'Car', 'Workouts', 'Groceries', 'Other'];

// Weekly supper rotation by weekday (1=Mon … 7=Sun) and season.
// Each slot cycles through its list week by week; inactive recipes are skipped.
const ROTATION = {
  summer: {
    1: ['s_bol', 's_las', 's_bob', 's_cot'],
    2: ['s_cur'],
    3: ['s_ff', 's_mac', 's_vet'],
    4: ['s_sfn', 's_alk', 's_sfr'],
    5: ['s_win'],
    6: ['s_br1', 's_br2', 's_br3', 's_br4'],
    7: ['s_rst', 's_stw'],
  },
  winter: {
    1: ['s_bol', 's_cot', 's_bob', 's_las'],
    2: ['s_cur'],
    3: ['s_soup', 's_mac', 's_vet', 's_len'],
    4: ['s_alk', 's_stw', 's_efr'],
    5: ['s_win'],
    6: ['s_br1', 's_br3', 's_br2', 's_br4'],
    7: ['s_stw', 's_rst'],
  },
};
const BREAKFASTS = { 1: 'b1', 2: 'b2', 3: 'b3', 4: 'b4', 5: 'b5', 6: 'b6', 7: 'b7' };
const LUNCHES = { 1: 'l_tt', 2: 'l_em', 3: 'l_tt', 4: 'l_nd', 5: 'l_lo', 6: 'l_pj', 7: 'l_rc' };

// ---------- helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const bad = (msg, status = 400) => json({ error: msg }, status);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toD = (s) => new Date(s + 'T00:00:00Z');
const fromD = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); };
const dayDiff = (a, b) => Math.round((toD(b) - toD(a)) / 86400000); // b - a
const weekday = (s) => { const w = toD(s).getUTCDay(); return w === 0 ? 7 : w; }; // 1=Mon … 7=Sun
const mondayOf = (s) => addDays(s, 1 - weekday(s));
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // SAST, no DST
const fmtShort = (s) => toD(s).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

async function notify(db, userIds, text, link = null) {
  const stmts = [...new Set(userIds)].filter(Boolean).map((u) =>
    db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)').bind(u, text, link));
  if (stmts.length) await db.batch(stmts);
}

async function currentUser(req, db) {
  const token = getCookie(req, 'nest_session');
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.name, u.full_name, u.colour, u.emoji, u.is_parent FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')`).bind(token).first();
}

// Create today's (and the past week's) instances of repeating chores.
// Rule: a chore is only added for a day if no earlier copy of it is still waiting —
// i.e. not done yet, or only done on/after that day. So an undone chore carries over
// (its "late" counter grows) instead of piling up duplicates, and the next fresh copy
// appears the day after it is finally ticked.
async function ensureTemplateTasks(db, today) {
  const { results: tpls } = await db.prepare('SELECT * FROM task_templates WHERE active = 1').all();
  if (!tpls.length) return;
  // Chores start counting from the first day the app was used (no backlog on day one)
  let start = (await db.prepare("SELECT value FROM settings WHERE key = 'tasks_start'").first())?.value;
  if (!start) { start = today; await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tasks_start', ?)").bind(today).run(); }
  const from = addDays(today, -6);
  const { results: inst } = await db.prepare(
    'SELECT template_id, due_date, done_at FROM tasks WHERE template_id IS NOT NULL AND (due_date >= ? OR done_at IS NULL OR done_at >= ?)')
    .bind(addDays(from, -30), from).all();
  const byT = {};
  for (const r of inst) (byT[r.template_id] = byT[r.template_id] || []).push({ due: r.due_date, done: r.done_at });
  const stmts = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    if (d < start) continue;
    const wd = String(weekday(d));
    for (const t of tpls) {
      if (!t.days.includes(wd)) continue;
      const list = byT[t.id] || (byT[t.id] = []);
      if (list.some((x) => x.due === d)) continue; // already there
      if (list.some((x) => x.due < d && (!x.done || x.done >= d))) continue; // earlier one still carrying
      stmts.push(db.prepare(`INSERT OR IGNORE INTO tasks (title, area, assignee, assigned_by, due_date, points, template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(t.title, t.area, t.assignee, t.created_by, d, t.points, t.id));
      list.push({ due: d, done: null });
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

function decorateTask(t, today) {
  const late = t.done_at ? dayDiff(t.due_date, t.done_at) : Math.max(0, dayDiff(t.due_date, today));
  return { ...t, late_days: late, earned: t.done_at ? (late > 0 ? Math.floor(t.points / 2) : t.points) : 0 };
}

async function generateMonth(db, ym, season, overwrite) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (season === 'auto') season = (m >= 4 && m <= 9) ? 'winter' : 'summer'; // SA seasons
  const { results: recs } = await db.prepare('SELECT id, active, season FROM recipes').all();
  const ok = Object.fromEntries(recs.map((r) => [r.id, r.active && (r.season === 'all' || r.season === season)]));
  const rot = ROTATION[season];
  // Week index counted from a fixed Monday so consecutive months keep rotating
  const epoch = '2026-01-05';
  const stmts = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i);
    const wd = weekday(d);
    const wk = Math.floor(dayDiff(epoch, d) / 7);
    const pool = rot[wd].filter((id) => ok[id]);
    const fallback = recs.filter((r) => ok[r.id] && r.id.startsWith('s_') && !r.id.endsWith('r')).map((r) => r.id);
    const list = pool.length ? pool : fallback;
    const supper = list[((wk % list.length) + list.length) % list.length];
    const verb = overwrite ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
    for (const [meal, rid] of [['b', BREAKFASTS[wd]], ['l', LUNCHES[wd]], ['s', supper]]) {
      if (!rid) continue;
      stmts.push(db.prepare(`${verb} INTO menu (date, meal, recipe_id, use_backup) VALUES (?, ?, ?, 0)`).bind(d, meal, rid));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { season, days };
}

const MENU_SQL = `SELECT m.date, m.meal, m.recipe_id, m.use_backup, r.name, r.outdoor, r.rain_backup,
  b.name AS backup_name, r.portions, r.method, b.portions AS backup_portions, b.method AS backup_method
  FROM menu m JOIN recipes r ON r.id = m.recipe_id LEFT JOIN recipes b ON b.id = r.rain_backup`;

// ---------- router ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e) {
      console.error(e);
      return bad('Something went wrong: ' + e.message, 500);
    }
  },
};

async function api(req, env, url) {
  const db = env.DB;
  const path = url.pathname.slice(5); // after /api/
  const method = req.method;
  const q = url.searchParams;
  const parts = path.split('/');

  // ----- public endpoints -----
  if (path === 'users' && method === 'GET') {
    const { results } = await db.prepare('SELECT id, name, full_name, colour, emoji, is_parent, pin_hash IS NOT NULL AS has_pin FROM users ORDER BY is_parent DESC, name').all();
    return json(results);
  }

  if (path === 'login' && method === 'POST') {
    const { user, pin } = await body(req);
    if (!/^\d{4}$/.test(pin || '')) return bad('PIN must be 4 digits');
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user).first();
    if (!u) return bad('Unknown person', 404);
    if (u.locked_until && u.locked_until > new Date().toISOString())
      return bad('Too many wrong PINs. Try again in 15 minutes, or ask Mom or Dad to reset it.', 429);
    let firstTime = false;
    if (!u.pin_hash) {
      const salt = randomHex(16);
      await db.prepare('UPDATE users SET pin_hash = ?, salt = ?, failed = 0 WHERE id = ?').bind(await sha256(salt + pin), salt, u.id).run();
      firstTime = true;
    } else if ((await sha256(u.salt + pin)) !== u.pin_hash) {
      const failed = u.failed + 1;
      const lock = failed >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
      await db.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : failed, lock, u.id).run();
      return bad('Wrong PIN', 401);
    }
    await db.prepare('UPDATE users SET failed = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
    const token = randomHex(32);
    await db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(token, u.id).run();
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return json({ ok: true, firstTime }, 200, {
      'set-cookie': `nest_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
    });
  }

  // ----- everything below needs a login -----
  const me = await currentUser(req, db);
  if (!me) return bad('Please log in', 401);

  if (path === 'logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(getCookie(req, 'nest_session')).run();
    return json({ ok: true }, 200, { 'set-cookie': 'nest_session=; Path=/; Max-Age=0' });
  }
  if (path === 'me') return json({ ...me, areas: AREAS });

  if (path === 'pin' && method === 'POST') {
    const { old, pin } = await body(req);
    if (!/^\d{4}$/.test(pin || '')) return bad('New PIN must be 4 digits');
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
    if ((await sha256(u.salt + old)) !== u.pin_hash) return bad('Old PIN is wrong', 401);
    const salt = randomHex(16);
    await db.prepare('UPDATE users SET pin_hash = ?, salt = ? WHERE id = ?').bind(await sha256(salt + pin), salt, me.id).run();
    return json({ ok: true });
  }
  if (parts[0] === 'users' && parts[2] === 'reset-pin' && method === 'POST') {
    if (!me.is_parent) return bad('Only Mom or Dad can reset a PIN', 403);
    await db.batch([
      db.prepare('UPDATE users SET pin_hash = NULL, salt = NULL, failed = 0, locked_until = NULL WHERE id = ?').bind(parts[1]),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(parts[1]),
    ]);
    return json({ ok: true });
  }

  // ----- settings -----
  if (path === 'settings') {
    if (method === 'PUT') {
      if (!me.is_parent) return bad('Only Mom or Dad can change settings', 403);
      const b = await body(req);
      const allowed = ['baby_name', 'baby_full_name', 'baby_due', 'lat', 'lon', 'town', 'rain_threshold'];
      const stmts = Object.entries(b).filter(([k]) => allowed.includes(k)).map(([k, v]) =>
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, String(v)));
      if (stmts.length) await db.batch(stmts);
    }
    const { results } = await db.prepare('SELECT key, value FROM settings').all();
    return json(Object.fromEntries(results.map((r) => [r.key, r.value])));
  }

  // ----- calendar -----
  if (path === 'month' && method === 'GET') {
    const ym = q.get('ym');
    if (!/^\d{4}-\d{2}$/.test(ym || '')) return bad('ym=YYYY-MM needed');
    const from = `${ym}-01`, to = `${ym}-31`;
    const [menu, plans, notes, tasks] = await db.batch([
      db.prepare(`${MENU_SQL} WHERE m.date BETWEEN ? AND ? AND m.meal = 's' ORDER BY m.date`).bind(from, to),
      db.prepare('SELECT id, date, time, title, outdoor, rain_plan, use_rain FROM day_plans WHERE date BETWEEN ? AND ? ORDER BY date, time').bind(from, to),
      db.prepare('SELECT date, COUNT(*) AS n FROM notes WHERE date BETWEEN ? AND ? GROUP BY date').bind(from, to),
      db.prepare(`SELECT due_date AS date, SUM(done_at IS NULL) AS open, SUM(done_at IS NOT NULL) AS done
        FROM tasks WHERE assignee = ? AND due_date BETWEEN ? AND ? GROUP BY due_date`).bind(me.id, from, to),
    ]);
    return json({ menu: menu.results, plans: plans.results, notes: notes.results, tasks: tasks.results });
  }

  if (path === 'day' && method === 'GET') {
    const date = q.get('date');
    if (!isDate(date)) return bad('date needed');
    const [menu, plans, notes] = await db.batch([
      db.prepare(`${MENU_SQL} WHERE m.date = ? ORDER BY CASE m.meal WHEN 'b' THEN 1 WHEN 'l' THEN 2 ELSE 3 END`).bind(date),
      db.prepare(`SELECT p.*, u.name AS by_name FROM day_plans p LEFT JOIN users u ON u.id = p.created_by WHERE date = ? ORDER BY time`).bind(date),
      db.prepare(`SELECT n.id, n.text, n.user_id, n.created_at, u.name, u.emoji, u.colour FROM notes n JOIN users u ON u.id = n.user_id WHERE date = ? ORDER BY n.id`).bind(date),
    ]);
    return json({ menu: menu.results, plans: plans.results, notes: notes.results });
  }

  // ----- menu & recipes -----
  if (path === 'menu/generate' && method === 'POST') {
    const { ym, season = 'auto', overwrite = false } = await body(req);
    if (!/^\d{4}-\d{2}$/.test(ym || '')) return bad('ym needed');
    const r = await generateMonth(db, ym, season, overwrite);
    return json({ ok: true, ...r });
  }
  if (path === 'menu' && method === 'PUT') {
    const { date, meal, recipe_id } = await body(req);
    if (!isDate(date) || !['b', 'l', 's'].includes(meal)) return bad('date and meal needed');
    await db.prepare('INSERT OR REPLACE INTO menu (date, meal, recipe_id, use_backup) VALUES (?, ?, ?, 0)').bind(date, meal, recipe_id).run();
    return json({ ok: true });
  }
  if (path === 'menu/backup' && method === 'PUT') {
    const { date, meal = 's', use_backup } = await body(req);
    await db.prepare('UPDATE menu SET use_backup = ? WHERE date = ? AND meal = ?').bind(use_backup ? 1 : 0, date, meal).run();
    if (use_backup) await notify(db, ['lee-roy', 'shirley', 'skyler'].filter((u) => u !== me.id),
      `☔ ${me.name} switched ${fmtShort(date)} to the rain-out plan`, `#day/${date}`);
    return json({ ok: true });
  }
  if (path === 'menu/swap' && method === 'POST') {
    const { a, b, meal = 's' } = await body(req);
    const [ra, rb] = await Promise.all([a, b].map((d) => db.prepare('SELECT recipe_id FROM menu WHERE date = ? AND meal = ?').bind(d, meal).first()));
    if (!ra || !rb) return bad('Both days need a meal');
    await db.batch([
      db.prepare('UPDATE menu SET recipe_id = ?, use_backup = 0 WHERE date = ? AND meal = ?').bind(rb.recipe_id, a, meal),
      db.prepare('UPDATE menu SET recipe_id = ?, use_backup = 0 WHERE date = ? AND meal = ?').bind(ra.recipe_id, b, meal),
    ]);
    return json({ ok: true });
  }
  if (path === 'recipes' && method === 'GET') {
    const { results } = await db.prepare('SELECT id, name, meal, season, outdoor, rain_backup, active, portions, method FROM recipes ORDER BY meal, name').all();
    return json(results);
  }
  if (parts[0] === 'recipes' && parts[1] && method === 'PUT') {
    const b = await body(req);
    const sets = [], vals = [];
    for (const k of ['active', 'season', 'outdoor', 'rain_backup']) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k]); }
    if (!sets.length) return bad('Nothing to change');
    await db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, parts[1]).run();
    return json({ ok: true });
  }

  // ----- day plans (with rain-out plan) -----
  if (path === 'plans' && method === 'POST') {
    const b = await body(req);
    if (!isDate(b.date) || !b.title) return bad('date and title needed');
    const r = await db.prepare('INSERT INTO day_plans (date, time, title, outdoor, rain_plan, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(b.date, b.time || null, b.title, b.outdoor ? 1 : 0, b.rain_plan || null, me.id).run();
    await notify(db, ['lee-roy', 'shirley', 'skyler'].filter((u) => u !== me.id), `📅 ${me.name} planned "${b.title}" for ${fmtShort(b.date)}`, `#day/${b.date}`);
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (parts[0] === 'plans' && parts[1]) {
    const id = Number(parts[1]);
    if (method === 'DELETE') { await db.prepare('DELETE FROM day_plans WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    if (method === 'PUT') {
      const b = await body(req);
      const p = await db.prepare('SELECT * FROM day_plans WHERE id = ?').bind(id).first();
      if (!p) return bad('Not found', 404);
      await db.prepare('UPDATE day_plans SET time = ?, title = ?, outdoor = ?, rain_plan = ?, use_rain = ? WHERE id = ?').bind(
        b.time ?? p.time, b.title ?? p.title, (b.outdoor ?? p.outdoor) ? 1 : 0, b.rain_plan ?? p.rain_plan, (b.use_rain ?? p.use_rain) ? 1 : 0, id).run();
      if (b.use_rain && !p.use_rain) await notify(db, ['lee-roy', 'shirley', 'skyler'].filter((u) => u !== me.id),
        `☔ "${p.title}" on ${fmtShort(p.date)} is now: ${p.rain_plan || 'rain plan'}`, `#day/${p.date}`);
      return json({ ok: true });
    }
  }

  // ----- notes -----
  if (path === 'notes' && method === 'POST') {
    const { date, text } = await body(req);
    if (!isDate(date) || !text?.trim()) return bad('date and text needed');
    await db.prepare('INSERT INTO notes (date, user_id, text) VALUES (?, ?, ?)').bind(date, me.id, text.trim()).run();
    await notify(db, ['lee-roy', 'shirley', 'skyler'].filter((u) => u !== me.id), `📝 ${me.name} added a note on ${fmtShort(date)}`, `#day/${date}`);
    return json({ ok: true });
  }
  if (parts[0] === 'notes' && parts[1] && method === 'DELETE') {
    const n = await db.prepare('SELECT user_id FROM notes WHERE id = ?').bind(parts[1]).first();
    if (n && n.user_id !== me.id && !me.is_parent) return bad('You can only delete your own notes', 403);
    await db.prepare('DELETE FROM notes WHERE id = ?').bind(parts[1]).run();
    return json({ ok: true });
  }

  // ----- tasks -----
  if (path === 'tasks' && method === 'GET') {
    const today = isDate(q.get('today')) ? q.get('today') : saToday();
    const date = isDate(q.get('date')) ? q.get('date') : today;
    await ensureTemplateTasks(db, today);
    const user = q.get('user'); // optional filter
    let sql, binds;
    if (date === today) {
      // Today: everything due on or before that day that is still open, plus what was ticked that day
      sql = `SELECT t.*, u.name AS assignee_name, u.emoji, u.colour, a.name AS assigned_by_name
        FROM tasks t JOIN users u ON u.id = t.assignee LEFT JOIN users a ON a.id = t.assigned_by
        WHERE ((t.done_at IS NULL AND t.due_date <= ?) OR t.done_at = ?)`;
      binds = [date, date];
    } else {
      // A past or future day: what is due that day (and, for past days, whether/when it was done)
      sql = `SELECT t.*, u.name AS assignee_name, u.emoji, u.colour, a.name AS assigned_by_name
        FROM tasks t JOIN users u ON u.id = t.assignee LEFT JOIN users a ON a.id = t.assigned_by
        WHERE t.due_date = ?`;
      binds = [date];
    }
    if (user) { sql += ' AND t.assignee = ?'; binds.push(user); }
    sql += ' ORDER BY t.done_at IS NOT NULL, t.due_date, t.area, t.title';
    const { results } = await db.prepare(sql).bind(...binds).all();
    // Future days also preview repeating chores that will appear that day
    let upcoming = [];
    if (date > today) {
      const wd = String(weekday(date));
      const { results: tpls } = await db.prepare(`SELECT t.id, t.title, t.area, t.assignee, t.points, u.name AS assignee_name, u.emoji, u.colour
        FROM task_templates t JOIN users u ON u.id = t.assignee WHERE t.active = 1 ${user ? 'AND t.assignee = ?' : ''}`).bind(...(user ? [user] : [])).all();
      const { results: withDays } = await db.prepare('SELECT id, days FROM task_templates').all();
      const dmap = Object.fromEntries(withDays.map((r) => [r.id, r.days]));
      upcoming = tpls.filter((t) => dmap[t.id].includes(wd));
    }
    return json({ today, date, tasks: results.map((t) => decorateTask(t, today)), upcoming });
  }

  if (path === 'tasks' && method === 'POST') {
    const b = await body(req);
    if (!b.title?.trim() || !b.assignee || !AREAS.includes(b.area)) return bad('Title, area and person needed');
    const points = Math.max(1, Math.min(50, Number(b.points) || 5));
    const due = isDate(b.due_date) ? b.due_date : saToday();
    if (b.repeat_days && /^[1-7]+$/.test(b.repeat_days)) {
      await db.prepare('INSERT INTO task_templates (title, area, assignee, days, points, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(b.title.trim(), b.area, b.assignee, b.repeat_days, points, me.id).run();
    } else {
      await db.prepare('INSERT INTO tasks (title, area, assignee, assigned_by, due_date, points, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(b.title.trim(), b.area, b.assignee, me.id, due, points, b.note || null).run();
    }
    if (b.assignee !== me.id) {
      const when = b.repeat_days ? 'a repeating chore' : `due ${fmtShort(due)}`;
      await notify(db, [b.assignee], `🧹 ${me.name} gave you: ${b.title.trim()} (${when})`, '#today');
    }
    return json({ ok: true });
  }

  if (parts[0] === 'tasks' && parts[1] && parts[2] === 'done' && method === 'POST') {
    const { done = true, date } = await body(req);
    const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(parts[1]).first();
    if (!t) return bad('Not found', 404);
    if (t.assignee !== me.id && !me.is_parent) return bad('Only the person it is for (or Mom/Dad) can tick it', 403);
    const day = isDate(date) ? date : saToday();
    await db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').bind(done ? day : null, t.id).run();
    if (done && t.assigned_by && t.assigned_by !== me.id && !t.template_id)
      await notify(db, [t.assigned_by], `✅ ${me.name} finished: ${t.title}`, '#tasks');
    return json({ ok: true });
  }
  if (parts[0] === 'tasks' && parts[1] && !parts[2] && method === 'DELETE') {
    const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(parts[1]).first();
    if (!t) return json({ ok: true });
    if (t.assigned_by !== me.id && !me.is_parent) return bad('Only whoever gave the task (or Mom/Dad) can remove it', 403);
    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(t.id).run();
    return json({ ok: true });
  }

  if (path === 'templates' && method === 'GET') {
    const { results } = await db.prepare(`SELECT t.*, u.name AS assignee_name, u.emoji FROM task_templates t JOIN users u ON u.id = t.assignee
      WHERE t.active = 1 ORDER BY u.name, t.area, t.title`).all();
    return json(results);
  }
  if (parts[0] === 'templates' && parts[1]) {
    const id = Number(parts[1]);
    if (method === 'DELETE') {
      // Stop repeating; leave any open instance on the list
      await db.prepare('UPDATE task_templates SET active = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const b = await body(req);
      const t = await db.prepare('SELECT * FROM task_templates WHERE id = ?').bind(id).first();
      if (!t) return bad('Not found', 404);
      const days = b.days && /^[1-7]+$/.test(b.days) ? b.days : t.days;
      await db.prepare('UPDATE task_templates SET title = ?, area = ?, assignee = ?, days = ?, points = ? WHERE id = ?')
        .bind(b.title ?? t.title, b.area ?? t.area, b.assignee ?? t.assignee, days, b.points ?? t.points, id).run();
      return json({ ok: true });
    }
  }

  // ----- weekly rewards & accountability -----
  if (path === 'rewards' && method === 'GET') {
    const today = isDate(q.get('today')) ? q.get('today') : saToday();
    await ensureTemplateTasks(db, today);
    const week = isDate(q.get('week')) ? mondayOf(q.get('week')) : mondayOf(today);
    const end = addDays(week, 6);
    const [users, goals, tasks, claims] = await db.batch([
      db.prepare('SELECT id, name, emoji, colour FROM users ORDER BY is_parent, name'),
      db.prepare('SELECT * FROM reward_goals'),
      db.prepare('SELECT * FROM tasks WHERE due_date BETWEEN ? AND ?').bind(week, end),
      db.prepare('SELECT * FROM rewards_log WHERE week_start = ?').bind(week),
    ]);
    const lastDay = today < end ? today : end;
    const out = users.results.map((u) => {
      const mine = tasks.results.filter((t) => t.assignee === u.id).map((t) => decorateTask(t, lastDay));
      const due = mine.filter((t) => t.due_date <= lastDay);
      const goal = goals.results.find((g) => g.user_id === u.id);
      return {
        ...u,
        week_start: week,
        points: mine.reduce((s, t) => s + t.earned, 0),
        possible: due.reduce((s, t) => s + t.points, 0),
        on_time: mine.filter((t) => t.done_at && t.late_days === 0).length,
        late: mine.filter((t) => t.done_at && t.late_days > 0).length,
        open: due.filter((t) => !t.done_at).length,
        target: goal?.target ?? null,
        reward: goal?.reward ?? null,
        claimed: claims.results.find((c) => c.user_id === u.id) || null,
      };
    });
    return json({ week, end, users: out });
  }
  if (path === 'rewards/goal' && method === 'PUT') {
    if (!me.is_parent) return bad('Only Mom or Dad can set rewards', 403);
    const { user_id, target, reward } = await body(req);
    await db.prepare('INSERT OR REPLACE INTO reward_goals (user_id, target, reward) VALUES (?, ?, ?)').bind(user_id, Number(target) || 0, reward || '').run();
    return json({ ok: true });
  }
  if (path === 'rewards/claim' && method === 'POST') {
    if (!me.is_parent) return bad('Only Mom or Dad can hand out a reward', 403);
    const { user_id, week_start, points, reward } = await body(req);
    await db.prepare('INSERT OR REPLACE INTO rewards_log (user_id, week_start, points, reward, approved_by) VALUES (?, ?, ?, ?, ?)')
      .bind(user_id, week_start, points || 0, reward || '', me.id).run();
    if (user_id !== me.id) await notify(db, [user_id], `🏆 ${me.name} approved your reward: ${reward}`, '#rewards');
    return json({ ok: true });
  }

  // ----- notifications -----
  if (path === 'notifications' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40').bind(me.id).all();
    return json(results);
  }
  if (path === 'notifications/read' && method === 'POST') {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(me.id).run();
    return json({ ok: true });
  }

  return bad('Not found', 404);
}
