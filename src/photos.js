// The Stewart Nest — shared photos: memories gallery, supper photos and activity photos pinned to calendar days.
import { json, bad, body, isDate, saToday, fmtShort, notify } from './util.js';
import { dropPhotoIfUnused } from './chat.js';

export async function photos({ req, env, db, path, parts, method, q, me, others }) {
  if (path === 'gallery' && method === 'GET') {
    const from = q.get('from'), to = q.get('to'), kind = q.get('kind');
    let sql = `SELECT p.*, u.name, u.emoji, r.name AS recipe_name FROM photos p LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN recipes r ON r.id = p.recipe_id WHERE 1=1`, b = [];
    if (isDate(from)) { sql += ' AND p.date >= ?'; b.push(from); }
    if (isDate(to)) { sql += ' AND p.date <= ?'; b.push(to); }
    if (kind) { sql += ' AND p.kind = ?'; b.push(kind); }
    if (q.get('slideshow')) sql += ' AND p.slideshow = 1';
    sql += ' ORDER BY p.date DESC, p.id DESC LIMIT ' + Math.min(500, Number(q.get('limit')) || 300);
    return json((await db.prepare(sql).bind(...b).all()).results);
  }
  if (path === 'gallery' && method === 'POST') {
    const b = await body(req);
    if (!b.photo_key) return bad('Upload a photo first');
    const date = isDate(b.date) ? b.date : saToday();
    const kind = ['memory', 'meal', 'activity'].includes(b.kind) ? b.kind : 'memory';
    let recipe = b.recipe_id || null;
    if (kind === 'meal' && !recipe) {
      // default: what was on the menu for supper that day
      const m = await db.prepare("SELECT CASE WHEN m.use_backup = 1 AND r.rain_backup IS NOT NULL THEN r.rain_backup ELSE m.recipe_id END AS rid FROM menu m JOIN recipes r ON r.id = m.recipe_id WHERE m.date = ? AND m.meal = 's'").bind(date).first();
      recipe = m?.rid || null;
    }
    const r = await db.prepare('INSERT INTO photos (photo_key, caption, date, kind, recipe_id, user_id, slideshow) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(b.photo_key, (b.caption || '').trim() || null, date, kind, recipe, me.id, b.slideshow === false ? 0 : 1).run();
    const what = kind === 'meal' ? 'a supper photo' : kind === 'activity' ? 'an activity photo' : 'a photo';
    await notify(db, others, `📸 ${me.name} added ${what} for ${fmtShort(date)}${b.caption ? ': ' + b.caption : ''}`, `#day/${date}`);
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (parts[0] === 'gallery' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    const p = await db.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first();
    if (!p) return bad('Not found', 404);
    if (method === 'PUT') {
      const b = await body(req);
      await db.prepare('UPDATE photos SET caption = ?, date = ?, kind = ?, recipe_id = ?, slideshow = ? WHERE id = ?').bind(
        'caption' in b ? (b.caption || null) : p.caption, isDate(b.date) ? b.date : p.date,
        ['memory', 'meal', 'activity'].includes(b.kind) ? b.kind : p.kind, 'recipe_id' in b ? (b.recipe_id || null) : p.recipe_id,
        'slideshow' in b ? (b.slideshow ? 1 : 0) : p.slideshow, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (p.user_id !== me.id && !me.is_parent && !me.is_admin) return bad('Only whoever added it (or Mom/Dad) can remove it', 403);
      await db.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
      await dropPhotoIfUnused(env, db, p.photo_key);
      return json({ ok: true });
    }
  }
  return null;
}
