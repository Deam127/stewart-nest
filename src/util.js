// Shared helpers for the API

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
export const bad = (msg, status = 400) => json({ error: msg }, status);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const toD = (s) => new Date(s + 'T00:00:00Z');
export const fromD = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); };
export const dayDiff = (a, b) => Math.round((toD(b) - toD(a)) / 86400000); // b - a
export const weekday = (s) => { const w = toD(s).getUTCDay(); return w === 0 ? 7 : w; }; // 1=Mon … 7=Sun
export const mondayOf = (s) => addDays(s, 1 - weekday(s));
export const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // SAST, no DST
export const fmtShort = (s) => toD(s).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

export async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export async function notify(db, userIds, text, link = null) {
  const { results: people } = await db.prepare('SELECT id, name, is_parent, is_admin, kid_name FROM users').all();
  const stmts = [...new Set(userIds)].filter(Boolean).map((u) => {
    const to = people.find((p) => p.id === u);
    return db.prepare('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)').bind(u, to && !to.is_parent && !to.is_admin ? forKids(text, people) : text, link);
  });
  if (stmts.length) await db.batch(stmts);
}


// Create today's (and the past week's) instances of repeating chores.
// Rule: a chore is only added for a day if no earlier copy of it is still waiting —
// i.e. not done yet, or only done on/after that day. So an undone chore carries over
// (its "late" counter grows) instead of piling up duplicates, and the next fresh copy
// appears the day after it is finally ticked.
// School days: inside a school term, Monday–Friday, not a public holiday or special school holiday
export async function schoolContext(db) {
  let rows = [];
  try { rows = (await db.prepare("SELECT category, start_date, end_date FROM events WHERE active = 1 AND category IN ('holiday','term','school_holiday')").all()).results; } catch { /* no events table yet */ }
  const holidays = new Set(rows.filter((r) => r.category === 'holiday').map((r) => r.start_date));
  const schoolOff = new Set(rows.filter((r) => r.category === 'school_holiday').map((r) => r.start_date));
  const terms = rows.filter((r) => r.category === 'term').map((r) => [r.start_date, r.end_date || r.start_date]);
  const isSchoolDay = (d) => weekday(d) <= 5 && !holidays.has(d) && !schoolOff.has(d) && terms.some(([a, b]) => d >= a && d <= b);
  return { holidays, isSchoolDay };
}
// Does a repeating chore apply on this date? (weekday + 'school' / 'no_school' rule)
export const templateApplies = (t, d, ctx) => t.days.includes(String(weekday(d))) &&
  (!t.when_school || t.when_school === 'any' || (t.when_school === 'school') === ctx.isSchoolDay(d));

export async function ensureTemplateTasks(db, today) {
  const { results: tpls } = await db.prepare('SELECT * FROM task_templates WHERE active = 1').all();
  if (!tpls.length) return;
  const ctx = await schoolContext(db);
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
    for (const t of tpls) {
      if (!templateApplies(t, d, ctx)) continue;
      const list = byT[t.id] || (byT[t.id] = []);
      if (list.some((x) => x.due === d)) continue; // already there
      // an undone chore carries over instead of piling up — except daily routine checks (a missed bed stays missed)
      if (!t.routine && list.some((x) => x.due < d && (!x.done || x.done >= d))) continue;
      stmts.push(db.prepare(`INSERT OR IGNORE INTO tasks (title, area, assignee, assigned_by, due_date, points, template_id, routine)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(t.title, t.area, t.assignee, t.created_by, d, t.points, t.id, t.routine || null));
      list.push({ due: d, done: null });
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export function decorateTask(t, today) {
  const late = t.done_at ? dayDiff(t.due_date, t.done_at) : Math.max(0, dayDiff(t.due_date, today));
  return { ...t, late_days: late, earned: t.done_at ? (late > 0 ? Math.floor(t.points / 2) : t.points) : 0 };
}

// For a child: call the grown-ups by what the kids call them ("Dad", "Mom") instead of their first names
export function forKids(text, people) {
  let out = String(text);
  for (const p of people) {
    if (!p.kid_name || !(p.is_parent || p.is_admin)) continue;
    out = out.replace(new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), p.kid_name);
  }
  return out;
}
const NAME_KEYS = new Set(['name', 'assignee_name', 'assigned_by_name', 'by_name', 'done_by_name', 'reply_name']);
// Rewrite names in an API response for a child viewer
export function kidView(data, people) {
  const map = Object.fromEntries(people.filter((p) => p.kid_name && (p.is_parent || p.is_admin)).map((p) => [p.name, p.kid_name]));
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = NAME_KEYS.has(k) && typeof x === 'string' && map[x] ? map[x] : (['text', 'title', 'notes'].includes(k) && typeof x === 'string' ? forKids(x, people) : walk(x));
      return o;
    }
    return v;
  };
  return walk(data);
}

// Everyone in the family who has an active profile (admin can add people later)
export async function familyIds(db) {
  const { results } = await db.prepare('SELECT id FROM users WHERE active = 1').all();
  return results.map((r) => r.id);
}
export async function othersOf(db, me) { return (await familyIds(db)).filter((u) => u !== me.id); }
