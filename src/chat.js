// The Stewart Nest — family chat: messages, replies, reactions, photo attachments.
import { json, bad, body, othersOf } from './util.js';
import { pushTo } from './push.js';
import { isMediaKey } from './media.js';

const MSG_SQL = `SELECT c.id, c.user_id, c.text, c.photo_key, c.reply_to, c.created_at, c.deleted, c.card, c.pinned,
  u.name, u.emoji, u.colour,
  r.text AS reply_text, r.photo_key AS reply_photo, ru.name AS reply_name, r.deleted AS reply_deleted
  FROM chat_messages c JOIN users u ON u.id = c.user_id
  LEFT JOIN chat_messages r ON r.id = c.reply_to LEFT JOIN users ru ON ru.id = r.user_id`;

async function reactionsFor(db, fromId) {
  const { results } = await db.prepare(`SELECT x.message_id, x.emoji, x.user_id, u.name FROM chat_reactions x JOIN users u ON u.id = x.user_id
    WHERE x.message_id >= ? ORDER BY x.created_at`).bind(fromId).all();
  const out = {};
  for (const r of results) {
    const m = out[r.message_id] || (out[r.message_id] = {});
    (m[r.emoji] = m[r.emoji] || []).push({ user_id: r.user_id, name: r.name });
  }
  return out;
}
async function votesFor(db, fromId) {
  const { results } = await db.prepare(`SELECT v.message_id, v.opt, v.user_id, u.name, u.emoji FROM chat_votes v JOIN users u ON u.id = v.user_id
    WHERE v.message_id >= ?`).bind(fromId).all();
  const out = {};
  for (const v of results) ((out[v.message_id] = out[v.message_id] || {})[v.opt] = out[v.message_id][v.opt] || []).push({ user_id: v.user_id, name: v.name, emoji: v.emoji });
  return out;
}
export const safeLink = (l) => typeof l === 'string' && /^#[\w\/.\-]*$/.test(l);
async function pinsList(db) {
  const { results } = await db.prepare(`SELECT c.id, c.text, c.photo_key, c.card, c.created_at, c.pinned_by, u.name, p.name AS pinned_by_name
    FROM chat_messages c JOIN users u ON u.id = c.user_id LEFT JOIN users p ON p.id = c.pinned_by
    WHERE c.pinned = 1 AND c.deleted = 0 ORDER BY c.id DESC LIMIT 20`).all();
  return results.map((m) => ({ ...m, card: parseCard(m.card) }));
}
const parseCard = (c) => { try { return c ? JSON.parse(c) : null; } catch { return null; } };

// Remove a photo from storage once nothing in the Nest uses it any more.
export async function dropPhotoIfUnused(env, db, key) {
  if (!key || !env?.PHOTOS) return;
  const used = await db.prepare(`SELECT 1 FROM chat_messages WHERE photo_key = ?1 UNION ALL SELECT 1 FROM photos WHERE photo_key = ?1
    UNION ALL SELECT 1 FROM items WHERE photo_key = ?1 LIMIT 1`).bind(key).first().catch(() => ({ keep: 1 }));
  if (!used) { try { await env.PHOTOS.delete(key); } catch (e) { console.error('photo delete', e.message); } }
}

// Delete messages for everyone: the message, its reactions and votes, and its photo if nothing else uses it.
const ID_CHUNK = 90; // the database accepts at most 100 values in one query
export async function removeMessages(db, env, ids) {
  const all = [...new Set(ids.map(Number).filter(Boolean))];
  for (let i = 0; i < all.length; i += ID_CHUNK) {
    const part = all.slice(i, i + ID_CHUNK);
    const marks = part.map(() => '?').join(',');
    const keys = (await db.prepare(`SELECT photo_key FROM chat_messages WHERE id IN (${marks}) AND photo_key IS NOT NULL`).bind(...part).all()).results.map((r) => r.photo_key);
    await db.batch([
      db.prepare(`DELETE FROM chat_reactions WHERE message_id IN (${marks})`).bind(...part),
      db.prepare(`DELETE FROM chat_votes WHERE message_id IN (${marks})`).bind(...part),
      db.prepare(`DELETE FROM chat_messages WHERE id IN (${marks})`).bind(...part),
    ]);
    for (const k of keys) await dropPhotoIfUnused(env, db, k);
  }
  return all.length;
}

export async function chat({ req, env, db, path, parts, method, q, me }) {
  if (parts[0] !== 'chat') return null;

  // messages (newest 150, or everything after a given id) + reactions on the loaded window
  if (path === 'chat' && method === 'GET') {
    const after = Number(q.get('after') || 0), since = Number(q.get('since') || 0);
    const { results } = after
      ? await db.prepare(`${MSG_SQL} WHERE c.id > ? ORDER BY c.id`).bind(after).all()
      : await db.prepare(`SELECT * FROM (${MSG_SQL} ORDER BY c.id DESC LIMIT 150) ORDER BY id`).all();
    const last = results.length ? results[results.length - 1].id : after;
    if (last) await db.prepare(`INSERT INTO chat_reads (user_id, last_id) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`).bind(me.id, last).run();
    const from = since || (results[0]?.id ?? after);
    // ids still in the chat from the oldest one this phone has; anything missing was deleted for everyone
    const ids = (await db.prepare('SELECT id FROM chat_messages WHERE id >= ? ORDER BY id').bind(from || 0).all()).results.map((r) => r.id);
    return json({ ids, from: from || 0,
      messages: results.map((m) => (m.deleted ? { ...m, text: null, photo_key: null, card: null } : { ...m, card: parseCard(m.card) })),
      reactions: await reactionsFor(db, from || 0), votes: await votesFor(db, from || 0),
      reads: (await db.prepare('SELECT r.user_id, r.last_id FROM chat_reads r JOIN users u ON u.id = r.user_id WHERE u.active = 1').all()).results,
      people: (await db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first()).n,
      pins: await pinsList(db),
    });
  }

  // search all messages (not only the ones loaded on the phone)
  if (path === 'chat/search' && method === 'GET') {
    const term = (q.get('q') || '').trim();
    if (term.length < 2) return json([]);
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const { results } = await db.prepare(`SELECT c.id, c.text, c.photo_key, c.card, c.created_at, u.name, u.emoji FROM chat_messages c JOIN users u ON u.id = c.user_id
      WHERE c.deleted = 0 AND (c.text LIKE ? ESCAPE '\\' OR c.card LIKE ? ESCAPE '\\') ORDER BY c.id DESC LIMIT 60`).bind(like, like).all();
    return json(results.map((m) => ({ ...m, card: parseCard(m.card) })));
  }

  if (path === 'chat' && method === 'POST') {
    const { text, photo_key, reply_to, card, client_id } = await body(req);
    if (!text?.trim() && !photo_key && !card) return bad('Empty message');
    if (photo_key && !isMediaKey(photo_key)) return bad('Upload the photo, voice note or video first');
    const cid = typeof client_id === 'string' ? client_id.slice(0, 64) : null;
    // the same message sent twice (double tap, slow network retry) is only posted once
    const again = cid
      ? await db.prepare('SELECT id FROM chat_messages WHERE user_id = ? AND client_id = ?').bind(me.id, cid).first()
      : await db.prepare(`SELECT id FROM chat_messages WHERE user_id = ? AND text = ? AND COALESCE(photo_key, '') = ? AND card IS NULL
          AND created_at >= datetime('now', '-20 seconds') ORDER BY id DESC LIMIT 1`).bind(me.id, (text || '').trim().slice(0, 2000), photo_key || '').first();
    if (again && !card) return json({ ok: true, id: again.id, duplicate: true });
    if (again && cid) return json({ ok: true, id: again.id, duplicate: true });
    let cardJson = null;
    if (card) {
      if (!['task', 'supper', 'event', 'recipe', 'poll', 'day'].includes(card.type)) return bad('Unknown card');
      if (card.type === 'poll' && (!card.q || !Array.isArray(card.options) || card.options.length < 2 || card.options.length > 6)) return bad('A poll needs a question and 2–6 options');
      // a card may only link to a page inside the Nest (#day/…, #recipes …), never to javascript: or another site
      if ('link' in card && !safeLink(card.link)) return bad('Cards can only link to a page in the Nest');
      cardJson = JSON.stringify(card);
      if (cardJson.length > 3000) return bad('Card too big');
    }
    let r;
    try {
      r = await db.prepare('INSERT INTO chat_messages (user_id, text, photo_key, reply_to, card, client_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(me.id, (text || '').trim().slice(0, 2000), photo_key || null, reply_to ? Number(reply_to) : null, cardJson, cid).run();
    } catch (e) {
      // two copies arrived at the same moment: the unique index kept one
      const had = cid && (await db.prepare('SELECT id FROM chat_messages WHERE user_id = ? AND client_id = ?').bind(me.id, cid).first());
      if (had) return json({ ok: true, id: had.id, duplicate: true });
      throw e;
    }
    await db.prepare(`INSERT INTO chat_reads (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = excluded.last_id`).bind(me.id, r.meta.last_row_id).run();
    pushTo(db, await othersOf(db, me), 'chat'); // wake everyone else's phone
    return json({ ok: true, id: r.meta.last_row_id });
  }

  // admin: delete several messages / photos for everyone
  if (path === 'chat/delete' && method === 'POST') {
    const { ids } = await body(req);
    if (!Array.isArray(ids) || !ids.length) return bad('Pick messages to delete');
    if (!me.is_admin) {
      if (ids.length > ID_CHUNK) return bad('Pick fewer messages at a time');
      const mine = (await db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(me.id, ...ids).first()).n;
      if (mine !== ids.length) return bad('You can only delete your own messages', 403);
    }
    return json({ ok: true, deleted: await removeMessages(db, env, ids.slice(0, 500)) });
  }

  const id = Number(parts[1]);
  if (!id) return null;
  const m = await db.prepare('SELECT * FROM chat_messages WHERE id = ?').bind(id).first();
  if (!m) return bad('Message not found', 404);

  // toggle a reaction
  if (parts[2] === 'react' && method === 'POST') {
    const { emoji } = await body(req);
    if (!emoji || [...emoji].length > 8) return bad('Pick an emoji');
    const had = await db.prepare('SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').bind(id, me.id, emoji).first();
    await db.prepare(had ? 'DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
      : 'INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').bind(id, me.id, emoji).run();
    return json({ ok: true, on: !had });
  }

  // vote in a poll (one vote each; tap the same option again to take it back)
  if (parts[2] === 'vote' && method === 'POST') {
    const card = parseCard(m.card);
    const { opt } = await body(req);
    if (!card || card.type !== 'poll' || !(opt >= 0 && opt < card.options.length)) return bad('Not a poll option');
    const had = await db.prepare('SELECT opt FROM chat_votes WHERE message_id = ? AND user_id = ?').bind(id, me.id).first();
    if (had && had.opt === opt) await db.prepare('DELETE FROM chat_votes WHERE message_id = ? AND user_id = ?').bind(id, me.id).run();
    else await db.prepare('INSERT OR REPLACE INTO chat_votes (message_id, user_id, opt) VALUES (?, ?, ?)').bind(id, me.id, opt).run();
    return json({ ok: true });
  }

  // pin / unpin a message for everyone (school info, the Wi-Fi password…)
  if (parts[2] === 'pin' && method === 'POST') {
    const on = !m.pinned;
    await db.prepare('UPDATE chat_messages SET pinned = ?, pinned_by = ? WHERE id = ?').bind(on ? 1 : 0, on ? me.id : null, id).run();
    return json({ ok: true, pinned: on });
  }

  // delete for everyone: your own messages, or any message if you're the admin
  if (!parts[2] && method === 'DELETE') {
    if (m.user_id !== me.id && !me.is_admin) return bad('You can only delete your own messages', 403);
    await removeMessages(db, env, [id]);
    return json({ ok: true });
  }
  return null;
}
