// The Stewart Nest — phase 8: Madilea's baby log, reward shop & streaks, notification settings,
// backups and photo storage (admin), and opening without signal.
'use strict';

// ================= baby log =================
const BABY = { date: null };
const FEED_LABEL = { left: 'Left', right: 'Right', both: 'Both sides', bottle: 'Bottle', solids: 'Solids' };
const NAPPY_LABEL = { wet: 'Wet', dirty: 'Dirty', both: 'Wet & dirty' };
const stampMs = (s) => Date.parse(s + ':00Z');
function ago(at, now) {
  const mins = Math.max(0, Math.round((stampMs(now) - stampMs(at)) / 60000));
  if (mins < 1) return 'just now';
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h ? h + 'h ' : ''}${m}m ago`;
}
const hm = (mins) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
function babyLine(r) {
  if (r.kind === 'feed') return `🍼 ${FEED_LABEL[r.detail] || r.detail}${r.amount ? ` · ${r.amount} ml` : ''}`;
  if (r.kind === 'nappy') return `🧷 ${NAPPY_LABEL[r.detail] || r.detail} nappy`;
  return r.detail === 'start' ? '😴 Fell asleep' : '🌞 Woke up';
}

ROUTES.baby = async () => {
  const d = await api('baby' + (BABY.date ? '?date=' + BABY.date : ''));
  const name = S.settings.baby_name || 'Baby';
  const today = d.now.slice(0, 10), isToday = d.date === today;
  const asleep = d.last.sleep && d.last.sleep.detail === 'start';
  const logIt = can('baby_lists');
  $('#view').innerHTML = `<h1>👶 ${esc(name)}'s log</h1>
    <div class="baby-now">
      <div class="card"><div class="muted">Last feed</div><strong>${d.last.feed ? ago(d.last.feed.at, d.now) : '—'}</strong>
        <div class="muted">${d.last.feed ? esc(FEED_LABEL[d.last.feed.detail]) + (d.last.feed.amount ? ` · ${d.last.feed.amount} ml` : '') : 'Nothing yet'}</div></div>
      <div class="card"><div class="muted">Last nappy</div><strong>${d.last.nappy ? ago(d.last.nappy.at, d.now) : '—'}</strong>
        <div class="muted">${d.last.nappy ? esc(NAPPY_LABEL[d.last.nappy.detail]) : 'Nothing yet'}</div></div>
      <div class="card"><div class="muted">${asleep ? 'Asleep' : 'Awake'}</div><strong>${d.last.sleep ? ago(d.last.sleep.at, d.now).replace(' ago', '') : '—'}</strong>
        <div class="muted">${asleep ? 'since ' + d.last.sleep.at.slice(11) : d.last.sleep ? 'woke ' + d.last.sleep.at.slice(11) : ''}</div></div>
    </div>
    ${logIt ? `<div class="baby-btns">
      <button class="btn" data-bfeed>🍼 Feed</button>
      <button class="btn" data-bnappy>🧷 Nappy</button>
      <button class="btn ${asleep ? 'rain' : ''}" data-bsleep="${asleep ? 'end' : 'start'}">${asleep ? '🌞 Woke up' : '😴 Fell asleep'}</button>
    </div>` : '<p class="muted">Mom and Dad keep this log.</p>'}
    <div class="spread" style="margin:12px 0 6px"><button class="btn small ghost" id="bl-prev">‹</button>
      <strong>${isToday ? 'Today' : nice(d.date)}</strong>
      <button class="btn small ghost" id="bl-next" ${isToday ? 'disabled' : ''}>›</button></div>
    <div class="card"><div class="stats">
      <span class="badge">🍼 ${d.summary.feeds} feed${d.summary.feeds === 1 ? '' : 's'}${d.summary.bottle_ml ? ` · ${d.summary.bottle_ml} ml` : ''}</span>
      <span class="badge">🧷 ${d.summary.nappies} nappies (${d.summary.dirty} dirty)</span>
      <span class="badge">😴 ${hm(d.summary.sleep_minutes)} sleep</span></div></div>
    <div class="card">${d.log.map((r) => `<div class="item"><div class="thumb">${esc(r.at.slice(11))}</div>
      <div class="grow"><div class="nm">${babyLine(r)}</div><div class="muted">${esc(r.by_name || '')}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
      ${logIt ? `<button class="btn small ghost" data-bdel="${r.id}" title="Remove">✕</button>` : ''}</div>`).join('') || '<div class="empty">Nothing logged this day.</div>'}</div>`;
  $('#bl-prev').onclick = () => { BABY.date = addDays(d.date, -1); ROUTES.baby(); };
  $('#bl-next').onclick = () => { const n = addDays(d.date, 1); BABY.date = n >= today ? null : n; ROUTES.baby(); };
  const save = async (body) => { try { await api('baby', { body }); toast('Logged ✔'); navigator.vibrate?.(40); ROUTES.baby(); } catch (e) { toast(e.message); } };
  const askWhen = (title, options, extra = '') => new Promise((res) => {
    const s = sheet(`<div class="spread"><h2 style="margin:0">${title}</h2><button class="btn small ghost" data-close>Close</button></div>
      <div class="baby-opts">${options.map(([k, l]) => `<button class="btn ghost" data-o="${k}">${l}</button>`).join('')}</div>
      ${extra}
      <label class="f">When</label><input type="datetime-local" id="bw-at" value="${d.now}" max="${d.now}">
      <label class="f">Note (optional)</label><input type="text" id="bw-note" placeholder="e.g. fussy, spat up a little">`);
    $('[data-close]', s).onclick = () => { s.remove(); res(null); };
    $$('[data-o]', s).forEach((b) => b.onclick = () => {
      const out = { detail: b.dataset.o, at: $('#bw-at', s).value || d.now, note: $('#bw-note', s).value, amount: $('#bw-ml', s)?.value };
      s.remove(); res(out);
    });
  });
  $('[data-bfeed]') && ($('[data-bfeed]').onclick = async () => {
    const r = await askWhen('🍼 Feed', Object.entries(FEED_LABEL), '<label class="f">Bottle amount (ml, for bottle feeds)</label><input type="number" id="bw-ml" min="0" max="500" step="10" placeholder="e.g. 90">');
    if (r) save({ kind: 'feed', ...r });
  });
  $('[data-bnappy]') && ($('[data-bnappy]').onclick = async () => {
    const r = await askWhen('🧷 Nappy', Object.entries(NAPPY_LABEL));
    if (r) save({ kind: 'nappy', ...r });
  });
  $('[data-bsleep]') && ($('[data-bsleep]').onclick = () => save({ kind: 'sleep', detail: $('[data-bsleep]').dataset.bsleep }));
  $$('[data-bdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this entry?')) return;
    try { await del('baby/' + b.dataset.bdel); ROUTES.baby(); } catch (e) { toast(e.message); }
  });
};
// a way in from Madilea's page and the family hub
const baseMadilea = ROUTES.madilea;
ROUTES.madilea = async (...args) => {
  await baseMadilea(...args);
  const h = $('#view h1');
  if (h) h.insertAdjacentHTML('afterend', `<a class="card baby-link" href="#baby"><strong>👶 Baby log</strong><span class="muted">Feeds, nappies and sleep, one tap each</span></a>`);
};
const baseHub = ROUTES.hub;
ROUTES.hub = async (...args) => {
  await baseHub(...args);
  const hub = $('#view .hub');
  if (hub && !$('a[href="#baby"]', hub)) hub.insertAdjacentHTML('beforeend', `<a href="#baby"><span class="i">🍼</span><strong>Baby log</strong><span class="muted">Feeds, nappies, sleep</span></a>`);
};

// ================= reward shop & streaks (under Rewards) =================
const baseRewards = viewRewards;
viewRewards = async (weekArg) => { // eslint-disable-line no-global-assign
  await baseRewards(weekArg);
  let t;
  try { t = await api('treats'); } catch { return; }
  const meP = t.people.find((p) => p.id === S.me.id);
  const approve = can('approve_rewards');
  const asked = t.buys.filter((b) => b.status === 'asked');
  const box = document.createElement('div');
  box.innerHTML = `
    <h2>🔥 Streaks</h2>
    <div class="card">${t.people.map((p) => `<div class="item"><div class="thumb">${esc(p.emoji || '🙂')}</div><div class="grow">
      <div class="nm">${esc(p.name)}</div>
      <div class="muted">☀️ ${p.morning} day${p.morning === 1 ? '' : 's'} morning check · ✅ ${p.on_time} day${p.on_time === 1 ? '' : 's'} all on time</div>
      ${p.badges.length ? `<div class="stats" style="margin-top:4px">${p.badges.slice(-3).map((b) => `<span class="badge ok">${esc(b)}</span>`).join('')}</div>` : ''}
    </div><div class="muted" title="Points to spend">💰 ${p.balance}</div></div>`).join('')}</div>
    <h2>🎁 Reward shop</h2>
    <p class="muted">Points from tasks add up. ${meP ? `You have <strong>${meP.balance}</strong> to spend.` : ''} Pick a treat and Mom or Dad hands it over.</p>
    ${approve && asked.length ? `<div class="card"><strong>Waiting for you</strong>${asked.map((b) => `<div class="item"><div class="grow"><div class="nm">${esc(b.emoji || '')} ${esc(b.name)}: ${esc(b.title)}</div><div class="muted">${b.cost} points</div></div>
      <button class="btn small" data-tgive="${b.id}">Given</button><button class="btn small ghost" data-tno="${b.id}">Not now</button></div>`).join('')}</div>` : ''}
    <div class="card">${t.items.map((i) => `<div class="item"><div class="thumb">${esc(i.emoji || '🎁')}</div><div class="grow"><div class="nm">${esc(i.title)}</div><div class="muted">${i.cost} points</div></div>
      ${meP && meP.balance >= i.cost ? `<button class="btn small" data-tbuy="${i.id}" data-tt="${esc(i.title)}" data-tc="${i.cost}">Get it</button>` : `<span class="muted">${meP ? i.cost - meP.balance + ' more' : ''}</span>`}
      ${approve ? `<button class="btn small ghost" data-tdel="${i.id}" title="Remove">✕</button>` : ''}</div>`).join('') || '<div class="empty">No treats yet.' + (approve ? ' Add some below.' : ' Ask Mom or Dad to add some.') + '</div>'}</div>
    ${approve ? `<details class="card"><summary><strong>+ Add a treat</strong></summary>
      <div class="row wrap" style="margin-top:8px"><input type="text" id="tr-emoji" value="🎁" style="width:56px"><input type="text" id="tr-title" class="grow" placeholder="e.g. Pick Friday's movie">
      <input type="number" id="tr-cost" style="width:90px" placeholder="Points" min="1"><button class="btn small" id="tr-add">Add</button></div></details>` : ''}
    ${t.buys.filter((b) => b.status !== 'asked').length ? `<details class="card"><summary class="muted">History</summary>${t.buys.filter((b) => b.status !== 'asked').slice(0, 20).map((b) => `<div class="muted">${esc(b.name)} · ${esc(b.title)} · ${b.cost} pts · ${b.status === 'given' ? '✅ given' : '↩️ not now'}${b.handled_by_name ? ' by ' + esc(b.handled_by_name) : ''}</div>`).join('')}</details>` : ''}`;
  $('#view').appendChild(box);
  const reload = () => viewRewards(weekArg);
  $$('[data-tbuy]', box).forEach((b) => b.onclick = async () => {
    if (!confirm(`Spend ${b.dataset.tc} points on "${b.dataset.tt}"?`)) return;
    try { await api(`treats/${b.dataset.tbuy}/buy`, { body: {} }); toast('Asked Mom and Dad 🎁'); reload(); } catch (e) { toast(e.message); }
  });
  const handle = (status) => async (e) => { try { await api(`treats/buys/${e.target.dataset.tgive || e.target.dataset.tno}`, { body: { status } }); reload(); } catch (err) { toast(err.message); } };
  $$('[data-tgive]', box).forEach((b) => b.onclick = handle('given'));
  $$('[data-tno]', box).forEach((b) => b.onclick = handle('declined'));
  $$('[data-tdel]', box).forEach((b) => b.onclick = async () => { if (confirm('Remove this treat from the shop?')) { await del('treats/' + b.dataset.tdel); reload(); } });
  $('#tr-add', box) && ($('#tr-add', box).onclick = async () => {
    try { await api('treats', { body: { title: $('#tr-title', box).value, cost: $('#tr-cost', box).value, emoji: $('#tr-emoji', box).value } }); toast('Treat added'); reload(); } catch (e) { toast(e.message); }
  });
};

// ================= More: notification settings, backups & storage =================
const baseMore = viewMore;
viewMore = async () => { // eslint-disable-line no-global-assign
  await baseMore();
  const p = S.me.prefs || {};
  const alerts = [...$$('#view h2')].find((h) => /Alerts on this device/.test(h.textContent));
  const box = document.createElement('div');
  box.innerHTML = `<h2>🔕 What buzzes my phone</h2>
    <div class="card">
      <label class="row"><input type="checkbox" id="np-chat" ${p.notify_chat === false ? '' : 'checked'}> 💬 Chat messages</label>
      <label class="row"><input type="checkbox" id="np-other" ${p.notify_other === false ? '' : 'checked'}> 🔔 Tasks, reminders and everything else</label>
      <label class="row"><input type="checkbox" id="np-week" ${p.week_ahead === false ? '' : 'checked'}> 🗓️ Sunday "week ahead" summary</label>
      <label class="row" style="margin-top:6px"><input type="checkbox" id="np-quiet" ${p.quiet_from ? 'checked' : ''}> 🌙 Quiet hours</label>
      <div class="row" id="np-qt" ${p.quiet_from ? '' : 'hidden'}><input type="time" id="np-qf" value="${esc(p.quiet_from || '21:00')}" style="width:auto"> to <input type="time" id="np-qe" value="${esc(p.quiet_to || '06:00')}" style="width:auto"></div>
      <p class="muted">These follow you to every phone you log in on. In quiet hours nothing buzzes; it's all waiting in the app.</p>
    </div>
    ${S.me.is_admin ? `<div id="admin-extra"><h2>🗄️ Backups</h2><div class="card"><div id="bk-list" class="muted">Loading…</div>
      <div class="row wrap" style="margin-top:8px"><button class="btn small" id="bk-now">Back up now</button><button class="btn small ghost" id="wa-now">🗓️ Send the week ahead now</button></div>
      <p class="muted">A backup is made every Sunday night and the last 8 are kept online. Download one now and then to keep a copy on the laptop.</p></div>
      <h2>💾 Photo storage</h2><div class="card"><div id="st-sum" class="muted">Loading…</div>
      <label class="f">Remove chat videos older than</label><select id="st-keep" style="width:auto">${[[0, 'Never (keep them all)'], [6, '6 months'], [12, '12 months'], [24, '2 years']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <p class="muted">Photos and voice notes are never removed. A removed video leaves a note in the chat.</p></div></div>` : ''}`;
  if (alerts) alerts.parentNode.insertBefore(box, alerts.nextElementSibling?.nextElementSibling || null); else $('#view').appendChild(box);
  const savePrefs = async () => {
    const quiet = $('#np-quiet').checked;
    $('#np-qt').hidden = !quiet;
    try {
      const r = await put('prefs', { notify_chat: $('#np-chat').checked, notify_other: $('#np-other').checked, week_ahead: $('#np-week').checked,
        quiet_from: quiet ? $('#np-qf').value : null, quiet_to: quiet ? $('#np-qe').value : null });
      S.me.prefs = r.prefs; toast('Saved');
    } catch (e) { toast(e.message); }
  };
  ['#np-chat', '#np-other', '#np-week', '#np-quiet', '#np-qf', '#np-qe'].forEach((id) => ($(id).onchange = savePrefs));
  if (!S.me.is_admin) return;
  const mb = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : (n / 1024 ** 2).toFixed(1) + ' MB');
  const drawBackups = async () => {
    try {
      const list = await api('admin/backups');
      $('#bk-list').innerHTML = list.length ? list.map((b) => `<div class="spread"><span>${esc(b.name.replace(/^nest-|\.json$/g, ''))} · ${mb(b.size)}</span><a class="btn small ghost" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>⬇️ Download</a></div>`).join('') : 'No backups yet. The first one is made on Sunday night, or tap Back up now.';
    } catch (e) { $('#bk-list').textContent = e.message; }
  };
  $('#bk-now').onclick = async () => { $('#bk-now').disabled = true; try { await api('admin/backups', { body: {} }); toast('Backup made ✔'); drawBackups(); } catch (e) { toast(e.message); } $('#bk-now').disabled = false; };
  drawBackups();
  $('#wa-now').onclick = async () => { try { await api('admin/week-ahead', { body: {} }); toast('Sent to everyone 🗓️'); } catch (e) { toast(e.message); } };
  try {
    const st = await api('admin/storage');
    const pct = Math.min(100, Math.round((st.bytes / st.free_bytes) * 100));
    $('#st-sum').innerHTML = `<div class="spread"><strong>${mb(st.bytes)} of ${mb(st.free_bytes)} free space</strong><span>${pct}%</span></div>
      <div class="bar ${pct > 80 ? 'full' : ''}"><i style="width:${pct}%"></i></div>
      <div class="stats" style="margin-top:6px">${Object.entries(st.groups).map(([g, x]) => `<span class="badge">${esc(g)}: ${x.files} · ${mb(x.bytes)}</span>`).join('')}</div>`;
    $('#st-keep').value = String(st.video_keep_months || 0);
    $('#st-keep').onchange = async (e) => {
      const v = Number(e.target.value);
      if (v && !confirm(`Chat videos older than ${v} months will be removed every night. Continue?`)) { e.target.value = String(st.video_keep_months || 0); return; }
      try { await put('settings', { video_keep_months: v }); st.video_keep_months = v; toast('Saved'); } catch (err) { toast(err.message); }
    };
  } catch (e) { $('#st-sum').textContent = e.message; }
};

// ================= opening without signal =================
// The service worker keeps the app and the last screens loaded; show a small banner while offline.
function offlineBanner() {
  let b = $('#offline');
  if (!b) { b = document.createElement('div'); b.id = 'offline'; b.textContent = '📴 No signal: showing what was last loaded. Changes need a connection.'; document.body.appendChild(b); }
  b.hidden = navigator.onLine;
}
window.addEventListener('online', offlineBanner);
window.addEventListener('offline', offlineBanner);
setTimeout(offlineBanner, 500);
