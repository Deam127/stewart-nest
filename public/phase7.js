// The Stewart Nest — family chat v2: reply to a message, reactions, emoji picker,
// photos from the camera, the phone's gallery or the Nest's family photos.
'use strict';

const QUICK = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const EMOJI = {
  '😊 Smileys': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 😐 😑 😶 🙄 😏 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 🥴 😵 🤯 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬',
  '❤️ Love': '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💕 💞 💓 💗 💖 💘 💝 💟 ❣️ 💔 😻 💋 🫶 🤗',
  '👋 Hands': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👋 👏 🙌 👐 🤲 🙏 💪 ✊ 👊 🫡 🤝 ☝️ 👆 👇 👉 👈',
  '👪 Family': '👨‍👩‍👦 👨‍👩‍👧‍👦 👶 🍼 🤰 👧 👦 👩 👨 👵 👴 🧒 🚼 🎒 🏫 📚 ✏️ 🏠 🛏️ 🛁 🧹 🧺 🚗 🚌',
  '🍲 Food': '🍳 🥓 🥞 🧇 🍞 🥪 🌭 🍔 🍟 🍕 🌮 🌯 🥗 🍝 🍜 🍛 🍲 🍚 🥩 🍗 🍖 🔥 🥘 🧀 🥚 🍎 🍌 🍊 🍇 🍓 🍉 🥑 🥕 🌽 🥔 🍰 🎂 🧁 🍪 🍫 🍦 ☕ 🍵 🥤 🧃',
  '🎉 Fun': '🎉 🎊 🎈 🎁 🏆 🥇 ⭐ 🌟 ✨ 💯 ✅ ❌ ⚠️ ❓ ❗ 💤 🎮 ⚽ 🏉 🏏 🎬 🎵 🎶 📸 🌈 ☀️ 🌧️ ⛈️ ❄️ 🌙',
  '🐾 Animals': '🐶 🐕 🦮 🐩 🐾 🐱 🐈 🐰 🐹 🐻 🦁 🐘 🦒 🦓 🦏 🐒 🐔 🐣 🦆 🐟 🐢 🦋 🐝 🌸 🌻 🌳',
  '🇿🇦 Flags': '🇿🇦 🏉 🦁 🇳🇦 🇬🇧 🇵🇹 🇳🇱',
};
const C7 = { msgs: [], reactions: {}, votes: {}, reads: [], people: 3, last: 0, replyTo: null, timer: null, sel: null, busy: false };
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#chat')) { C7.sel = null; document.getElementById('sel-bar')?.remove(); } });
const newCid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ticks = (m) => {
  const others = C7.reads.filter((r) => r.user_id !== S.me.id);
  const seen = others.filter((r) => r.last_id >= m.id).length;
  const all = Math.max(1, (C7.people || 3) - 1);
  return seen >= all ? '<span class="tk blue">✓✓</span>' : seen ? '<span class="tk">✓✓</span>' : '<span class="tk">✓</span>';
};

function bubble(m, prev) {
  const mine = m.user_id === S.me.id;
  const d = new Date(m.created_at + 'Z');
  const dayStr = (x) => new Date(x.created_at + 'Z').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  const react = C7.reactions[m.id] || {};
  const chips = Object.entries(react).map(([e, who]) => `<button class="rx ${who.some((w) => w.user_id === S.me.id) ? 'mine' : ''}" data-rx="${m.id}" title="${esc(who.map((w) => w.name).join(', '))}">${esc(e)}${who.length > 1 ? ' ' + who.length : ''}</button>`).join('');
  return `${!prev || dayStr(m) !== dayStr(prev) ? `<div class="day-sep">${dayStr(m)}</div>` : ''}
    <div class="msg ${mine ? 'mine' : ''} ${C7.sel && C7.sel.has(m.id) ? 'picked' : ''}" id="m-${m.id}" data-mid="${m.id}">
      ${mine ? '' : `<div class="who" style="color:${m.colour}">${m.emoji} ${esc(m.name)}</div>`}
      ${m.reply_to ? `<div class="quote" data-goto="${m.reply_to}"><strong>${esc(m.reply_name || '')}</strong>${m.reply_name ? '<br>' : ''}${m.reply_deleted || !m.reply_name ? '<i>message deleted</i>' : m.reply_photo && !m.reply_text ? mediaWord(m.reply_photo) : esc((m.reply_text || '').slice(0, 90))}</div>` : ''}
      ${m.deleted ? '<i class="muted">🚫 message deleted</i>' : `${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}
      ${m.photo_key ? mediaHtml(m.photo_key) : ''}
      ${m.card ? cardHtml(m) : ''}`}
      <div class="time">${isPinned(m.id) ? '📌 ' : ''}${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}${mine && !m.deleted ? ' ' + ticks(m) : ''}</div>
      ${chips ? `<div class="rxs">${chips}</div>` : ''}
    </div>`;
}

// a chat attachment: photo (p/…), voice note (a/…) or video clip (v/…)
const mediaKind = (k) => ({ a: 'audio', v: 'video' }[(k || '')[0]] || 'photo');
const mediaWord = (k) => ({ audio: '🎤 Voice note', video: '🎥 Video', photo: '📷 Photo' }[mediaKind(k)]);
function mediaHtml(k) {
  const src = esc(photoUrl(k));
  if (mediaKind(k) === 'audio') return `<audio class="voice" controls preload="metadata" src="${src}"></audio>`;
  if (mediaKind(k) === 'video') return `<video class="clip" controls playsinline preload="metadata" src="${src}#t=0.1"></video>`;
  return `<img src="${src}" loading="lazy" alt="photo" data-big="${esc(k)}">`;
}

const CARD_ICON = { task: '🧹', supper: '🍽️', event: '📅', recipe: '📖', day: '🗓️', poll: '📊' };
function cardHtml(m) {
  const c = m.card;
  if (c.type === 'poll') {
    const votes = C7.votes[m.id] || {};
    const total = Object.values(votes).reduce((s, v) => s + v.length, 0);
    const best = Math.max(0, ...Object.values(votes).map((v) => v.length));
    const sub = c.task ? `🧹 ${esc(c.task.title)}${isYmd(c.date) ? ' · due ' + short(c.date) : ''}` : c.event ? `📅 ${esc(c.event.title)}` : isYmd(c.date) ? short(c.date) : '';
    return `<div class="card-msg poll"><div><strong>📊 ${esc(c.q)}</strong>${sub ? `<div class="muted">${sub}</div>` : ''}</div>
      ${c.options.map((o, i) => {
        const who = votes[i] || []; const pct = total ? Math.round((who.length / total) * 100) : 0;
        const mine = who.some((w) => w.user_id === S.me.id);
        return `<button class="opt ${mine ? 'mine' : ''}" data-vote="${m.id}" data-opt="${i}"><span class="bar2" style="width:${pct}%"></span>
          <span class="lbl">${mine ? '✔ ' : ''}${esc(o.label)}</span><span class="cnt">${who.map((w) => w.emoji).join('')} ${who.length || ''}</span></button>
          ${isYmd(c.date) && o.recipe_id && who.length && who.length === best && can('edit_menu') ? `<button class="btn small" data-setsup="${esc(o.recipe_id)}" data-date="${c.date}">✅ Make "${esc(o.label)}" supper for ${short(c.date)}</button>` : ''}
          ${c.task && o.user_id && who.length && who.length === best && can('assign_tasks') ? `<button class="btn small" data-givetask="${m.id}" data-opt="${i}">🧹 Give "${esc(c.task.title)}" to ${esc(o.label)}</button>` : ''}
          ${c.event && isYmd(o.date) && who.length && who.length === best && can('edit_calendar') ? `<button class="btn small" data-addevent="${m.id}" data-opt="${i}">📅 Put "${esc(c.event.title)}" on ${esc(o.label)}</button>` : ''}`;
      }).join('')}
      <div class="muted">${total} vote${total === 1 ? '' : 's'} · tap to vote</div></div>`;
  }
  const link = typeof c.link === 'string' && /^#[\w\/.\-]*$/.test(c.link) ? c.link : '#calendar'; // only pages inside the Nest
  return `<a class="card-msg" href="${esc(link)}"><span class="ci">${CARD_ICON[c.type] || '📌'}</span>
    <span class="grow"><strong>${esc(c.title || '')}</strong>${c.sub ? `<br><span class="muted">${esc(c.sub)}</span>` : ''}</span><span class="go">Open ›</span></a>`;
}

function drawAll() {
  const box = $('#chat'); if (!box) return;
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  box.innerHTML = C7.msgs.length ? C7.msgs.map((m, i) => bubble(m, C7.msgs[i - 1])).join('') : '<div class="empty">Say hi to the family 👋</div>';
  wireBubbles();
  if (atBottom) window.scrollTo(0, document.body.scrollHeight);
}

function wireBubbles() {
  $$('[data-rx]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); whoReacted(Number(b.dataset.rx)); });
  $$('.card-msg a, a.card-msg').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('[data-vote]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const id = Number(b.dataset.vote), opt = Number(b.dataset.opt);
    const v = (C7.votes[id] = C7.votes[id] || {});
    const had = Object.keys(v).find((k) => v[k].some((w) => w.user_id === S.me.id));
    Object.keys(v).forEach((k) => { v[k] = v[k].filter((w) => w.user_id !== S.me.id); if (!v[k].length) delete v[k]; });
    if (had === undefined || Number(had) !== opt) (v[opt] = v[opt] || []).push({ user_id: S.me.id, emoji: S.me.emoji, name: S.me.name });
    drawAll();
    try { await api(`chat/${id}/vote`, { body: { opt } }); } catch (err) { toast(err.message); }
  });
  // winning task / schedule option → a grown-up turns it into a real task or calendar event
  $$('[data-givetask]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const m = C7.msgs.find((x) => x.id === Number(b.dataset.givetask)); const c = m?.card; const o = c?.options?.[Number(b.dataset.opt)];
    if (!c?.task || !o?.user_id) return;
    try {
      await api('tasks', { body: { title: c.task.title, area: c.task.area, assignee: o.user_id, due_date: isYmd(c.date) ? c.date : todayStr() } });
      toast('Task given ✅'); await sendMsg(null, `🧹 ${o.label} is doing: ${c.task.title}`);
    } catch (err) { toast(err.message); }
  });
  $$('[data-addevent]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const m = C7.msgs.find((x) => x.id === Number(b.dataset.addevent)); const c = m?.card; const o = c?.options?.[Number(b.dataset.opt)];
    if (!c?.event || !isYmd(o?.date)) return;
    try {
      await api('events', { body: { title: c.event.title, category: 'family', start_date: o.date, start_time: isHm(o.time) ? o.time : null, remind: 'day_before' } });
      toast('On the calendar 📅'); await sendMsg(null, `📅 ${c.event.title} is on ${o.label}`);
    } catch (err) { toast(err.message); }
  });
  $$('[data-setsup]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    await put('menu', { date: b.dataset.date, meal: 's', recipe_id: b.dataset.setsup });
    toast('Supper set ✅'); await sendMsg(null, `✅ Supper for ${short(b.dataset.date)} is set: ${b.textContent.match(/"(.+)"/)?.[1] || ''}`);
  });
  $$('[data-goto]').forEach((q) => q.onclick = (e) => {
    e.stopPropagation();
    const t = $('#m-' + q.dataset.goto);
    if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1400); }
  });
  $$('[data-big]').forEach((img) => img.onclick = (e) => {
    e.stopPropagation();
    const m = C7.msgs.find((x) => x.photo_key === img.dataset.big);
    lightbox([{ photo_key: img.dataset.big, caption: m?.text, date: (m?.created_at || '').slice(0, 10) || todayStr(), kind: 'memory', name: m?.name, emoji: m?.emoji, user_id: m?.user_id, slideshow: 0, id: 0 }], 0);
    setTimeout(() => {
      $$('.lightbox [data-ss], .lightbox [data-cap], .lightbox [data-del]').forEach((x) => x.remove());
      if (m && (m.user_id === S.me.id || S.me.is_admin)) {
        const lb = $('.lightbox') || document.body.lastElementChild;
        const b = document.createElement('button'); b.className = 'btn small danger'; b.textContent = '🗑️ Delete for everyone';
        b.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999';
        b.onclick = async (ev) => { ev.stopPropagation(); if (!confirm('Delete this photo from the chat for everyone?')) return;
          await deleteForAll([m.id]); b.remove(); (lb && lb !== document.body ? lb : null)?.remove(); $$('.sheet, .lightbox').forEach((x) => x.remove()); };
        (lb || document.body).appendChild(b);
      }
    }, 0);
  });
  // tap (or press and hold) a message for the action menu
  if (C7.sel) {
    $$('.msg[data-mid]').forEach((el) => el.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = Number(el.dataset.mid); C7.sel.has(id) ? C7.sel.delete(id) : C7.sel.add(id);
      el.classList.toggle('picked', C7.sel.has(id)); selBar();
    });
    return;
  }
  $$('.msg[data-mid]').forEach((el) => {
    let t;
    el.oncontextmenu = (e) => { e.preventDefault(); actions(Number(el.dataset.mid)); };
    let x0 = null, y0 = null, dx = 0;
    el.addEventListener('touchstart', (e) => { if (e.target.closest('audio, video')) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; t = setTimeout(() => actions(Number(el.dataset.mid)), 500); }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      clearTimeout(t);
      if (x0 === null) return;
      dx = e.touches[0].clientX - x0;
      if (Math.abs(e.touches[0].clientY - y0) > 30) { x0 = null; el.style.transform = ''; return; }
      if (dx > 0) el.style.transform = `translateX(${Math.min(dx, 80)}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      clearTimeout(t); el.style.transform = '';
      if (x0 !== null && dx > 60) { const m = C7.msgs.find((x) => x.id === Number(el.dataset.mid)); if (m && !m.deleted) startReply(m); }
      x0 = null;
    });
    // desktop: click opens the menu (phones use press-and-hold / swipe)
    el.onclick = (e) => { if (e.target.closest('audio, video')) return; if (!('ontouchstart' in window)) actions(Number(el.dataset.mid)); };
  });
}

function actions(id) {
  const m = C7.msgs.find((x) => x.id === id); if (!m || m.deleted) return;
  $$('.msg-menu').forEach((x) => x.remove());
  const menu = document.createElement('div');
  menu.className = 'msg-menu';
  menu.innerHTML = `<div class="quick">${QUICK.map((e) => `<button data-q="${e}">${e}</button>`).join('')}<button data-more title="More emoji">＋</button></div>
    <div class="acts"><button data-reply>↩️ Reply</button>${Object.keys(C7.reactions[id] || {}).length ? '<button data-who>👀 Reactions</button>' : ''}${m.user_id === S.me.id ? '<button data-seen>👁 Seen by</button>' : ''}<button data-pin>${isPinned(id) ? '📌 Unpin' : '📌 Pin'}</button>${m.text ? '<button data-copy>📋 Copy</button>' : ''}${m.user_id === S.me.id || S.me.is_admin ? '<button data-delm>🗑️ Delete for everyone</button>' : ''}${S.me.is_admin ? '<button data-sel>☑️ Select</button>' : ''}<button data-close>✕</button></div>`;
  document.body.appendChild(menu);
  const el = $('#m-' + id); const r = el.getBoundingClientRect();
  menu.style.top = Math.max(60, Math.min(window.innerHeight - 140, r.top - 100)) + 'px';
  $$('[data-q]', menu).forEach((b) => b.onclick = () => { menu.remove(); react(id, b.dataset.q); });
  $('[data-more]', menu).onclick = () => { menu.remove(); emojiPicker((e) => react(id, e)); };
  $('[data-reply]', menu).onclick = () => { menu.remove(); startReply(m); };
  $('[data-who]', menu) && ($('[data-who]', menu).onclick = () => { menu.remove(); whoReacted(id); });
  $('[data-seen]', menu) && ($('[data-seen]', menu).onclick = () => { menu.remove(); seenBy(m); });
  $('[data-pin]', menu).onclick = async () => { menu.remove(); try { const r = await api(`chat/${id}/pin`, { body: {} }); toast(r.pinned ? 'Pinned 📌' : 'Unpinned'); await refresh(); } catch (e) { toast(e.message); } };
  $('[data-copy]', menu) && ($('[data-copy]', menu).onclick = async () => { menu.remove(); try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { /* no clipboard */ } });
  $('[data-delm]', menu) && ($('[data-delm]', menu).onclick = async () => { menu.remove(); if (!confirm(`Delete this ${m.photo_key ? { audio: 'voice note', video: 'video', photo: 'photo' }[mediaKind(m.photo_key)] : 'message'} for everyone?`)) return; await deleteForAll([id]); });
  $('[data-sel]', menu) && ($('[data-sel]', menu).onclick = () => { menu.remove(); startSelect(id); });
  $('[data-close]', menu).onclick = () => menu.remove();
  setTimeout(() => document.addEventListener('click', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', off); } }), 0);
}

async function react(id, emoji) {
  const mine = (C7.reactions[id]?.[emoji] || []).some((w) => w.user_id === S.me.id);
  const list = (C7.reactions[id] = C7.reactions[id] || {});
  list[emoji] = mine ? (list[emoji] || []).filter((w) => w.user_id !== S.me.id) : [...(list[emoji] || []), { user_id: S.me.id, name: S.me.name }];
  if (!list[emoji].length) delete list[emoji];
  drawAll();
  try { await api(`chat/${id}/react`, { body: { emoji } }); } catch (e) { toast(e.message); }
}

// who reacted to a message, like WhatsApp: everyone with their emoji; tap your own to take it back
function whoReacted(id) {
  const list = Object.entries(C7.reactions[id] || {}).flatMap(([e, who]) => who.map((w) => ({ e, ...w })));
  if (!list.length) return;
  const counts = Object.entries(C7.reactions[id]).map(([e, who]) => `${esc(e)} ${who.length}`).join(' · ');
  const s = sheet(`<div class="spread"><h2 style="margin:0">Reactions</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="muted" style="margin:4px 0 8px">${list.length} reaction${list.length > 1 ? 's' : ''} · ${counts}</div>
    <div class="card">${list.map((r) => { const u = user(r.user_id); const mine = r.user_id === S.me.id; return `<div class="item rx-who" ${mine ? `data-unrx="${esc(r.e)}"` : ''}>
      <div class="thumb">${u.emoji || '🙂'}</div><div class="grow"><div class="nm">${esc(mine ? 'You' : r.name || u.name)}</div>${mine ? '<div class="muted">Tap to remove</div>' : ''}</div>
      <div style="font-size:1.6rem">${esc(r.e)}</div></div>`; }).join('')}</div>`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-unrx]', s).forEach((el) => el.onclick = () => { s.remove(); react(id, el.dataset.unrx); });
}

function startReply(m) {
  C7.replyTo = m;
  $('#c-reply').hidden = false;
  $('#c-reply').innerHTML = `<div class="grow"><strong>↩️ Replying to ${esc(m.name)}</strong><br><span class="muted">${m.text ? esc(m.text.slice(0, 80)) : m.photo_key ? mediaWord(m.photo_key) : ''}</span></div><button class="btn small ghost" id="c-rx">✕</button>`;
  $('#c-rx').onclick = () => { C7.replyTo = null; $('#c-reply').hidden = true; };
  $('#c-text').focus();
}

function emojiPicker(onPick) {
  const s = sheet(`<div class="spread"><h2 style="margin:0">Emoji</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="tabs" style="margin-top:8px">${Object.keys(EMOJI).map((k, i) => `<a href="#" data-et="${i}" class="${i === 0 ? 'on' : ''}">${k.split(' ')[0]}</a>`).join('')}</div>
    <div class="emoji-grid" id="eg"></div>`);
  const show = (i) => {
    $('#eg', s).innerHTML = Object.values(EMOJI)[i].split(' ').map((e) => `<button data-em="${e}">${e}</button>`).join('');
    $$('[data-et]', s).forEach((a) => a.classList.toggle('on', a.dataset.et == i));
    $$('[data-em]', s).forEach((b) => b.onclick = () => { onPick(b.dataset.em); if (!s.dataset.multi) s.remove(); });
  };
  $$('[data-et]', s).forEach((a) => a.onclick = (e) => { e.preventDefault(); show(Number(a.dataset.et)); });
  $('[data-close]', s).onclick = () => s.remove();
  show(0);
  return s;
}

// attachments: camera, phone gallery (several at once) or the Nest's family photos
function attachMenu() {
  const s = sheet(`<div class="spread"><h2 style="margin:0">Send a photo</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="hub" style="margin-top:10px">
      <a href="#" data-src="camera"><span class="i">📷</span><strong>Camera</strong><span class="muted">Take a photo now</span></a>
      <a href="#" data-src="gallery"><span class="i">🖼️</span><strong>Phone gallery</strong><span class="muted">Pick one or more</span></a>
      <a href="#" data-src="video"><span class="i">🎥</span><strong>Video</strong><span class="muted">Record or pick a short clip (max 50 MB)</span></a>
      <a href="#" data-src="nest"><span class="i">📸</span><strong>Family photos</strong><span class="muted">From the Nest's gallery</span></a>
      <a href="#" data-src="share"><span class="i">📌</span><strong>Share from the Nest</strong><span class="muted">A task, supper, event or recipe</span></a>
      <a href="#" data-src="poll"><span class="i">📊</span><strong>Ask the family</strong><span class="muted">Poll: supper, who does a task, when suits everyone…</span></a>
    </div>`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-src]', s).forEach((a) => a.onclick = async (e) => {
    e.preventDefault(); s.remove();
    if (a.dataset.src === 'nest') return nestPicker();
    if (a.dataset.src === 'share') return sharePicker();
    if (a.dataset.src === 'poll') return pollMaker();
    if (a.dataset.src === 'video') return pickVideo();
    const files = await new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      if (a.dataset.src === 'camera') inp.capture = 'environment'; else inp.multiple = true; // eslint-disable-line
      inp.onchange = () => res([...inp.files]); inp.click();
    });
    if (files.length) photoPreview(files);
  });
}
function pickPhotos(camera) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (camera) inp.capture = 'environment'; else inp.multiple = true;
    inp.onchange = () => res([...inp.files]); inp.click();
  });
}
// preview the photo(s), add a caption, then send — like WhatsApp
function photoPreview(files) {
  const urls = files.map((f) => URL.createObjectURL(f));
  const s = sheet(`<div class="spread"><h2 style="margin:0">Send ${files.length > 1 ? files.length + ' photos' : 'photo'}</h2><button class="btn small ghost" data-close>✕</button></div>
    <div class="pv">${urls.map((u) => `<img src="${u}" alt="">`).join('')}</div>
    <div class="row" style="margin-top:10px"><input type="text" id="pv-cap" placeholder="Add a caption…" class="grow"><button class="btn send-round" id="pv-send">➤</button></div>`);
  const close = () => { s.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  $('[data-close]', s).onclick = close;
  $('#pv-send', s).onclick = async () => {
    const cap = $('#pv-cap', s).value.trim();
    close();
    Up.total = files.length;
    for (let i = 0; i < files.length; i++) {
      try { const key = await uploadPhoto(files[i]); await sendMsg(key, i === 0 ? cap : ''); }
      catch (err) { toast(err.message); break; }
    }
  };
  setTimeout(() => $('#pv-cap', s)?.focus(), 100);
}
async function nestPicker() {
  const list = await api('gallery?limit=200');
  if (!list.length) return toast('No family photos yet. Add some in Family → Photos.');
  const picked = new Set();
  const s = sheet(`<div class="spread"><h2 style="margin:0">Family photos</h2><button class="btn small ghost" data-close>Close</button></div>
    <input type="search" id="np-find" placeholder="🔍 Search captions, suppers, who, month…" style="margin:6px 0">
    <p class="muted">Tap photos to pick them, then send.</p>
    <div class="pins" id="np-pins">${list.map((p) => `<div class="pin" data-np="${esc(p.photo_key)}" data-find="${esc([p.caption, p.recipe_name, p.name, p.kind === 'meal' ? 'supper' : p.kind, p.date, nice(p.date, { month: 'long', year: 'numeric' })].filter(Boolean).join(' '))}"><img src="${photoUrl(p.photo_key)}" loading="lazy" alt=""><span>${esc(p.caption || p.recipe_name || short(p.date))}</span></div>`).join('')}</div>
    <button class="btn" style="width:100%;margin-top:10px;position:sticky;bottom:0" id="np-send" disabled>Send</button>`);
  $('[data-close]', s).onclick = () => s.remove();
  filterRows($('#np-find', s), $('#np-pins', s), '.pin');
  $$('[data-np]', s).forEach((el) => el.onclick = () => {
    const k = el.dataset.np; picked.has(k) ? picked.delete(k) : picked.add(k);
    el.classList.toggle('picked', picked.has(k));
    $('#np-send', s).disabled = !picked.size; $('#np-send', s).textContent = picked.size ? `Send ${picked.size} photo${picked.size > 1 ? 's' : ''}` : 'Send';
  });
  $('#np-send', s).onclick = async () => { s.remove(); for (const k of picked) await sendMsg(k); };
}

// delete for everyone (your own, or anything if you're the admin) — gone from every phone on its next refresh
async function deleteForAll(ids) {
  try {
    if (ids.length === 1) await del('chat/' + ids[0]); else await api('chat/delete', { body: { ids } });
    C7.msgs = C7.msgs.filter((x) => !ids.includes(x.id));
    toast(ids.length > 1 ? `${ids.length} deleted for everyone` : 'Deleted for everyone');
    drawAll();
  } catch (e) { toast(e.message); }
}
// admin: pick several messages / photos and delete them in one go
function startSelect(first) {
  C7.sel = new Set(first ? [first] : []);
  drawAll(); selBar();
}
function selBar() {
  let bar = $('#sel-bar');
  if (!C7.sel) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'sel-bar'; bar.className = 'sel-bar'; document.body.appendChild(bar); }
  const n = C7.sel.size;
  bar.innerHTML = `<button class="btn small ghost" id="sel-x">✕ Cancel</button><strong class="grow">${n} selected</strong>
    <button class="btn small ghost" id="sel-photos">📷 All photos</button><button class="btn small danger" id="sel-del" ${n ? '' : 'disabled'}>🗑️ Delete</button>`;
  $('#sel-x', bar).onclick = () => { C7.sel = null; selBar(); drawAll(); };
  $('#sel-photos', bar).onclick = () => { C7.msgs.filter((x) => x.photo_key).forEach((x) => C7.sel.add(x.id)); drawAll(); selBar(); };
  $('#sel-del', bar).onclick = async () => {
    if (!confirm(`Delete ${n} message${n > 1 ? 's' : ''} for everyone? This can't be undone.`)) return;
    const ids = [...C7.sel]; C7.sel = null; selBar(); await deleteForAll(ids);
  };
}

async function sendMsg(photo_key, textOverride, card) {
  const text = textOverride ?? (photo_key || card ? '' : $('#c-text').value.trim());
  if (!photo_key && !card && textOverride === undefined && !text) return;
  if (!text && !photo_key && !card) return;
  const typed = !photo_key && textOverride === undefined && !card;
  if (typed && C7.busy) return; // already sending what's in the box
  const reply_to = C7.replyTo?.id || null;
  const client_id = newCid(); // the server posts each of these once, even if the phone sends it twice
  if (typed) { $('#c-text').value = ''; C7.busy = true; }
  if (C7.replyTo) { C7.replyTo = null; $('#c-reply').hidden = true; }
  try {
    let tries = 0;
    for (;;) {
      try { await api('chat', { body: { text, photo_key, reply_to, card, client_id } }); break; }
      catch (e) {
        // weak signal: try again with the same id (it can't double up); give up after 3 tries
        if (++tries >= 3 || /log in|Empty|Unknown|poll/i.test(e.message)) { if (typed && !$('#c-text').value) $('#c-text').value = text; throw e; }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (e) { toast(e.message); return; }
  finally { if (typed) C7.busy = false; }
  await refresh();
  window.scrollTo(0, document.body.scrollHeight);
}

async function refresh(full = false) {
  if (!location.hash.startsWith('#chat')) return;
  try {
    const first = C7.msgs[0]?.id || 0;
    const d = full ? await api('chat') : await api(`chat?after=${C7.last}&since=${first}`);
    if (full) C7.msgs = d.messages;
    else {
      const have = new Set(C7.msgs.map((x) => x.id));
      d.messages.forEach((m) => { if (!have.has(m.id)) { C7.msgs.push(m); have.add(m.id); } });
      // deleted for everyone → gone here too
      if (Array.isArray(d.ids)) { const keep = new Set(d.ids); C7.msgs = C7.msgs.filter((x) => x.id < (d.from || 0) || keep.has(x.id)); }
    }
    C7.msgs.sort((a, b) => a.id - b.id);
    // one gentle ping per new message from someone else (the phone notification is handled by the badge check)
    const newest = [...C7.msgs].reverse().find((m) => m.user_id !== S.me.id && !m.deleted);
    if (window.Alerts && newest) {
      if (document.hidden) { /* badge check sends the phone notification */ }
      else Alerts.chatAlert({ id: newest.id, name: newest.name, body: newest.text || (newest.photo_key ? '📷 Photo' : '📌 Shared something') }, true);
    }
    C7.reactions = d.reactions; C7.votes = d.votes || {}; C7.reads = d.reads || []; C7.people = d.people || 3; C7.pins = d.pins || [];
    drawPins();
    C7.last = C7.msgs.length ? C7.msgs[C7.msgs.length - 1].id : 0;
    drawAll();
  } catch { /* offline */ }
}

ROUTES.chat = async () => {
  const d = await api('chat');
  C7.msgs = d.messages; C7.reactions = d.reactions; C7.votes = d.votes || {}; C7.reads = d.reads || []; C7.people = d.people || 3; C7.last = C7.msgs.length ? C7.msgs[C7.msgs.length - 1].id : 0; C7.replyTo = null; C7.sel = null; selBar();
  if (window.Alerts && C7.last) Alerts.markChat(C7.last); // opening the chat counts as seeing everything
  $('#chat-n').hidden = true;
  $('#view').innerHTML = `<div class="wa-head"><img src="/icon.svg" alt=""><div><strong>Stewart family</strong>
      <div class="muted">${S.users.map((u) => esc(u.name)).join(', ')}</div></div><button class="btn small ghost" id="c-find" style="margin-left:auto" title="Search the chat">🔍</button>${S.me.is_admin ? '<button class="btn small ghost" id="c-select" title="Select messages to delete">☑️ Select</button>' : ''}</div>
    <div id="c-pins"></div>
    <div class="chat wa" id="chat"></div>
    <div class="composer wa">
      <div class="reply-bar" id="c-reply" hidden></div>
      <div class="row">
        <div class="wa-input grow">
          <button id="c-emo" title="Emoji">😊</button>
          <input type="text" id="c-text" placeholder="Message" autocomplete="off">
          <button id="c-att" title="Attach">📎</button>
          <button id="c-cam" title="Camera">📷</button>
          <button id="c-mic" title="Voice note">🎤</button>
        </div>
        <button class="btn send-round" id="c-send" title="Send">➤</button></div></div>`;
  document.body.classList.add('chat-mode');
  drawAll();
  window.scrollTo(0, document.body.scrollHeight);
  clearInterval(P2.chatTimer); clearInterval(C7.timer);
  C7.timer = setInterval(() => (location.hash.startsWith('#chat') ? refresh() : clearInterval(C7.timer)), 4000);
  $('#c-send').onclick = () => sendMsg();
  $('#c-text').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && !e.repeat) { e.preventDefault(); sendMsg(); } };
  $('#c-select') && ($('#c-select').onclick = () => startSelect());
  $('#c-find').onclick = chatSearch;
  drawPins();
  $('#c-att').onclick = attachMenu;
  $('#c-mic').onclick = recordVoice;
  $('#c-cam').onclick = async () => { const f = await pickPhotos(true); if (f.length) photoPreview(f); };
  $('#c-emo').onclick = () => {
    const inp = $('#c-text');
    const s = emojiPicker((e) => {
      const p = inp.selectionStart ?? inp.value.length;
      inp.value = inp.value.slice(0, p) + e + inp.value.slice(inp.selectionEnd ?? p);
      inp.selectionStart = inp.selectionEnd = p + e.length;
    });
    s.dataset.multi = '1'; // keep open to add several
  };
};


// ---------- share a task / supper / event / recipe as a card ----------
async function sharePicker(tab = 'supper') {
  const today = todayStr();
  const s = sheet(`<div class="spread"><h2 style="margin:0">📌 Share from the Nest</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="tabs" style="margin-top:8px">${[['supper', '🍽️ Supper'], ['task', '🧹 Task'], ['event', '📅 Event'], ['recipe', '📖 Recipe']].map(([k, l]) => `<a href="#" data-st="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${tab === 'recipe' ? '' : `<input type="search" id="sh-find" placeholder="🔍 Search ${{ supper: 'suppers (next 4 weeks)', task: 'tasks or people', event: 'events (next 3 months)' }[tab]}…" style="margin-top:8px">`}
    <div id="sh-body"><div class="empty">Loading…</div></div>
    <label class="f">Add a message (optional)</label><input type="text" id="sh-text" placeholder="e.g. Is this OK for tonight?">`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-st]', s).forEach((a) => a.onclick = (e) => { e.preventDefault(); s.remove(); sharePicker(a.dataset.st); });
  const send = async (card) => { const t = $('#sh-text', s).value.trim(); s.remove(); await sendMsg(null, t, card); };
  const body = $('#sh-body', s);
  if (tab === 'supper') {
    const days = Array.from({ length: 28 }, (_, i) => addDays(today, i));
    // one call for the whole range instead of one per day
    const rows = await api(`menu?from=${days[0]}&to=${days[days.length - 1]}`);
    const names = Object.fromEntries((await api('recipes')).map((r) => [r.id, r]));
    const supperOn = (d) => { const m = rows.find((x) => x.date === d && x.meal === 's'); const r = m && names[m.recipe_id]; return r ? { name: r.name, use_backup: m.use_backup, backup_name: m.use_backup && names[r.rain_backup]?.name } : null; };
    body.innerHTML = `<div class="card">${days.map((d, i) => {
      const sup = supperOn(d);
      const name = sup ? (sup.use_backup && sup.backup_name ? sup.backup_name : sup.name) : 'Nothing planned';
      return `<div class="item" data-sd="${d}" data-sn="${esc(name)}"><div class="thumb">🍽️</div><div class="grow"><div class="nm">${esc(name)}</div><div class="muted">${i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : nice(d)}</div></div></div>`;
    }).join('')}</div>`;
    $$('[data-sd]', body).forEach((el) => el.onclick = () => send({ type: 'supper', title: el.dataset.sn, sub: `Supper ${el.dataset.sd === today ? 'tonight' : 'on ' + nice(el.dataset.sd)}`, link: '#day/' + el.dataset.sd, date: el.dataset.sd }));
  }
  if (tab === 'task') {
    const t = await api(`tasks?date=${today}&today=${today}`);
    const open = t.tasks.filter((x) => !x.done_at && x.routine !== 'morning');
    body.innerHTML = `<div class="card">${open.map((x) => `<div class="item" data-tk="${x.id}"><div class="thumb">🧹</div><div class="grow"><div class="nm">${esc(x.title)}</div>
      <div class="muted">${esc(x.assignee_name)} · ${esc(x.area)}${x.late_days ? ` · ${x.late_days} day${x.late_days > 1 ? 's' : ''} late` : ''}</div></div></div>`).join('') || '<div class="empty">No open tasks 🎉</div>'}</div>`;
    $$('[data-tk]', body).forEach((el) => el.onclick = () => { const x = open.find((y) => y.id == el.dataset.tk); send({ type: 'task', title: x.title, sub: `For ${x.assignee_name} · ${x.area}${x.late_days ? ` · ${x.late_days} day${x.late_days > 1 ? 's' : ''} late` : ''}`, link: x.assignee === S.me.id ? '#today' : '#tasks' }); });
  }
  if (tab === 'event') {
    const ev = (await api(`events?from=${today}&to=${addDays(today, 90)}`)).occurrences.filter((o) => !o.quiet && o.category !== 'term' && (!o.layer || (S.me.prefs && S.me.prefs[o.layer])));
    body.innerHTML = `<div class="card">${ev.slice(0, 150).map((o, i) => `<div class="item" data-ev="${i}"><div class="thumb">📅</div><div class="grow"><div class="nm">${esc(o.title)}</div><div class="muted">${nice(o.date)}${o.start_time ? ' · ' + o.start_time : ''}</div></div></div>`).join('') || '<div class="empty">Nothing coming up</div>'}</div>`;
    $$('[data-ev]', body).forEach((el) => el.onclick = () => { const o = ev[el.dataset.ev]; send({ type: 'event', title: o.title, sub: nice(o.date) + (o.start_time ? ' · ' + o.start_time : ''), link: '#day/' + o.date }); });
  }
  if (tab === 'recipe') {
    const cat = await api('catalog');
    const list = cat.recipes.filter((r) => r.active && !r.name.startsWith('Rain plan:') && r.meal !== 'x');
    body.innerHTML = `<input type="text" id="sh-q" placeholder="Search recipes…" style="margin:8px 0"><div class="card" id="sh-list"></div>`;
    const draw = (f = '') => {
      $('#sh-list', body).innerHTML = list.filter((r) => r.name.toLowerCase().includes(f.toLowerCase())).slice(0, 40).map((r) => `<div class="item" data-rc2="${r.id}"><div class="thumb">📖</div><div class="grow"><div class="nm">${esc(r.name)}</div><div class="muted">${R(r.cost)} per meal</div></div></div>`).join('');
      $$('[data-rc2]', body).forEach((el) => el.onclick = () => { const r = list.find((x) => x.id === el.dataset.rc2); send({ type: 'recipe', title: r.name, sub: `Recipe · about ${R(r.cost)} per meal`, link: '#recipes' }); });
    };
    $('#sh-q', body).oninput = (e) => draw(e.target.value); draw();
  }
  if ($('#sh-find', s)) { filterRows($('#sh-find', s), body, '.item'); $('#sh-find', s).focus(); }
}

// ---------- quick poll ----------
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isHm = (v) => /^\d\d:\d\d$/.test(v || '');
// Ask the family: supper (winner becomes supper), task (winner gets the task) or schedule (winner goes on the calendar), or anything else
async function pollMaker(kind = 'supper') {
  const today = todayStr();
  const KINDS = [['supper', '🍽️ Supper'], ['task', '🧹 Task'], ['schedule', '📅 Schedule'], ['other', '💬 Anything']];
  const Q = { supper: 'What should we have for supper?', task: 'Who will do this?', schedule: 'When suits everyone?', other: '' };
  const s = sheet(`<div class="spread"><h2 style="margin:0">📊 Ask the family</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="tabs" style="margin-top:8px">${KINDS.map(([k, l]) => `<a href="#" data-pk="${k}" class="${kind === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <label class="f">Question</label><input type="text" id="pl-q" value="${esc(Q[kind])}" placeholder="e.g. Movie or games tonight?">
    <div id="pl-extra"></div>
    <label class="f">Options (2–6)</label>
    <div id="pl-opts"></div>
    <div id="pl-adders"></div>
    <div class="row" style="margin-top:6px"><input type="text" id="pl-own" placeholder="+ Or type an option" class="grow"><button class="btn small ghost" id="pl-add">Add</button></div>
    <div class="err" id="pl-err"></div>
    <button class="btn" style="width:100%;margin-top:10px" id="pl-send">Send poll</button>`);
  const opts = [];
  const draw = () => {
    $('#pl-opts', s).innerHTML = opts.map((o, i) => `<div class="chip-x" style="margin:3px 4px 0 0">${esc(o.label)}<button data-plx="${i}">✕</button></div>`).join('') || '<div class="muted">No options yet</div>';
    $$('[data-plx]', s).forEach((b) => b.onclick = () => { opts.splice(b.dataset.plx, 1); draw(); });
  };
  const add = (o) => { if (opts.length >= 6) return toast('6 options at most'); if (!opts.some((x) => x.label === o.label)) opts.push(o); draw(); };
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-pk]', s).forEach((a) => a.onclick = (e) => { e.preventDefault(); s.remove(); pollMaker(a.dataset.pk); });
  const extra = $('#pl-extra', s), adders = $('#pl-adders', s);
  let card = () => ({});

  if (kind === 'supper') {
    const cat = await api('catalog');
    const sup = cat.recipes.filter((r) => r.meal === 's' && r.active && !r.name.startsWith('Rain plan:')).sort((a, b) => a.name.localeCompare(b.name));
    extra.innerHTML = `<label class="f">For which day? (a grown-up can then set the winning supper)</label><input type="date" id="pl-d" value="${today}">`;
    adders.innerHTML = `<div class="row" style="margin-top:6px"><select id="pl-pick" class="grow" data-search><option value="">+ Add a supper…</option>${sup.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>`;
    $('#pl-pick', s).onchange = (e) => { const r = sup.find((x) => x.id === e.target.value); if (r) add({ label: r.name, recipe_id: r.id }); e.target.value = ''; };
    card = () => ({ date: $('#pl-d', s).value || null });
  }
  if (kind === 'task') {
    const areas = S.me.areas || ['Kitchen', 'Lounge', 'Yard', 'Other'];
    extra.innerHTML = `<label class="f">The task</label><input type="text" id="pl-tt" placeholder="e.g. Wash the car">
      <div class="row wrap"><div class="grow"><label class="f">Area</label><select id="pl-ta">${areas.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div>
      <div style="width:120px"><label class="f">Due</label><input type="date" id="pl-td" value="${today}"></div></div>`;
    adders.innerHTML = `<div class="muted" style="margin-top:6px">Everyone is an option. Remove anyone who can't. A grown-up can then give the task to the winner.</div>`;
    S.users.filter((u) => u.id).forEach((u) => opts.push({ label: `${u.emoji || ''} ${u.kid_name && S.me.is_child ? u.kid_name : u.name}`.trim(), user_id: u.id }));
    opts.splice(6);
    card = () => { const title = $('#pl-tt', s).value.trim(); return title ? { task: { title, area: $('#pl-ta', s).value }, date: $('#pl-td', s).value || today } : { error: 'Say what the task is' }; };
    $('#pl-tt', s).oninput = () => { if (!$('#pl-q', s).dataset.edited) $('#pl-q', s).value = $('#pl-tt', s).value.trim() ? `Who will ${$('#pl-tt', s).value.trim().replace(/^./, (c) => c.toLowerCase())}?` : Q.task; };
  }
  if (kind === 'schedule') {
    extra.innerHTML = `<label class="f">What is it?</label><input type="text" id="pl-et" placeholder="e.g. Visit Gran, family braai">`;
    adders.innerHTML = `<div class="row" style="margin-top:6px"><input type="date" id="pl-sd" value="${today}" class="grow"><input type="time" id="pl-st" style="width:110px"><button class="btn small ghost" id="pl-sadd">Add time</button></div>`;
    $('#pl-sadd', s).onclick = () => {
      const d = $('#pl-sd', s).value, t = $('#pl-st', s).value;
      if (!isYmd(d)) return toast('Pick a day');
      add({ label: `${short(d)}${t ? ' · ' + t : ''}`, date: d, time: isHm(t) ? t : null });
    };
    card = () => { const title = $('#pl-et', s).value.trim(); return { event: { title: title || $('#pl-q', s).value.trim() } }; };
    $('#pl-et', s).oninput = () => { if (!$('#pl-q', s).dataset.edited) $('#pl-q', s).value = $('#pl-et', s).value.trim() ? `When suits everyone for ${$('#pl-et', s).value.trim()}?` : Q.schedule; };
  }
  $('#pl-q', s).oninput = () => { $('#pl-q', s).dataset.edited = '1'; };
  draw();
  const addOwn = () => { const v = $('#pl-own', s).value.trim(); if (v) { add({ label: v }); $('#pl-own', s).value = ''; } };
  $('#pl-add', s).onclick = addOwn; $('#pl-own', s).onkeydown = (e) => { if (e.key === 'Enter') addOwn(); };
  $('#pl-send', s).onclick = async () => {
    const q = $('#pl-q', s).value.trim();
    const extraCard = card();
    if (extraCard.error) { $('#pl-err', s).textContent = extraCard.error; return; }
    if (!q || opts.length < 2) { $('#pl-err', s).textContent = 'Add a question and at least 2 options'; return; }
    s.remove();
    await sendMsg(null, '', { type: 'poll', kind, q, ...extraCard, options: opts });
  };
}

window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#chat')) document.body.classList.remove('chat-mode'); });

// ---------- video clips ----------
function pickVideo() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'video/*';
  inp.onchange = () => { const f = inp.files[0]; if (f) videoPreview(f); };
  inp.click();
}
function videoPreview(file) {
  if (file.size > MEDIA_MAX_MB.video * 1024 * 1024) return toast(`That video is ${Math.round(file.size / 1048576)} MB. The limit is ${MEDIA_MAX_MB.video} MB: trim it or pick a shorter one.`);
  const url = URL.createObjectURL(file);
  const s = sheet(`<div class="spread"><h2 style="margin:0">Send video</h2><button class="btn small ghost" data-close>✕</button></div>
    <video class="clip" src="${url}" controls playsinline style="width:100%;max-height:50vh;margin-top:8px"></video>
    <div class="row" style="margin-top:10px"><input type="text" id="vv-cap" placeholder="Add a caption…" class="grow"><button class="btn send-round" id="vv-send">➤</button></div>`);
  const close = () => { s.remove(); URL.revokeObjectURL(url); };
  $('[data-close]', s).onclick = close;
  $('#vv-send', s).onclick = async () => {
    const cap = $('#vv-cap', s).value.trim();
    close();
    try { const key = await uploadMedia(file, 'video'); await sendMsg(key, cap); } catch (e) { toast(e.message); }
  };
}

// ---------- voice notes ----------
const VOICE_MAX_SECS = 180;
async function recordVoice() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast(window.isSecureContext ? "This phone's browser can't record voice notes." : 'Voice notes need the secure address (https://stewartza.co.za), not the Wi-Fi address.');
  }
  if ($('.rec-bar')) return; // already recording
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('Allow the microphone for the Nest to send voice notes.'); }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  let send = false, secs = 0;
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const bar = document.createElement('div');
  bar.className = 'rec-bar';
  bar.innerHTML = `<button class="btn small ghost" data-cancel title="Cancel">🗑️</button><span class="dot"></span><span class="t">0:00</span>
    <span class="muted grow">Recording…</span><button class="btn send-round" data-send title="Send">➤</button>`;
  $('.composer').appendChild(bar);
  const tick = setInterval(() => {
    secs++; $('.t', bar).textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (secs >= VOICE_MAX_SECS) { send = true; rec.stop(); }
  }, 1000);
  const cancel = () => { send = false; if (rec.state !== 'inactive') rec.stop(); };
  const finish = () => { clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); bar.remove(); window.removeEventListener('hashchange', cancel); };
  rec.onstop = async () => {
    finish();
    if (!send || !chunks.length) return;
    if (secs < 1) return toast('Too short: record a little longer');
    const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
    try { const key = await uploadMedia(blob, 'audio'); await sendMsg(key, ''); } catch (e) { toast(e.message); }
  };
  $('[data-cancel]', bar).onclick = cancel;
  $('[data-send]', bar).onclick = () => { send = true; rec.stop(); };
  window.addEventListener('hashchange', cancel); // leaving the chat throws the recording away
  rec.start(250);
  navigator.vibrate?.(40);
}

// ---------- pinned messages, search, seen by ----------
const isPinned = (id) => (C7.pins || []).some((p) => p.id === id);
const pinText = (p) => p.text || (p.card ? (p.card.q || p.card.title || '📌 Shared something') : p.photo_key ? mediaWord(p.photo_key) : '');
function jumpTo(id) {
  const t = $('#m-' + id);
  if (!t) return false;
  t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1400);
  return true;
}
function drawPins() {
  const bar = $('#c-pins'); if (!bar) return;
  const pins = C7.pins || [];
  bar.innerHTML = pins.length ? `<button class="pin-bar" id="pin-open"><span>📌</span><span class="grow"><strong>${esc(pins[0].name)}</strong> ${esc(pinText(pins[0]).slice(0, 80))}</span>${pins.length > 1 ? `<span class="muted">+${pins.length - 1}</span>` : ''}</button>` : '';
  $('#pin-open') && ($('#pin-open').onclick = () => {
    if (pins.length === 1 && jumpTo(pins[0].id)) return;
    const s = sheet(`<div class="spread"><h2 style="margin:0">📌 Pinned</h2><button class="btn small ghost" data-close>Close</button></div>
      <div class="card">${pins.map((p) => `<div class="item" data-pj="${p.id}"><div class="grow"><div class="nm">${esc(pinText(p))}</div>
        <div class="muted">${esc(p.name)} · ${new Date(p.created_at + 'Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}${p.pinned_by_name ? ' · pinned by ' + esc(p.pinned_by_name) : ''}</div></div></div>`).join('')}</div>`);
    $('[data-close]', s).onclick = () => s.remove();
    $$('[data-pj]', s).forEach((el) => el.onclick = () => { if (jumpTo(Number(el.dataset.pj))) s.remove(); else toast('That message is older than what is loaded here'); });
  });
}
function chatSearch() {
  const s = sheet(`<div class="spread"><h2 style="margin:0">🔍 Search the chat</h2><button class="btn small ghost" data-close>Close</button></div>
    <input type="search" id="cs-q" placeholder="Type a word, e.g. school, wifi, braai" style="margin-top:8px">
    <div id="cs-res" class="card" style="margin-top:8px"><div class="muted">Searches every message, also old ones.</div></div>`);
  $('[data-close]', s).onclick = () => s.remove();
  let timer;
  $('#cs-q', s).oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 2) { $('#cs-res', s).innerHTML = '<div class="muted">Type at least 2 letters.</div>'; return; }
      try {
        const res = await api('chat/search?q=' + encodeURIComponent(q));
        const mark = (t) => esc(t).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (x) => `<mark>${x}</mark>`);
        $('#cs-res', s).innerHTML = res.map((m) => `<div class="item" data-cj="${m.id}"><div class="grow"><div class="nm">${mark(m.text || pinText(m))}</div>
          <div class="muted">${esc(m.emoji || '')} ${esc(m.name)} · ${new Date(m.created_at + 'Z').toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('') || '<div class="empty">Nothing found</div>';
        $$('[data-cj]', s).forEach((el) => el.onclick = () => { if (jumpTo(Number(el.dataset.cj))) s.remove(); else toast('Older message: shown here only'); });
      } catch (err) { toast(err.message); }
    }, 250);
  };
  setTimeout(() => $('#cs-q', s).focus(), 100);
}
function seenBy(m) {
  const others = S.users.filter((u) => u.id !== S.me.id);
  const read = new Set(C7.reads.filter((r) => r.last_id >= m.id).map((r) => r.user_id));
  const s = sheet(`<div class="spread"><h2 style="margin:0">👁 Seen by</h2><button class="btn small ghost" data-close>Close</button></div>
    <div class="card">${others.map((u) => `<div class="item"><div class="thumb">${esc(u.emoji || '🙂')}</div><div class="grow"><div class="nm">${esc(u.name)}</div></div>
      <div>${read.has(u.id) ? '<span class="tk blue">✓✓</span> seen' : '<span class="muted">not yet</span>'}</div></div>`).join('')}</div>`);
  $('[data-close]', s).onclick = () => s.remove();
}
