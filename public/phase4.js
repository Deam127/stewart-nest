// The Stewart Nest — family schedule (events), recipe catalogue & rotation, and plan-ahead.
'use strict';

const CAT_ICON = { holiday: '🇿🇦', term: '🏫', school: '🎒', school_holiday: '🏖️', bins: '🗑️', work: '💼', birthday: '🎂', appointment: '🩺', family: '🏡', other: '📌' };
const CATS = { holiday: 'Public holiday', term: 'School term', school: 'School', school_holiday: 'School holiday', bins: 'Bin day', work: 'Work', birthday: 'Birthday', appointment: 'Appointment', family: 'Family', other: 'Other' };
const REMIND = { none: 'No reminder', day_before: 'Day before (from 17:00)', morning: 'Morning of (from 06:00)', both: 'Day before and morning' };
const whoNames = (who) => who ? who.split(',').map((u) => user(u).emoji + ' ' + user(u).name).join(', ') : '🏡 Everyone';
const evTitle = (e) => (/^\p{Extended_Pictographic}/u.test(e.title) ? '' : (CAT_ICON[e.category] || '📌') + ' ') + e.title;
const repeatText = (e) => e.repeat === 'weekly' ? `Every ${[...(e.repeat_days || '')].map((d) => WD[d - 1]).join(', ')}` : e.repeat === 'monthly' ? 'Every month' : e.repeat === 'yearly' ? 'Every year' : '';

// ================= events on a day =================
(window.dayHooks = window.dayHooks || []).push(async function eventsHook(date, day) {
  const box = $('#day-events'); if (!box) return;
  const evs = day.events || [];
  const row = (e) => `<div class="ev ${e.quiet ? 'quiet' : ''}">
    <div class="tm">${e.start_time || (e.multi ? '' : 'All day')}${e.end_time ? `<div class="muted" style="font-weight:400">–${e.end_time}</div>` : ''}</div>
    <div class="grow"><div><strong>${esc(evTitle(e))}</strong></div>
      <div class="muted">${whoNames(e.who)}${e.repeat !== 'none' ? ' · 🔁 ' + repeatText(e) : ''}${e.remind !== 'none' ? ' · ⏰' : ''}</div>
      ${e.notes ? `<div class="muted">${esc(e.notes)}</div>` : ''}</div>
    <div class="row">${e.repeat !== 'none' ? `<button class="btn small ghost" data-evskip="${e.id}" title="Not happening this day">Skip day</button>` : ''}
      ${!['holiday', 'term'].includes(e.category) || S.me.is_admin ? `<button class="btn small ghost" data-evedit="${e.id}">✏️</button>` : ''}</div>
  </div>`;
  const hol = evs.filter((e) => e.category === 'holiday');
  const term = evs.find((e) => e.category === 'term');
  const rest = evs.filter((e) => !['holiday', 'term'].includes(e.category));
  box.innerHTML = `<h2>📅 Schedule</h2><div class="card">
    ${hol.map((e) => `<div class="badge warn" style="margin-bottom:6px">🇿🇦 ${esc(e.title)}: public holiday</div>`).join('')}
    ${term ? `<div class="badge ok" style="margin-bottom:6px">🏫 ${esc(term.title)}${weekdayOf(date) <= 5 && !hol.length ? ': school day' : ''}</div>` : (weekdayOf(date) <= 5 ? '<div class="badge rain" style="margin-bottom:6px">🏖️ No school (holidays)</div>' : '')}
    ${rest.map(row).join('') || '<div class="muted">Nothing scheduled.</div>'}
    <div class="row wrap" style="margin-top:8px"><button class="btn small ghost" id="ev-add">+ Add event</button>
      <button class="btn small ghost" id="ev-school">🎒 School date for Skyler</button></div></div>`;
  $('#ev-add', box).onclick = () => eventSheet({ start_date: date }, () => viewDay(date));
  $('#ev-school', box).onclick = () => eventSheet(schoolPreset(date), () => viewDay(date));
  $$('[data-evskip]', box).forEach((b) => b.onclick = async () => {
    if (!confirm('Skip this one day? (The rest of the series stays.)')) return;
    await api(`events/${b.dataset.evskip}/skip`, { body: { date } }); toast('Skipped for this day'); viewDay(date);
  });
  $$('[data-evedit]', box).forEach((b) => b.onclick = async () => {
    const all = (await api('events/all')).events;
    eventSheet(all.find((x) => x.id == b.dataset.evedit), () => viewDay(date));
  });
});
// Quick preset for Skyler's school dates: sports days, outings, tests, civvies day, payments…
const schoolPreset = (date) => ({ start_date: date, category: 'school', who: S.users.find((u) => u.id === 'skyler') ? 'skyler' : '', remind: 'day_before', title: '' });
const weekdayOf = (d) => (toD(d).getDay() + 6) % 7 + 1;

// ================= event editor =================
function eventSheet(e, done) {
  e = e || {};
  const isNew = !e.id;
  const who = new Set((e.who || '').split(',').filter(Boolean));
  const s = sheet(`
    <div class="spread"><h2 style="margin:0">${isNew ? 'New event' : 'Edit event'}</h2><button class="btn small ghost" data-close>Close</button></div>
    <label class="f">What</label><input type="text" id="e-title" value="${esc(e.title || '')}" placeholder="e.g. Sports day, test, civvies day (R10), outing form due">
    <label class="f">Type</label><select id="e-cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${(e.category || 'other') === k ? 'selected' : ''}>${CAT_ICON[k]} ${v}</option>`).join('')}</select>
    <label class="f">Who (none ticked = whole family)</label>
    <div class="days-pick" id="e-who">${S.users.map((u) => `<label><input type="checkbox" value="${u.id}" ${who.has(u.id) ? 'checked' : ''}><span>${u.emoji} ${esc(u.name)}</span></label>`).join('')}</div>
    <div class="row"><div class="grow"><label class="f">Date</label><input type="date" id="e-date" value="${esc(e.start_date || todayStr())}"></div>
      <div class="grow"><label class="f">Until (multi-day, optional)</label><input type="date" id="e-end" value="${esc(e.end_date || '')}"></div></div>
    <div class="row"><div class="grow"><label class="f">From</label><input type="time" id="e-from" value="${esc(e.start_time || '')}"></div>
      <div class="grow"><label class="f">To</label><input type="time" id="e-to" value="${esc(e.end_time || '')}"></div></div>
    <label class="f">Repeat</label>
    <select id="e-rep">${[['none', 'Does not repeat'], ['weekly', 'Weekly'], ['monthly', 'Monthly (same date)'], ['yearly', 'Yearly (birthdays, anniversaries)']].map(([k, v]) => `<option value="${k}" ${(e.repeat || 'none') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div id="e-repbox">
      <div class="days-pick" id="e-days" style="margin-top:6px">${WD.map((w, i) => `<label><input type="checkbox" value="${i + 1}" ${(e.repeat_days || '').includes(String(i + 1)) ? 'checked' : ''}><span>${w}</span></label>`).join('')}</div>
      <label class="f">Repeat until (optional)</label><input type="date" id="e-until" value="${esc(e.repeat_until || '')}">
      <label class="row" style="margin-top:6px"><input type="checkbox" id="e-school" ${e.school_days_only ? 'checked' : ''}> Only on school days (skips holidays and school breaks)</label>
      <label class="row" style="margin-top:4px"><input type="checkbox" id="e-hol" ${e.skip_holidays ? 'checked' : ''}> Skip public holidays</label>
    </div>
    <label class="row" style="margin-top:6px"><input type="checkbox" id="e-quiet" ${e.quiet ? 'checked' : ''}> Routine (show on the day page, not in the month grid)</label>
    <label class="f">Reminder</label><select id="e-rem">${Object.entries(REMIND).map(([k, v]) => `<option value="${k}" ${(e.remind || 'none') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label class="f">Notes</label><input type="text" id="e-notes" value="${esc(e.notes || '')}" placeholder="e.g. Take PE kit, R20 for the bus">
    <div class="err" id="e-err"></div>
    <button class="btn" style="width:100%" id="e-save">${isNew ? 'Add to calendar' : 'Save'}</button>
    ${isNew ? '' : '<button class="btn small danger" style="margin-top:10px" id="e-del">Delete this event (all dates)</button>'}`);
  const syncRep = () => { const r = $('#e-rep', s).value; $('#e-repbox', s).hidden = r === 'none'; $('#e-days', s).hidden = r !== 'weekly'; };
  $('#e-rep', s).onchange = syncRep; syncRep();
  $('#e-cat', s).onchange = () => { if ($('#e-cat', s).value === 'birthday') { $('#e-rep', s).value = 'yearly'; $('#e-rem', s).value = 'day_before'; syncRep(); } };
  $('[data-close]', s).onclick = () => s.remove();
  $('#e-save', s).onclick = async () => {
    const b = {
      title: $('#e-title', s).value, category: $('#e-cat', s).value, who: $$('#e-who input:checked', s).map((c) => c.value),
      start_date: $('#e-date', s).value, end_date: $('#e-end', s).value, start_time: $('#e-from', s).value, end_time: $('#e-to', s).value,
      repeat: $('#e-rep', s).value, repeat_days: $$('#e-days input:checked', s).map((c) => c.value).join(''), repeat_until: $('#e-until', s).value,
      school_days_only: $('#e-school', s).checked, skip_holidays: $('#e-hol', s).checked, quiet: $('#e-quiet', s).checked,
      remind: $('#e-rem', s).value, notes: $('#e-notes', s).value,
    };
    if (b.repeat === 'weekly' && !b.repeat_days) b.repeat_days = String(weekdayOf(b.start_date));
    try {
      if (isNew) await api('events', { body: b }); else await put('events/' + e.id, b);
      s.remove(); toast(isNew ? 'Added to the calendar 📅' : 'Saved'); done && done();
    } catch (err) { $('#e-err', s).textContent = err.message; }
  };
  $('#e-del', s) && ($('#e-del', s).onclick = async () => { if (confirm('Delete this event and all its repeats?')) { await del('events/' + e.id); s.remove(); done && done(); } });
}

// ================= events page =================
ROUTES.events = async () => {
  const today = todayStr();
  const whoF = P4.evWho || '';
  const [up, all] = await Promise.all([api(`events?from=${today}&to=${addDays(today, 90)}${whoF ? '&who=' + whoF : ''}`), api('events/all')]);
  const list = up.occurrences.filter((o) => !o.quiet && o.category !== 'term');
  const groups = groupBy(list.map((o) => ({ ...o, month: new Date(o.date + 'T00:00:00').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) })), 'month');
  const repeating = all.events.filter((e) => e.repeat !== 'none' || e.category === 'term');
  $('#view').innerHTML = `<h1>📅 Events & schedule</h1>
    <div class="row wrap" style="margin-bottom:8px">
      <div class="seg">${[['', 'Everyone'], ...S.users.map((u) => [u.id, u.emoji + ' ' + u.name])].map(([k, l]) => `<button data-ew="${k}" class="${whoF === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <span class="grow"></span><button class="btn ghost" id="ev-school">🎒 School date</button><button class="btn" id="ev-new">+ Add event</button></div>
    <p class="muted">Public holidays and the government school calendar are loaded up to December 2027. Private schools set their own dates, so check against Skyler's school letters.</p>
    <h2>Next 3 months</h2>
    ${groups.map(([m, l]) => `<h3>${m}</h3><div class="card">${l.map((o) => `<div class="ev" data-evopen="${o.id}" style="cursor:pointer">
      <div class="tm">${toD(o.date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}${o.start_time ? `<div class="muted" style="font-weight:400">${o.start_time}</div>` : ''}</div>
      <div class="grow"><strong>${esc(evTitle(o))}</strong><div class="muted">${whoNames(o.who)}${o.notes ? ' · ' + esc(o.notes) : ''}</div></div>
      ${o.remind !== 'none' ? '<span title="Reminder on">⏰</span>' : ''}</div>`).join('')}</div>`).join('') || '<div class="card empty">Nothing coming up</div>'}
    <h2>🔁 Repeating & routines</h2>
    <div class="card">${repeating.map((e) => `<div class="ev" data-evopen="${e.id}" style="cursor:pointer">
      <div class="grow"><strong>${esc(evTitle(e))}</strong>
        <div class="muted">${whoNames(e.who)} · ${e.category === 'term' ? `${short(e.start_date)} – ${short(e.end_date)}` : repeatText(e)}${e.start_time ? ` · ${e.start_time}${e.end_time ? '–' + e.end_time : ''}` : ''}${e.school_days_only ? ' · school days only' : ''}${e.skip_holidays ? ' · not on public holidays' : ''}${e.quiet ? ' · routine' : ''}</div></div>
      ${e.remind !== 'none' ? '<span>⏰</span>' : ''}</div>`).join('')}</div>`;
  $$('[data-ew]').forEach((b) => b.onclick = () => { P4.evWho = b.dataset.ew; ROUTES.events(); });
  $('#ev-new').onclick = () => eventSheet({ start_date: today, who: whoF }, ROUTES.events);
  $('#ev-school').onclick = () => eventSheet(schoolPreset(today), ROUTES.events);
  $$('[data-evopen]').forEach((r) => r.onclick = () => eventSheet(all.events.find((e) => e.id == r.dataset.evopen), ROUTES.events));
};
const P4 = { evWho: '', recTab: 's', season: 'summer' };

// ================= recipe catalogue =================
const MEALS = { s: '🍽️ Suppers', b: '🥣 Breakfasts', l: '🥪 Lunches' };
ROUTES.recipes = async () => {
  const [cat, items] = await Promise.all([api('catalog'), api('items')]);
  P4.items = items;
  const tab = P4.recTab;
  const tabs = [...Object.entries(MEALS), ['rot', '🔁 Weekly rotation']];
  let body = '';
  if (tab === 'rot') body = rotationEditor(cat);
  else {
    const f = (P4.recQ || '').toLowerCase(), tag = P4.recTag || '';
    const list = cat.recipes.filter((r) => r.meal === tab && !r.name.startsWith('Rain plan:') && (!f || r.name.toLowerCase().includes(f))
      && (!tag || (tag === 'winter' || tag === 'summer' ? r.season === tag : (r.notes || '').toLowerCase().includes(tag))));
    body = `<div class="row wrap" style="margin-bottom:8px"><input type="text" id="rc-q" placeholder="Search recipes…" value="${esc(P4.recQ || '')}" class="grow">
        <select id="rc-tag" style="width:auto">${[['', 'All'], ['favourite', '❤️ Favourites'], ['light', '🥗 Light'], ['budget', '💰 Budget'], ['wat eet ons', '📗 Wat eet ons vanaand?'], ['winter', '❄️ Winter'], ['summer', '☀️ Summer']].map(([k, l]) => `<option value="${k}" ${tag === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="btn" id="rc-new" style="margin-bottom:10px">+ New ${tab === 's' ? 'supper' : tab === 'b' ? 'breakfast' : 'lunch'}</button> <span class="muted">${list.length} recipes</span>
      <div class="card">${list.map((r) => `<div class="item" data-rc="${r.id}" style="${r.active ? '' : 'opacity:.5'}">
        <div class="thumb">${r.outdoor ? '🔥' : tab === 's' ? '🍲' : tab === 'b' ? '🥣' : '🥪'}</div>
        <div class="grow"><div class="nm">${esc(r.name)}</div>
          <div class="muted">${r.notes ? esc(r.notes.split(' — ')[0]) + ' · ' : ''}${r.items.length} ingredients${r.season !== 'all' ? ' · ' + r.season : ''}${r.rain_backup ? ' · ☔ rain plan' : ''}${r.active ? '' : ' · not in use'}</div></div>
        <div style="text-align:right"><strong>${R(r.cost)}</strong><div class="muted">per meal</div></div></div>`).join('')}</div>
      <p class="muted">Cost per meal = ingredients used × last known price. Change prices in 🛒 Shop → Inventory.</p>`;
  }
  $('#view').innerHTML = `<h1>📖 Recipes</h1>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#" data-rt="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${body}`;
  $$('[data-rt]').forEach((a) => a.onclick = (e) => { e.preventDefault(); P4.recTab = a.dataset.rt; ROUTES.recipes(); });
  $$('[data-rc]').forEach((r) => r.onclick = () => recipeSheet(cat.recipes.find((x) => x.id === r.dataset.rc), cat));
  $('#rc-new') && ($('#rc-new').onclick = () => recipeSheet({ meal: tab, items: [], season: 'all', active: 1 }, cat));
  if (tab === 'rot') wireRotation(cat);
  if ($('#rc-q')) {
    $('#rc-q').oninput = () => { P4.recQ = $('#rc-q').value; clearTimeout(P4.qt); P4.qt = setTimeout(async () => { await ROUTES.recipes(); const n = $('#rc-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); };
    $('#rc-tag').onchange = () => { P4.recTag = $('#rc-tag').value; ROUTES.recipes(); };
  }
};

function recipeSheet(r, cat) {
  const isNew = !r.id;
  let rows = (r.items || []).map((x) => ({ item_id: x.item_id, qty: x.qty }));
  let portions = []; try { portions = JSON.parse(r.portions || '[]'); } catch { /* none */ }
  const items = P4.items;
  const itemOpts = items.map((i) => `<option value="${esc(i.name)} · ${i.code}"></option>`).join('');
  const backups = cat.recipes.filter((x) => x.meal === 's' && x.id !== r.id);
  const s = sheet(`
    <div class="spread"><h2 style="margin:0">${isNew ? 'New recipe' : esc(r.name)}</h2><button class="btn small ghost" data-close>Close</button></div>
    <label class="f">Name</label><input type="text" id="r-name" value="${esc(r.name || '')}" placeholder="e.g. Chicken & mushroom pasta">
    <div class="row"><div class="grow"><label class="f">Meal</label><select id="r-meal">${Object.entries({ s: 'Supper', b: 'Breakfast', l: 'Lunch' }).map(([k, v]) => `<option value="${k}" ${r.meal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="grow"><label class="f">Season</label><select id="r-season">${['all', 'summer', 'winter'].map((k) => `<option ${r.season === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
    <label class="row" style="margin-top:8px"><input type="checkbox" id="r-out" ${r.outdoor ? 'checked' : ''}> Outdoor / braai (needs a dry day)</label>
    <div id="r-rainbox"><label class="f">Rain plan (indoor version)</label><select id="r-rain"><option value="">None</option>${backups.map((b) => `<option value="${b.id}" ${r.rain_backup === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    <h3>Ingredients (for the whole family, one meal)</h3>
    <datalist id="r-items">${itemOpts}</datalist>
    <div id="r-rows"></div>
    <button class="btn small ghost" id="r-addrow">+ Ingredient</button>
    <button class="btn small ghost" id="r-newitem">+ New item (not in inventory yet)</button>
    <div class="spread" style="margin-top:8px"><span class="muted">Cost per meal</span><strong id="r-cost"></strong></div>
    <h3>Portions</h3>
    ${['Lee Roy', 'Shirley', 'Skyler'].map((n, i) => `<label class="f">${n}</label><input type="text" data-por="${i}" value="${esc(portions[i] || '')}">`).join('')}
    <label class="f">Method</label><textarea id="r-method">${esc(r.method || '')}</textarea>
    <label class="f">Notes</label><input type="text" id="r-notes" value="${esc(r.notes || '')}">
    <div class="err" id="r-err"></div>
    <button class="btn" style="width:100%" id="r-save">Save recipe</button>
    ${isNew ? '' : `<button class="btn small ${r.active ? 'danger' : 'ghost'}" style="margin-top:10px" id="r-off">${r.active ? 'Take out of use' : 'Put back in use'}</button>`}`);
  const itemById = (id) => items.find((i) => i.id == id);
  const draw = () => {
    $('#r-rows', s).innerHTML = rows.map((row, k) => {
      const it = itemById(row.item_id);
      return `<div class="ing"><input list="r-items" data-ri="${k}" value="${it ? esc(it.name) + ' · ' + it.code : ''}" placeholder="Start typing an item…">
        <input type="number" step="any" data-rq="${k}" value="${row.qty ?? ''}" placeholder="Qty">
        <span class="u">${it ? esc(it.pack_unit || 'each') : ''}</span>
        <button class="btn small danger" data-rx="${k}">✕</button></div>`;
    }).join('') || '<div class="muted">No ingredients yet</div>';
    const cost = rows.reduce((sum, row) => { const it = itemById(row.item_id); return sum + (it && it.pack_qty ? (row.qty / it.pack_qty) * (it.price || 0) : 0); }, 0);
    $('#r-cost', s).textContent = R(cost);
    $$('[data-ri]', s).forEach((inp) => inp.onchange = () => {
      const code = (inp.value.match(/NEST-\d+/) || [])[0];
      const it = items.find((i) => i.code === code);
      rows[inp.dataset.ri].item_id = it ? it.id : null;
      if (!it) toast('Pick an item from the list, or add a new item'); draw();
    });
    $$('[data-rq]', s).forEach((inp) => inp.onchange = () => { rows[inp.dataset.rq].qty = Number(inp.value); draw(); });
    $$('[data-rx]', s).forEach((b) => b.onclick = () => { rows.splice(b.dataset.rx, 1); draw(); });
  };
  draw();
  const syncOut = () => ($('#r-rainbox', s).hidden = !$('#r-out', s).checked);
  $('#r-out', s).onchange = syncOut; syncOut();
  $('[data-close]', s).onclick = () => s.remove();
  $('#r-addrow', s).onclick = () => { rows.push({ item_id: null, qty: '' }); draw(); $$('[data-ri]', s).pop()?.focus(); };
  $('#r-newitem', s).onclick = async () => {
    const name = prompt('New item name (e.g. Mushrooms 250g punnet)'); if (!name) return;
    const size = prompt('How much is in one pack? Number, then unit: g, ml, each or kg (e.g. "250 g")', '1 each') || '1 each';
    const m = size.trim().match(/^([\d.,]+)\s*(g|ml|each|kg)$/i);
    const price = prompt('Price per pack (R), blank if unknown', '');
    const r2 = await api('items', { body: { name, section: 'Pantry', kind: 'grocery', price, size: m ? `${m[1]}${m[2]}` : null, par: 0 } });
    if (m) await put('items/' + r2.id, { pack_qty: Number(m[1].replace(',', '.')), pack_unit: m[2].toLowerCase() });
    P4.items = items.splice(0, items.length, ...(await api('items'))) && items;
    rows.push({ item_id: r2.id, qty: m ? Number(m[1].replace(',', '.')) : 1 });
    $('#r-items', s).innerHTML = items.map((i) => `<option value="${esc(i.name)} · ${i.code}"></option>`).join('');
    toast(`Added ${r2.code}. Fill in section and photo later in Inventory.`); draw();
  };
  $('#r-save', s).onclick = async () => {
    const b = {
      name: $('#r-name', s).value, meal: $('#r-meal', s).value, season: $('#r-season', s).value, outdoor: $('#r-out', s).checked,
      rain_backup: $('#r-out', s).checked ? $('#r-rain', s).value : null, method: $('#r-method', s).value, notes: $('#r-notes', s).value,
      portions: $$('[data-por]', s).map((i) => i.value), items: rows.filter((x) => x.item_id && x.qty > 0),
    };
    try {
      if (isNew) await api('catalog', { body: b }); else await put('catalog/' + r.id, b);
      s.remove(); toast(isNew ? 'Recipe added. Add it to the weekly rotation so it appears on menus.' : 'Saved'); ROUTES.recipes();
    } catch (e) { $('#r-err', s).textContent = e.message; }
  };
  $('#r-off', s) && ($('#r-off', s).onclick = async () => {
    if (r.active) { if (!confirm('Take this recipe out of use? It also comes off the weekly rotation.')) return; await del('catalog/' + r.id); }
    else await put('recipes/' + r.id, { active: 1 });
    s.remove(); ROUTES.recipes();
  });
}

function rotationEditor(cat) {
  const season = P4.season;
  const sup = cat.recipes.filter((r) => r.meal === 's' && r.active && !r.name.startsWith('Rain plan:'));
  const name = (id) => cat.recipes.find((r) => r.id === id)?.name || id;
  return `<div class="seg" style="margin-bottom:8px">${['summer', 'winter'].map((k) => `<button data-season="${k}" class="${season === k ? 'on' : ''}">${k === 'summer' ? '☀️ Summer (Oct–Mar)' : '❄️ Winter (Apr–Sep)'}</button>`).join('')}</div>
    <p class="muted">Each weekday cycles through its suppers week by week. New menus use this. Already-built months keep their meals until you rebuild them in Plan ahead.</p>
    ${WD.map((w, i) => {
      const ids = cat.rotation.filter((x) => x.season === season && x.weekday === i + 1).map((x) => x.recipe_id);
      return `<div class="card"><strong>${w}</strong>
        <div class="chips" style="margin:6px 0">${ids.map((id) => `<span class="chip-x">${esc(name(id))}<button data-rotx="${i + 1}|${id}">✕</button></span>`).join('') || '<span class="muted">Nothing: any supper may be picked</span>'}</div>
        <select data-rota="${i + 1}"><option value="">+ Add a supper to ${w}…</option>${sup.filter((r) => !ids.includes(r.id)).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>`;
    }).join('')}`;
}
function wireRotation(cat) {
  const season = P4.season;
  const idsFor = (wd) => cat.rotation.filter((x) => x.season === season && x.weekday === wd).map((x) => x.recipe_id);
  const save = async (wd, ids) => { await put('rotation', { season, weekday: wd, recipe_ids: ids }); ROUTES.recipes(); };
  $$('[data-season]').forEach((b) => b.onclick = () => { P4.season = b.dataset.season; ROUTES.recipes(); });
  $$('[data-rotx]').forEach((b) => b.onclick = () => { const [wd, id] = b.dataset.rotx.split('|'); save(Number(wd), idsFor(Number(wd)).filter((x) => x !== id)); });
  $$('[data-rota]').forEach((sel) => sel.onchange = () => { if (sel.value) save(Number(sel.dataset.rota), [...idsFor(Number(sel.dataset.rota)), sel.value]); });
}

// ================= plan ahead =================
ROUTES.plan = async () => {
  const today = todayStr();
  const firstNext = ymd(new Date(toD(today).getFullYear(), toD(today).getMonth() + 1, 1));
  const lastNext = ymd(new Date(toD(today).getFullYear(), toD(today).getMonth() + 2, 0));
  const from = P4.planFrom || firstNext, to = P4.planTo || lastNext;
  $('#view').innerHTML = `<h1>🗓️ Plan ahead</h1>
    <div class="card">
      <div class="row"><div class="grow"><label class="f">From</label><input type="date" id="p-from" value="${from}"></div>
        <div class="grow"><label class="f">To</label><input type="date" id="p-to" value="${to}"></div></div>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn small ghost" data-pr="next">Next month</button><button class="btn small ghost" data-pr="3">Next 3 months</button>
        <button class="btn small ghost" data-pr="rest">Rest of this month</button><span class="grow"></span><button class="btn small" id="p-go">Work it out</button></div>
    </div>
    <div class="card"><strong>Build menus ahead</strong>
      <p class="muted">Fills the calendar with suppers from the weekly rotation (summer or winter picked by month). Days you already changed are kept.</p>
      <div class="row"><select id="p-months" style="width:auto">${[1, 2, 3, 6, 12].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} month${n > 1 ? 's' : ''}</option>`).join('')}</select>
        <button class="btn small" id="p-build">Build from ${monthName(firstNext.slice(0, 7))}</button>
        <label class="row muted"><input type="checkbox" id="p-over"> Replace existing</label></div></div>
    <div id="p-out"><div class="empty">Working it out…</div></div>`;
  const run = async () => {
    P4.planFrom = $('#p-from').value; P4.planTo = $('#p-to').value;
    const d = await api(`plan/needs?from=${P4.planFrom}&to=${P4.planTo}`);
    const months = Math.max(1, Math.round(d.days / 30.4));
    const gB = Number(S.settings.grocery_budget || 5000) * months, mB = Number(S.settings.meat_budget || 2000) * months;
    const buy = d.items.filter((i) => i.buy > 0);
    $('#p-out').innerHTML = `
      <div class="card totals ${d.totals.groceries > gB || d.totals.meat > mB ? 'over' : ''}">
        <div class="spread"><span>🛒 Groceries & household to buy</span><strong class="${d.totals.groceries > gB ? 'low' : ''}">${R(d.totals.groceries)} / ${R(gB)}</strong></div>
        <div class="spread"><span>🥩 Meat to buy</span><strong class="${d.totals.meat > mB ? 'low' : ''}">${R(d.totals.meat)} / ${R(mB)}</strong></div>
        <div class="muted">${d.days} days · already counting what's in the cupboard (last stock take) · ${buy.length} items to buy</div>
        <button class="btn" style="margin-top:8px" id="p-trip">🛒 Make this the shopping list</button></div>
      ${d.no_ingredients.length ? `<div class="card muted">⚠️ No ingredients entered yet for: ${d.no_ingredients.map(esc).join(', ')}. Add them in 📖 Recipes so they're counted.</div>` : ''}
      <h2>What to buy</h2>
      ${groupBy(d.items, 'section').map(([sec, l]) => `<h3>${esc(sec)}</h3><div class="card"><table class="plan">
        <tr><th>Item</th><th>Need</th><th>Have</th><th>Buy</th><th>Cost</th></tr>
        ${l.map((i) => `<tr class="${i.buy ? '' : 'zero'}"><td>${esc(i.name)}${i.from === 'keep level' ? ' <span class="muted">(keep level)</span>' : ''}</td>
          <td>${i.packs}</td><td>${i.on_hand}</td><td><strong>${i.buy || '–'}</strong></td><td>${i.buy ? R(i.cost) : ''}</td></tr>`).join('')}
      </table></div>`).join('')}
      <h2>Meals in this period</h2>
      <div class="card">${d.meals.filter((m) => m.meal === 's').map((m) => `<div class="spread" style="padding:3px 0"><span>${esc(m.name)}</span><span class="muted">× ${m.times}</span></div>`).join('')}</div>`;
    $('#p-trip').onclick = async () => {
      try { const r = await api('plan/trip', { body: { from: P4.planFrom, to: P4.planTo } }); toast(`Shopping list ready: ${r.lines} items`); location.hash = '#shop/list'; }
      catch (e) { toast(e.message); }
    };
  };
  const setRange = (a, b) => { $('#p-from').value = a; $('#p-to').value = b; run(); };
  $$('[data-pr]').forEach((b) => b.onclick = () => {
    const t = toD(today);
    if (b.dataset.pr === 'next') setRange(firstNext, lastNext);
    if (b.dataset.pr === '3') setRange(firstNext, ymd(new Date(t.getFullYear(), t.getMonth() + 4, 0)));
    if (b.dataset.pr === 'rest') setRange(today, ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)));
  });
  $('#p-go').onclick = run;
  $('#p-build').onclick = async () => {
    const r = await api('plan/menus', { body: { from_ym: firstNext.slice(0, 7), months: Number($('#p-months').value), overwrite: $('#p-over').checked } });
    toast(`Menus built: ${r.months.map((m) => monthName(m.ym) + ' (' + m.season + ')').join(', ')}`); run();
  };
  run();
};
