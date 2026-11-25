// The Stewart Nest — meal ratings (stars, keep/swap, comment) and an export to paste into Claude.
import { json, bad, body, isDate, saToday } from './util.js';

export async function ratings({ req, db, path, method, q, me }) {
  // Ratings for one day (all meals, everyone)
  if (path === 'ratings' && method === 'GET') {
    const date = q.get('date');
    if (!isDate(date)) return bad('date needed');
    const { results } = await db.prepare(`SELECT r.*, u.name, u.emoji FROM meal_ratings r JOIN users u ON u.id = r.user_id
      WHERE r.date = ? ORDER BY u.name`).bind(date).all();
    return json(results);
  }

  if (path === 'ratings' && method === 'PUT') {
    const { date, recipe_id, stars, verdict, comment } = await body(req);
    if (!isDate(date) || !recipe_id) return bad('date and meal needed');
    if (date > saToday()) return bad('You can rate a meal once you\'ve eaten it');
    const s = stars == null || stars === '' ? null : Math.max(1, Math.min(5, Number(stars)));
    const v = ['keep', 'swap'].includes(verdict) ? verdict : null;
    await db.prepare(`INSERT INTO meal_ratings (date, recipe_id, user_id, stars, verdict, comment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(date, recipe_id, user_id) DO UPDATE SET stars = excluded.stars, verdict = excluded.verdict,
        comment = excluded.comment, updated_at = excluded.updated_at`).bind(date, recipe_id, me.id, s, v, (comment || '').trim() || null).run();
    return json({ ok: true });
  }

  // Per-recipe summary: average stars, keep/swap votes, recent comments
  if (path === 'ratings/summary' && method === 'GET') {
    return json(await summary(db));
  }

  // Plain-text report to paste into Claude for the next month's menu
  if (path === 'ratings/export' && method === 'GET') {
    const rows = await summary(db);
    const rated = rows.filter((r) => r.n);
    const lines = [
      `Stewart family meal ratings (exported ${saToday()})`,
      'Family: Lee Roy, Shirley (pregnant), Skyler (12). Stars are 1–5. Keep/Swap = should it stay on the menu.',
      '',
    ];
    for (const r of rated.sort((a, b) => (b.avg || 0) - (a.avg || 0))) {
      lines.push(`- ${r.name}: ${r.avg ? r.avg.toFixed(1) + '★' : 'no stars'} from ${r.n} rating${r.n > 1 ? 's' : ''}` +
        `${r.keep || r.swap ? `, keep ${r.keep} / swap ${r.swap}` : ''}` +
        `${r.by.length ? ` (${r.by.join('; ')})` : ''}` +
        `${r.comments.length ? ` — comments: ${r.comments.map((c) => `${c.name}: "${c.comment}"`).join(' | ')}` : ''}`);
    }
    const unrated = rows.filter((r) => !r.n && r.meal === 's').map((r) => r.name);
    if (unrated.length) lines.push('', `Not rated yet: ${unrated.join(', ')}`);
    lines.push('', 'Please suggest next month\'s supper menu: keep the high-rated meals, replace the "swap" ones with similar-budget South African family meals, and keep pap to once a week.');
    return json({ text: lines.join('\n') });
  }
  return null;
}

async function summary(db) {
  const [recipes, rows] = await db.batch([
    db.prepare("SELECT id, name, meal, active FROM recipes WHERE name NOT LIKE 'Rain plan:%' ORDER BY meal DESC, name"),
    db.prepare(`SELECT r.*, u.name AS who FROM meal_ratings r JOIN users u ON u.id = r.user_id ORDER BY r.date DESC`),
  ]);
  return recipes.results.map((rc) => {
    const mine = rows.results.filter((r) => r.recipe_id === rc.id);
    const starred = mine.filter((r) => r.stars);
    const byPerson = {};
    starred.forEach((r) => { (byPerson[r.who] = byPerson[r.who] || []).push(r.stars); });
    return {
      id: rc.id, name: rc.name, meal: rc.meal, active: rc.active,
      n: mine.length,
      avg: starred.length ? starred.reduce((s, r) => s + r.stars, 0) / starred.length : null,
      keep: mine.filter((r) => r.verdict === 'keep').length,
      swap: mine.filter((r) => r.verdict === 'swap').length,
      by: Object.entries(byPerson).map(([who, s]) => `${who} ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1)}★`),
      comments: mine.filter((r) => r.comment).slice(0, 4).map((r) => ({ name: r.who, comment: r.comment, date: r.date })),
    };
  });
}
