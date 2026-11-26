// The Stewart Nest — jobs that run on Cloudflare's timer (every 15 minutes, see "triggers" in wrangler.jsonc):
// reminders, the Sunday "week ahead" notification, the weekly backup and (if switched on) clearing old chat videos.
// Each job remembers when it last ran (settings table), so running every 15 minutes never repeats one.
import { addDays, fmtShort, notify } from './util.js';
import { generateMonth } from './worker.js';
import { runReminders, occurrences } from './events.js';
import { dropPhotoIfUnused } from './chat.js';

const SAST_OFFSET_MS = 2 * 3600e3; // South Africa, no daylight saving
const BACKUP_PREFIX = 'backups/';
const BACKUPS_KEPT = 8;
const WEEK_AHEAD_HOUR = 17; // Sunday 17:00
const NIGHTLY_HOUR = 3; // 03:00: backup on Sundays, video clean-up daily
// tables that are not worth backing up (log-ins and phone registrations are made again)
const SKIP_TABLES = new Set(['sessions', 'push_subs', 'd1_migrations']);

const sastNow = () => { const d = new Date(Date.now() + SAST_OFFSET_MS); return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() }; };

// run a job once per "slot" (e.g. once per date): claims the slot in settings first
async function once(db, key, slot, job) {
  const r = await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NOT excluded.value`).bind(key, slot).run();
  if (!r.meta.changes) return false;
  await job();
  return true;
}

export async function runScheduled(env) {
  const db = env.DB;
  const now = sastNow();
  const done = [];
  try { await runReminders(db); done.push('reminders'); } catch (e) { console.error('reminders', e.message); }
  if (now.weekday === 0 && now.hour >= WEEK_AHEAD_HOUR) {
    if (await once(db, 'job_week_ahead', now.date, () => weekAhead(db, now.date))) done.push('week ahead');
  }
  if (now.hour >= NIGHTLY_HOUR) {
    if (now.weekday === 0 && env.PHOTOS && await once(db, 'job_backup', now.date, () => backup(db, env.PHOTOS, now.date))) done.push('backup');
    if (env.PHOTOS && await once(db, 'job_video_cleanup', now.date, () => clearOldVideos(db, env))) done.push('video clean-up');
  }
  return done;
}

// ---------- weekly backup into R2 (JSON, one file per week, newest 8 kept) ----------
export async function backup(db, bucket, date) {
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  const data = {};
  for (const { name } of tables) {
    if (SKIP_TABLES.has(name)) continue;
    data[name] = (await db.prepare(`SELECT * FROM "${name.replace(/"/g, '')}"`).all()).results;
  }
  const body = JSON.stringify({ app: 'stewart-nest', made: new Date().toISOString(), tables: data });
  await bucket.put(`${BACKUP_PREFIX}nest-${date}.json`, body, { httpMetadata: { contentType: 'application/json' } });
  // keep the newest few
  const all = await listAll(bucket, BACKUP_PREFIX);
  const old = all.sort((a, b) => b.key.localeCompare(a.key)).slice(BACKUPS_KEPT);
  for (const o of old) await bucket.delete(o.key);
  return { key: `${BACKUP_PREFIX}nest-${date}.json`, bytes: body.length };
}
export async function listAll(bucket, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// ---------- Sunday "week ahead" for everyone ----------
// the next 7 days (on Sunday evening that's Monday to Sunday)
export async function weekAhead(db, today) {
  const mon = addDays(today, 1), sun = addDays(today, 7);
  for (const ym of new Set([mon.slice(0, 7), sun.slice(0, 7)])) { // make sure those menus exist
    if (!(await db.prepare('SELECT 1 FROM menu WHERE date LIKE ? LIMIT 1').bind(ym + '%').first())) await generateMonth(db, ym, 'auto', false);
  }
  const { results: menu } = await db.prepare(`SELECT m.date, r.name, m.use_backup, b.name AS backup_name FROM menu m JOIN recipes r ON r.id = m.recipe_id
    LEFT JOIN recipes b ON b.id = r.rain_backup WHERE m.meal = 's' AND m.date BETWEEN ? AND ? ORDER BY m.date`).bind(mon, sun).all();
  const short = (d) => fmtShort(d).split(' ')[0].replace(',', '');
  const suppers = menu.map((m) => `${short(m.date)} ${m.use_backup && m.backup_name ? m.backup_name : m.name}`).join(' · ');
  const evs = (await occurrences(db, mon, sun)).filter((o) => !o.quiet && o.category !== 'term');
  const { results: tpls } = await db.prepare('SELECT assignee, days FROM task_templates WHERE active = 1').all();
  const { results: people } = await db.prepare('SELECT id, prefs FROM users WHERE active = 1').all();
  for (const p of people) {
    let prefs = {}; try { prefs = JSON.parse(p.prefs || '{}'); } catch { /* none */ }
    if (prefs.week_ahead === false) continue;
    const mine = evs.filter((o) => (!o.who || o.who.split(',').includes(p.id)) && (!o.layer || prefs[o.layer]));
    const chores = tpls.filter((t) => t.assignee === p.id).reduce((n, t) => n + t.days.length, 0);
    const parts = [
      suppers && `🍽️ ${suppers}`,
      chores && `🧹 about ${chores} chore${chores > 1 ? 's' : ''} for you`,
      mine.length && `📅 ${mine.slice(0, 5).map((o) => `${short(o.date)} ${o.title}`).join(' · ')}${mine.length > 5 ? ` +${mine.length - 5} more` : ''}`,
    ].filter(Boolean);
    if (parts.length) await notify(db, [p.id], `🗓️ Week ahead (${fmtShort(mon)} to ${fmtShort(sun)}): ${parts.join(' | ')}`, '#calendar');
  }
}

// ---------- optional: remove chat videos older than N months (More → Photo storage) ----------
async function clearOldVideos(db, env) {
  const months = Number((await db.prepare("SELECT value FROM settings WHERE key = 'video_keep_months'").first())?.value || 0);
  if (!months) return; // off (the default)
  const { results } = await db.prepare(`SELECT id, photo_key FROM chat_messages WHERE photo_key LIKE 'v/%' AND created_at < datetime('now', ?)`).bind(`-${months} months`).all();
  for (const m of results) {
    await db.prepare("UPDATE chat_messages SET photo_key = NULL, text = TRIM(COALESCE(text, '') || ' 🎥 (video removed after ' || ? || ' months)') WHERE id = ?").bind(months, m.id).run();
    await dropPhotoIfUnused(env, db, m.photo_key);
  }
}

