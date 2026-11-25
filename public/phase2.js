// The Stewart Nest — Phase 2 screens: family hub, chat, fun ideas, Madilea, shop (stock take,
// shopping list & trolley, inventory with barcodes & photos), workouts.
// Uses helpers from app.js ($, $$, esc, api, put, del, toast, S, ROUTES, …).
'use strict';

const R = (n) => 'R' + (Number(n) || 0).toFixed(2);
const thisMonth = () => todayStr().slice(0, 7);
const monthName = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
const addMonths = (ym, n) => { const d = new Date(ym + '-01T00:00:00'); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const photoUrl = (k) => k ? '/api/photos/' + k : '';
const P2 = { chatLast: 0, chatTimer: null, shopTab: 'list', invFilter: '', invSection: '', stockSection: '' };

// ---------- shared: photos & barcodes ----------
// Shrink a phone photo to ~1280px JPEG before uploading (saves data and storage)
async function resizeImage(file, max = 1280) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
}
async function uploadPhoto(file) {
  const blob = await resizeImage(file);
  const r = await fetch('/api/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d.key;
}
function pickPhoto() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
// Scan a barcode with the camera (Chrome on Android supports this). Falls back to typing the number.
async function scanBarcode() {
  const typeIt = () => { const v = prompt('Type the barcode number (under the stripes):'); return v ? v.replace(/\D/g, '') || null : null; };
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return typeIt();
  const box = $('#scanner'), video = $('video', box);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { return typeIt(); }
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
  video.srcObject = stream; box.hidden = false; await video.play();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; stream.getTracks().forEach((t) => t.stop()); box.hidden = true; resolve(v); };
    $('#scan-close').onclick = () => finish(null);
    $('#scan-type').onclick = () => { const v = typeIt(); finish(v); };
    const tick = async () => {
      if (done) return;
      try { const codes = await detector.detect(video); if (codes.length) { navigator.vibrate?.(80); return finish(codes[0].rawValue); } } catch { /* keep trying */ }
      setTimeout(tick, 250);
    };
    tick();
  });
}
function sheet(html) {
  const s = document.createElement('div');
  s.className = 'sheet'; s.innerHTML = `<div>${html}</div>`;
  s.onclick = (e) => { if (e.target === s) s.remove(); };
  document.body.appendChild(s);
  return s;
}

// ---------- badges (chat unread on the nav) ----------
async function pollBadges() {
  if (!S.me) return;
  try {
    const b = await api('badges');
    const onChat = location.hash.startsWith('#chat');
    $('#chat-n').hidden = onChat || !b.chat; $('#chat-n').textContent = b.chat;
    if (!onChat && b.chat > (P2.lastChatBadge || 0) && document.hidden && 'Notification' in window && Notification.permission === 'granted')
      new Notification('The Stewart Nest', { body: `💬 ${b.chat} new message${b.chat > 1 ? 's' : ''} in the family chat`, icon: '/icon.svg' });
    P2.lastChatBadge = b.chat;
  } catch { /* ignore */ }
}
setInterval(pollBadges, 15000);
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#chat')) { clearInterval(P2.chatTimer); P2.chatTimer = null; } pollBadges(); });
setTimeout(pollBadges, 1500);

// ================= family hub =================
ROUTES.hub = async () => {
  const name = S.settings.baby_name || 'Baby';
  $('#view').innerHTML = `<h1>The family</h1>
    <div class="hub">
      <a href="#tasks"><span class="i">🧹</span><strong>Tasks</strong><span class="muted">Give & track chores</span></a>
      <a href="#rewards"><span class="i">🏆</span><strong>Rewards</strong><span class="muted">This week's points</span></a>
      <a href="#workouts"><span class="i">💪</span><strong>Workouts</strong><span class="muted">Plans, logs & streaks</span></a>
      <a href="#fun"><span class="i">🎉</span><strong>Family fun</strong><span class="muted">Ideas & votes</span></a>
      <a href="#madilea"><span class="i">👶</span><strong>${esc(name)}</strong><span class="muted">Countdown, bags & buy list</span></a>
      <a href="#shop/inventory"><span class="i">📦</span><strong>Inventory</strong><span class="muted">Codes, barcodes, photos</span></a>
      <a href="#gallery"><span class="i">📸</span><strong>Photos</strong><span class="muted">Supper pinboard, activities, memories</span></a>
      <a href="#builder"><span class="i">🧑‍🍳</span><strong>Menu builder</strong><span class="muted">Pick next month's meals + budget</span></a>
      <a href="#events"><span class="i">📅</span><strong>Events & schedule</strong><span class="muted">Holidays, school, bins, reminders</span></a>
      <a href="#recipes"><span class="i">📖</span><strong>Recipes</strong><span class="muted">Catalogue, ingredients, rotation</span></a>
      <a href="#plan"><span class="i">🗓️</span><strong>Plan ahead</strong><span class="muted">Months of menus → shopping</span></a>
      <a href="#ratings"><span class="i">⭐</span><strong>Meal ratings</strong><span class="muted">Scores & export for Claude</span></a>
      <a href="#more"><span class="i">⚙️</span><strong>Settings</strong><span class="muted">Menu, password, budgets</span></a>
      ${S.me.is_admin ? '<a href="#users"><span class="i">👥</span><strong>Family profiles</strong><span class="muted">Admin: passwords & people</span></a>' : ''}
    </div>`;
};

// ================= chat =================
function msgHtml(m, prev) {
  const mine = m.user_id === S.me.id;
  const d = new Date(m.created_at + 'Z');
  const day = d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  const prevDay = prev ? new Date(prev.created_at + 'Z').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return `${day !== prevDay ? `<div class="day-sep">${day}</div>` : ''}
    <div class="msg ${mine ? 'mine' : ''}">
      ${mine ? '' : `<div class="who" style="color:${m.colour}">${m.emoji} ${esc(m.name)}</div>`}
      ${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}
      ${m.photo_key ? `<a href="${photoUrl(m.photo_key)}" target="_blank"><img src="${photoUrl(m.photo_key)}" loading="lazy" alt="photo"></a>` : ''}
      <div class="time">${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>`;
}
ROUTES.chat = async () => {
  const msgs = await api('chat');
  P2.chatMsgs = msgs; P2.chatLast = msgs.length ? msgs[msgs.length - 1].id : 0;
  $('#chat-n').hidden = true;
  $('#view').innerHTML = `<h1>Family chat</h1>
    <div class="chat" id="chat">${msgs.length ? msgs.map((m, i) => msgHtml(m, msgs[i - 1])).join('') : '<div class="empty">Say hi to the family 👋</div>'}</div>
    <div class="composer"><div class="row">
      <button class="btn ghost" id="c-photo" title="Send a photo">📷</button>
      <input type="text" id="c-text" placeholder="Message the family…" autocomplete="off" class="grow">
      <button class="btn" id="c-send">Send</button></div></div>`;
  const scroll = () => window.scrollTo(0, document.body.scrollHeight);
  scroll();
  const refresh = async () => {
    if (!location.hash.startsWith('#chat')) return;
    try {
      const more = await api('chat?after=' + P2.chatLast);
      if (!more.length) return;
      const box = $('#chat');
      if (!P2.chatMsgs.length) box.innerHTML = '';
      more.forEach((m) => { box.insertAdjacentHTML('beforeend', msgHtml(m, P2.chatMsgs[P2.chatMsgs.length - 1])); P2.chatMsgs.push(m); });
      P2.chatLast = more[more.length - 1].id;
      scroll();
    } catch { /* offline */ }
  };
  clearInterval(P2.chatTimer); P2.chatTimer = setInterval(refresh, 4000);
  const send = async (photo_key) => {
    const text = $('#c-text').value.trim();
    if (!text && !photo_key) return;
    $('#c-text').value = '';
    await api('chat', { body: { text, photo_key } });
    refresh();
  };
  $('#c-send').onclick = () => send();
  $('#c-text').onkeydown = (e) => { if (e.key === 'Enter') send(); };
  $('#c-photo').onclick = async () => {
    const f = await pickPhoto(); if (!f) return;
    toast('Sending photo…');
    try { await send(await uploadPhoto(f)); } catch (e) { toast(e.message); }
  };
};

// ================= family fun =================
ROUTES.fun = async () => {
  const ideas = await api('fun');
  await loadWeather();
  const today = todayStr();
  const sat = addDays(today, (6 - ((toD(today).getDay() + 6) % 7) + 7) % 7 || 0); // this Saturday (today if Saturday)
  const wet = rainLikely(sat) || rainLikely(addDays(sat, 1));
  const easy = P2.funEasy ?? true;
  const filter = P2.funPlace || 'all';
  // Suggestion score: family votes, how long since we last did it, a little randomness per week
  const seed = Number(sat.replace(/-/g, ''));
  const rnd = (id) => ((Math.sin(id * 9301 + seed) + 1) / 2);
  const daysSince = (d) => d ? Math.max(0, (toD(today) - toD(d)) / 86400000) : 120;
  const pool = ideas.filter((i) => (!easy || i.easy) && !(wet && i.needs_dry));
  const picks = pool.map((i) => ({ i, s: i.votes.length * 3 + Math.min(daysSince(i.last_done), 120) / 30 + rnd(i.id) * 2 }))
    .sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.i);
  const card = (i) => `<div class="card">
    <div class="spread"><strong>${esc(i.title)}</strong><span class="muted">${i.place === 'out' ? '🚗 Out' : '🏠 Home'} · ${['Free', 'R', 'RR'][i.cost] || ''}</span></div>
    ${i.details ? `<div class="muted">${esc(i.details)}</div>` : ''}
    <div class="row wrap" style="margin-top:6px">
      ${i.easy ? '<span class="badge ok">Easy-going</span>' : ''}${i.needs_dry ? '<span class="badge rain">Needs a dry day</span>' : ''}
      ${i.last_done ? `<span class="badge">Last: ${short(i.last_done)}</span>` : ''}
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn small ${i.votes.includes(S.me.id) ? '' : 'ghost'}" data-vote="${i.id}">👍 ${i.votes.map((v) => user(v).emoji).join('') || 'Vote'}</button>
      <span class="grow"></span>
      <input type="date" value="${sat}" data-pdate="${i.id}" style="width:auto">
      <button class="btn small" data-plan="${i.id}">Plan it</button>
    </div></div>`;
  const list = ideas.filter((i) => filter === 'all' || i.place === filter);
  $('#view').innerHTML = `<h1>Family fun</h1>
    <div class="card"><div class="spread"><strong>✨ Ideas for this weekend</strong>
      <label class="row muted"><input type="checkbox" id="f-easy" ${easy ? 'checked' : ''}> Easy-going only</label></div>
      <div class="muted">${wet ? '☔ Rain is likely this weekend, so these are indoor ideas.' : 'Based on your votes and what you haven\'t done in a while.'}</div></div>
    ${picks.map(card).join('') || '<div class="card empty">No ideas match. Untick "Easy-going only".</div>'}
    <h2>All ideas</h2>
    <div class="seg" style="margin-bottom:8px">${[['all', 'All'], ['home', '🏠 Home'], ['out', '🚗 Out']].map(([k, l]) => `<button data-fp="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${list.map(card).join('')}
    <details class="card"><summary><strong>+ Add an idea</strong></summary>
      <label class="f">Idea</label><input type="text" id="fi-title" placeholder="e.g. Fly a kite at the park">
      <label class="f">Details</label><input type="text" id="fi-det">
      <div class="row wrap" style="margin-top:8px">
        <select id="fi-place" style="width:auto"><option value="home">🏠 At home</option><option value="out">🚗 Going out</option></select>
        <select id="fi-cost" style="width:auto"><option value="0">Free</option><option value="1">Cheap</option><option value="2">Treat</option></select>
        <label class="row"><input type="checkbox" id="fi-easy" checked> Easy-going</label>
        <label class="row"><input type="checkbox" id="fi-dry"> Needs a dry day</label>
      </div>
      <button class="btn" style="margin-top:10px" id="fi-add">Add idea</button></details>`;
  $('#f-easy').onchange = (e) => { P2.funEasy = e.target.checked; ROUTES.fun(); };
  $$('[data-fp]').forEach((b) => b.onclick = () => { P2.funPlace = b.dataset.fp; ROUTES.fun(); });
  $$('[data-vote]').forEach((b) => b.onclick = async () => { await api(`fun/${b.dataset.vote}/vote`, { body: {} }); ROUTES.fun(); });
  $$('[data-plan]').forEach((b) => b.onclick = async () => {
    const date = $(`[data-pdate="${b.dataset.plan}"]`, b.parentElement).value;
    await api(`fun/${b.dataset.plan}/plan`, { body: { date } });
    toast('On the calendar! The family has been told.'); location.hash = '#day/' + date;
  });
  $('#fi-add').onclick = async () => {
    const title = $('#fi-title').value.trim(); if (!title) return toast('What is the idea?');
    await api('fun', { body: { title, details: $('#fi-det').value, place: $('#fi-place').value, cost: $('#fi-cost').value, easy: $('#fi-easy').checked, needs_dry: $('#fi-dry').checked } });
    toast('Idea added'); ROUTES.fun();
  };
};

// ================= Madilea =================
function checklistCard(l, opts = {}) {
  const done = l.items.filter((i) => i.done).length;
  const pct = l.items.length ? Math.round((done / l.items.length) * 100) : 0;
  const total = l.items.reduce((s, i) => s + (i.price || 0), 0);
  return `<div class="card" data-list="${l.id}">
    <div class="spread"><strong>${esc(l.title)}</strong><span class="muted">${done}/${l.items.length}</span></div>
    <div class="bar ${pct === 100 ? 'full' : ''}"><i style="width:${pct}%"></i></div>
    ${l.items.map((i) => `<div class="ci ${i.done ? 'done' : ''}">
      <input type="checkbox" data-ci="${i.id}" ${i.done ? 'checked' : ''}>
      <div class="grow"><span class="txt">${esc(i.text)}</span>${i.qty ? ` <span class="muted">× ${esc(i.qty)}</span>` : ''}
        ${i.done && i.done_by_name ? `<div class="muted">✓ ${esc(i.done_by_name)}</div>` : ''}</div>
      ${opts.prices ? `<input type="number" class="price" step="0.01" placeholder="R" value="${i.price ?? ''}" data-cprice="${i.id}">` : ''}
      <button class="btn small danger" data-cdel="${i.id}">✕</button></div>`).join('')}
    ${opts.prices ? `<div class="spread" style="margin-top:6px"><span class="muted">Estimated total</span><strong>${R(total)}</strong></div>` : ''}
    <div class="row" style="margin-top:8px"><input type="text" placeholder="Add item…" data-cnew="${l.id}" class="grow">
      <input type="text" placeholder="Qty" data-cqty="${l.id}" style="width:70px"><button class="btn small" data-cadd="${l.id}">Add</button></div>
    ${opts.reset ? `<button class="btn small ghost" style="margin-top:8px" data-creset="${l.id}">↺ Repack (untick everything)</button>` : ''}
  </div>`;
}
function wireChecklists(refresh) {
  $$('[data-ci]').forEach((c) => c.onchange = async () => { await put('list-items/' + c.dataset.ci, { done: c.checked }); refresh(); });
  $$('[data-cprice]').forEach((c) => c.onchange = async () => { await put('list-items/' + c.dataset.cprice, { price: c.value }); refresh(); });
  $$('[data-cdel]').forEach((b) => b.onclick = async () => { await del('list-items/' + b.dataset.cdel); refresh(); });
  $$('[data-creset]').forEach((b) => b.onclick = async () => { if (confirm('Untick everything to pack again?')) { await api(`lists/${b.dataset.creset}/reset`, { body: {} }); refresh(); } });
  $$('[data-cadd]').forEach((b) => {
    const id = b.dataset.cadd;
    const add = async () => {
      const text = $(`[data-cnew="${id}"]`).value.trim(); if (!text) return;
      await api(`lists/${id}/items`, { body: { text, qty: $(`[data-cqty="${id}"]`).value.trim() } }); refresh();
    };
    b.onclick = add;
    $(`[data-cnew="${id}"]`).onkeydown = (e) => { if (e.key === 'Enter') add(); };
  });
}
ROUTES.madilea = async () => {
  const month = P2.babyMonth || thisMonth();
  const [bags, buy, allBuy] = await Promise.all([api('lists?kind=bag'), api('lists?kind=buy&month=' + month), api('lists?kind=buy')]);
  const name = S.settings.baby_name || 'Baby';
  const due = S.settings.baby_due;
  let count = '';
  if (due) {
    const days = Math.round((toD(due) - toD(todayStr())) / 86400000);
    const pregDays = 280 - days;
    count = days > 0
      ? `<div class="big">${days}</div><div>days until ${esc(name)} is due</div>
         <div class="muted" style="margin-top:6px">Due ${nice(due)} · Shirley is ${Math.floor(pregDays / 7)} weeks ${pregDays % 7} day${pregDays % 7 === 1 ? '' : 's'}</div>`
      : `<div class="big">💗</div><div>${esc(S.settings.baby_full_name || name)} is ${-days} day${days === -1 ? '' : 's'} old!</div><div class="muted">Born around ${nice(due)}. Update the date in Settings.</div>`;
  }
  const prevList = allBuy.filter((l) => l.month < month).pop();
  $('#view').innerHTML = `<h1>${esc(S.settings.baby_full_name || name)}</h1>
    ${count ? `<div class="card count">${count}</div>` : ''}
    <h2>👜 Bags</h2>${bags.map((l) => checklistCard(l, { reset: true })).join('')}
    <details class="card"><summary><strong>+ New bag or checklist</strong></summary>
      <div class="row" style="margin-top:8px"><input type="text" id="nb-title" placeholder="e.g. Clinic visit bag" class="grow"><button class="btn small" id="nb-add">Create</button></div></details>
    <h2>🛍️ Things to buy</h2>
    <div class="spread" style="margin-bottom:8px"><button class="btn small ghost" id="bm-prev">‹</button><strong>${monthName(month)}</strong><button class="btn small ghost" id="bm-next">›</button></div>
    ${buy.length ? buy.map((l) => checklistCard(l, { prices: true })).join('')
      : `<div class="card empty">No list for ${monthName(month)} yet.<br><br>
         <button class="btn" id="bm-start">Start ${monthName(month)} list${prevList ? ` (copy ${monthName(prevList.month)})` : ''}</button></div>`}`;
  wireChecklists(ROUTES.madilea);
  $('#bm-prev').onclick = () => { P2.babyMonth = addMonths(month, -1); ROUTES.madilea(); };
  $('#bm-next').onclick = () => { P2.babyMonth = addMonths(month, 1); ROUTES.madilea(); };
  $('#bm-start') && ($('#bm-start').onclick = async () => {
    await api('lists', { body: { kind: 'buy', title: `${name}: ${monthName(month)}`, month, copy_from: prevList?.id } });
    ROUTES.madilea();
  });
  $('#nb-add').onclick = async () => {
    const title = $('#nb-title').value.trim(); if (!title) return;
    await api('lists', { body: { kind: 'bag', title } }); ROUTES.madilea();
  };
};

// ================= shop: stock take, shopping list & trolley, inventory, history =================
ROUTES.shop = async (tab) => {
  P2.shopTab = tab || P2.shopTab || 'list';
  const t = P2.shopTab;
  const tabs = [['stock', '📋 Stock take'], ['list', '🛒 Shopping list'], ['inventory', '📦 Inventory'], ['history', '🧾 History']];
  $('#view').innerHTML = `<h1>Shop</h1><div class="tabs">${tabs.map(([k, l]) => `<a href="#shop/${k}" class="${t === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="shop-body"></div>`;
  if (t === 'stock') return shopStock();
  if (t === 'inventory') return shopInventory();
  if (t === 'history') return shopHistory();
  return shopList();
};

async function shopStock() {
  const [cur, items] = await Promise.all([api('stock-takes/current'), api('items')]);
  const el = $('#shop-body');
  if (!cur.take) {
    el.innerHTML = `<div class="card">
      <strong>Before you shop, count what's in the house</strong>
      <p class="muted">Go cupboard by cupboard and type how many of each item you have. Anything below its "keep" level goes on the shopping list, with the shortfall worked out for you.</p>
      ${cur.last ? `<p class="muted">Last stock take: ${new Date(cur.last.finished_at + 'Z').toLocaleDateString('en-ZA', { dateStyle: 'medium' })} by ${esc(cur.last.by_name || '')}</p>` : ''}
      <button class="btn" id="st-start">Start stock take</button></div>`;
    $('#st-start').onclick = async () => { await api('stock-takes', { body: {} }); shopStock(); };
    return;
  }
  const counts = cur.counts;
  const sections = [...new Set(items.map((i) => i.section))];
  const sec = P2.stockSection && sections.includes(P2.stockSection) ? P2.stockSection : '';
  const shown = items.filter((i) => !sec || i.section === sec);
  const counted = items.filter((i) => counts[i.id] !== undefined).length;
  el.innerHTML = `<div class="card totals"><div class="spread"><strong>Counting… ${counted}/${items.length}</strong>
      <button class="btn small" id="st-scan">📷 Scan</button></div>
      <div class="bar"><i style="width:${Math.round((counted / items.length) * 100)}%"></i></div>
      <select id="st-sec"><option value="">All sections</option>${sections.map((s) => `<option ${s === sec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    ${groupBy(shown, 'section').map(([s, list]) => `<h3>${esc(s)}</h3><div class="card">${list.map((i) => {
      const v = counts[i.id];
      return `<div class="item" id="st-${i.id}">
        ${i.photo_key ? `<img class="thumb" src="${photoUrl(i.photo_key)}" loading="lazy">` : '<div class="thumb">📦</div>'}
        <div class="grow"><div class="nm">${esc(i.name)}</div><div class="muted">Keep ${i.par} · last count ${i.on_hand}</div></div>
        <div class="qty"><button data-st="${i.id}" data-d="-1">−</button>
          <input type="number" step="${i.kind === 'meat' ? 0.5 : 1}" min="0" value="${v ?? ''}" placeholder="${i.on_hand}" data-stv="${i.id}" style="${v === undefined ? '' : 'border-color:var(--ok)'}">
          <button data-st="${i.id}" data-d="1">+</button></div></div>`;
    }).join('')}</div>`).join('')}
    <div class="card"><label class="row"><input type="checkbox" id="st-zero"> Anything I didn't count is finished (set to 0)</label>
      <p class="muted">If you leave this unticked, items you skipped keep their last count.</p>
      <button class="btn" id="st-done">Finish & make the shopping list</button></div>`;
  const save = async (id, val) => { await put(`stock-takes/${cur.take.id}/count`, { item_id: Number(id), qty: val === '' ? null : Number(val) }); counts[id] = val === '' ? undefined : Number(val); };
  $$('[data-stv]').forEach((inp) => inp.onchange = async () => { await save(inp.dataset.stv, inp.value); inp.style.borderColor = inp.value === '' ? '' : 'var(--ok)'; });
  $$('[data-st]').forEach((b) => b.onclick = async () => {
    const inp = $(`[data-stv="${b.dataset.st}"]`);
    const step = Number(inp.step) || 1;
    const base = inp.value === '' ? Number(inp.placeholder) || 0 : Number(inp.value);
    inp.value = Math.max(0, base + step * Number(b.dataset.d));
    await save(b.dataset.st, inp.value); inp.style.borderColor = 'var(--ok)';
  });
  $('#st-sec').onchange = (e) => { P2.stockSection = e.target.value; shopStock(); };
  $('#st-scan').onclick = async () => {
    const code = await scanBarcode(); if (!code) return;
    const it = items.find((i) => i.barcode === code);
    if (!it) return toast('That barcode isn\'t in the inventory yet. Add it under 📦 Inventory.');
    if (sec && it.section !== sec) { P2.stockSection = ''; await shopStock(); }
    const row = $('#st-' + it.id); row.scrollIntoView({ block: 'center' }); $('input', row).focus();
  };
  $('#st-done').onclick = async () => {
    if (!confirm(`Finish the stock take? ${counted} of ${items.length} items counted.`)) return;
    await api(`stock-takes/${cur.take.id}/finish`, { body: { uncounted_zero: $('#st-zero').checked } });
    toast('Shopping list ready'); location.hash = '#shop/list';
  };
}

function groupBy(arr, key) {
  const m = new Map();
  arr.forEach((x) => { const k = x[key] || 'Other'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return [...m.entries()];
}

async function shopList() {
  const d = await api('trips/current');
  const el = $('#shop-body');
  if (!d.trip) {
    el.innerHTML = `<div class="card"><strong>No shopping list yet</strong>
      <p class="muted">Do a stock take first so the list only has what you actually need. Or make a list straight from the last counts.</p>
      <div class="row wrap"><a class="btn" href="#shop/stock" style="text-decoration:none">📋 Start stock take</a>
      <button class="btn ghost" id="sl-new">Make list from last counts</button></div></div>`;
    $('#sl-new').onclick = async () => { await api('trips/new', { body: {} }); shopList(); };
    return;
  }
  const lines = d.lines;
  const gBudget = d.budgets.grocery_budget || 5000, mBudget = d.budgets.meat_budget || 2000;
  const isMeat = (l) => l.kind === 'meat';
  const sum = (f, pick) => lines.filter(pick).reduce((s, l) => s + f(l), 0);
  const actual = (l) => (l.qty ?? l.plan_qty) * (l.price ?? l.plan_price ?? 0);
  const planned = (l) => l.plan_qty * (l.plan_price || 0);
  const calc = (pick) => {
    const trolley = sum(actual, (l) => pick(l) && l.in_trolley);
    const left = sum(planned, (l) => pick(l) && !l.in_trolley && !l.skipped);
    return { trolley, left, proj: trolley + left };
  };
  const g = calc((l) => !isMeat(l)), m = calc(isMeat);
  // Over budget? suggest non-essential items still on the list, biggest first, until we're back under
  const suggest = (tot, budget, pick) => {
    if (tot.proj <= budget) return [];
    let over = tot.proj - budget; const out = [];
    for (const l of lines.filter((l) => pick(l) && !l.in_trolley && !l.skipped && !l.essential).sort((a, b) => planned(b) - planned(a))) {
      if (over <= 0) break; out.push(l); over -= planned(l);
    }
    return out;
  };
  const gS = suggest(g, gBudget, (l) => !isMeat(l)), mS = suggest(m, mBudget, isMeat);
  const totalBox = (label, t, budget, sug) => `<div class="spread"><span>${label}</span><strong>${R(t.trolley)} <span class="muted">in trolley</span></strong></div>
    <div class="spread muted"><span>Projected at the till</span><span class="${t.proj > budget ? 'low' : ''}">${R(t.proj)} / ${R(budget)}</span></div>
    ${sug.length ? `<div class="muted" style="margin-top:4px">💡 Over by ${R(t.proj - budget)}. Leave for next time: ${sug.map((l) => `<a href="#" data-skipsug="${l.id}">${esc(l.name)}</a>`).join(', ')}</div>` : ''}`;
  const remaining = lines.filter((l) => !l.in_trolley && !l.skipped).length;
  const show = P2.listFilter || 'todo';
  const shown = lines.filter((l) => show === 'all' || (!l.in_trolley && !l.skipped) || (P2.keep || new Set()).has(l.id));
  el.innerHTML = `<div class="card totals ${(g.proj > gBudget || m.proj > mBudget) ? 'over' : ''}">
      ${totalBox('🛒 Groceries & household', g, gBudget, gS)}
      <hr style="border:0;border-top:1px solid var(--line)">
      ${totalBox('🥩 Meat', m, mBudget, mS)}
      <div class="muted" style="margin-top:4px">${remaining} still to get · ${lines.filter((l) => l.in_trolley).length} in trolley</div></div>
    <div class="row" style="margin-bottom:8px"><div class="seg">${[['todo', 'Still to get'], ['all', 'Everything']].map(([k, l]) => `<button data-lf="${k}" class="${show === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="grow"></span><button class="btn small ghost" id="sl-scan">📷 Scan</button></div>
    ${groupBy(shown, 'section').map(([s, list]) => `<h3>${esc(s === 'Other' && list.every((l) => !l.item_id) ? 'Extras' : s)}</h3><div class="card">${list.map((l) => `
      <div class="line ${l.in_trolley ? 'in' : ''} ${l.skipped ? 'skip' : ''}" id="ln-${l.id}">
        <div class="row">
          <input type="checkbox" data-tr="${l.id}" ${l.in_trolley ? 'checked' : ''} style="width:24px;height:24px;accent-color:var(--ok)">
          ${l.photo_key ? `<img class="thumb" src="${photoUrl(l.photo_key)}" loading="lazy" style="width:36px;height:36px">` : ''}
          <div class="grow"><div class="nm">${esc(l.name)}${l.essential ? ' <span class="badge">must</span>' : ''}</div>
            <div class="muted">Need ${l.plan_qty}${l.kind === 'meat' ? ' kg' : ''} × ${l.plan_price ? R(l.plan_price) : '?'} = ${R(planned(l))}</div></div>
          <button class="btn small ${l.skipped ? '' : 'ghost'}" data-skip="${l.id}" data-v="${l.skipped ? 0 : 1}">${l.skipped ? 'Undo' : 'Skip'}</button>
        </div>
        ${l.in_trolley ? `<div class="act"><input type="number" step="0.01" value="${l.qty ?? l.plan_qty}" data-lq="${l.id}" placeholder="Qty taken">
          <input type="number" step="0.01" value="${l.price ?? l.plan_price ?? ''}" data-lp="${l.id}" placeholder="Price each">
          <strong style="align-self:center">${R(actual(l))}</strong></div>` : ''}
      </div>`).join('')}</div>`).join('') || '<div class="card empty">Everything is in the trolley 🎉</div>'}
    <details class="card"><summary><strong>+ Picked up something extra</strong></summary>
      <div class="row" style="margin-top:8px"><input type="text" id="x-name" placeholder="What" class="grow"><input type="number" id="x-qty" value="1" style="width:60px"><input type="number" id="x-price" placeholder="R" step="0.01" style="width:90px"></div>
      <button class="btn small" style="margin-top:8px" id="x-add">Add to trolley</button></details>
    <div class="card"><label class="f">Shop</label><input type="text" id="sl-shop" placeholder="e.g. Checkers Key West" value="${esc(d.trip.shop || '')}">
      <button class="btn" style="margin-top:10px" id="sl-finish">✅ Finish shop: update stock & prices</button>
      <button class="btn small danger" style="margin-top:10px" id="sl-del">Delete this list</button></div>`;
  const reload = () => shopList();
  P2.keep = P2.keep || new Set();
  $$('[data-lf]').forEach((b) => b.onclick = () => { P2.listFilter = b.dataset.lf; P2.keep = new Set(); reload(); });
  $$('[data-tr]').forEach((c) => c.onchange = async () => {
    const l = lines.find((x) => x.id == c.dataset.tr);
    P2.keep.add(l.id); // keep it visible so qty/price can be typed in
    await put('shop-lines/' + l.id, { in_trolley: c.checked, qty: c.checked ? (l.qty ?? l.plan_qty) : l.qty, price: c.checked ? (l.price ?? l.plan_price) : l.price, skipped: 0 });
    reload();
  });
  $$('[data-lq]').forEach((i) => i.onchange = async () => { await put('shop-lines/' + i.dataset.lq, { qty: i.value }); reload(); });
  $$('[data-lp]').forEach((i) => i.onchange = async () => { await put('shop-lines/' + i.dataset.lp, { price: i.value }); reload(); });
  $$('[data-skip]').forEach((b) => b.onclick = async () => { await put('shop-lines/' + b.dataset.skip, { skipped: b.dataset.v === '1', in_trolley: 0 }); reload(); });
  $$('[data-skipsug]').forEach((a) => a.onclick = async (e) => { e.preventDefault(); await put('shop-lines/' + a.dataset.skipsug, { skipped: 1 }); toast('Left for next time'); reload(); });
  $('#x-add').onclick = async () => {
    const name = $('#x-name').value.trim(); if (!name) return;
    await api(`trips/${d.trip.id}/lines`, { body: { name, qty: $('#x-qty').value, price: $('#x-price').value, in_trolley: 1 } }); reload();
  };
  $('#sl-scan').onclick = async () => {
    const code = await scanBarcode(); if (!code) return;
    const l = lines.find((x) => x.barcode === code);
    if (!l) return toast('Not on the list. Add it under "Picked up something extra".');
    if (!l.in_trolley) { P2.keep.add(l.id); await put('shop-lines/' + l.id, { in_trolley: 1, qty: l.plan_qty, price: l.plan_price, skipped: 0 }); await reload(); }
    $('#ln-' + l.id)?.scrollIntoView({ block: 'center' }); toast(`🛒 ${l.name}`);
  };
  $('#sl-finish').onclick = async () => {
    if (!confirm('Finished shopping? Everything ticked gets added to the cupboard counts, and the prices you typed are saved.')) return;
    const r = await api(`trips/${d.trip.id}/finish`, { body: { shop: $('#sl-shop').value } });
    toast(`Shop done: ${R(r.spent)}`); P2.keep = new Set(); location.hash = '#shop/history';
  };
  $('#sl-del').onclick = async () => { if (confirm('Delete this shopping list?')) { await del('trips/' + d.trip.id); reload(); } };
}

async function shopHistory() {
  const trips = await api('trips');
  $('#shop-body').innerHTML = trips.filter((t) => t.status === 'done').map((t) => `<div class="card">
    <div class="spread"><strong>${esc(t.shop || 'Shop')}</strong><strong>${R(t.spent)}</strong></div>
    <div class="muted">${new Date(t.finished_at + 'Z').toLocaleDateString('en-ZA', { dateStyle: 'medium' })} · ${t.n} items · budget ${R(t.budget)} · by ${esc(t.by_name || '')}</div></div>`).join('')
    || '<div class="card empty">No finished shops yet.</div>';
}

async function shopInventory() {
  const items = await api('items');
  const sections = [...new Set(items.map((i) => i.section))];
  const f = P2.invFilter.toLowerCase(), sec = P2.invSection;
  const shown = items.filter((i) => (!sec || i.section === sec) && (!f || [i.name, i.brand, i.code, i.barcode].join(' ').toLowerCase().includes(f)));
  const noPhoto = items.filter((i) => !i.photo_key).length;
  $('#shop-body').innerHTML = `
    <div class="row" style="margin-bottom:8px"><input type="text" id="inv-q" placeholder="Search name, brand, code…" value="${esc(P2.invFilter)}" class="grow">
      <button class="btn" id="inv-scan">📷</button><button class="btn" id="inv-add">＋</button></div>
    <select id="inv-sec" style="margin-bottom:8px"><option value="">All sections (${items.length} items)</option>${sections.map((s) => `<option ${s === sec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    ${noPhoto ? `<div class="muted" style="margin-bottom:8px">📸 ${noPhoto} items still need a photo. Tap one to add its picture and barcode.</div>` : ''}
    ${groupBy(shown, 'section').map(([s, list]) => `<h3>${esc(s)}</h3><div class="card">${list.map((i) => `
      <div class="item" data-item="${i.id}">
        ${i.photo_key ? `<img class="thumb" src="${photoUrl(i.photo_key)}" loading="lazy">` : '<div class="thumb">📷</div>'}
        <div class="grow"><div class="nm">${esc(i.name)}</div>
          <div class="muted">${esc(i.code)}${i.brand ? ' · ' + esc(i.brand) : ''}${i.size ? ' · ' + esc(i.size) : ''}${i.barcode ? ' · ▮▯▮' : ''}</div></div>
        <div style="text-align:right"><div>${i.price ? R(i.price) : '—'}</div><div class="muted ${i.on_hand < i.par ? 'low' : ''}">${i.on_hand}/${i.par}</div></div>
      </div>`).join('')}</div>`).join('') || '<div class="card empty">Nothing found</div>'}`;
  const q = $('#inv-q');
  q.oninput = () => { P2.invFilter = q.value; clearTimeout(P2.invT); P2.invT = setTimeout(async () => { await shopInventory(); const n = $('#inv-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
  $('#inv-sec').onchange = (e) => { P2.invSection = e.target.value; shopInventory(); };
  $$('[data-item]').forEach((r) => r.onclick = () => itemSheet(items.find((i) => i.id == r.dataset.item), sections));
  $('#inv-add').onclick = () => itemSheet(null, sections);
  $('#inv-scan').onclick = async () => {
    const code = await scanBarcode(); if (!code) return;
    const it = await api('items/barcode/' + code);
    itemSheet(it || { barcode: code }, sections);
  };
}

async function itemSheet(it, sections) {
  it = it || {};
  const isNew = !it.id;
  const prices = isNew ? [] : await api(`items/${it.id}/prices`);
  let photo = it.photo_key || null;
  const s = sheet(`
    <div class="spread"><h2 style="margin:0">${isNew ? 'New item' : esc(it.code)}</h2><button class="btn small ghost" data-close>Close</button></div>
    <div style="margin:10px 0;text-align:center" id="is-ph">${photo ? `<img class="photo-big" src="${photoUrl(photo)}">` : '<div class="thumb" style="width:100%;height:140px;font-size:2.5rem">📷</div>'}</div>
    <button class="btn ghost" id="is-photo" style="width:100%">📷 ${photo ? 'Retake photo' : 'Take photo'}</button>
    <label class="f">Name</label><input type="text" id="is-name" value="${esc(it.name || '')}">
    <div class="row"><div class="grow"><label class="f">Brand</label><input type="text" id="is-brand" value="${esc(it.brand || '')}"></div>
      <div class="grow"><label class="f">Size / volume</label><input type="text" id="is-size" value="${esc(it.size || '')}" placeholder="2kg, 750ml…"></div></div>
    <label class="f">Barcode</label><div class="row"><input type="text" inputmode="numeric" id="is-bc" value="${esc(it.barcode || '')}" class="grow"><button class="btn small ghost" id="is-scan">📷 Scan</button></div>
    <div class="row"><div class="grow"><label class="f">Price (R)</label><input type="number" step="0.01" id="is-price" value="${it.price ?? ''}"></div>
      <div class="grow"><label class="f">Shop</label><input type="text" id="is-shop" value="${esc(it.shop || '')}"></div></div>
    <div class="row"><div class="grow"><label class="f">Section</label><input type="text" id="is-sec" list="is-secs" value="${esc(it.section || 'Pantry')}"><datalist id="is-secs">${sections.map((x) => `<option>${esc(x)}</option>`).join('')}</datalist></div>
      <div class="grow"><label class="f">Type</label><select id="is-kind">${['grocery', 'household', 'meat', 'baby'].map((k) => `<option ${it.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
    <div class="row"><div class="grow"><label class="f">Amount in one pack (for recipes)</label><input type="number" step="any" id="is-pq" value="${it.pack_qty ?? ''}" placeholder="e.g. 750"></div>
      <div style="width:100px"><label class="f">Unit</label><select id="is-pu">${['g', 'ml', 'each', 'kg'].map((u) => `<option ${(it.pack_unit || 'each') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
    <div class="row"><div class="grow"><label class="f">Keep in the house</label><input type="number" step="0.5" id="is-par" value="${it.par ?? 1}"></div>
      <div class="grow"><label class="f">Have now</label><input type="number" step="0.5" id="is-oh" value="${it.on_hand ?? 0}"></div></div>
    <label class="row" style="margin-top:8px"><input type="checkbox" id="is-ess" ${it.essential ? 'checked' : ''}> Must-have (never suggested for leaving out)</label>
    <button class="btn" style="margin-top:12px;width:100%" id="is-save">Save</button>
    ${prices.length ? `<h3>Price history</h3>${prices.map((p) => `<div class="spread muted"><span>${short(p.date)} ${p.shop ? '· ' + esc(p.shop) : ''}</span><span>${R(p.price)}</span></div>`).join('')}` : ''}
    ${isNew ? '' : '<button class="btn small danger" style="margin-top:12px" id="is-del">Remove from inventory</button>'}`);
  $('[data-close]', s).onclick = () => s.remove();
  $('#is-photo', s).onclick = async () => {
    const f = await pickPhoto(); if (!f) return;
    toast('Uploading…');
    try { photo = await uploadPhoto(f); $('#is-ph', s).innerHTML = `<img class="photo-big" src="${photoUrl(photo)}">`; } catch (e) { toast(e.message); }
  };
  $('#is-scan', s).onclick = async () => { const c = await scanBarcode(); if (c) $('#is-bc', s).value = c; };
  $('#is-save', s).onclick = async () => {
    const b = {
      name: $('#is-name', s).value.trim(), brand: $('#is-brand', s).value.trim(), size: $('#is-size', s).value.trim(),
      barcode: $('#is-bc', s).value.trim(), price: $('#is-price', s).value, shop: $('#is-shop', s).value.trim(),
      section: $('#is-sec', s).value.trim() || 'Other', kind: $('#is-kind', s).value, par: $('#is-par', s).value,
      on_hand: $('#is-oh', s).value, essential: $('#is-ess', s).checked, photo_key: photo,
      pack_qty: $('#is-pq', s).value, pack_unit: $('#is-pu', s).value,
    };
    if (!b.name) return toast('Name needed');
    if (isNew) { const r = await api('items', { body: b }); toast(`Added as ${r.code}`); }
    else { await put('items/' + it.id, b); toast('Saved'); }
    s.remove(); shopInventory();
  };
  $('#is-del', s) && ($('#is-del', s).onclick = async () => { if (confirm('Remove this item?')) { await del('items/' + it.id); s.remove(); shopInventory(); } });
}

// ================= workouts =================
ROUTES.workouts = async () => {
  const today = todayStr();
  const d = await api('workouts?today=' + today);
  const days = (s) => s === '1234567' ? 'every day' : [...s].map((x) => WD[x - 1]).join(', ');
  const people = d.people.map((p) => {
    const u = user(p.id);
    const pct = p.planned ? Math.round((p.done / p.planned) * 100) : 0;
    return `<div class="card">
      <div class="spread"><strong>${u.emoji} ${esc(u.name)}</strong><span>${p.done}/${p.planned} this week${p.streak ? ` · 🔥 ${p.streak}-week streak` : ''}</span></div>
      <div class="bar ${pct === 100 && p.planned ? 'full' : ''}"><i style="width:${pct}%"></i></div>
      <div class="muted">${p.minutes} minutes logged this week</div>
      ${p.open.map((t) => `<div class="task ${t.late_days ? 'late' : ''}">
        <div class="grow"><div class="t">${esc(t.title)}</div>
          ${t.late_days ? `<span class="badge warn">From ${short(t.due_date)} · ${t.late_days} day${t.late_days > 1 ? 's' : ''} late</span>` : '<span class="badge">Today</span>'}</div>
        ${(p.id === S.me.id || S.me.is_parent) ? `<button class="btn small" data-log="${t.id}" data-tpl="${t.template_id}">Log it</button>` : ''}
      </div>`).join('')}
    </div>`;
  }).join('');
  $('#view').innerHTML = `<h1>Workouts</h1>
    <p class="muted">Workouts show on the calendar (💪) and in everyone's daily checklist. Missed ones carry over, and they earn reward points like any other task.</p>
    ${people}
    <h2>Plans</h2>
    ${d.plans.map((p) => `<div class="card"><div class="spread"><strong>${p.emoji} ${esc(p.title.replace(/^💪 /, ''))}</strong><span class="muted">${p.minutes || 20} min</span></div>
      <div class="muted">${esc(p.assignee_name)} · ${days(p.days)} · ${p.points} pts</div>
      ${p.howto ? `<p style="margin:6px 0 0">${esc(p.howto)}</p>` : ''}
      ${(S.me.is_parent || p.assignee === S.me.id) ? `<button class="btn small danger" style="margin-top:6px" data-wstop="${p.id}">Stop this workout</button>` : ''}</div>`).join('') || '<div class="card empty">No workouts yet</div>'}
    <details class="card"><summary><strong>+ New workout</strong></summary>
      <label class="f">Workout</label><input type="text" id="w-title" placeholder="e.g. 20-min walk">
      <div class="row"><div class="grow"><label class="f">For</label><select id="w-who">${S.users.map((u) => `<option value="${u.id}" ${u.id === S.me.id ? 'selected' : ''}>${u.emoji} ${esc(u.name)}</option>`).join('')}</select></div>
        <div style="width:90px"><label class="f">Minutes</label><input type="number" id="w-min" value="20"></div>
        <div style="width:80px"><label class="f">Points</label><input type="number" id="w-pts" value="10"></div></div>
      <label class="f">Days</label><div class="days-pick" id="w-days">${WD.map((w, i) => `<label><input type="checkbox" value="${i + 1}"><span>${w}</span></label>`).join('')}</div>
      <label class="f">How to do it</label><textarea id="w-how" placeholder="Rounds, reps, tips…"></textarea>
      <button class="btn" style="margin-top:10px" id="w-add">Add workout</button></details>
    <h2>Recently done</h2>
    <div class="card">${d.recent.map((r) => `<div class="spread" style="padding:4px 0"><span>${r.emoji} ${esc(r.title.replace(/^💪 /, ''))}</span>
      <span class="muted">${r.minutes ? r.minutes + ' min · ' : ''}${['', '😓', '🙂', '😄'][r.feel] || ''} ${short(r.done_at)}</span></div>`).join('') || '<div class="empty">Nothing logged yet</div>'}</div>`;
  $$('[data-log]').forEach((b) => b.onclick = () => {
    const plan = d.plans.find((p) => p.id == b.dataset.tpl);
    let feel = 2;
    const s = sheet(`<h2 style="margin-top:0">Log workout</h2>
      <label class="f">Minutes</label><input type="number" id="l-min" value="${plan?.minutes || 20}">
      <label class="f">How did it feel?</label><div class="row feel">${['😓 Tough', '🙂 OK', '😄 Great'].map((f, i) => `<button data-f="${i + 1}" class="${i === 1 ? 'on' : ''}">${f}</button>`).join('')}</div>
      <label class="f">Note (optional)</label><input type="text" id="l-note">
      <button class="btn" style="margin-top:12px;width:100%" id="l-save">Done ✅</button>`);
    $$('[data-f]', s).forEach((x) => x.onclick = () => { feel = Number(x.dataset.f); $$('[data-f]', s).forEach((y) => y.classList.toggle('on', y === x)); });
    $('#l-save', s).onclick = async () => {
      await api('workouts/log', { body: { task_id: Number(b.dataset.log), minutes: $('#l-min', s).value, feel, note: $('#l-note', s).value, date: today } });
      s.remove(); toast('Workout logged 💪'); ROUTES.workouts();
    };
  });
  $$('[data-wstop]').forEach((b) => b.onclick = async () => { if (confirm('Stop this workout?')) { await del('templates/' + b.dataset.wstop); ROUTES.workouts(); } });
  $('#w-add').onclick = async () => {
    const title = $('#w-title').value.trim(); const daysSel = $$('#w-days input:checked').map((c) => c.value).join('');
    if (!title || !daysSel) return toast('Add a name and pick the days');
    await api('workouts', { body: { title, assignee: $('#w-who').value, minutes: $('#w-min').value, points: $('#w-pts').value, days: daysSel, howto: $('#w-how').value } });
    toast('Workout added'); ROUTES.workouts();
  };
};
