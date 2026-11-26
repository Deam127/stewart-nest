// The Stewart Nest — reward shop and streaks.
// Points earned from tasks (full on the day, half when late) build up a balance; the reward shop lets people
// spend them on treats the grown-ups agreed (asked → given, or declined and the points come back).
// Streaks: days in a row the morning check was done, and days in a row every task was done on time.
import { json, bad, body, addDays, saToday, notify, dayDiff } from './util.js';

const STREAK_LOOKBACK_DAYS = 120;
const BADGES = [3, 7, 14, 30, 60, 100];
const MAX_COST = 10000;

const earnedOf = (t) => (dayDiff(t.due_date, t.done_at) > 0 ? Math.floor(t.points / 2) : t.points);

async function balances(db) {
  const [{ results: done }, { results: spent }] = await db.batch([
    db.prepare('SELECT assignee, due_date, done_at, points FROM tasks WHERE done_at IS NOT NULL'),
    db.prepare("SELECT user_id, SUM(cost) AS n FROM treat_buys WHERE status != 'declined' GROUP BY user_id"),
  ]);
  const out = {};
  for (const t of done) out[t.assignee] = (out[t.assignee] || 0) + earnedOf(t);
  for (const s of spent) out[s.user_id] = (out[s.user_id] || 0) - s.n;
  return out;
}

// count days in a row, going back from today (today only counts once it's complete)
function streak(byDay, today, ok) {
  let n = 0;
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const d = addDays(today, -i);
    const day = byDay[d];
    if (!day) continue; // a day with nothing due doesn't break a streak
    if (ok(day, d)) n++;
    else if (i === 0) continue; // today isn't finished yet
    else break;
  }
  return n;
}
async function streaks(db, ids, today) {
  const { results } = await db.prepare('SELECT assignee, due_date, done_at, routine FROM tasks WHERE due_date BETWEEN ? AND ?')
    .bind(addDays(today, -STREAK_LOOKBACK_DAYS), today).all();
  const out = {};
  for (const id of ids) {
    const mine = results.filter((t) => t.assignee === id);
    const morning = {}, all = {};
    for (const t of mine) {
      (all[t.due_date] = all[t.due_date] || []).push(t);
      if (t.routine === 'morning') (morning[t.due_date] = morning[t.due_date] || []).push(t);
    }
    const onDay = (list, d) => list.every((t) => t.done_at === d);
    const m = streak(morning, today, onDay), a = streak(all, today, onDay);
    out[id] = { morning: m, on_time: a, badges: [...BADGES.filter((b) => m >= b).map((b) => `☀️ ${b}-day morning streak`), ...BADGES.filter((b) => a >= b).map((b) => `✅ ${b} days all on time`)] };
  }
  return out;
}

export async function treats({ req, db, path, parts, method, me }) {
  if (parts[0] !== 'treats') return null;
  const today = saToday();

  if (path === 'treats' && method === 'GET') {
    const { results: people } = await db.prepare('SELECT id, name, emoji FROM users WHERE active = 1 ORDER BY is_parent, name').all();
    const [items, buys] = await db.batch([
      db.prepare('SELECT * FROM treats WHERE active = 1 ORDER BY cost, title'),
      db.prepare(`SELECT b.*, u.name, u.emoji, h.name AS handled_by_name FROM treat_buys b JOIN users u ON u.id = b.user_id
        LEFT JOIN users h ON h.id = b.handled_by ORDER BY b.id DESC LIMIT 60`),
    ]);
    const bal = await balances(db);
    const st = await streaks(db, people.map((p) => p.id), today);
    return json({ items: items.results, buys: buys.results,
      people: people.map((p) => ({ ...p, balance: Math.max(0, bal[p.id] || 0), ...st[p.id] })) });
  }

  // grown-ups (approve_rewards) manage the shop
  if (path === 'treats' && method === 'POST') {
    if (!me.perms.approve_rewards) return bad('Ask Mom or Dad to add treats', 403);
    const b = await body(req);
    const cost = Math.round(Number(b.cost));
    if (!String(b.title || '').trim() || !(cost > 0 && cost <= MAX_COST)) return bad('A treat needs a name and a points price');
    await db.prepare('INSERT INTO treats (title, cost, emoji, created_by) VALUES (?, ?, ?, ?)')
      .bind(String(b.title).trim().slice(0, 80), cost, String(b.emoji || '🎁').slice(0, 8), me.id).run();
    return json({ ok: true });
  }
  if (parts[1] && /^\d+$/.test(parts[1]) && !parts[2] && method === 'DELETE') {
    if (!me.perms.approve_rewards) return bad('Ask Mom or Dad', 403);
    await db.prepare('UPDATE treats SET active = 0 WHERE id = ?').bind(Number(parts[1])).run();
    return json({ ok: true });
  }

  // spend points on a treat (asks the grown-ups)
  if (parts[1] && /^\d+$/.test(parts[1]) && parts[2] === 'buy' && method === 'POST') {
    const t = await db.prepare('SELECT * FROM treats WHERE id = ? AND active = 1').bind(Number(parts[1])).first();
    if (!t) return bad('That treat is gone', 404);
    const have = (await balances(db))[me.id] || 0;
    if (have < t.cost) return bad(`You need ${t.cost - have} more points for that`);
    await db.prepare('INSERT INTO treat_buys (user_id, treat_id, title, cost) VALUES (?, ?, ?, ?)').bind(me.id, t.id, t.title, t.cost).run();
    const { results: grownUps } = await db.prepare('SELECT id FROM users WHERE active = 1 AND (is_parent = 1 OR is_admin = 1) AND id != ?').bind(me.id).all();
    await notify(db, grownUps.map((u) => u.id), `🎁 ${me.name} wants to spend ${t.cost} points on: ${t.title}`, '#rewards');
    return json({ ok: true });
  }

  // a grown-up hands it over (or says no, which gives the points back)
  if (parts[1] === 'buys' && /^\d+$/.test(parts[2] || '') && method === 'POST') {
    if (!me.perms.approve_rewards) return bad('Ask Mom or Dad', 403);
    const { status } = await body(req);
    if (!['given', 'declined'].includes(status)) return bad('Given or declined?');
    const buy = await db.prepare("SELECT * FROM treat_buys WHERE id = ? AND status = 'asked'").bind(Number(parts[2])).first();
    if (!buy) return bad('Already handled', 409);
    await db.prepare("UPDATE treat_buys SET status = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?").bind(status, me.id, buy.id).run();
    await notify(db, [buy.user_id], status === 'given' ? `🎁 ${me.name} gave you: ${buy.title}. Enjoy!` : `${me.name} said not now to: ${buy.title}. Your ${buy.cost} points are back.`, '#rewards');
    return json({ ok: true });
  }
  return null;
}
