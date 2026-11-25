// The Stewart Nest — front end (no build step, plain JS)
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const toD = (s) => new Date(s + 'T00:00:00');
const ymd = (d) => d.toLocaleDateString('en-CA');
const addDays = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return ymd(d); };
const nice = (s, opt = { weekday: 'long', day: 'numeric', month: 'long' }) => toD(s).toLocaleDateString('en-ZA', opt);
const short = (s) => nice(s, { weekday: 'short', day: 'numeric', month: 'short' });
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEAL = { b: 'Breakfast', l: 'Lunch', s: 'Supper' };

const S = { me: null, users: [], settings: {}, weather: {}, month: todayStr().slice(0, 7), lastNotif: 0, taskView: 'mine' };

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') { S.me = null; location.hash = '#login'; throw new Error('Please log in'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const put = (p, body) => api(p, { method: 'PUT', body });
const del = (p) => api(p, { method: 'DELETE' });

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600);
}
const user = (id) => S.users.find((u) => u.id === id) || { name: id, emoji: '🙂', colour: '#888' };

// ---------- weather (Open-Meteo, free, no key) ----------
async function loadWeather() {
  if (S.weatherAt && Date.now() - S.weatherAt < 30 * 60e3) return;
  try {
    const { lat = -26.1016, lon = 27.7695 } = S.settings;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,weather_code,temperature_2m_max,temperature_2m_min&timezone=Africa%2FJohannesburg&forecast_days=16`);
    const d = await r.json();
    S.weather = {};
    d.daily.time.forEach((t, i) => (S.weather[t] = {
      rain: d.daily.precipitation_probability_max[i], code: d.daily.weather_code[i],
      max: Math.round(d.daily.temperature_2m_max[i]), min: Math.round(d.daily.temperature_2m_min[i]),
    }));
    S.weatherAt = Date.now();
  } catch { /* offline: no forecast */ }
}
const wxIcon = (c) => c == null ? '' : c >= 95 ? '⛈️' : c >= 80 ? '🌦️' : c >= 61 ? '🌧️' : c >= 51 ? '🌦️' : c >= 45 ? '🌫️' : c >= 3 ? '☁️' : c >= 1 ? '⛅' : '☀️';
const rainLikely = (date) => (S.weather[date]?.rain ?? 0) >= Number(S.settings.rain_threshold || 50);

// ---------- header ----------
function renderHeader() {
  const on = !!S.me;
  $('#top').hidden = !on; $('#nav').hidden = !on;
  if (!on) return;
  document.documentElement.style.setProperty('--me', S.me.colour);
  $('#me-btn').textContent = S.me.emoji;
  $('#me-btn').title = S.me.full_name || S.me.name;
  const due = S.settings.baby_due;
  if (due) {
    const days = Math.round((toD(due) - toD(todayStr())) / 86400000);
    const name = S.settings.baby_name || 'Baby';
    $('#baby').textContent = days > 0 ? `👶 ${name}: ${days} days` : days === 0 ? `👶 ${name}: due today!` : `💗 ${name}`;
    $('#baby').title = `${S.settings.baby_full_name || name} — due ${nice(due)}`;
  }
  const r = (location.hash.slice(1).split('/')[0]) || 'calendar';
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r || (r === 'day' && a.dataset.r === 'calendar')));
}

// ---------- notifications ----------
async function pollNotifications(show = false) {
  if (!S.me) return;
  try {
    const list = await api('notifications');
    const unread = list.filter((n) => !n.is_read);
    $('#bell-n').hidden = !unread.length; $('#bell-n').textContent = unread.length;
    const newest = list[0]?.id || 0;
    if (S.lastNotif && newest > S.lastNotif && 'Notification' in window && Notification.permission === 'granted') {
      unread.filter((n) => n.id > S.lastNotif).slice(0, 3).forEach((n) => new Notification('The Stewart Nest', { body: n.text, icon: '/icon.svg' }));
    }
    S.lastNotif = Math.max(S.lastNotif, newest);
    if (show) {
      const p = $('#notif-panel');
      p.innerHTML = `<div class="spread"><strong>Notifications</strong><button class="btn small ghost" id="n-close">Close</button></div>` +
        (list.length ? list.map((n) => `<div class="n-item ${n.is_read ? '' : 'unread'}">${n.link ? `<a href="${esc(n.link)}">${esc(n.text)}</a>` : esc(n.text)}
          <div class="muted">${new Date(n.created_at + 'Z').toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</div></div>`).join('')
          : '<div class="empty">Nothing yet</div>');
      p.hidden = false;
      $('#n-close').onclick = () => (p.hidden = true);
      $$('a', p).forEach((a) => a.addEventListener('click', () => (p.hidden = true)));
      if (unread.length) { await api('notifications/read', { body: {} }); $('#bell-n').hidden = true; }
    }
  } catch { /* ignore */ }
}

// ---------- login ----------
async function viewLogin() {
  S.users = await api('users');
  let sel = null, pin = '';
  const v = $('#view');
  v.innerHTML = `<div class="login">
    <div class="logo">🪺</div><h1>The Stewart Nest</h1><div class="muted">Who's there?</div>
    <div class="who">${S.users.map((u) => `<button data-u="${u.id}"><span class="e">${u.emoji}</span>${esc(u.name)}</button>`).join('')}</div>
    <div id="pin-area" hidden>
      <div id="pin-msg" class="muted"></div>
      <div class="dots">${'<i></i>'.repeat(4)}</div>
      <div class="err" id="err"></div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>
    </div></div>`;
  const dots = () => $$('.dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
  $$('.who button').forEach((b) => b.onclick = () => {
    sel = S.users.find((u) => u.id === b.dataset.u); pin = ''; dots(); $('#err').textContent = '';
    $$('.who button').forEach((x) => x.classList.toggle('sel', x === b));
    $('#pin-area').hidden = false;
    $('#pin-msg').textContent = sel.has_pin ? `Hi ${sel.name}, enter your PIN` : `Hi ${sel.name}! First time — choose a 4-digit PIN you'll remember`;
  });
  $$('.pad button').forEach((b) => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
    dots();
    if (pin.length === 4) {
      try {
        const r = await api('login', { body: { user: sel.id, pin } });
        if (r.firstTime) toast('PIN saved. Welcome to the Nest!');
        await boot();
      } catch (e) { $('#err').textContent = e.message; pin = ''; dots(); }
    }
  });
}

// ---------- calendar ----------
async function viewCalendar() {
  const ym = S.month;
  const [y, m] = ym.split('-').map(Number);
  let data = await api('month?ym=' + ym);
  if (!data.menu.length) {
    // First visit to a month: build its menu from the rotation (season picked automatically)
    await api('menu/generate', { body: { ym } });
    data = await api('month?ym=' + ym);
  }
  await loadWeather();
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const nDays = new Date(y, m, 0).getDate();
  const today = todayStr();
  const by = (arr) => arr.reduce((a, r) => ((a[r.date] = a[r.date] || []).push(r), a), {});
  const menu = Object.fromEntries(data.menu.map((r) => [r.date, r]));
  const plans = by(data.plans), notes = Object.fromEntries(data.notes.map((r) => [r.date, r.n]));
  const tasks = Object.fromEntries(data.tasks.map((r) => [r.date, r]));
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= nDays; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const s = menu[date], wx = S.weather[date];
    const outdoorToday = (s && s.outdoor && !s.use_backup) || (plans[date] || []).some((p) => p.outdoor && !p.use_rain);
    const rainy = rainLikely(date) && outdoorToday;
    const usingBackup = s && s.use_backup;
    const t = tasks[date];
    cells += `<div class="cell ${date === today ? 'today' : ''} ${date < today ? 'past' : ''} ${rainy ? 'rainy' : ''}" data-d="${date}">
      <div class="n"><span>${d}</span>${wx ? `<span class="wx" title="${wx.rain}% chance of rain">${wxIcon(wx.code)}${wx.rain >= 30 ? wx.rain + '%' : ''}</span>` : ''}</div>
      ${s ? `<div class="meal ${usingBackup ? 'backup' : ''}">${usingBackup ? '☔ ' + esc(s.backup_name.replace(/^Rain plan: /, '')) : (s.outdoor ? '🔥 ' : '') + esc(s.name)}</div>` : ''}
      <div class="marks">
        ${rainy ? '<span class="badge rain">☔ rain?</span>' : ''}
        ${(plans[date] || []).length ? `<span class="badge">📌${plans[date].length}</span>` : ''}
        ${notes[date] ? `<span class="badge">📝${notes[date]}</span>` : ''}
        ${t && t.open ? `<span class="badge ${date < today ? 'warn' : ''}">🧹${t.open}</span>` : ''}
      </div></div>`;
  }
  $('#view').innerHTML = `
    <div class="cal-head">
      <button class="btn small ghost" id="prev">‹</button>
      <h1 style="margin:0">${first.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</h1>
      <button class="btn small ghost" id="next">›</button>
    </div>
    <div class="row wrap" style="margin-bottom:8px">
      <span class="muted grow">Hi ${esc(S.me.name)}. Tap a day for meals, plans, notes and tasks.</span>
      ${ym !== today.slice(0, 7) ? '<button class="btn small ghost" id="this">This month</button>' : ''}
    </div>
    <div class="cal">${WD.map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <p class="muted">🔥 braai (needs a dry day) · ☔ rain likely, so look at the rain plan · 📌 plans · 📝 notes · 🧹 your open tasks</p>`;
  $('#prev').onclick = () => { S.month = ymd(new Date(y, m - 2, 1)).slice(0, 7); viewCalendar(); };
  $('#next').onclick = () => { S.month = ymd(new Date(y, m, 1)).slice(0, 7); viewCalendar(); };
  $('#this') && ($('#this').onclick = () => { S.month = today.slice(0, 7); viewCalendar(); });
  $$('.cell[data-d]').forEach((c) => c.onclick = () => (location.hash = '#day/' + c.dataset.d));
}

// ---------- one day ----------
async function viewDay(date) {
  const today = todayStr();
  const [d, t, recipes] = await Promise.all([
    api('day?date=' + date),
    api(`tasks?date=${date}&today=${today}`),
    S.recipes ? Promise.resolve(S.recipes) : api('recipes'),
  ]);
  S.recipes = recipes;
  await loadWeather();
  const wx = S.weather[date];
  const portions = (p) => { try { const a = JSON.parse(p || '[]'); return a.length ? `<div class="muted">Lee Roy: ${esc(a[0])}<br>Shirley: ${esc(a[1])}<br>Skyler: ${esc(a[2])}</div>` : ''; } catch { return ''; } };
  const meals = ['b', 'l', 's'].map((k) => {
    const m = d.menu.find((x) => x.meal === k);
    const opts = recipes.filter((r) => r.meal === k && r.active && !r.id.endsWith('r'))
      .map((r) => `<option value="${r.id}" ${m && m.recipe_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    if (!m) return `<div class="card meal-card"><div class="lbl">${MEAL[k]}</div><select data-meal="${k}"><option value="">Choose…</option>${opts}</select></div>`;
    const showBackup = m.use_backup && m.backup_name;
    const rainWarn = m.outdoor && !m.use_backup && rainLikely(date);
    return `<div class="card meal-card">
      <div class="spread"><span class="lbl">${MEAL[k]}</span>${m.outdoor ? (m.use_backup ? '<span class="badge rain">☔ rain plan on</span>' : '<span class="badge">🔥 outdoor</span>') : ''}</div>
      <div class="name">${esc(showBackup ? m.backup_name : m.name)}</div>
      ${showBackup ? `<div class="muted">Instead of: ${esc(m.name)}</div>` : ''}
      ${rainWarn ? `<div class="rain-box">☔ ${wx.rain}% chance of rain. The rain plan is <strong>${esc(m.backup_name)}</strong>.</div>` : ''}
      <details><summary>Portions & method</summary>${portions(showBackup ? m.backup_portions : m.portions)}<p>${esc(showBackup ? m.backup_method : m.method)}</p></details>
      <div class="row wrap" style="margin-top:8px">
        <select data-meal="${k}" class="grow" style="max-width:70%">${opts}</select>
        ${m.rain_backup ? `<button class="btn small ${m.use_backup ? 'ghost' : 'rain'}" data-backup="${m.use_backup ? 0 : 1}">${m.use_backup ? 'Back to braai' : '☔ Use rain plan'}</button>` : ''}
      </div></div>`;
  }).join('');

  const plans = d.plans.map((p) => `<div class="card">
      <div class="spread"><strong>${p.time ? esc(p.time) + ' · ' : ''}${esc(p.use_rain && p.rain_plan ? p.rain_plan : p.title)}</strong>
        <button class="btn small danger" data-delplan="${p.id}">✕</button></div>
      ${p.use_rain ? `<div class="muted">☔ Rain plan instead of: ${esc(p.title)}</div>` : ''}
      ${p.outdoor && p.rain_plan && !p.use_rain ? `<div class="rain-box">Rain plan: ${esc(p.rain_plan)}${rainLikely(date) ? ` (${wx.rain}% chance of rain)` : ''}</div>` : ''}
      ${p.outdoor && !p.rain_plan ? '<div class="muted">⚠️ Outdoor, with no rain plan yet</div>' : ''}
      <div class="row" style="margin-top:6px"><span class="muted grow">Added by ${esc(p.by_name || '')}</span>
      ${p.outdoor && p.rain_plan ? `<button class="btn small ${p.use_rain ? 'ghost' : 'rain'}" data-rainplan="${p.id}" data-v="${p.use_rain ? 0 : 1}">${p.use_rain ? 'Back to original' : '☔ Switch to rain plan'}</button>` : ''}</div>
    </div>`).join('') || '<div class="muted">No plans yet.</div>';

  const notes = d.notes.map((n) => `<div class="note" style="border-color:${n.colour}">
      <div class="spread"><span>${n.emoji} <strong>${esc(n.name)}</strong></span>
      ${(n.user_id === S.me.id || S.me.is_parent) ? `<button class="btn small danger" data-delnote="${n.id}">✕</button>` : ''}</div>
      ${esc(n.text).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="muted">No notes yet.</div>';

  const tasks = t.tasks.length ? t.tasks.map(taskRow).join('') : '<div class="muted">No tasks for this day.</div>';
  const upcoming = t.upcoming?.length ? `<h3>Repeating chores that will show up</h3><div class="card">${t.upcoming.map((u) =>
    `<div class="muted"><span class="who-dot" style="background:${u.colour}"></span>${esc(u.assignee_name)}: ${esc(u.title)} (${u.points} pts)</div>`).join('')}</div>` : '';

  $('#view').innerHTML = `
    <div class="spread"><button class="btn small ghost" id="dprev">‹</button>
      <h1 style="margin:0;text-align:center">${nice(date)}</h1>
      <button class="btn small ghost" id="dnext">›</button></div>
    ${wx ? `<div class="card wx-line">${wxIcon(wx.code)} <span>${wx.min}°–${wx.max}°C</span> <span class="${rainLikely(date) ? 'badge rain' : 'muted'}">${wx.rain}% chance of rain</span></div>` : ''}
    <h2>🍽️ Meals</h2>${meals}
    <h2>📌 Plans</h2>${plans}
    <details class="card"><summary><strong>+ Add a plan</strong></summary>
      <label class="f">What</label><input type="text" id="p-title" placeholder="e.g. Braai with the Steyns">
      <label class="f">Time (optional)</label><input type="time" id="p-time">
      <label class="row" style="margin-top:8px"><input type="checkbox" id="p-out"> Outdoor (needs a dry day)</label>
      <label class="f">Rain-out plan</label><input type="text" id="p-rain" placeholder="e.g. Move inside: oven-grill and board games">
      <button class="btn" style="margin-top:10px" id="p-add">Add plan</button>
    </details>
    <h2>📝 Notes</h2>${notes}
    <div class="card"><textarea id="n-text" placeholder="Add a note for this day…"></textarea>
      <button class="btn" style="margin-top:8px" id="n-add">Add note</button></div>
    <h2>🧹 Tasks</h2><div class="card">${tasks}</div>${upcoming}
    <button class="btn ghost" onclick="location.hash='#tasks/new/${date}'">+ Give someone a task for this day</button>`;

  $('#dprev').onclick = () => (location.hash = '#day/' + addDays(date, -1));
  $('#dnext').onclick = () => (location.hash = '#day/' + addDays(date, 1));
  $$('select[data-meal]').forEach((s) => s.onchange = async () => { await put('menu', { date, meal: s.dataset.meal, recipe_id: s.value }); toast('Meal changed'); viewDay(date); });
  $$('[data-backup]').forEach((b) => b.onclick = async () => { await put('menu/backup', { date, meal: 's', use_backup: b.dataset.backup === '1' }); toast(b.dataset.backup === '1' ? 'Rain plan on. The family has been told.' : 'Back to the braai'); viewDay(date); });
  $$('[data-rainplan]').forEach((b) => b.onclick = async () => { await put('plans/' + b.dataset.rainplan, { use_rain: b.dataset.v === '1' }); viewDay(date); });
  $$('[data-delplan]').forEach((b) => b.onclick = async () => { if (confirm('Remove this plan?')) { await del('plans/' + b.dataset.delplan); viewDay(date); } });
  $$('[data-delnote]').forEach((b) => b.onclick = async () => { await del('notes/' + b.dataset.delnote); viewDay(date); });
  $('#p-add').onclick = async () => {
    const title = $('#p-title').value.trim(); if (!title) return toast('What is the plan?');
    await api('plans', { body: { date, title, time: $('#p-time').value, outdoor: $('#p-out').checked, rain_plan: $('#p-rain').value.trim() } });
    toast('Plan added'); viewDay(date);
  };
  $('#n-add').onclick = async () => {
    const text = $('#n-text').value.trim(); if (!text) return;
    await api('notes', { body: { date, text } }); toast('Note added'); viewDay(date);
  };
  wireTasks(() => viewDay(date), date);
}

// ---------- tasks ----------
function taskRow(t) {
  const late = !t.done_at && t.late_days > 0;
  const lateDone = t.done_at && t.late_days > 0;
  const mineOrParent = t.assignee === S.me.id || S.me.is_parent;
  return `<div class="task ${t.done_at ? 'done' : ''} ${late ? 'late' : ''}">
    <button class="tick" data-tick="${t.id}" data-done="${t.done_at ? 0 : 1}" ${mineOrParent ? '' : 'disabled title="Only ' + esc(t.assignee_name) + ' can tick this"'}>${t.done_at ? '✓' : ''}</button>
    <div class="grow">
      <div class="t">${esc(t.title)}</div>
      <div class="muted"><span class="who-dot" style="background:${t.colour}"></span>${esc(t.assignee_name)} · ${esc(t.area)} · ${t.points} pts
        ${t.assigned_by_name && t.assigned_by !== t.assignee ? ` · from ${esc(t.assigned_by_name)}` : ''}${t.template_id ? ' · 🔁' : ''}</div>
      ${t.note ? `<div class="muted">“${esc(t.note)}”</div>` : ''}
      ${late ? `<span class="badge warn">Carried over from ${short(t.due_date)} · ${t.late_days} day${t.late_days > 1 ? 's' : ''} late</span>` : ''}
      ${lateDone ? `<span class="badge warn">Done ${t.late_days} day${t.late_days > 1 ? 's' : ''} late, half points</span>` : ''}
      ${t.done_at && !lateDone ? `<span class="badge ok">On time +${t.earned}</span>` : ''}
    </div>
    ${(!t.template_id && (t.assigned_by === S.me.id || S.me.is_parent)) ? `<button class="btn small danger" data-deltask="${t.id}" title="Remove">✕</button>` : ''}
  </div>`;
}
function wireTasks(refresh, date) {
  $$('[data-tick]').forEach((b) => b.onclick = async () => {
    const done = b.dataset.done === '1';
    await api(`tasks/${b.dataset.tick}/done`, { body: { done, date: date && date < todayStr() ? date : todayStr() } });
    if (done) toast('Nice one! ✅');
    refresh();
  });
  $$('[data-deltask]').forEach((b) => b.onclick = async () => { if (confirm('Remove this task?')) { await del('tasks/' + b.dataset.deltask); refresh(); } });
}

async function viewToday() {
  const today = todayStr();
  const mine = S.taskView === 'mine';
  const t = await api(`tasks?date=${today}&today=${today}${mine ? '&user=' + S.me.id : ''}`);
  const open = t.tasks.filter((x) => !x.done_at), done = t.tasks.filter((x) => x.done_at);
  const carried = open.filter((x) => x.late_days > 0), fresh = open.filter((x) => x.late_days === 0);
  const pts = done.reduce((s, x) => s + x.earned, 0);
  $('#view').innerHTML = `
    <div class="spread"><h1>${mine ? 'My checklist' : 'Family checklist'}</h1>
      <div class="seg"><button data-v="mine" class="${mine ? 'on' : ''}">Mine</button><button data-v="all" class="${mine ? '' : 'on'}">Everyone</button></div></div>
    <div class="muted">${nice(today)} · ${open.length} to do · ${done.length} done · +${pts} pts today</div>
    ${carried.length ? `<h2>⏳ Carried over</h2><div class="card">${carried.map(taskRow).join('')}</div>` : ''}
    <h2>Today</h2><div class="card">${fresh.length ? fresh.map(taskRow).join('') : `<div class="empty">${open.length ? 'Only carried-over tasks left 👆' : 'All done for today! 🎉'}</div>`}</div>
    ${done.length ? `<h2>Done today</h2><div class="card">${done.map(taskRow).join('')}</div>` : ''}
    <button class="btn ghost" onclick="location.hash='#tasks/new'">+ Give someone a task</button>`;
  $$('.seg button').forEach((b) => b.onclick = () => { S.taskView = b.dataset.v; viewToday(); });
  wireTasks(viewToday);
}

async function viewTasks(sub, presetDate) {
  const today = todayStr();
  const [t, tpls] = await Promise.all([api(`tasks?date=${today}&today=${today}`), api('templates')]);
  const open = t.tasks.filter((x) => !x.done_at);
  const areas = S.me.areas;
  const byArea = areas.map((a) => [a, open.filter((x) => x.area === a)]).filter(([, l]) => l.length);
  const dayBoxes = WD.map((w, i) => `<label><input type="checkbox" value="${i + 1}"><span>${w}</span></label>`).join('');
  $('#view').innerHTML = `
    <h1>Tasks</h1>
    <details class="card" id="new-box" ${sub === 'new' ? 'open' : ''}><summary><strong>+ Give someone a task</strong></summary>
      <label class="f">Task</label><input type="text" id="t-title" placeholder="e.g. Pack away the washing">
      <div class="row">
        <div class="grow"><label class="f">For</label><select id="t-who">${S.users.map((u) => `<option value="${u.id}" ${u.id === S.me.id ? '' : ''}>${u.emoji} ${esc(u.name)}</option>`).join('')}</select></div>
        <div class="grow"><label class="f">Area</label><select id="t-area">${areas.map((a) => `<option>${a}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="grow"><label class="f">Due</label><input type="date" id="t-due" value="${presetDate || today}"></div>
        <div style="width:90px"><label class="f">Points</label><input type="number" id="t-pts" value="5" min="1" max="50"></div>
      </div>
      <label class="f">Repeat every… (leave empty for a one-off)</label>
      <div class="days-pick" id="t-days">${dayBoxes}</div>
      <label class="f">Note (optional)</label><input type="text" id="t-note" placeholder="Anything they should know">
      <button class="btn" style="margin-top:10px" id="t-add">Give task</button>
      <div class="muted" style="margin-top:6px">They get a notification. Tasks not ticked off carry over to the next day, and late ones earn half points.</div>
    </details>
    <h2>Open tasks by area</h2>
    ${byArea.length ? byArea.map(([a, l]) => `<h3>${a}</h3><div class="card">${l.map(taskRow).join('')}</div>`).join('') : '<div class="card empty">Nothing open. 🎉</div>'}
    <h2>🔁 Repeating chores</h2>
    <div class="card">${tpls.map((x) => `<div class="recipe-row"><span>${x.emoji} <strong>${esc(x.title)}</strong><br>
      <span class="muted">${esc(x.area)} · ${x.days === '1234567' ? 'every day' : [...x.days].map((d) => WD[d - 1]).join(', ')} · ${x.points} pts</span></span>
      ${S.me.is_parent || x.created_by === S.me.id ? `<button class="btn small danger" data-deltpl="${x.id}">Stop</button>` : ''}</div>`).join('') || '<div class="empty">None</div>'}</div>`;
  if (sub === 'new') setTimeout(() => $('#t-title').focus(), 50);
  $('#t-add').onclick = async () => {
    const title = $('#t-title').value.trim(); if (!title) return toast('What is the task?');
    const repeat = $$('#t-days input:checked').map((c) => c.value).join('');
    await api('tasks', { body: { title, assignee: $('#t-who').value, area: $('#t-area').value, due_date: $('#t-due').value, points: $('#t-pts').value, note: $('#t-note').value, repeat_days: repeat } });
    toast(repeat ? 'Repeating chore added' : 'Task given');
    location.hash = '#tasks'; viewTasks();
  };
  $$('[data-deltpl]').forEach((b) => b.onclick = async () => { if (confirm('Stop repeating this chore? Any open one stays on the list.')) { await del('templates/' + b.dataset.deltpl); viewTasks(); } });
  wireTasks(() => viewTasks());
}

// ---------- rewards ----------
async function viewRewards(weekArg) {
  const today = todayStr();
  const r = await api(`rewards?today=${today}${weekArg ? '&week=' + weekArg : ''}`);
  const cards = r.users.map((u) => {
    const pct = u.target ? Math.min(100, Math.round((u.points / u.target) * 100)) : 0;
    const reached = u.target && u.points >= u.target;
    const rate = u.possible ? Math.round(((u.on_time + u.late) / Math.max(1, u.on_time + u.late + u.open)) * 100) : 0;
    return `<div class="card">
      <div class="spread"><strong>${u.emoji} ${esc(u.name)}</strong><span>${u.points}${u.target ? ' / ' + u.target : ''} pts</span></div>
      ${u.target ? `<div class="bar ${reached ? 'full' : ''}"><i style="width:${pct}%"></i></div>` : ''}
      <div class="muted">🎁 ${esc(u.reward || 'No reward set')}</div>
      <div class="stats" style="margin-top:6px">
        <span class="badge ok">✅ ${u.on_time} on time</span><span class="badge warn">⏳ ${u.late} late</span>
        <span class="badge ${u.open ? 'warn' : ''}">📋 ${u.open} still open</span><span class="badge">${rate}% done</span>
      </div>
      ${u.claimed ? `<div style="margin-top:8px" class="badge ok">🏆 Reward given by ${esc(user(u.claimed.approved_by).name)}</div>`
        : reached && S.me.is_parent ? `<button class="btn" style="margin-top:8px" data-claim="${u.id}" data-pts="${u.points}" data-rw="${esc(u.reward)}">🏆 Hand out reward</button>`
        : reached ? '<div style="margin-top:8px" class="badge ok">🎉 Target reached! Ask Mom or Dad.</div>' : ''}
      ${S.me.is_parent ? `<details style="margin-top:8px"><summary class="muted">Change goal</summary>
        <div class="row" style="margin-top:6px"><input type="number" style="width:90px" value="${u.target || 0}" data-gt="${u.id}">
        <input type="text" class="grow" value="${esc(u.reward || '')}" data-gr="${u.id}"><button class="btn small" data-gs="${u.id}">Save</button></div></details>` : ''}
    </div>`;
  }).join('');
  $('#view').innerHTML = `
    <div class="spread"><button class="btn small ghost" id="wprev">‹</button>
      <h1 style="margin:0;text-align:center">Week of ${short(r.week)}</h1>
      <button class="btn small ghost" id="wnext" ${r.end >= today ? 'disabled' : ''}>›</button></div>
    <p class="muted">Points from ticked tasks, Monday to Sunday. Done on the day = full points; carried over and done late = half points.</p>
    ${cards}`;
  $('#wprev').onclick = () => viewRewards(addDays(r.week, -7));
  $('#wnext').onclick = () => viewRewards(addDays(r.week, 7));
  $$('[data-claim]').forEach((b) => b.onclick = async () => {
    await api('rewards/claim', { body: { user_id: b.dataset.claim, week_start: r.week, points: Number(b.dataset.pts), reward: b.dataset.rw } });
    toast('Reward handed out 🏆'); viewRewards(r.week);
  });
  $$('[data-gs]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.gs;
    await put('rewards/goal', { user_id: id, target: $(`[data-gt="${id}"]`).value, reward: $(`[data-gr="${id}"]`).value });
    toast('Goal saved'); viewRewards(r.week);
  });
}

// ---------- more / settings ----------
async function viewMore() {
  const recipes = S.recipes = await api('recipes');
  const sup = recipes.filter((r) => r.meal === 's' && !r.id.endsWith('r'));
  const notifState = !('Notification' in window) ? 'not supported in this browser'
    : Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked (allow them in your browser settings)' : 'off';
  $('#view').innerHTML = `
    <h1>More</h1>
    <div class="card"><div class="spread"><span>${S.me.emoji} <strong>${esc(S.me.full_name || S.me.name)}</strong></span><button class="btn small ghost" id="logout">Log out</button></div></div>

    <h2>🔔 Notifications</h2>
    <div class="card"><div class="spread"><span>Pop-up alerts on this device: <strong>${notifState}</strong></span>
      ${'Notification' in window && Notification.permission === 'default' ? '<button class="btn small" id="notif-on">Turn on</button>' : ''}</div>
      <div class="muted">The 🔔 at the top always shows new tasks, rain changes, notes and rewards.</div></div>

    <h2>🍽️ Menu</h2>
    <div class="card">
      <div class="row wrap">
        <input type="month" id="g-month" value="${S.month}" style="width:auto">
        <select id="g-season" style="width:auto"><option value="auto">Season: automatic</option><option value="summer">Summer menu</option><option value="winter">Winter menu</option></select>
        <button class="btn small" id="g-go">Rebuild month</button>
      </div>
      <div class="muted" style="margin-top:6px">Automatic uses summer (Oct–Mar: braais, salads) or winter (Apr–Sep: soups, stews). Rebuilding replaces that month's meals, including swaps you made.</div>
    </div>
    <div class="card"><strong>Suppers in rotation</strong><div class="muted">Untick a meal that's out of season, too pricey or not in stock. New menus skip it.</div>
      ${sup.map((r) => `<div class="recipe-row"><label class="row grow"><input type="checkbox" data-rec="${r.id}" ${r.active ? 'checked' : ''}> ${r.outdoor ? '🔥 ' : ''}${esc(r.name)}</label>
        <select data-season="${r.id}" style="width:auto"><option value="all" ${r.season === 'all' ? 'selected' : ''}>All year</option><option value="summer" ${r.season === 'summer' ? 'selected' : ''}>Summer</option><option value="winter" ${r.season === 'winter' ? 'selected' : ''}>Winter</option></select></div>`).join('')}
    </div>

    ${S.me.is_parent ? `<h2>👶 ${esc(S.settings.baby_name || 'Baby')}</h2>
    <div class="card"><label class="f">Full name</label><input type="text" id="s-bfull" value="${esc(S.settings.baby_full_name || '')}">
      <label class="f">Due date</label><input type="date" id="s-due" value="${esc(S.settings.baby_due || '')}">
      <label class="f">Rain warning when chance of rain is at least (%)</label><input type="number" id="s-rain" value="${esc(S.settings.rain_threshold || 50)}" min="10" max="100">
      <button class="btn" style="margin-top:10px" id="s-save">Save</button></div>` : ''}

    <h2>🔐 PIN</h2>
    <div class="card"><div class="row"><input type="password" inputmode="numeric" maxlength="4" id="pin-old" placeholder="Old PIN">
      <input type="password" inputmode="numeric" maxlength="4" id="pin-new" placeholder="New PIN"><button class="btn small" id="pin-go">Change</button></div>
      ${S.me.is_parent ? `<div class="muted" style="margin-top:8px">Forgotten PIN? Reset it, and that person picks a new one the next time they log in:</div>
      <div class="row wrap" style="margin-top:6px">${S.users.filter((u) => u.id !== S.me.id).map((u) => `<button class="btn small ghost" data-reset="${u.id}">Reset ${esc(u.name)}</button>`).join('')}</div>` : ''}
    </div>
    <p class="muted">Coming in Phase 2: family chat, fun-time ideas, ${esc(S.settings.baby_name || 'baby')}'s going-out bag and monthly buy list, stock take, barcode and photo inventory, and workouts.</p>`;

  $('#logout').onclick = async () => { await api('logout', { body: {} }); S.me = null; location.hash = '#login'; route(); };
  $('#notif-on') && ($('#notif-on').onclick = async () => { await Notification.requestPermission(); viewMore(); });
  $('#g-go').onclick = async () => {
    const ym = $('#g-month').value; if (!ym) return;
    if (!confirm(`Rebuild the whole menu for ${ym}? Meal swaps for that month will be lost.`)) return;
    const r = await api('menu/generate', { body: { ym, season: $('#g-season').value, overwrite: true } });
    toast(`${r.season[0].toUpperCase() + r.season.slice(1)} menu built for ${r.days} days`);
    S.month = ym;
  };
  $$('[data-rec]').forEach((c) => c.onchange = () => put('recipes/' + c.dataset.rec, { active: c.checked ? 1 : 0 }).then(() => toast('Saved')));
  $$('[data-season]').forEach((s) => s.onchange = () => put('recipes/' + s.dataset.season, { season: s.value }).then(() => toast('Saved')));
  $('#s-save') && ($('#s-save').onclick = async () => {
    S.settings = await put('settings', { baby_full_name: $('#s-bfull').value, baby_due: $('#s-due').value, rain_threshold: $('#s-rain').value });
    renderHeader(); toast('Saved');
  });
  $('#pin-go').onclick = async () => {
    try { await api('pin', { body: { old: $('#pin-old').value, pin: $('#pin-new').value } }); toast('PIN changed'); $('#pin-old').value = $('#pin-new').value = ''; }
    catch (e) { toast(e.message); }
  };
  $$('[data-reset]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Reset ${user(b.dataset.reset).name}'s PIN?`)) return;
    await api(`users/${b.dataset.reset}/reset-pin`, { body: {} }); toast('PIN reset');
  });
}

// ---------- routing ----------
async function route() {
  const [r, a, b] = location.hash.slice(1).split('/');
  $('#notif-panel').hidden = true;
  if (!S.me && r !== 'login') { location.hash = '#login'; return; }
  renderHeader();
  window.scrollTo(0, 0);
  try {
    if (r === 'login') return S.me ? (location.hash = '#calendar') : viewLogin();
    if (r === 'day' && a) return viewDay(a);
    if (r === 'today') return viewToday();
    if (r === 'tasks') return viewTasks(a, b);
    if (r === 'rewards') return viewRewards();
    if (r === 'more') return viewMore();
    return viewCalendar();
  } catch (e) { toast(e.message); }
}

async function boot() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (me.ok) {
      S.me = await me.json();
      [S.users, S.settings] = await Promise.all([api('users'), api('settings')]);
      pollNotifications();
      if (location.hash === '#login' || !location.hash) { location.hash = '#calendar'; return; } // hashchange will route
    }
  } catch { /* offline */ }
  route();
}

window.addEventListener('hashchange', route);
$('#bell').onclick = () => pollNotifications(true);
$('#me-btn').onclick = () => (location.hash = '#more');
setInterval(() => pollNotifications(), 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNotifications(); });
boot();
