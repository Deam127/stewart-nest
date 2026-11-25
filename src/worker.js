// The Stewart Nest — API (Cloudflare Worker + D1)
// Static files in /public are served by Workers Assets; everything under /api lands here.

import { json, bad, isDate, addDays, dayDiff, weekday, mondayOf, saToday, fmtShort, body, notify, othersOf, ensureTemplateTasks, decorateTask, schoolContext, templateApplies } from './util.js';
import { ensureSchema, authPublic, authPrivate, currentUser } from './auth.js';
import { ratings } from './ratings.js';
import { recipes as recipeApi } from './recipes.js';
import { events as eventApi, occurrences } from './events.js';
import { photos as photoApi } from './photos.js';
import { phase2 } from './phase2.js';

const AREAS = ['Kitchen', 'Bathroom', 'Main bedroom', 'Second bedroom', 'Lounge', 'Toilet',
  'Yard', 'Dogs', 'Madilea', 'Car', 'Workouts', 'Groceries', 'Other'];

const BREAKFASTS = { 1: 'b1', 2: 'b2', 3: 'b3', 4: 'b4', 5: 'b5', 6: 'b6', 7: 'b7' };
const LUNCHES = { 1: 'l_tt', 2: 'l_em', 3: 'l_tt', 4: 'l_nd', 5: 'l_lo', 6: 'l_pj', 7: 'l_rc' };

async function generateMonth(db, ym, season, overwrite) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (season === 'auto') season = (m >= 4 && m <= 9) ? 'winter' : 'summer'; // SA seasons
  const { results: recs } = await db.prepare('SELECT id, name, active, season FROM recipes').all();
  const ok = Object.fromEntries(recs.map((r) => [r.id, r.active && (r.season === 'all' || r.season === season)]));
  const { results: rotRows } = await db.prepare('SELECT weekday, recipe_id FROM rotation WHERE season = ? ORDER BY weekday, sort').bind(season).all();
  const rot = {};
  rotRows.forEach((r) => (rot[r.weekday] = rot[r.weekday] || []).push(r.recipe_id));
  // Week index counted from a fixed Monday so consecutive months keep rotating
  const epoch = '2026-01-05';
  const stmts = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i);
    const wd = weekday(d);
    const wk = Math.floor(dayDiff(epoch, d) / 7);
    const pool = (rot[wd] || []).filter((id) => ok[id]);
    const fallback = recs.filter((r) => ok[r.id] && r.id.startsWith('s_') && !r.name.startsWith('Rain plan:')).map((r) => r.id);
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

  await ensureSchema(db);

  // ----- public endpoints (login) -----
  const pub = await authPublic({ req, db, url, path, method });
  if (pub) return pub;

  // ----- everything below needs a login -----
  const me = await currentUser(req, db);
  if (!me) return bad('Please log in', 401);
  if (path === 'me') return json({ ...me, areas: AREAS });
  const priv = await authPrivate({ req, db, path, parts, method, me });
  if (priv) return priv;
  const others = await othersOf(db, me);

  // ----- settings -----
  if (path === 'settings') {
    if (method === 'PUT') {
      if (!me.is_parent && !me.is_admin) return bad('Only Mom or Dad can change settings', 403);
      const b = await body(req);
      const allowed = ['baby_name', 'baby_full_name', 'baby_due', 'lat', 'lon', 'town', 'rain_threshold', 'grocery_budget', 'meat_budget'];
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
    const [menu, plans, notes, tasks, workouts] = await db.batch([
      db.prepare(`${MENU_SQL} WHERE m.date BETWEEN ? AND ? AND m.meal = 's' ORDER BY m.date`).bind(from, to),
      db.prepare('SELECT id, date, time, title, outdoor, rain_plan, use_rain FROM day_plans WHERE date BETWEEN ? AND ? ORDER BY date, time').bind(from, to),
      db.prepare('SELECT date, COUNT(*) AS n FROM notes WHERE date BETWEEN ? AND ? GROUP BY date').bind(from, to),
      db.prepare(`SELECT due_date AS date, SUM(done_at IS NULL) AS open, SUM(done_at IS NOT NULL) AS done
        FROM tasks WHERE assignee = ? AND due_date BETWEEN ? AND ? GROUP BY due_date`).bind(me.id, from, to),
      db.prepare(`SELECT due_date AS date, COUNT(*) AS n, SUM(done_at IS NOT NULL) AS done
        FROM tasks WHERE area = 'Workouts' AND due_date BETWEEN ? AND ? GROUP BY due_date`).bind(from, to),
    ]);
    const evs = await occurrences(db, from, `${ym}-31`);
    const pics = (await db.prepare('SELECT id, photo_key, date, kind, caption FROM photos WHERE date BETWEEN ? AND ? ORDER BY kind = \'meal\' DESC, id').bind(from, `${ym}-31`).all()).results;
    return json({ menu: menu.results, plans: plans.results, notes: notes.results, tasks: tasks.results, workouts: workouts.results, events: evs, photos: pics });
  }

  if (path === 'day' && method === 'GET') {
    const date = q.get('date');
    if (!isDate(date)) return bad('date needed');
    const [menu, plans, notes] = await db.batch([
      db.prepare(`${MENU_SQL} WHERE m.date = ? ORDER BY CASE m.meal WHEN 'b' THEN 1 WHEN 'l' THEN 2 ELSE 3 END`).bind(date),
      db.prepare(`SELECT p.*, u.name AS by_name FROM day_plans p LEFT JOIN users u ON u.id = p.created_by WHERE date = ? ORDER BY time`).bind(date),
      db.prepare(`SELECT n.id, n.text, n.user_id, n.created_at, u.name, u.emoji, u.colour FROM notes n JOIN users u ON u.id = n.user_id WHERE date = ? ORDER BY n.id`).bind(date),
    ]);
    const pics = (await db.prepare('SELECT p.*, u.name, u.emoji, r.name AS recipe_name FROM photos p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN recipes r ON r.id = p.recipe_id WHERE p.date = ? ORDER BY p.id').bind(date).all()).results;
    return json({ menu: menu.results, plans: plans.results, notes: notes.results, events: await occurrences(db, date, date), photos: pics });
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
    if (use_backup) await notify(db, others,
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
    await notify(db, others, `📅 ${me.name} planned "${b.title}" for ${fmtShort(b.date)}`, `#day/${b.date}`);
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
      if (b.use_rain && !p.use_rain) await notify(db, others,
        `☔ "${p.title}" on ${fmtShort(p.date)} is now: ${p.rain_plan || 'rain plan'}`, `#day/${p.date}`);
      return json({ ok: true });
    }
  }

  // ----- notes -----
  if (path === 'notes' && method === 'POST') {
    const { date, text } = await body(req);
    if (!isDate(date) || !text?.trim()) return bad('date and text needed');
    await db.prepare('INSERT INTO notes (date, user_id, text) VALUES (?, ?, ?)').bind(date, me.id, text.trim()).run();
    await notify(db, others, `📝 ${me.name} added a note on ${fmtShort(date)}`, `#day/${date}`);
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
        WHERE ((t.done_at IS NULL AND t.due_date <= ? AND (t.routine IS NULL OR t.due_date = ?)) OR t.done_at = ?)`;
      binds = [date, date, date];
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
      const ctx = await schoolContext(db);
      const { results: tpls } = await db.prepare(`SELECT t.id, t.title, t.area, t.assignee, t.points, t.days, t.when_school, t.routine, u.name AS assignee_name, u.emoji, u.colour
        FROM task_templates t JOIN users u ON u.id = t.assignee WHERE t.active = 1 ${user ? 'AND t.assignee = ?' : ''}`).bind(...(user ? [user] : [])).all();
      upcoming = tpls.filter((t) => templateApplies(t, date, ctx));
    }
    return json({ today, date, tasks: results.map((t) => decorateTask(t, today)), upcoming });
  }

  if (path === 'tasks' && method === 'POST') {
    const b = await body(req);
    if (!b.title?.trim() || !b.assignee || !AREAS.includes(b.area)) return bad('Title, area and person needed');
    const points = Math.max(1, Math.min(50, Number(b.points) || 5));
    const due = isDate(b.due_date) ? b.due_date : saToday();
    if (b.repeat_days && /^[1-7]+$/.test(b.repeat_days)) {
      const when = ['school', 'no_school'].includes(b.when_school) ? b.when_school : 'any';
      await db.prepare('INSERT INTO task_templates (title, area, assignee, days, points, created_by, when_school, routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(b.title.trim(), b.area, b.assignee, b.repeat_days, points, me.id, when, b.routine === 'morning' ? 'morning' : null).run();
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
    if (done && t.routine === 'morning') {
      const left = await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee = ? AND due_date = ? AND routine = 'morning' AND done_at IS NULL").bind(t.assignee, t.due_date).first();
      if (!left.n) {
        const who = await db.prepare('SELECT name FROM users WHERE id = ?').bind(t.assignee).first();
        const grownUps = (await db.prepare('SELECT id FROM users WHERE active = 1 AND (is_parent = 1 OR is_admin = 1) AND id != ?').bind(t.assignee).all()).results.map((u) => u.id);
        await notify(db, grownUps, `☀️ ${who?.name || t.assignee} finished the morning check`, '#today');
      }
    }
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
      const when = ['any', 'school', 'no_school'].includes(b.when_school) ? b.when_school : t.when_school;
      const routine = 'routine' in b ? (b.routine === 'morning' ? 'morning' : null) : t.routine;
      await db.prepare('UPDATE task_templates SET title = ?, area = ?, assignee = ?, days = ?, points = ?, when_school = ?, routine = ? WHERE id = ?')
        .bind(b.title ?? t.title, b.area ?? t.area, b.assignee ?? t.assignee, days, b.points ?? t.points, when, routine, id).run();
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

  const rt = await ratings({ req, db, path, method, q, me });
  if (rt) return rt;
  const rc = await recipeApi({ req, db, path, parts, method, q, me, generateMonth });
  if (rc) return rc;
  const ev = await eventApi({ req, db, path, parts, method, q, me, others });
  if (ev) return ev;
  const ph = await photoApi({ req, db, path, parts, method, q, me, others });
  if (ph) return ph;

  const p2 = await phase2({ req, env, db, url, path, parts, method, q, me, others });
  if (p2) return p2;

  return bad('Not found', 404);
}
