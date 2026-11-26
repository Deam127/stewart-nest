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
const C7 = { msgs: [], reactions: {}, votes: {}, reads: [], people: 3, last: 0, replyTo: null, timer: null };
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
  const chips = Object.entries(react).map(([e, who]) => `<button class="rx ${who.some((w) => w.user_id === S.me.id) ? 'mine' : ''}" data-rx="${m.id}" data-e="${e}" title="${esc(who.map((w) => w.name).join(', '))}">${e}${who.length > 1 ? ' ' + who.length : ''}</button>`).join('');
  return `${!prev || dayStr(m) !== dayStr(prev) ? `<div class="day-sep">${dayStr(m)}</div>` : ''}
    <div class="msg ${mine ? 'mine' : ''}" id="m-${m.id}" data-mid="${m.id}">
      ${mine ? '' : `<div class="who" style="color:${m.colour}">${m.emoji} ${esc(m.name)}</div>`}
      ${m.reply_to ? `<div class="quote" data-goto="${m.reply_to}"><strong>${esc(m.reply_name || '')}</strong><br>${m.reply_deleted ? '<i>message deleted</i>' : m.reply_photo && !m.reply_text ? '📷 Photo' : esc((m.reply_text || '').slice(0, 90))}</div>` : ''}
      ${m.deleted ? '<i class="muted">🚫 message deleted</i>' : `${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}
      ${m.photo_key ? `<img src="${photoUrl(m.photo_key)}" loading="lazy" alt="photo" data-big="${m.photo_key}">` : ''}
      ${m.card ? cardHtml(m) : ''}`}
      <div class="time">${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}${mine && !m.deleted ? ' ' + ticks(m) : ''}</div>
      ${chips ? `<div class="rxs">${chips}</div>` : ''}
    </div>`;
}

const CARD_ICON = { task: '🧹', supper: '🍽️', event: '📅', recipe: '📖', day: '🗓️', poll: '📊' };
function cardHtml(m) {
  const c = m.card;
  if (c.type === 'poll') {
    const votes = C7.votes[m.id] || {};
    const total = Object.values(votes).reduce((s, v) => s + v.length, 0);
    const best = Math.max(0, ...Object.values(votes).map((v) => v.length));
    return `<div class="card-msg poll"><div><strong>📊 ${esc(c.q)}</strong>${c.date ? `<div class="muted">${short(c.date)}</div>` : ''}</div>
      ${c.options.map((o, i) => {
        const who = votes[i] || []; const pct = total ? Math.round((who.length / total) * 100) : 0;
        const mine = who.some((w) => w.user_id === S.me.id);
        return `<button class="opt ${mine ? 'mine' : ''}" data-vote="${m.id}" data-opt="${i}"><span class="bar2" style="width:${pct}%"></span>
          <span class="lbl">${mine ? '✔ ' : ''}${esc(o.label)}</span><span class="cnt">${who.map((w) => w.emoji).join('')} ${who.length || ''}</span></button>
          ${c.date && o.recipe_id && who.length && who.length === best && can('edit_menu') ? `<button class="btn small" data-setsup="${o.recipe_id}" data-date="${c.date}">✅ Make "${esc(o.label)}" supper for ${short(c.date)}</button>` : ''}`;
      }).join('')}
      <div class="muted">${total} vote${total === 1 ? '' : 's'} · tap to vote</div></div>`;
  }
  return `<a class="card-msg" href="${esc(c.link || '#calendar')}"><span class="ci">${CARD_ICON[c.type] || '📌'}</span>
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
  $$('[data-rx]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); react(Number(b.dataset.rx), b.dataset.e); });
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
    setTimeout(() => $$('.lightbox [data-ss], .lightbox [data-cap], .lightbox [data-del]').forEach((x) => x.remove()), 0);
  });
  // tap (or press and hold) a message for the action menu
  $$('.msg[data-mid]').forEach((el) => {
    let t;
    el.oncontextmenu = (e) => { e.preventDefault(); actions(Number(el.dataset.mid)); };
    let x0 = null, y0 = null, dx = 0;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; t = setTimeout(() => actions(Number(el.dataset.mid)), 500); }, { passive: true });
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
    el.onclick = () => { if (!('ontouchstart' in window)) actions(Number(el.dataset.mid)); };
  });
}

function actions(id) {
  const m = C7.msgs.find((x) => x.id === id); if (!m || m.deleted) return;
  $$('.msg-menu').forEach((x) => x.remove());
  const menu = document.createElement('div');
  menu.className = 'msg-menu';
  menu.innerHTML = `<div class="quick">${QUICK.map((e) => `<button data-q="${e}">${e}</button>`).join('')}<button data-more title="More emoji">＋</button></div>
    <div class="acts"><button data-reply>↩️ Reply</button>${m.text ? '<button data-copy>📋 Copy</button>' : ''}${m.user_id === S.me.id || S.me.is_admin ? '<button data-delm>🗑️ Delete</button>' : ''}<button data-close>✕</button></div>`;
  document.body.appendChild(menu);
  const el = $('#m-' + id); const r = el.getBoundingClientRect();
  menu.style.top = Math.max(60, Math.min(window.innerHeight - 140, r.top - 100)) + 'px';
  $$('[data-q]', menu).forEach((b) => b.onclick = () => { menu.remove(); react(id, b.dataset.q); });
  $('[data-more]', menu).onclick = () => { menu.remove(); emojiPicker((e) => react(id, e)); };
  $('[data-reply]', menu).onclick = () => { menu.remove(); startReply(m); };
  $('[data-copy]', menu) && ($('[data-copy]', menu).onclick = async () => { menu.remove(); try { await navigator.clipboard.writeText(m.text); toast('Copied'); } catch { /* no clipboard */ } });
  $('[data-delm]', menu) && ($('[data-delm]', menu).onclick = async () => { menu.remove(); if (!confirm('Delete this message for everyone?')) return; await del('chat/' + id); refresh(true); });
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

function startReply(m) {
  C7.replyTo = m;
  $('#c-reply').hidden = false;
  $('#c-reply').innerHTML = `<div class="grow"><strong>↩️ Replying to ${esc(m.name)}</strong><br><span class="muted">${m.text ? esc(m.text.slice(0, 80)) : '📷 Photo'}</span></div><button class="btn small ghost" id="c-rx">✕</button>`;
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
      <a href="#" data-src="nest"><span class="i">📸</span><strong>Family photos</strong><span class="muted">From the Nest's gallery</span></a>
      <a href="#" data-src="share"><span class="i">📌</span><strong>Share from the Nest</strong><span class="muted">A task, supper, event or recipe</span></a>
      <a href="#" data-src="poll"><span class="i">📊</span><strong>Ask the family</strong><span class="muted">Quick poll, e.g. what's for supper?</span></a>
    </div>`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-src]', s).forEach((a) => a.onclick = async (e) => {
    e.preventDefault(); s.remove();
    if (a.dataset.src === 'nest') return nestPicker();
    if (a.dataset.src === 'share') return sharePicker();
    if (a.dataset.src === 'poll') return pollMaker();
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
    <p class="muted">Tap photos to pick them, then send.</p>
    <div class="pins">${list.map((p) => `<div class="pin" data-np="${p.photo_key}"><img src="${photoUrl(p.photo_key)}" loading="lazy" alt=""><span>${esc(p.caption || p.recipe_name || short(p.date))}</span></div>`).join('')}</div>
    <button class="btn" style="width:100%;margin-top:10px;position:sticky;bottom:0" id="np-send" disabled>Send</button>`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-np]', s).forEach((el) => el.onclick = () => {
    const k = el.dataset.np; picked.has(k) ? picked.delete(k) : picked.add(k);
    el.classList.toggle('picked', picked.has(k));
    $('#np-send', s).disabled = !picked.size; $('#np-send', s).textContent = picked.size ? `Send ${picked.size} photo${picked.size > 1 ? 's' : ''}` : 'Send';
  });
  $('#np-send', s).onclick = async () => { s.remove(); for (const k of picked) await sendMsg(k); };
}

async function sendMsg(photo_key, textOverride, card) {
  const text = textOverride ?? (photo_key || card ? '' : $('#c-text').value.trim());
  if (!photo_key && !card && textOverride === undefined && !text) return;
  if (!text && !photo_key && !card) return;
  const reply_to = C7.replyTo?.id || null;
  if (!photo_key && textOverride === undefined && !card) $('#c-text').value = '';
  if (C7.replyTo) { C7.replyTo = null; $('#c-reply').hidden = true; }
  await api('chat', { body: { text, photo_key, reply_to, card } });
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
      d.messages.forEach((m) => { if (!C7.msgs.some((x) => x.id === m.id)) C7.msgs.push(m); });
      // deletions only show up on a full reload; fine for a family chat
    }
    C7.reactions = d.reactions; C7.votes = d.votes || {}; C7.reads = d.reads || []; C7.people = d.people || 3;
    C7.last = C7.msgs.length ? C7.msgs[C7.msgs.length - 1].id : 0;
    drawAll();
  } catch { /* offline */ }
}

ROUTES.chat = async () => {
  const d = await api('chat');
  C7.msgs = d.messages; C7.reactions = d.reactions; C7.votes = d.votes || {}; C7.reads = d.reads || []; C7.people = d.people || 3; C7.last = C7.msgs.length ? C7.msgs[C7.msgs.length - 1].id : 0; C7.replyTo = null;
  $('#chat-n').hidden = true;
  $('#view').innerHTML = `<div class="wa-head"><img src="/icon.svg" alt=""><div><strong>Stewart family</strong>
      <div class="muted">${S.users.map((u) => esc(u.name)).join(', ')}</div></div></div>
    <div class="chat wa" id="chat"></div>
    <div class="composer wa">
      <div class="reply-bar" id="c-reply" hidden></div>
      <div class="row">
        <div class="wa-input grow">
          <button id="c-emo" title="Emoji">😊</button>
          <input type="text" id="c-text" placeholder="Message" autocomplete="off">
          <button id="c-att" title="Attach">📎</button>
          <button id="c-cam" title="Camera">📷</button>
        </div>
        <button class="btn send-round" id="c-send" title="Send">➤</button></div></div>`;
  document.body.classList.add('chat-mode');
  drawAll();
  window.scrollTo(0, document.body.scrollHeight);
  clearInterval(P2.chatTimer); clearInterval(C7.timer);
  C7.timer = setInterval(() => (location.hash.startsWith('#chat') ? refresh() : clearInterval(C7.timer)), 4000);
  $('#c-send').onclick = () => sendMsg();
  $('#c-text').onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
  $('#c-att').onclick = attachMenu;
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
    <div id="sh-body"><div class="empty">Loading…</div></div>
    <label class="f">Add a message (optional)</label><input type="text" id="sh-text" placeholder="e.g. Is this OK for tonight?">`);
  $('[data-close]', s).onclick = () => s.remove();
  $$('[data-st]', s).forEach((a) => a.onclick = (e) => { e.preventDefault(); s.remove(); sharePicker(a.dataset.st); });
  const send = async (card) => { const t = $('#sh-text', s).value.trim(); s.remove(); await sendMsg(null, t, card); };
  const body = $('#sh-body', s);
  if (tab === 'supper') {
    const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));
    const menus = await Promise.all(days.map((d) => api('day?date=' + d)));
    body.innerHTML = `<div class="card">${days.map((d, i) => {
      const sup = menus[i].menu.find((m) => m.meal === 's');
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
    const ev = (await api(`events?from=${today}&to=${addDays(today, 60)}`)).occurrences.filter((o) => !o.quiet && o.category !== 'term' && (!o.layer || (S.me.prefs && S.me.prefs[o.layer])));
    body.innerHTML = `<div class="card">${ev.slice(0, 40).map((o, i) => `<div class="item" data-ev="${i}"><div class="thumb">📅</div><div class="grow"><div class="nm">${esc(o.title)}</div><div class="muted">${nice(o.date)}${o.start_time ? ' · ' + o.start_time : ''}</div></div></div>`).join('') || '<div class="empty">Nothing coming up</div>'}</div>`;
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
}

// ---------- quick poll ----------
async function pollMaker() {
  const today = todayStr();
  const cat = await api('catalog');
  const sup = cat.recipes.filter((r) => r.meal === 's' && r.active && !r.name.startsWith('Rain plan:')).sort((a, b) => a.name.localeCompare(b.name));
  const s = sheet(`<div class="spread"><h2 style="margin:0">📊 Ask the family</h2><button class="btn small ghost" data-close>Close</button></div>
    <label class="f">Question</label><input type="text" id="pl-q" value="What should we have for supper?">
    <label class="f">For which day? (lets a grown-up set the winning supper)</label><input type="date" id="pl-d" value="${today}">
    <label class="f">Options (2–6): pick suppers or type your own</label>
    <div id="pl-opts"></div>
    <div class="row" style="margin-top:6px"><select id="pl-pick" class="grow"><option value="">+ Add a supper…</option>${sup.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:6px"><input type="text" id="pl-own" placeholder="+ Or type an option (e.g. Takeaways 🍕)" class="grow"><button class="btn small ghost" id="pl-add">Add</button></div>
    <div class="err" id="pl-err"></div>
    <button class="btn" style="width:100%;margin-top:10px" id="pl-send">Send poll</button>`);
  const opts = [];
  const draw = () => {
    $('#pl-opts', s).innerHTML = opts.map((o, i) => `<div class="chip-x" style="margin:3px 4px 0 0">${esc(o.label)}<button data-plx="${i}">✕</button></div>`).join('') || '<div class="muted">No options yet</div>';
    $$('[data-plx]', s).forEach((b) => b.onclick = () => { opts.splice(b.dataset.plx, 1); draw(); });
  };
  draw();
  $('[data-close]', s).onclick = () => s.remove();
  $('#pl-pick', s).onchange = (e) => { const r = sup.find((x) => x.id === e.target.value); if (r && opts.length < 6) opts.push({ label: r.name, recipe_id: r.id }); e.target.value = ''; draw(); };
  const addOwn = () => { const v = $('#pl-own', s).value.trim(); if (v && opts.length < 6) { opts.push({ label: v }); $('#pl-own', s).value = ''; draw(); } };
  $('#pl-add', s).onclick = addOwn; $('#pl-own', s).onkeydown = (e) => { if (e.key === 'Enter') addOwn(); };
  $('#pl-send', s).onclick = async () => {
    const q = $('#pl-q', s).value.trim();
    if (!q || opts.length < 2) { $('#pl-err', s).textContent = 'Add a question and at least 2 options'; return; }
    s.remove();
    await sendMsg(null, '', { type: 'poll', q, date: $('#pl-d', s).value || null, options: opts });
  };
}

window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#chat')) document.body.classList.remove('chat-mode'); });
