// The Stewart Nest — family calendar events: public holidays, school terms, Skyler's school activities,
// bin day, work routine, birthdays, appointments. Repeats, "school days only", skips and reminders.
import { json, bad, body, isDate, addDays, weekday, saToday, fmtShort, notify, familyIds, schoolContext } from './util.js';

export const CATEGORIES = {
  faith: '☪️ Faith / religious',
  holiday: '🇿🇦 Public holiday', term: '🏫 School term', school: '🎒 School', school_holiday: '🏖️ School holiday',
  bins: '🗑️ Bin day', work: '💼 Work', birthday: '🎂 Birthday', appointment: '🩺 Appointment', family: '🏡 Family', other: '📌 Other',
};
const FIELDS = ['title', 'category', 'who', 'start_date', 'end_date', 'start_time', 'end_time', 'repeat', 'repeat_days', 'repeat_until',
  'school_days_only', 'skip_holidays', 'quiet', 'remind', 'notes', 'layer'];

const context = schoolContext;

// All occurrences of all events between two dates (inclusive)
export async function occurrences(db, from, to, userId = null) {
  const [evs, skips] = await db.batch([
    db.prepare(`SELECT * FROM events WHERE active = 1 AND start_date <= ? AND (
      (repeat = 'none' AND COALESCE(end_date, start_date) >= ?) OR (repeat != 'none' AND (repeat_until IS NULL OR repeat_until >= ?)))`).bind(to, from, from),
    db.prepare('SELECT event_id, date FROM event_skips WHERE date BETWEEN ? AND ?').bind(from, to),
  ]);
  const skip = new Set(skips.results.map((s) => `${s.event_id}|${s.date}`));
  const ctx = await context(db);
  const out = [];
  for (const e of evs.results) {
    if (userId && e.who && !e.who.split(',').includes(userId)) continue;
    const start = e.start_date > from ? e.start_date : from;
    const end = [to, e.repeat === 'none' ? (e.end_date || e.start_date) : (e.repeat_until || to)].sort()[0];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      let hit = false;
      if (e.repeat === 'none') hit = true;
      else if (e.repeat === 'weekly') hit = (e.repeat_days || String(weekday(e.start_date))).includes(String(weekday(d)));
      else if (e.repeat === 'monthly') hit = d.slice(8) === e.start_date.slice(8);
      else if (e.repeat === 'yearly') hit = d.slice(5) === e.start_date.slice(5);
      if (!hit || skip.has(`${e.id}|${d}`)) continue;
      if (e.school_days_only && !ctx.isSchoolDay(d)) continue;
      if (e.skip_holidays && ctx.holidays.has(d)) continue;
      out.push({
        id: e.id, date: d, title: e.title, category: e.category, who: e.who, start_time: e.start_time, end_time: e.end_time,
        quiet: e.quiet, layer: e.layer || null, person: e.person, start_date: e.start_date, repeat: e.repeat, repeat_days: e.repeat_days, notes: e.notes, remind: e.remind, multi: !!e.end_date && e.repeat === 'none',
        first: d === e.start_date, last: d === (e.end_date || e.start_date),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));
  return out;
}

// Send reminders: "day before" ones from 17:00 the day before (after work), "morning" ones from 06:00 on the day.
export async function runReminders(db) {
  const now = new Date(Date.now() + 2 * 3600e3); // SAST
  const today = now.toISOString().slice(0, 10), hour = now.getUTCHours();
  const tomorrow = addDays(today, 1), nextWeek = addDays(today, 7);
  const occ = (await occurrences(db, today, nextWeek)).filter((o) => o.remind !== 'none');
  const family = await familyIds(db);
  const prefs = Object.fromEntries((await db.prepare('SELECT id, prefs FROM users WHERE active = 1').all()).results.map((u) => { try { return [u.id, JSON.parse(u.prefs || '{}')]; } catch { return [u.id, {}]; } }));
  for (const o of occ) {
    const kinds = [];
    if (o.date === tomorrow && hour >= 17 && ['day_before', 'both', 'week'].includes(o.remind)) kinds.push(['day_before', `⏰ Tomorrow (${fmtShort(o.date)}): ${o.title}`]);
    if (o.date === nextWeek && hour >= 6 && o.remind === 'week') kinds.push(['week', `🎁 In a week (${fmtShort(o.date)}): ${o.title}. Time to sort out a gift?`]);
    if (o.date === today && hour >= 6 && ['morning', 'both', 'week'].includes(o.remind)) kinds.push(['morning', `⏰ Today${o.start_time ? ' at ' + o.start_time : ''}: ${o.title}`]);
    for (const [kind, text] of kinds) {
      const r = await db.prepare('INSERT OR IGNORE INTO reminder_log (event_id, date, kind) VALUES (?, ?, ?)').bind(o.id, o.date, kind).run();
      if (!r.meta.changes) continue;
      let to = o.who ? o.who.split(',').filter((u) => family.includes(u)) : family;
      if (o.layer) to = to.filter((u) => prefs[u]?.[o.layer]); // only people who switched that calendar on
      if (!to.length) continue;
      // a child's reminders also go to the grown-ups
      const grownUps = (await db.prepare('SELECT id FROM users WHERE active = 1 AND (is_parent = 1 OR is_admin = 1)').all()).results.map((u) => u.id);
      const hasChild = !o.layer && to.some((u) => !grownUps.includes(u));
      await notify(db, [...new Set([...to, ...(hasChild ? grownUps : [])])], text + (o.notes ? ` · ${o.notes}` : ''), `#day/${o.date}`);
    }
  }
}

export async function events({ req, db, path, parts, method, q, me, others }) {
  if (path === 'badges' && method === 'GET') { try { await runReminders(db); } catch (e) { console.error(e); } return null; }

  if (path === 'events' && method === 'GET') {
    const from = q.get('from') || saToday(), to = q.get('to') || addDays(from, 60);
    if (!isDate(from) || !isDate(to)) return bad('from/to dates needed');
    return json({ categories: CATEGORIES, occurrences: await occurrences(db, from, to, q.get('who') || null) });
  }
  if (path === 'events/all' && method === 'GET') {
    const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 ORDER BY CASE WHEN repeat = 'none' THEN 1 ELSE 0 END, start_date`).all();
    return json({ categories: CATEGORIES, events: results });
  }
  if (path === 'events' && method === 'POST') {
    const b = clean(await body(req));
    if (!b.title || !isDate(b.start_date)) return bad('Title and date needed');
    const r = await db.prepare(`INSERT INTO events (${FIELDS.join(', ')}, created_by) VALUES (${FIELDS.map(() => '?').join(', ')}, ?)`)
      .bind(...FIELDS.map((f) => b[f]), me.id).run();
    if (!b.quiet) await notify(db, others, `📅 ${me.name} added "${b.title}" on ${fmtShort(b.start_date)}${b.repeat !== 'none' ? ' (repeats)' : ''}`, `#day/${b.start_date}`);
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (parts[0] === 'events' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    const e = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!e) return bad('Not found', 404);
    if (parts[2] === 'skip') {
      const { date } = await body(req);
      if (!isDate(date)) return bad('date needed');
      await db.prepare(method === 'DELETE' ? 'DELETE FROM event_skips WHERE event_id = ? AND date = ?' : 'INSERT OR IGNORE INTO event_skips (event_id, date) VALUES (?, ?)').bind(id, date).run();
      return json({ ok: true });
    }
    if (method === 'PUT') {
      const b = clean({ ...e, ...(await body(req)) });
      await db.prepare(`UPDATE events SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).bind(...FIELDS.map((f) => b[f]), id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') { await db.prepare('UPDATE events SET active = 0 WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  return null;
}

function clean(b) {
  const t = (v) => (v == null || v === '' ? null : String(v).trim());
  const repeat = ['none', 'weekly', 'monthly', 'yearly'].includes(b.repeat) ? b.repeat : 'none';
  return {
    title: t(b.title), category: CATEGORIES[b.category] ? b.category : 'other',
    who: Array.isArray(b.who) ? b.who.join(',') : (b.who || ''),
    start_date: t(b.start_date), end_date: repeat === 'none' && isDate(b.end_date) && b.end_date > b.start_date ? b.end_date : null,
    start_time: /^\d\d:\d\d$/.test(b.start_time || '') ? b.start_time : null, end_time: /^\d\d:\d\d$/.test(b.end_time || '') ? b.end_time : null,
    repeat, repeat_days: repeat === 'weekly' && /^[1-7]+$/.test(b.repeat_days || '') ? b.repeat_days : null,
    repeat_until: repeat !== 'none' && isDate(b.repeat_until) ? b.repeat_until : null,
    school_days_only: b.school_days_only ? 1 : 0, skip_holidays: b.skip_holidays ? 1 : 0, quiet: b.quiet ? 1 : 0,
    remind: ['none', 'day_before', 'morning', 'both', 'week'].includes(b.remind) ? b.remind : 'none', notes: t(b.notes),
    layer: b.layer === 'islam' ? 'islam' : null,
  };
}
