// The Stewart Nest — admin housekeeping: backups (list, make now, download) and how much photo storage is used.
import { json, bad, saToday } from './util.js';
import { backup, listAll, weekAhead } from './schedule.js';

const FREE_STORAGE_GB = 10; // Cloudflare R2 free tier
const GROUPS = { p: 'Photos', a: 'Voice notes', v: 'Videos', backups: 'Backups' };

export async function housekeeping({ env, db, path, parts, method, me }) {
  if (parts[0] !== 'admin' || !['backups', 'storage', 'week-ahead'].includes(parts[1])) return null;
  if (!me.is_admin) return bad('Only the admin can do that', 403);
  if (!env.PHOTOS && parts[1] !== 'week-ahead') return bad('Storage is not set up', 500);

  if (path === 'admin/backups' && method === 'GET') {
    const list = (await listAll(env.PHOTOS, 'backups/')).sort((a, b) => b.key.localeCompare(a.key));
    return json(list.map((o) => ({ name: o.key.slice('backups/'.length), size: o.size, uploaded: o.uploaded })));
  }
  if (path === 'admin/backups' && method === 'POST') {
    const r = await backup(db, env.PHOTOS, saToday());
    return json({ ok: true, name: r.key.slice('backups/'.length), size: r.bytes });
  }
  if (parts[1] === 'backups' && parts[2] && method === 'GET') {
    if (!/^nest-\d{4}-\d{2}-\d{2}\.json$/.test(parts[2])) return bad('Not found', 404);
    const obj = await env.PHOTOS.get('backups/' + parts[2]);
    if (!obj) return bad('Not found', 404);
    return new Response(obj.body, { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${parts[2]}"`, 'x-content-type-options': 'nosniff' } });
  }

  // send the Sunday "week ahead" now (normally Sunday 17:00)
  if (path === 'admin/week-ahead' && method === 'POST') {
    await weekAhead(db, saToday());
    return json({ ok: true });
  }

  if (path === 'admin/storage' && method === 'GET') {
    const all = await listAll(env.PHOTOS, '');
    const groups = {};
    for (const o of all) {
      const g = GROUPS[o.key.split('/')[0]] || 'Other';
      const x = (groups[g] = groups[g] || { files: 0, bytes: 0 });
      x.files++; x.bytes += o.size;
    }
    const bytes = all.reduce((s, o) => s + o.size, 0);
    const keep = (await db.prepare("SELECT value FROM settings WHERE key = 'video_keep_months'").first())?.value || '0';
    return json({ bytes, free_bytes: FREE_STORAGE_GB * 1024 ** 3, groups, video_keep_months: Number(keep) });
  }
  return null;
}
