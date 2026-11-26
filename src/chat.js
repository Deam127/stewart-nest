// The Stewart Nest — family chat: messages, replies, reactions, photo attachments.
import { json, bad, body } from './util.js';

const MSG_SQL = `SELECT c.id, c.user_id, c.text, c.photo_key, c.reply_to, c.created_at, c.deleted, c.card,
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
const parseCard = (c) => { try { return c ? JSON.parse(c) : null; } catch { return null; } };

export async function chat({ req, db, path, parts, method, q, me }) {
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
    return json({
      messages: results.map((m) => (m.deleted ? { ...m, text: null, photo_key: null, card: null } : { ...m, card: parseCard(m.card) })),
      reactions: await reactionsFor(db, from || 0), votes: await votesFor(db, from || 0),
      reads: (await db.prepare('SELECT r.user_id, r.last_id FROM chat_reads r JOIN users u ON u.id = r.user_id WHERE u.active = 1').all()).results,
      people: (await db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first()).n,
    });
  }

  if (path === 'chat' && method === 'POST') {
    const { text, photo_key, reply_to, card } = await body(req);
    if (!text?.trim() && !photo_key && !card) return bad('Empty message');
    let cardJson = null;
    if (card) {
      if (!['task', 'supper', 'event', 'recipe', 'poll', 'day'].includes(card.type)) return bad('Unknown card');
      if (card.type === 'poll' && (!card.q || !Array.isArray(card.options) || card.options.length < 2 || card.options.length > 6)) return bad('A poll needs a question and 2–6 options');
      cardJson = JSON.stringify(card);
      if (cardJson.length > 3000) return bad('Card too big');
    }
    const r = await db.prepare('INSERT INTO chat_messages (user_id, text, photo_key, reply_to, card) VALUES (?, ?, ?, ?, ?)')
      .bind(me.id, (text || '').trim().slice(0, 2000), photo_key || null, reply_to ? Number(reply_to) : null, cardJson).run();
    await db.prepare(`INSERT INTO chat_reads (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = excluded.last_id`).bind(me.id, r.meta.last_row_id).run();
    return json({ ok: true, id: r.meta.last_row_id });
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

  // delete your own message (shows as "message deleted")
  if (!parts[2] && method === 'DELETE') {
    if (m.user_id !== me.id && !me.is_admin) return bad('You can only delete your own messages', 403);
    await db.prepare('UPDATE chat_messages SET deleted = 1 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  return null;
}
