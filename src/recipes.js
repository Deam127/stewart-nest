// The Stewart Nest — recipe catalogue (ingredients linked to inventory), weekly rotation,
// and plan-ahead: what the menu for any date range needs → shopping list.
import { json, bad, body, isDate, addDays, saToday } from './util.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'recipe';

async function recipeIngredients(db, ids = null) {
  const { results } = await db.prepare(`SELECT ri.recipe_id, ri.item_id, ri.qty, i.name, i.pack_qty, i.pack_unit, i.price, i.section, i.kind, i.code
    FROM recipe_items ri JOIN items i ON i.id = ri.item_id ${ids ? `WHERE ri.recipe_id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .bind(...(ids || [])).all();
  return results;
}
const lineCost = (r) => (r.pack_qty ? (r.qty / r.pack_qty) * (r.price || 0) : 0);

export async function recipes({ req, db, path, parts, method, q, me, generateMonth }) {
  // ---------- catalogue ----------
  if (path === 'catalog' && method === 'GET') {
    const [rec, rot] = await db.batch([
      db.prepare("SELECT * FROM recipes WHERE meal IN ('b','l','s','x') ORDER BY meal DESC, name"),
      db.prepare('SELECT * FROM rotation ORDER BY season, weekday, sort'),
    ]);
    const ing = await recipeIngredients(db);
    const out = rec.results.map((r) => {
      const items = ing.filter((x) => x.recipe_id === r.id).map((x) => ({ ...x, cost: Math.round(lineCost(x) * 100) / 100 }));
      return { ...r, items, cost: Math.round(items.reduce((s, x) => s + x.cost, 0) * 100) / 100 };
    });
    return json({ recipes: out, rotation: rot.results });
  }

  if (path === 'catalog' && method === 'POST' || (parts[0] === 'catalog' && parts[1] && method === 'PUT')) {
    const b = await body(req);
    if (!b.name?.trim() || !['b', 'l', 's'].includes(b.meal)) return bad('Name and meal type needed');
    let id = parts[1];
    if (!id) {
      id = `${b.meal}_${slug(b.name)}`;
      for (let n = 2; await db.prepare('SELECT 1 FROM recipes WHERE id = ?').bind(id).first(); n++) id = `${b.meal}_${slug(b.name)}_${n}`;
      await db.prepare("INSERT INTO recipes (id, name, meal, season, outdoor, rain_backup, portions, ingredients, meat, method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)")
        .bind(id, b.name.trim(), b.meal, b.season || 'all', b.outdoor ? 1 : 0, b.rain_backup || null, JSON.stringify(b.portions || []), b.method || null, b.notes || null).run();
    } else {
      if (!(await db.prepare('SELECT 1 FROM recipes WHERE id = ?').bind(id).first())) return bad('Not found', 404);
      await db.prepare('UPDATE recipes SET name = ?, meal = ?, season = ?, outdoor = ?, rain_backup = ?, portions = ?, method = ?, notes = ? WHERE id = ?')
        .bind(b.name.trim(), b.meal, b.season || 'all', b.outdoor ? 1 : 0, b.rain_backup || null, JSON.stringify(b.portions || []), b.method || null, b.notes || null, id).run();
    }
    if (Array.isArray(b.items)) {
      const stmts = [db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').bind(id)];
      for (const it of b.items) if (it.item_id && Number(it.qty) > 0)
        stmts.push(db.prepare('INSERT OR REPLACE INTO recipe_items (recipe_id, item_id, qty) VALUES (?, ?, ?)').bind(id, Number(it.item_id), Number(it.qty)));
      await db.batch(stmts);
    }
    return json({ ok: true, id });
  }
  if (parts[0] === 'catalog' && parts[1] && method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE recipes SET active = 0 WHERE id = ?').bind(parts[1]),
      db.prepare('DELETE FROM rotation WHERE recipe_id = ?').bind(parts[1]),
    ]);
    return json({ ok: true });
  }

  // ---------- the menu for a date range (all meals) ----------
  if (path === 'menu' && method === 'GET') {
    const from = q.get('from'), to = q.get('to');
    if (!isDate(from) || !isDate(to)) return bad('from and to needed');
    const { results } = await db.prepare('SELECT date, meal, recipe_id, use_backup FROM menu WHERE date BETWEEN ? AND ? ORDER BY date').bind(from, to).all();
    return json(results);
  }

  // ---------- rotation: which suppers cycle on which weekday ----------
  if (path === 'rotation' && method === 'PUT') {
    const { season, weekday, recipe_ids } = await body(req);
    if (!['summer', 'winter'].includes(season) || !(weekday >= 1 && weekday <= 7) || !Array.isArray(recipe_ids)) return bad('season, weekday and recipe_ids needed');
    await db.batch([
      db.prepare('DELETE FROM rotation WHERE season = ? AND weekday = ?').bind(season, weekday),
      ...recipe_ids.map((rid, i) => db.prepare('INSERT OR IGNORE INTO rotation (season, weekday, recipe_id, sort) VALUES (?, ?, ?, ?)').bind(season, weekday, rid, i)),
    ]);
    return json({ ok: true });
  }

  // ---------- plan ahead ----------
  if (path === 'plan/menus' && method === 'POST') {
    // Build menus for the next N months (only fills empty days unless overwrite)
    const { from_ym, months = 3, overwrite = false } = await body(req);
    if (!/^\d{4}-\d{2}$/.test(from_ym || '')) return bad('from_ym needed');
    const done = [];
    let [y, m] = from_ym.split('-').map(Number);
    for (let i = 0; i < Math.min(12, Number(months) || 1); i++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const r = await generateMonth(db, ym, 'auto', overwrite);
      done.push({ ym, season: r.season });
      m++; if (m > 12) { m = 1; y++; }
    }
    return json({ ok: true, months: done });
  }

  if (path === 'plan/needs' && method === 'GET') {
    const from = q.get('from'), to = q.get('to');
    if (!isDate(from) || !isDate(to) || to < from) return bad('from and to dates needed');
    return json(await needs(db, from, to, generateMonth, q.get('household') !== '0'));
  }

  if (path === 'plan/trip' && method === 'POST') {
    const { from, to, household = true } = await body(req);
    if (!isDate(from) || !isDate(to)) return bad('from and to needed');
    const n = await needs(db, from, to, generateMonth, household !== false);
    // replace an open list that has nothing in the trolley yet
    await db.prepare("DELETE FROM shop_lines WHERE trip_id IN (SELECT id FROM shop_trips WHERE status = 'open' AND id NOT IN (SELECT DISTINCT trip_id FROM shop_lines WHERE in_trolley = 1))").run();
    await db.prepare("DELETE FROM shop_trips WHERE status = 'open' AND id NOT IN (SELECT DISTINCT trip_id FROM shop_lines)").run();
    if (await db.prepare("SELECT 1 FROM shop_trips WHERE status = 'open'").first()) return bad('There is a shopping list with things already in the trolley. Finish or delete it first.');
    const budget = Number((await db.prepare("SELECT value FROM settings WHERE key = 'grocery_budget'").first())?.value || 5000);
    const r = await db.prepare('INSERT INTO shop_trips (budget, created_by, from_date, to_date) VALUES (?, ?, ?, ?)').bind(budget, me.id, from, to).run();
    const tripId = r.meta.last_row_id;
    const stmts = n.items.filter((i) => i.buy > 0).map((i) =>
      db.prepare('INSERT INTO shop_lines (trip_id, item_id, name, plan_qty, plan_price) VALUES (?, ?, ?, ?, ?)').bind(tripId, i.item_id, i.name, i.buy, i.price));
    for (let k = 0; k < stmts.length; k += 50) await db.batch(stmts.slice(k, k + 50));
    return json({ ok: true, trip_id: tripId, lines: stmts.length });
  }
  return null;
}

// Everything the menu between two dates needs, as packs to buy after what's in the cupboard,
// plus household / baby items that are below their "keep in the house" level.
async function needs(db, from, to, generateMonth, household = true) {
  // make sure every month in the range has a menu
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7);) {
    const has = await db.prepare('SELECT 1 FROM menu WHERE date LIKE ? LIMIT 1').bind(ym + '%').first();
    if (!has) await generateMonth(db, ym, 'auto', false);
    let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; }
    ym = `${y}-${String(m).padStart(2, '0')}`;
  }
  const { results: menu } = await db.prepare(`SELECT m.date, m.meal, CASE WHEN m.use_backup = 1 AND r.rain_backup IS NOT NULL THEN r.rain_backup ELSE m.recipe_id END AS rid
    FROM menu m JOIN recipes r ON r.id = m.recipe_id WHERE m.date BETWEEN ? AND ?`).bind(from, to).all();
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const uses = {};
  menu.forEach((m) => (uses[m.rid] = (uses[m.rid] || 0) + 1));
  uses.x_daily = days;
  const ids = Object.keys(uses);
  const ing = ids.length ? await recipeIngredients(db, ids) : [];
  const { results: recs } = ids.length ? await db.prepare(`SELECT id, name, meal FROM recipes WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all() : { results: [] };
  const per = {};
  for (const x of ing) {
    const p = per[x.item_id] || (per[x.item_id] = { item_id: x.item_id, name: x.name, code: x.code, section: x.section, kind: x.kind, unit: x.pack_unit, pack_qty: x.pack_qty, price: x.price, need: 0, recipes: new Set() });
    p.need += x.qty * uses[x.recipe_id];
    p.recipes.add(x.recipe_id);
  }
  const { results: stock } = await db.prepare('SELECT id, name, code, section, kind, pack_unit, pack_qty, price, on_hand, par FROM items WHERE active = 1').all();
  const byId = Object.fromEntries(stock.map((s) => [s.id, s]));
  const items = Object.values(per).map((p) => {
    const packs = p.pack_qty ? Math.ceil((p.need / p.pack_qty) * 100 - 1e-6) / 100 : 0; // exact packs (2 decimals)
    const whole = p.unit === 'kg' ? Math.ceil(packs * 2) / 2 : Math.ceil(packs - 1e-6);
    const onHand = byId[p.item_id]?.on_hand || 0;
    const buy = Math.max(0, p.unit === 'kg' ? Math.ceil((whole - onHand) * 2) / 2 : Math.ceil(whole - onHand));
    return { ...p, recipes: [...p.recipes].length, need: Math.round(p.need * 100) / 100, packs: whole, on_hand: onHand, buy, cost: Math.round(buy * (p.price || 0) * 100) / 100, from: 'menu' };
  });
  // non-food items (and anything not used by a recipe) still restock to their keep level
  const used = new Set(items.map((i) => i.item_id));
  for (const s of household ? stock : []) {
    if (used.has(s.id) || s.on_hand >= s.par) continue;
    if (s.kind === 'grocery' || s.kind === 'meat') continue; // food comes from the menu
    const buy = Math.ceil(s.par - s.on_hand);
    items.push({ item_id: s.id, name: s.name, code: s.code, section: s.section, kind: s.kind, unit: s.pack_unit, pack_qty: s.pack_qty, price: s.price, need: s.par, packs: s.par, on_hand: s.on_hand, buy, cost: Math.round(buy * (s.price || 0) * 100) / 100, from: 'keep level' });
  }
  items.sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.name.localeCompare(b.name));
  const meat = items.filter((i) => i.kind === 'meat').reduce((s, i) => s + i.cost, 0);
  const rest = items.filter((i) => i.kind !== 'meat').reduce((s, i) => s + i.cost, 0);
  const noIngredients = recs.filter((r) => r.id !== 'x_daily' && !/^leftover/i.test(r.name) && !ing.some((x) => x.recipe_id === r.id)).map((r) => r.name);
  return {
    from, to, days,
    meals: recs.filter((r) => r.id !== 'x_daily').map((r) => ({ id: r.id, name: r.name, meal: r.meal, times: uses[r.id] })).sort((a, b) => b.times - a.times),
    items, totals: { groceries: Math.round(rest * 100) / 100, meat: Math.round(meat * 100) / 100 },
    no_ingredients: noIngredients,
  };
}
