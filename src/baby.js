// The Stewart Nest — Madilea's baby log: feeds, nappies and sleep, logged with one tap from any grown-up's phone.
import { json, bad, body, isDate, addDays, saToday } from './util.js';

const KINDS = {
  feed: ['left', 'right', 'both', 'bottle', 'solids'],
  nappy: ['wet', 'dirty', 'both'],
  sleep: ['start', 'end'],
};
const MAX_BACKDATE_HOURS = 48;
// the log stores South African time as "YYYY-MM-DDTHH:MM" (what the phones show)
const sastNowStamp = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 16);
const okStamp = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
const hoursBetween = (a, b) => (Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600e3;

export async function baby({ req, db, path, parts, method, q, me }) {
  if (parts[0] !== 'baby') return null;

  // a day's log plus "last fed / asleep since" for the header
  if (path === 'baby' && method === 'GET') {
    const day = isDate(q.get('date')) ? q.get('date') : saToday();
    const [list, lastFeed, lastNappy, lastSleep] = await db.batch([
      db.prepare(`SELECT b.*, u.name AS by_name FROM baby_log b LEFT JOIN users u ON u.id = b.user_id
        WHERE b.at >= ? AND b.at < ? ORDER BY b.at DESC, b.id DESC`).bind(day + 'T00:00', addDays(day, 1) + 'T00:00'),
      db.prepare("SELECT * FROM baby_log WHERE kind = 'feed' ORDER BY at DESC, id DESC LIMIT 1"),
      db.prepare("SELECT * FROM baby_log WHERE kind = 'nappy' ORDER BY at DESC, id DESC LIMIT 1"),
      db.prepare("SELECT * FROM baby_log WHERE kind = 'sleep' ORDER BY at DESC, id DESC LIMIT 1"),
    ]);
    const rows = list.results;
    const feeds = rows.filter((r) => r.kind === 'feed');
    const summary = {
      feeds: feeds.length,
      bottle_ml: feeds.filter((r) => r.detail === 'bottle').reduce((s, r) => s + (r.amount || 0), 0),
      nappies: rows.filter((r) => r.kind === 'nappy').length,
      dirty: rows.filter((r) => r.kind === 'nappy' && r.detail !== 'wet').length,
      sleep_minutes: sleepMinutes(rows.slice().reverse(), day),
    };
    return json({ date: day, now: sastNowStamp(), log: rows, summary,
      last: { feed: lastFeed.results[0] || null, nappy: lastNappy.results[0] || null, sleep: lastSleep.results[0] || null } });
  }

  if (path === 'baby' && method === 'POST') {
    const b = await body(req);
    if (!KINDS[b.kind] || !KINDS[b.kind].includes(b.detail)) return bad('What are you logging?');
    const now = sastNowStamp();
    const at = okStamp(b.at) ? b.at : now;
    if (at > now) return bad("That time hasn't happened yet");
    if (hoursBetween(at, now) > MAX_BACKDATE_HOURS) return bad(`Only the last ${MAX_BACKDATE_HOURS} hours can be logged`);
    const amount = b.amount === '' || b.amount == null ? null : Math.max(0, Math.min(500, Number(b.amount) || 0));
    const r = await db.prepare('INSERT INTO baby_log (kind, detail, amount, at, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(b.kind, b.detail, amount, at, String(b.note || '').trim().slice(0, 300) || null, me.id).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }

  if (parts[1] && /^\d+$/.test(parts[1]) && method === 'DELETE') {
    const row = await db.prepare('SELECT user_id FROM baby_log WHERE id = ?').bind(Number(parts[1])).first();
    if (!row) return json({ ok: true });
    if (row.user_id !== me.id && !me.is_parent && !me.is_admin) return bad('Only whoever logged it (or Mom/Dad) can remove it', 403);
    await db.prepare('DELETE FROM baby_log WHERE id = ?').bind(Number(parts[1])).run();
    return json({ ok: true });
  }
  return null;
}

// minutes asleep within one day, from the start/end entries (oldest first)
function sleepMinutes(rows, day) {
  const dayStart = day + 'T00:00', dayEnd = addDays(day, 1) + 'T00:00';
  let total = 0, from = null;
  for (const r of rows.filter((x) => x.kind === 'sleep')) {
    if (r.detail === 'start') from = r.at;
    else if (r.detail === 'end') { total += hoursBetween(from || dayStart, r.at) * 60; from = null; }
  }
  if (from) total += hoursBetween(from, [sastNowStamp(), dayEnd].sort()[0]) * 60;
  return Math.max(0, Math.round(total));
}
