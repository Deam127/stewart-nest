// The Stewart Nest — Phase 2 API: chat, fun ideas, Madilea's lists, inventory & photos,
// stock take → shopping list → trolley, workouts.
import { mediaLabel } from './media.js';
import { json, bad, isDate, doneDay, pickToday, addDays, mondayOf, saToday, fmtShort, body, notify,
  ensureTemplateTasks, decorateTask, familyIds } from './util.js';

const num = (v, d = null) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
const ITEM_FIELDS = ['barcode', 'name', 'brand', 'size', 'section', 'kind', 'price', 'shop', 'photo_key', 'par', 'on_hand', 'essential', 'active', 'pack_qty', 'pack_unit'];

export async function phase2({ req, env, db, url, path, parts, method, q, me, others: otherIds }) {
  const others = () => otherIds;
  // photos, voice notes and videos live in media.js; chat in chat.js
  if (path === 'badges' && method === 'GET') {
    const [n, c, latest, note] = await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').bind(me.id),
      db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE user_id != ? AND deleted = 0 AND id > COALESCE((SELECT last_id FROM chat_reads WHERE user_id = ?), 0)`).bind(me.id, me.id),
      // newest message from someone else, so each phone alerts once per message
      db.prepare(`SELECT c.id, c.text, c.photo_key, c.card, u.name FROM chat_messages c JOIN users u ON u.id = c.user_id
        WHERE c.user_id != ? AND c.deleted = 0 ORDER BY c.id DESC LIMIT 1`).bind(me.id),
      // newest unread notification, for the phone notification the service worker shows
      db.prepare('SELECT id, text, link FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY id DESC LIMIT 1').bind(me.id),
    ]);
    const l = latest.results[0];
    return json({ notifications: n.results[0].n, chat: c.results[0].n, note: note.results[0] || null,
      latest: l ? { id: l.id, name: l.name, body: l.text || (l.photo_key ? { Photo: '📷 Photo', 'Voice note': '🎤 Voice note', Video: '🎥 Video' }[mediaLabel(l.photo_key)] : l.card ? '📌 Shared something' : '') } : null });
  }

  // ================= fun ideas =================
  if (path === 'fun' && method === 'GET') {
    const [ideas, votes] = await db.batch([
      db.prepare('SELECT * FROM fun_ideas WHERE active = 1 ORDER BY title'),
      db.prepare('SELECT idea_id, user_id FROM fun_votes'),
    ]);
    return json(ideas.results.map((i) => ({ ...i, votes: votes.results.filter((v) => v.idea_id === i.id).map((v) => v.user_id) })));
  }
  if (path === 'fun' && method === 'POST') {
    const b = await body(req);
    if (!b.title?.trim()) return bad('What is the idea?');
    await db.prepare('INSERT INTO fun_ideas (title, details, place, cost, easy, needs_dry, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(b.title.trim(), b.details || null, b.place === 'out' ? 'out' : 'home', num(b.cost, 0), b.easy ? 1 : 0, b.needs_dry ? 1 : 0, me.id).run();
    await notify(db, others(me), `🎉 ${me.name} added a fun idea: ${b.title.trim()}`, '#fun');
    return json({ ok: true });
  }
  if (parts[0] === 'fun' && parts[1]) {
    const id = Number(parts[1]);
    if (parts[2] === 'vote' && method === 'POST') {
      const had = await db.prepare('SELECT 1 FROM fun_votes WHERE idea_id = ? AND user_id = ?').bind(id, me.id).first();
      await db.prepare(had ? 'DELETE FROM fun_votes WHERE idea_id = ? AND user_id = ?' : 'INSERT INTO fun_votes (idea_id, user_id) VALUES (?, ?)').bind(id, me.id).run();
      return json({ ok: true, voted: !had });
    }
    if (parts[2] === 'plan' && method === 'POST') {
      const { date, time } = await body(req);
      if (!isDate(date)) return bad('Pick a day');
      const idea = await db.prepare('SELECT * FROM fun_ideas WHERE id = ?').bind(id).first();
      if (!idea) return bad('Not found', 404);
      let rain = null;
      if (idea.needs_dry) {
        const alt = await db.prepare("SELECT title FROM fun_ideas WHERE active = 1 AND place = 'home' AND needs_dry = 0 ORDER BY RANDOM() LIMIT 1").first();
        rain = alt ? `Stay home: ${alt.title}` : 'Stay home: movie night';
      }
      await db.batch([
        db.prepare('INSERT INTO day_plans (date, time, title, outdoor, rain_plan, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(date, time || null, `🎉 ${idea.title}`, idea.needs_dry, rain, me.id),
        db.prepare('UPDATE fun_ideas SET last_done = ? WHERE id = ?').bind(date, id),
        db.prepare('DELETE FROM fun_votes WHERE idea_id = ?').bind(id),
      ]);
      await notify(db, others(me), `🎉 Family fun on ${fmtShort(date)}: ${idea.title}`, `#day/${date}`);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('UPDATE fun_ideas SET active = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ================= checklists (Madilea's bags & monthly buy lists) =================
  if (path === 'lists' && method === 'GET') {
    const kind = q.get('kind');
    const month = q.get('month');
    let sql = 'SELECT * FROM checklists WHERE 1=1', binds = [];
    if (kind) { sql += ' AND kind = ?'; binds.push(kind); }
    if (month) { sql += ' AND month = ?'; binds.push(month); }
    const { results: lists } = await db.prepare(sql + ' ORDER BY sort, month, id').bind(...binds).all();
    if (!lists.length) return json([]);
    const { results: items } = await db.prepare(`SELECT i.*, u.name AS done_by_name FROM checklist_items i LEFT JOIN users u ON u.id = i.done_by
      WHERE list_id IN (${lists.map(() => '?').join(',')}) ORDER BY sort, id`).bind(...lists.map((l) => l.id)).all();
    return json(lists.map((l) => ({ ...l, items: items.filter((i) => i.list_id === l.id) })));
  }
  if (path === 'lists' && method === 'POST') {
    const { kind, title, month, copy_from } = await body(req);
    if (!['bag', 'buy'].includes(kind) || !title?.trim()) return bad('Kind and title needed');
    if (kind === 'buy' && month) {
      const ex = await db.prepare("SELECT id FROM checklists WHERE kind = 'buy' AND month = ?").bind(month).first();
      if (ex) return json({ ok: true, id: ex.id });
    }
    const r = await db.prepare('INSERT INTO checklists (kind, title, month, sort) VALUES (?, ?, ?, ?)').bind(kind, title.trim(), month || null, kind === 'buy' ? 10 : 5).run();
    const id = r.meta.last_row_id;
    if (copy_from) {
      await db.prepare('INSERT INTO checklist_items (list_id, text, qty, price, sort) SELECT ?, text, qty, price, sort FROM checklist_items WHERE list_id = ?').bind(id, copy_from).run();
    }
    return json({ ok: true, id });
  }
  if (parts[0] === 'lists' && parts[1]) {
    const id = Number(parts[1]);
    if (parts[2] === 'items' && method === 'POST') {
      const { text, qty, price } = await body(req);
      if (!text?.trim()) return bad('What item?');
      await db.prepare('INSERT INTO checklist_items (list_id, text, qty, price, sort) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM checklist_items WHERE list_id = ?))')
        .bind(id, text.trim(), qty || null, num(price), id).run();
      return json({ ok: true });
    }
    if (parts[2] === 'reset' && method === 'POST') {
      await db.prepare('UPDATE checklist_items SET done = 0, done_by = NULL WHERE list_id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (!parts[2] && method === 'DELETE') {
      await db.batch([db.prepare('DELETE FROM checklist_items WHERE list_id = ?').bind(id), db.prepare('DELETE FROM checklists WHERE id = ?').bind(id)]);
      return json({ ok: true });
    }
  }
  if (parts[0] === 'list-items' && parts[1]) {
    const id = Number(parts[1]);
    if (method === 'DELETE') { await db.prepare('DELETE FROM checklist_items WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    if (method === 'PUT') {
      const b = await body(req);
      const it = await db.prepare('SELECT * FROM checklist_items WHERE id = ?').bind(id).first();
      if (!it) return bad('Not found', 404);
      const done = 'done' in b ? (b.done ? 1 : 0) : it.done;
      await db.prepare('UPDATE checklist_items SET text = ?, qty = ?, price = ?, done = ?, done_by = ? WHERE id = ?')
        .bind(b.text ?? it.text, b.qty ?? it.qty, 'price' in b ? num(b.price) : it.price, done, done ? me.id : null, id).run();
      return json({ ok: true });
    }
  }

  // ================= inventory =================
  if (path === 'items' && method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM items WHERE active = 1 ORDER BY section, name').all();
    return json(results);
  }
  if (parts[0] === 'items' && parts[1] === 'barcode' && parts[2]) {
    const it = await db.prepare('SELECT * FROM items WHERE barcode = ? AND active = 1').bind(parts[2]).first();
    return json(it || null);
  }
  if (path === 'items' && method === 'POST') {
    const b = await body(req);
    if (!b.name?.trim()) return bad('Name needed');
    const last = await db.prepare("SELECT code FROM items WHERE code LIKE 'NEST-%' ORDER BY code DESC LIMIT 1").first();
    const next = 'NEST-' + String((last ? Number(last.code.slice(5)) : 0) + 1).padStart(4, '0');
    const r = await db.prepare(`INSERT INTO items (code, barcode, name, brand, size, section, kind, price, shop, photo_key, par, on_hand, essential, pack_qty, pack_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(next, b.barcode || null, b.name.trim(), b.brand || null, b.size || null,
      b.section || 'Other', b.kind || 'grocery', num(b.price), b.shop || null, b.photo_key || null, num(b.par, 1), num(b.on_hand, 0), b.essential ? 1 : 0,
      num(b.pack_qty, 1), ['g', 'ml', 'each', 'kg'].includes(b.pack_unit) ? b.pack_unit : 'each').run();
    if (num(b.price)) await db.prepare('INSERT INTO item_prices (item_id, price, shop, date) VALUES (?, ?, ?, ?)').bind(r.meta.last_row_id, num(b.price), b.shop || null, saToday()).run();
    return json({ ok: true, id: r.meta.last_row_id, code: next });
  }
  if (parts[0] === 'items' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    if (parts[2] === 'prices') {
      const { results } = await db.prepare('SELECT * FROM item_prices WHERE item_id = ? ORDER BY date DESC, id DESC LIMIT 20').bind(id).all();
      return json(results);
    }
    if (method === 'PUT') {
      const b = await body(req);
      const it = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
      if (!it) return bad('Not found', 404);
      const sets = [], vals = [];
      for (const k of ITEM_FIELDS) if (k in b) {
        sets.push(`${k} = ?`);
        vals.push(['price', 'par', 'on_hand', 'pack_qty'].includes(k) ? num(b[k], k === 'price' ? null : 0) : ['essential', 'active'].includes(k) ? (b[k] ? 1 : 0) : (b[k] === '' ? null : b[k]));
      }
      if (!sets.length) return bad('Nothing to change');
      await db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, id).run();
      if ('price' in b && num(b.price) && num(b.price) !== it.price)
        await db.prepare('INSERT INTO item_prices (item_id, price, shop, date) VALUES (?, ?, ?, ?)').bind(id, num(b.price), b.shop ?? it.shop, saToday()).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') { await db.prepare('UPDATE items SET active = 0 WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }

  // ================= stock take =================
  if (path === 'stock-takes/current' && method === 'GET') {
    const take = await db.prepare('SELECT * FROM stock_takes WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1').first();
    const last = await db.prepare('SELECT s.*, u.name AS by_name FROM stock_takes s LEFT JOIN users u ON u.id = s.started_by WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').first();
    let counts = {};
    if (take) {
      const { results } = await db.prepare('SELECT item_id, qty FROM stock_counts WHERE take_id = ?').bind(take.id).all();
      counts = Object.fromEntries(results.map((r) => [r.item_id, r.qty]));
    }
    return json({ take, counts, last });
  }
  if (path === 'stock-takes' && method === 'POST') {
    const open = await db.prepare('SELECT id FROM stock_takes WHERE finished_at IS NULL').first();
    if (open) return json({ ok: true, id: open.id });
    const r = await db.prepare('INSERT INTO stock_takes (started_by) VALUES (?)').bind(me.id).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (parts[0] === 'stock-takes' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    if (parts[2] === 'count' && method === 'PUT') {
      const { item_id, qty } = await body(req);
      if (qty === null || qty === '') await db.prepare('DELETE FROM stock_counts WHERE take_id = ? AND item_id = ?').bind(id, item_id).run();
      else await db.prepare('INSERT OR REPLACE INTO stock_counts (take_id, item_id, qty) VALUES (?, ?, ?)').bind(id, item_id, num(qty, 0)).run();
      return json({ ok: true });
    }
    if (parts[2] === 'finish' && method === 'POST') {
      const { uncounted_zero = false } = await body(req);
      const { results: counts } = await db.prepare('SELECT item_id, qty FROM stock_counts WHERE take_id = ?').bind(id).all();
      const stmts = counts.map((c) => db.prepare("UPDATE items SET on_hand = ?, updated_at = datetime('now') WHERE id = ?").bind(c.qty, c.item_id));
      if (uncounted_zero) stmts.push(db.prepare('UPDATE items SET on_hand = 0 WHERE active = 1 AND id NOT IN (SELECT item_id FROM stock_counts WHERE take_id = ?)').bind(id));
      stmts.push(db.prepare("UPDATE stock_takes SET finished_at = datetime('now') WHERE id = ?").bind(id));
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
      const tripId = await buildTrip(db, me, id);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM shop_lines WHERE trip_id = ?').bind(tripId).first();
      await notify(db, others(me), `📋 ${me.name} finished the stock take. Shopping list ready (${n.n} items)`, '#shop');
      return json({ ok: true, trip_id: tripId });
    }
  }

  // ================= shopping list & trolley =================
  if (path === 'trips/new' && method === 'POST') {
    const id = await buildTrip(db, me, null);
    return json({ ok: true, id });
  }
  if (path === 'trips/current' && method === 'GET') {
    const trip = await db.prepare("SELECT * FROM shop_trips WHERE status = 'open' ORDER BY id DESC LIMIT 1").first();
    const s = await db.prepare("SELECT key, value FROM settings WHERE key IN ('grocery_budget','meat_budget')").all();
    const budgets = Object.fromEntries(s.results.map((r) => [r.key, Number(r.value)]));
    if (!trip) return json({ trip: null, lines: [], budgets });
    const { results: lines } = await db.prepare(`SELECT l.*, i.section, i.kind, i.brand, i.size, i.photo_key, i.barcode, i.code, i.essential
      FROM shop_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.trip_id = ? ORDER BY COALESCE(i.section, 'zz'), l.name`).bind(trip.id).all();
    return json({ trip, lines, budgets });
  }
  if (path === 'trips' && method === 'GET') {
    const { results } = await db.prepare(`SELECT t.*, u.name AS by_name,
      (SELECT ROUND(SUM(COALESCE(qty,0) * COALESCE(price,0)),2) FROM shop_lines WHERE trip_id = t.id AND in_trolley = 1) AS spent,
      (SELECT COUNT(*) FROM shop_lines WHERE trip_id = t.id AND in_trolley = 1) AS n
      FROM shop_trips t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.id DESC LIMIT 12`).all();
    return json(results);
  }
  if (parts[0] === 'trips' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    if (parts[2] === 'lines' && method === 'POST') {
      const b = await body(req);
      if (!b.name?.trim()) return bad('What did you pick up?');
      await db.prepare('INSERT INTO shop_lines (trip_id, item_id, name, plan_qty, plan_price, in_trolley, qty, price) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)')
        .bind(id, b.item_id || null, b.name.trim(), b.in_trolley ? 1 : 0, num(b.qty, 1), num(b.price)).run();
      return json({ ok: true });
    }
    if (parts[2] === 'finish' && method === 'POST') {
      const { shop } = await body(req);
      // claim the trip first, so a second tap or a network retry can't add the same shopping to the cupboard twice
      const claim = await db.prepare("UPDATE shop_trips SET status = 'done', shop = ?, finished_at = datetime('now') WHERE id = ? AND status = 'open'").bind(shop || null, id).run();
      if (!claim.meta.changes) return bad('This shop is already finished', 409);
      const { results: lines } = await db.prepare('SELECT * FROM shop_lines WHERE trip_id = ? AND in_trolley = 1').bind(id).all();
      const today = saToday();
      const stmts = [];
      for (const l of lines) {
        if (!l.item_id) continue;
        stmts.push(db.prepare("UPDATE items SET on_hand = on_hand + ?, price = COALESCE(?, price), shop = COALESCE(?, shop), updated_at = datetime('now') WHERE id = ?")
          .bind(l.qty || 0, l.price, shop || null, l.item_id));
        if (l.price) stmts.push(db.prepare('INSERT INTO item_prices (item_id, price, shop, date) VALUES (?, ?, ?, ?)').bind(l.item_id, l.price, shop || null, today));
      }
      for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
      const spent = lines.reduce((s, l) => s + (l.qty || 0) * (l.price || 0), 0);
      await notify(db, others(me), `🛒 ${me.name} finished shopping: R${spent.toFixed(2)}`, '#shop');
      return json({ ok: true, spent: Math.round(spent * 100) / 100 });
    }
    if (!parts[2] && method === 'DELETE') {
      await db.batch([db.prepare('DELETE FROM shop_lines WHERE trip_id = ?').bind(id), db.prepare('DELETE FROM shop_trips WHERE id = ?').bind(id)]);
      return json({ ok: true });
    }
  }
  if (parts[0] === 'shop-lines' && parts[1]) {
    const id = Number(parts[1]);
    if (method === 'DELETE') { await db.prepare('DELETE FROM shop_lines WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    if (method === 'PUT') {
      const b = await body(req);
      const l = await db.prepare('SELECT * FROM shop_lines WHERE id = ?').bind(id).first();
      if (!l) return bad('Not found', 404);
      await db.prepare('UPDATE shop_lines SET in_trolley = ?, qty = ?, price = ?, skipped = ? WHERE id = ?').bind(
        'in_trolley' in b ? (b.in_trolley ? 1 : 0) : l.in_trolley,
        'qty' in b ? num(b.qty) : l.qty,
        'price' in b ? num(b.price) : l.price,
        'skipped' in b ? (b.skipped ? 1 : 0) : l.skipped, id).run();
      return json({ ok: true });
    }
  }

  // ================= workouts =================
  if (path === 'workouts' && method === 'GET') {
    const today = pickToday(q.get('today'));
    await ensureTemplateTasks(db, today);
    const week = mondayOf(today);
    const [plans, tasks, recent] = await db.batch([
      db.prepare(`SELECT t.*, w.minutes, w.howto, u.name AS assignee_name, u.emoji, u.colour FROM task_templates t
        JOIN users u ON u.id = t.assignee LEFT JOIN workout_info w ON w.template_id = t.id
        WHERE t.area = 'Workouts' AND t.active = 1 ORDER BY u.name, t.title`),
      db.prepare(`SELECT t.*, l.minutes AS did_minutes, l.feel FROM tasks t LEFT JOIN workout_logs l ON l.task_id = t.id
        WHERE t.area = 'Workouts' AND (t.due_date >= ? OR t.done_at IS NULL) ORDER BY t.due_date`).bind(addDays(week, -21)),
      db.prepare(`SELECT t.title, t.assignee, t.done_at, l.minutes, l.feel, l.note, u.name, u.emoji FROM tasks t
        JOIN workout_logs l ON l.task_id = t.id JOIN users u ON u.id = t.assignee ORDER BY t.done_at DESC, t.id DESC LIMIT 15`),
    ]);
    const all = tasks.results.map((t) => decorateTask(t, today));
    const people = (await familyIds(db)).map((id) => {
      const mine = all.filter((t) => t.assignee === id);
      const thisWeek = mine.filter((t) => t.due_date >= week && t.due_date <= today);
      // streak: consecutive weeks (ending last week) where every planned workout was done
      let streak = 0;
      for (let w = 1; w <= 3; w++) {
        const ws = addDays(week, -7 * w), we = addDays(ws, 6);
        const wk = mine.filter((t) => t.due_date >= ws && t.due_date <= we);
        if (wk.length && wk.every((t) => t.done_at)) streak++; else break;
      }
      return {
        id,
        planned: thisWeek.length,
        done: thisWeek.filter((t) => t.done_at).length,
        minutes: thisWeek.reduce((s, t) => s + (t.did_minutes || 0), 0),
        open: mine.filter((t) => !t.done_at && t.due_date <= today),
        streak,
      };
    });
    return json({ week, plans: plans.results, people, recent: recent.results });
  }
  if (path === 'workouts' && method === 'POST') {
    const b = await body(req);
    if (!b.title?.trim() || !(await familyIds(db)).includes(b.assignee) || !/^[1-7]+$/.test(b.days || '')) return bad('Title, person and days needed');
    const title = b.title.trim().startsWith('💪') ? b.title.trim() : '💪 ' + b.title.trim();
    const r = await db.prepare("INSERT INTO task_templates (title, area, assignee, days, points, created_by) VALUES (?, 'Workouts', ?, ?, ?, ?)")
      .bind(title, b.assignee, b.days, num(b.points, 10), me.id).run();
    await db.prepare('INSERT INTO workout_info (template_id, minutes, howto) VALUES (?, ?, ?)').bind(r.meta.last_row_id, num(b.minutes, 20), b.howto || null).run();
    if (b.assignee !== me.id) await notify(db, [b.assignee], `💪 ${me.name} set you a workout: ${b.title.trim()}`, '#workouts');
    return json({ ok: true });
  }
  if (path === 'workouts/log' && method === 'POST') {
    const { task_id, minutes, feel, note, date } = await body(req);
    if (!task_id) return bad('Which workout?');
    const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(task_id).first();
    if (!t) return bad('Not found', 404);
    if (t.assignee !== me.id && !me.is_parent) return bad('Only the person doing it can log it', 403);
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO workout_logs (task_id, minutes, feel, note) VALUES (?, ?, ?, ?)').bind(t.id, num(minutes), num(feel), note || null),
      db.prepare('UPDATE tasks SET done_at = COALESCE(done_at, ?) WHERE id = ?').bind(doneDay(me, date), t.id),
    ]);
    return json({ ok: true });
  }
  if (parts[0] === 'workouts' && /^\d+$/.test(parts[1] || '') && method === 'PUT') {
    const b = await body(req);
    const id = Number(parts[1]);
    const stmts = [db.prepare('INSERT OR IGNORE INTO workout_info (template_id) VALUES (?)').bind(id)];
    if ('minutes' in b) stmts.push(db.prepare('UPDATE workout_info SET minutes = ? WHERE template_id = ?').bind(num(b.minutes, 20), id));
    if ('howto' in b) stmts.push(db.prepare('UPDATE workout_info SET howto = ? WHERE template_id = ?').bind(b.howto || null, id));
    if (b.days && /^[1-7]+$/.test(b.days)) stmts.push(db.prepare('UPDATE task_templates SET days = ? WHERE id = ?').bind(b.days, id));
    await db.batch(stmts);
    return json({ ok: true });
  }

  return null;
}

// Build a shopping trip: everything below its "keep in the house" level
async function buildTrip(db, me, takeId) {
  await db.prepare("DELETE FROM shop_lines WHERE trip_id IN (SELECT id FROM shop_trips WHERE status = 'open' AND id NOT IN (SELECT DISTINCT trip_id FROM shop_lines WHERE in_trolley = 1))").run();
  await db.prepare("DELETE FROM shop_trips WHERE status = 'open' AND id NOT IN (SELECT DISTINCT trip_id FROM shop_lines)").run();
  const open = await db.prepare("SELECT id FROM shop_trips WHERE status = 'open'").first();
  if (open) return open.id; // a trip with things already in the trolley — keep it
  const budget = Number((await db.prepare("SELECT value FROM settings WHERE key = 'grocery_budget'").first())?.value || 5000);
  const r = await db.prepare('INSERT INTO shop_trips (take_id, budget, created_by) VALUES (?, ?, ?)').bind(takeId, budget, me.id).run();
  const tripId = r.meta.last_row_id;
  const { results: items } = await db.prepare('SELECT * FROM items WHERE active = 1 AND on_hand < par').all();
  const stmts = items.map((i) => {
    const need = i.kind === 'meat' ? Math.ceil((i.par - i.on_hand) * 2) / 2 : Math.ceil(i.par - i.on_hand);
    const label = [i.name, i.brand && !i.name.includes(i.brand) ? `(${i.brand})` : ''].filter(Boolean).join(' ');
    return db.prepare('INSERT INTO shop_lines (trip_id, item_id, name, plan_qty, plan_price) VALUES (?, ?, ?, ?, ?)').bind(tripId, i.id, label, need, i.price);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return tripId;
}
