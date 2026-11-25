// The Stewart Nest — permissions editor, "Mom/Dad" names for children, birthdays & star signs,
// and the Islamic calendar layer (holy days + daily prayer times) that each person can switch on/off.
'use strict';

// ================= star signs =================
const SIGNS = [
  ['♑', 'Capricorn', '01-19'], ['♒', 'Aquarius', '02-18'], ['♓', 'Pisces', '03-20'], ['♈', 'Aries', '04-19'],
  ['♉', 'Taurus', '05-20'], ['♊', 'Gemini', '06-20'], ['♋', 'Cancer', '07-22'], ['♌', 'Leo', '08-22'],
  ['♍', 'Virgo', '09-22'], ['♎', 'Libra', '10-22'], ['♏', 'Scorpio', '11-21'], ['♐', 'Sagittarius', '12-21'], ['♑', 'Capricorn', '12-31'],
];
const starSign = (mmdd) => { const s = SIGNS.find(([, , end]) => mmdd <= end); return { icon: s[0], name: s[1] }; };
const mmdd = (d) => (d || '').slice(-5);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function nextOccurrence(md) {
  const today = todayStr(); const y = Number(today.slice(0, 4));
  let d = `${y}-${md}`; if (d < today) d = `${y + 1}-${md}`;
  return { date: d, days: Math.round((toD(d) - toD(today)) / 86400000) };
}
const niceMD = (md) => `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1]}`;
function dayMonthPicker(id, md) {
  const [m, d] = md ? md.split('-').map(Number) : [0, 0];
  return `<div class="row"><select id="${id}-d" style="width:80px"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option ${d === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    <select id="${id}-m" class="grow"><option value="">Month</option>${MONTHS.map((n, i) => `<option value="${i + 1}" ${m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <input type="number" id="${id}-y" placeholder="Year (optional)" style="width:130px"></div>`;
}
function readPicker(id, root = document) {
  const d = $(`#${id}-d`, root).value, m = $(`#${id}-m`, root).value, y = $(`#${id}-y`, root).value;
  if (!d || !m) return null;
  const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return /^\d{4}$/.test(y) ? `${y}-${md}` : md;
}

// ================= Family profiles (admin) — replaces the earlier screen =================
ROUTES.users = async () => {
  if (!S.me.is_admin) { location.hash = '#hub'; return; }
  const { perms, users } = await api('admin/users');
  const status = (u) => !u.active ? '<span class="badge">Switched off</span>'
    : !u.has_password ? '<span class="badge warn">No password yet</span>'
    : u.locked ? '<span class="badge warn">Locked (wrong passwords)</span>'
    : u.must_change ? '<span class="badge rain">Temporary password, must change it</span>' : '<span class="badge ok">Password set</span>';
  $('#view').innerHTML = `<h1>👥 Family profiles</h1>
    <p class="muted">You're the admin. Tap ✏️ to change what each person may do, their birthday, and what the children call them.
      Everyone can always see the calendar, do and tick their own tasks, rate meals and upload photos.</p>
    ${users.map((u) => {
      const on = Object.keys(perms).filter((k) => u.perms[k]);
      const sign = u.birthday ? starSign(mmdd(u.birthday)) : null;
      return `<div class="card" style="${u.active ? '' : 'opacity:.6'}">
        <div class="spread"><strong>${u.emoji} ${esc(u.full_name || u.name)}</strong>${u.is_admin ? '<span class="badge">Admin</span>' : u.is_parent ? '<span class="badge">Grown-up</span>' : '<span class="badge">Child</span>'}</div>
        <div class="muted" style="margin:4px 0">${u.birthday ? `🎂 ${niceMD(mmdd(u.birthday))} · ${sign.icon} ${sign.name}` : '🎂 no birthday set'}${u.kid_name ? ` · the kids call them "${esc(u.kid_name)}"` : ''}</div>
        <div style="margin:6px 0">${status(u)}</div>
        <div class="muted">${u.is_admin ? 'Can do everything.' : on.length === Object.keys(perms).length ? 'Can do everything except manage profiles.' : on.length ? 'Also allowed: ' + on.map((k) => perms[k].split(',')[0]).join(' · ') : 'Own tasks, ratings and photos only.'}</div>
        <div class="row wrap" style="margin-top:8px">
          ${u.id !== S.me.id ? `<button class="btn small" data-temp="${u.id}">🔑 Temporary password</button>` : ''}
          <button class="btn small ghost" data-edit="${u.id}">✏️ Edit</button></div></div>`;
    }).join('')}
    <details class="card"><summary><strong>+ Add a family member</strong></summary>
      <p class="muted">E.g. Madilea later on, or a grandparent who helps out.</p>
      <div class="row"><div class="grow"><label class="f">Short name</label><input type="text" id="nu-name"></div>
        <div style="width:80px"><label class="f">Emoji</label><input type="text" id="nu-emoji" value="🙂"></div></div>
      <label class="f">Full name</label><input type="text" id="nu-full">
      <label class="row" style="margin-top:8px"><input type="checkbox" id="nu-parent"> Grown-up (starts with all permissions)</label>
      <label class="f">Birthday</label>${dayMonthPicker('nu-bd', '')}
      <label class="f">Temporary password (6+ characters)</label><input type="text" id="nu-pw" autocomplete="off">
      <button class="btn" style="margin-top:10px" id="nu-add">Add</button></details>`;

  $$('[data-temp]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => x.id === b.dataset.temp);
    const sug = ['nest', 'braai', 'rooibos', 'koeksister', 'biltong', 'protea'][Math.floor(Math.random() * 6)] + (100 + Math.floor(Math.random() * 900));
    const s = sheet(`<h2 style="margin-top:0">Temporary password for ${esc(u.name)}</h2>
      <p class="muted">Tell ${esc(u.name)} this password. They use it once, then pick their own.</p>
      <input type="text" id="tp" value="${sug}" autocomplete="off"><div class="err" id="tp-err"></div>
      <button class="btn" style="width:100%" id="tp-save">Save temporary password</button>`);
    $('#tp-save', s).onclick = async () => {
      try { await api(`admin/users/${u.id}/password`, { body: { password: $('#tp', s).value } }); s.remove(); toast(`${u.name}'s temporary password: ${$('#tp', s).value}`); ROUTES.users(); }
      catch (e) { $('#tp-err', s).textContent = e.message; }
    };
  });

  $$('[data-edit]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => x.id === b.dataset.edit);
    const self = u.id === S.me.id;
    const s = sheet(`<h2 style="margin-top:0">Edit ${esc(u.name)}</h2>
      <div class="row"><div class="grow"><label class="f">Short name</label><input type="text" id="eu-name" value="${esc(u.name)}"></div>
        <div style="width:80px"><label class="f">Emoji</label><input type="text" id="eu-emoji" value="${esc(u.emoji)}"></div></div>
      <label class="f">Full name</label><input type="text" id="eu-full" value="${esc(u.full_name || '')}">
      <label class="f">Birthday</label>${dayMonthPicker('eu-bd', u.birthday ? mmdd(u.birthday) : '')}
      <div class="muted" id="eu-sign"></div>
      <div class="row"><div class="grow"><label class="f">Colour</label><input type="color" id="eu-col" value="${esc(u.colour)}" style="height:40px"></div>
        <div class="grow"><label class="f">What the children call them</label><input type="text" id="eu-kid" value="${esc(u.kid_name || '')}" placeholder="e.g. Mom, Dad, Gran"></div></div>
      <label class="row" style="margin-top:8px"><input type="checkbox" id="eu-parent" ${u.is_parent ? 'checked' : ''}> Grown-up</label>
      <label class="row" style="margin-top:4px"><input type="checkbox" id="eu-admin" ${u.is_admin ? 'checked' : ''} ${self ? 'disabled' : ''}> Admin (everything, incl. profiles & passwords)</label>
      <label class="row" style="margin-top:4px"><input type="checkbox" id="eu-active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Profile switched on (can log in)</label>
      <h3>What ${esc(u.name)} may do</h3>
      ${u.is_admin ? '<div class="muted">Admins can do everything.</div>' : `<div class="perm-list">${Object.entries(perms).map(([k, label]) => `<label><input type="checkbox" data-pk="${k}" ${u.perms[k] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>
      <div class="row" style="margin-top:6px"><button class="btn small ghost" id="eu-all">Tick all</button><button class="btn small ghost" id="eu-none">Own tasks, ratings & photos only</button></div>`}
      <div class="err" id="eu-err"></div>
      <button class="btn" style="width:100%;margin-top:10px" id="eu-save">Save</button>`);
    if (u.birthday && /^\d{4}/.test(u.birthday)) $('#eu-bd-y', s).value = u.birthday.slice(0, 4);
    const showSign = () => { const b2 = readPicker('eu-bd', s); $('#eu-sign', s).textContent = b2 ? `${starSign(mmdd(b2)).icon} ${starSign(mmdd(b2)).name}` : ''; };
    ['d', 'm'].forEach((x) => ($(`#eu-bd-${x}`, s).onchange = showSign)); showSign();
    $('#eu-all', s) && ($('#eu-all', s).onclick = () => $$('[data-pk]', s).forEach((c) => (c.checked = true)));
    $('#eu-none', s) && ($('#eu-none', s).onclick = () => $$('[data-pk]', s).forEach((c) => (c.checked = false)));
    $('#eu-save', s).onclick = async () => {
      const body = { name: $('#eu-name', s).value.trim(), full_name: $('#eu-full', s).value.trim(), emoji: $('#eu-emoji', s).value.trim() || '🙂',
        colour: $('#eu-col', s).value, is_parent: $('#eu-parent', s).checked, kid_name: $('#eu-kid', s).value.trim(), birthday: readPicker('eu-bd', s) };
      if (!self) { body.is_admin = $('#eu-admin', s).checked; body.active = $('#eu-active', s).checked; }
      if ($$('[data-pk]', s).length) body.perms = Object.fromEntries($$('[data-pk]', s).map((c) => [c.dataset.pk, c.checked]));
      try { await put('admin/users/' + u.id, body); s.remove(); toast('Saved'); S.users = await api('users'); applyPerms(); ROUTES.users(); }
      catch (e) { $('#eu-err', s).textContent = e.message; }
    };
  });

  $('#nu-add').onclick = async () => {
    try {
      await api('admin/users', { body: { name: $('#nu-name').value, full_name: $('#nu-full').value, emoji: $('#nu-emoji').value, is_parent: $('#nu-parent').checked, password: $('#nu-pw').value, birthday: readPicker('nu-bd') } });
      toast('Added'); S.users = await api('users'); applyPerms(); ROUTES.users();
    } catch (e) { toast(e.message); }
  };
};

// ================= birthdays & watch list =================
ROUTES.birthdays = async () => {
  const all = (await api('events/all')).events.filter((e) => e.category === 'birthday');
  const rows = all.map((e) => {
    const md = mmdd(e.start_date), n = nextOccurrence(md), sign = starSign(md);
    const fam = e.person ? user(e.person) : null;
    const born = e.notes && /born (\d{4})/i.exec(e.notes);
    const age = born ? Number(n.date.slice(0, 4)) - Number(born[1]) : null;
    return { e, md, n, sign, title: fam ? `${fam.emoji} ${fam.name}` : e.title.replace(/^🎂\s*/, '').replace(/'s birthday$/, ''), fam: !!fam, age };
  }).sort((a, b) => a.n.days - b.n.days);
  const row = (r) => `<div class="bd" ${can('edit_calendar') && !r.fam ? `data-bde="${r.e.id}" style="cursor:pointer"` : ''}>
    <div class="sign" title="${r.sign.name}">${r.sign.icon}</div>
    <div class="grow"><strong>${esc(r.title)}</strong><div class="muted">${niceMD(r.md)} · ${r.sign.name}${r.age ? ` · turns ${r.age}` : ''}${r.e.notes && !r.fam ? ' · ' + esc(r.e.notes.replace(/born \d{4}\.?\s*/i, '')) : ''}</div></div>
    <div style="text-align:right">${r.n.days === 0 ? '<strong>🎉 Today!</strong>' : `<strong>${r.n.days}</strong><div class="muted">days</div>`}</div></div>`;
  $('#view').innerHTML = `<h1>🎂 Birthdays</h1>
    <h2>Our family</h2><div class="card">${rows.filter((r) => r.fam).map(row).join('') || '<div class="muted">Add birthdays in 👥 Family profiles.</div>'}</div>
    <h2>Birthday watch list</h2>
    <div class="card">${rows.filter((r) => !r.fam).map(row).join('') || '<div class="muted">Nobody yet. Add grandparents, aunts, uncles, cousins, friends…</div>'}</div>
    <div class="card" data-perm="edit_calendar"><strong>+ Add someone to the watch list</strong>
      <label class="f">Name</label><input type="text" id="bw-name" placeholder="e.g. Ouma Steyn">
      <label class="f">Who are they? (optional)</label><input type="text" id="bw-rel" placeholder="e.g. Shirley's mom">
      <label class="f">Birthday</label>${dayMonthPicker('bw', '')}
      <label class="f">Reminder</label><select id="bw-rem"><option value="week">A week before (gift time!) + the day before + on the day</option><option value="day_before">The day before</option><option value="morning">On the morning</option><option value="none">No reminder</option></select>
      <button class="btn" style="margin-top:10px" id="bw-add">Add to watch list</button></div>
    <p class="muted">Star signs: ${SIGNS.slice(0, 12).map((s) => s[0] + ' ' + s[1]).join(' · ')}</p>`;
  $('#bw-add') && ($('#bw-add').onclick = async () => {
    const name = $('#bw-name').value.trim(), bd = readPicker('bw');
    if (!name || !bd) return toast('Name and birthday needed');
    const md = mmdd(bd), year = bd.length > 5 ? bd.slice(0, 4) : null;
    await api('events', { body: { title: `🎂 ${name}'s birthday`, category: 'birthday', start_date: `2026-${md}`, repeat: 'yearly', remind: $('#bw-rem').value,
      notes: [year ? `Born ${year}.` : '', $('#bw-rel').value.trim()].filter(Boolean).join(' ') } });
    toast(`${name} added 🎂`); ROUTES.birthdays();
  });
  $$('[data-bde]').forEach((el) => el.onclick = () => eventSheet(all.find((e) => e.id == el.dataset.bde), ROUTES.birthdays));
};

// ================= Islamic calendar layer & prayer times =================
const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const prayerCache = {};
async function prayerTimes(date) {
  const [y, m] = date.split('-');
  const key = `${y}-${m}-${S.settings.islam_method}-${S.settings.islam_school}`;
  if (!prayerCache[key]) {
    const { lat = -26.1016, lon = 27.7695, islam_method = 3, islam_school = 1 } = S.settings;
    try {
      const r = await fetch(`https://api.aladhan.com/v1/calendar/${y}/${Number(m)}?latitude=${lat}&longitude=${lon}&method=${islam_method}&school=${islam_school}`);
      const d = await r.json();
      prayerCache[key] = Object.fromEntries(d.data.map((x) => {
        const [dd, mm, yy] = x.date.gregorian.date.split('-');
        return [`${yy}-${mm}-${dd}`, { times: Object.fromEntries(PRAYERS.map((p) => [p, x.timings[p].slice(0, 5)])), hijri: `${x.date.hijri.day} ${x.date.hijri.month.en} ${x.date.hijri.year}` }];
      }));
    } catch { prayerCache[key] = {}; }
  }
  return prayerCache[key][date];
}
const layerOn = (l) => !!(S.me && S.me.prefs && S.me.prefs[l]);

(window.dayHooks = window.dayHooks || []).push(async function islamHook(date, day) {
  // hide the layer's events if it's switched off for this person
  if (!layerOn('islam')) { $$('#day-events .ev').forEach((el) => { if (/☪️|🌙 Ramadan|Eid al-/.test(el.textContent)) el.remove(); }); return; }
  const box = $('#day-events'); if (!box) return;
  const pt = await prayerTimes(date);
  const ramadan = (day.events || []).some((e) => e.layer === 'islam' && /Ramadan/.test(e.title));
  const fam = S.settings.islam_family || 'Your sister\'s family';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="spread"><strong>🕌 Prayer times</strong><span class="muted">${pt ? esc(pt.hijri) : ''}</span></div>
    ${pt ? `<div class="prayer" style="margin-top:6px">${PRAYERS.map((p) => `<div>${p}<b>${pt.times[p]}</b></div>`).join('')}</div>
    <div class="muted" style="margin-top:6px">${esc(fam)} may be at prayer around these times${weekdayOf(date) === 5 ? `, and at the mosque for Jumu'ah (Friday prayer) around ${pt.times.Dhuhr}–${addMinutes(pt.times.Dhuhr, 75)}` : ''}. Best not to call then.
    ${ramadan ? `<br>🌙 Ramadan: fast from ${pt.times.Fajr} (suhoor ends) to ${pt.times.Maghrib} (iftar).` : ''}</div>`
    : '<div class="muted">Prayer times need an internet connection (aladhan.com).</div>'}`;
  box.prepend(card);
});
const addMinutes = (hhmm, n) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + n; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

async function toggleLayer(l, on) {
  const r = await put('prefs', { [l]: on });
  S.me.prefs = r.prefs;
  toast(on ? '☪️ Islamic calendar on: holy days, Ramadan and prayer times' : 'Islamic calendar hidden');
}
window.toggleLayer = toggleLayer;

ROUTES.faith = async () => {
  const on = layerOn('islam');
  $('#view').innerHTML = `<h1>☪️ Islamic calendar</h1>
    <div class="card"><label class="row"><input type="checkbox" id="fa-on" ${on ? 'checked' : ''}> <strong>Show it on my calendar</strong></label>
      <p class="muted">Shows Ramadan, the Eids and other holy days on the calendar, plus daily prayer times on each day's page, so you know when ${esc(S.settings.islam_family || 'your sister\'s family')} is celebrating and when not to disturb them. Reminders for these days only go to people who switch this on. Each person chooses for themselves.</p></div>
    <div class="card" data-perm="settings"><strong>Settings</strong>
      <label class="f">Whose calendar is this?</label><input type="text" id="fa-fam" value="${esc(S.settings.islam_family || '')}">
      <label class="f">Prayer time calculation</label><select id="fa-m">${[['3', 'Muslim World League'], ['1', 'University of Islamic Sciences, Karachi'], ['2', 'ISNA (North America)'], ['4', 'Umm al-Qura, Makkah'], ['5', 'Egyptian General Authority']].map(([k, l]) => `<option value="${k}" ${String(S.settings.islam_method || 3) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="f">Asr time</label><select id="fa-s"><option value="1" ${String(S.settings.islam_school ?? 1) === '1' ? 'selected' : ''}>Hanafi (later Asr, common in South Africa)</option><option value="0" ${String(S.settings.islam_school) === '0' ? 'selected' : ''}>Shafi'i (earlier Asr)</option></select>
      <p class="muted">Times are calculated for Krugersdorp and may differ by a few minutes from their mosque's timetable. Holy-day dates are estimates: in South Africa they follow the moon sighting, so they can move by a day.</p>
      <button class="btn small" id="fa-save">Save</button></div>`;
  $('#fa-on').onchange = (e) => toggleLayer('islam', e.target.checked);
  $('#fa-save') && ($('#fa-save').onclick = async () => {
    S.settings = await put('settings', { islam_family: $('#fa-fam').value, islam_method: $('#fa-m').value, islam_school: $('#fa-s').value });
    Object.keys(prayerCache).forEach((k) => delete prayerCache[k]); toast('Saved');
  });
};
