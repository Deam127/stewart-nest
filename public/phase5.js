// The Stewart Nest — photos (gallery, supper pinboard, activities on the calendar), background slideshow,
// and the monthly menu builder with a budget preview.
'use strict';

const P5 = { tab: 'all', builderMonth: null };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const KIND = { meal: '🍽️ Supper', activity: '🎉 Activity', memory: '💗 Memory' };

// ================= background slideshow =================
const Slides = {
  list: [], i: 0, timer: null, layer: 0,
  async start() {
    if (!S.me || lsGet('nest-bg', '1') !== '1') return this.stop();
    try { this.list = await api('gallery?slideshow=1&limit=80'); } catch { return; }
    if (!this.list.length) return this.stop();
    this.list.sort(() => Math.random() - 0.5);
    let bg = $('#bgshow');
    if (!bg) {
      bg = document.createElement('div'); bg.id = 'bgshow';
      bg.innerHTML = '<div class="bgimg"></div><div class="bgimg"></div><div class="bgveil"></div><div class="bgcap"></div>';
      document.body.prepend(bg);
    }
    document.body.classList.add('has-bg');
    clearInterval(this.timer);
    this.show();
    this.timer = setInterval(() => this.show(), 9000);
  },
  show() {
    const p = this.list[this.i++ % this.list.length];
    const layers = $$('#bgshow .bgimg');
    const next = layers[this.layer ^= 1], prev = layers[this.layer ^ 1];
    const img = new Image();
    img.onload = () => {
      next.style.backgroundImage = `url(${photoUrl(p.photo_key)})`;
      next.classList.add('on'); prev.classList.remove('on');
      $('#bgshow .bgcap').textContent = [p.caption || p.recipe_name, short(p.date)].filter(Boolean).join(' · ');
    };
    img.src = photoUrl(p.photo_key);
  },
  stop() { clearInterval(this.timer); $('#bgshow')?.remove(); document.body.classList.remove('has-bg'); },
};
setTimeout(() => Slides.start(), 2500);
window.addEventListener('hashchange', () => { if (S.me && !$('#bgshow') && lsGet('nest-bg', '1') === '1') Slides.start(); });

// ================= add / view photos =================
async function addPhotos({ date, kind, recipe_id } = {}) {
  const files = await new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = () => res([...inp.files]); inp.click();
  });
  if (!files.length) return false;
  const caption = prompt(kind === 'meal' ? 'Caption (optional), e.g. "Trinchado night!"' : 'Caption (optional)') || '';
  toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  for (const f of files) {
    try {
      const key = await uploadPhoto(f);
      await api('gallery', { body: { photo_key: key, date: date || todayStr(), kind: kind || 'memory', caption, recipe_id } });
    } catch (e) { toast(e.message); return false; }
  }
  toast('Photo added 📸'); Slides.list.length || Slides.start();
  return true;
}

function lightbox(list, index, onChange) {
  let i = index;
  const s = document.createElement('div');
  s.className = 'lightbox';
  const draw = () => {
    const p = list[i];
    s.innerHTML = `<div class="lb-top"><span>${i + 1}/${list.length}</span><button class="btn small ghost" data-x>✕ Close</button></div>
      <img src="${photoUrl(p.photo_key)}" alt="">
      <div class="lb-info">
        <strong>${esc(p.caption || p.recipe_name || KIND[p.kind] || '')}</strong>
        <div class="muted">${KIND[p.kind] || ''} · ${nice(p.date)}${p.recipe_name && p.caption ? ' · ' + esc(p.recipe_name) : ''}${p.name ? ` · by ${p.emoji || ''} ${esc(p.name)}` : ''}</div>
        <div class="row wrap" style="margin-top:8px">
          ${list.length > 1 ? '<button class="btn small ghost" data-prev>‹</button><button class="btn small ghost" data-next>›</button>' : ''}
          <a class="btn small ghost" href="#day/${p.date}" data-x style="text-decoration:none">📅 Open the day</a>
          <button class="btn small ghost" data-ss>${p.slideshow ? '🖼️ In slideshow' : '🚫 Not in slideshow'}</button>
          <button class="btn small ghost" data-cap>✏️ Caption</button>
          ${(p.user_id === S.me.id || S.me.is_parent || S.me.is_admin) ? '<button class="btn small danger" data-del>Delete</button>' : ''}
        </div></div>`;
    $$('[data-x]', s).forEach((b) => b.onclick = () => s.remove());
    $('[data-prev]', s) && ($('[data-prev]', s).onclick = () => { i = (i - 1 + list.length) % list.length; draw(); });
    $('[data-next]', s) && ($('[data-next]', s).onclick = () => { i = (i + 1) % list.length; draw(); });
    $('[data-ss]', s).onclick = async () => { p.slideshow = p.slideshow ? 0 : 1; await put('gallery/' + p.id, { slideshow: !!p.slideshow }); draw(); };
    $('[data-cap]', s).onclick = async () => { const c = prompt('Caption', p.caption || ''); if (c === null) return; p.caption = c; await put('gallery/' + p.id, { caption: c }); draw(); onChange && onChange(); };
    $('[data-del]', s) && ($('[data-del]', s).onclick = async () => { if (!confirm('Delete this photo?')) return; await del('gallery/' + p.id); s.remove(); onChange && onChange(); });
  };
  s.onclick = (e) => { if (e.target === s) s.remove(); };
  let x0 = null;
  s.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX));
  s.addEventListener('touchend', (e) => { if (x0 === null || list.length < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { i = (i + (dx < 0 ? 1 : -1) + list.length) % list.length; draw(); } x0 = null; });
  draw();
  document.body.appendChild(s);
}

// Photos on a day page
(window.dayHooks = window.dayHooks || []).push(async function photoHook(date, day) {
  let box = $('#day-photos');
  if (!box) { box = document.createElement('div'); box.id = 'day-photos'; ($('#day-rate') || $('#view')).after(box); }
  const pics = day.photos || [];
  box.innerHTML = `<h2>📸 Photos</h2><div class="card">
    ${pics.length ? `<div class="pins">${pics.map((p, k) => `<div class="pin" data-pk="${k}"><img src="${photoUrl(p.photo_key)}" loading="lazy" alt="">
      <span>${esc(p.caption || p.recipe_name || KIND[p.kind])}</span></div>`).join('')}</div>` : '<div class="muted">No photos for this day yet.</div>'}
    <div class="row wrap" style="margin-top:8px">
      <button class="btn small" data-addk="meal">🍽️ Supper photo</button>
      <button class="btn small ghost" data-addk="activity">🎉 Activity photo</button>
      <button class="btn small ghost" data-addk="memory">💗 Memory</button></div></div>`;
  $$('[data-pk]', box).forEach((el) => el.onclick = () => lightbox(pics, Number(el.dataset.pk), () => viewDay(date)));
  $$('[data-addk]', box).forEach((b) => b.onclick = async () => { if (await addPhotos({ date, kind: b.dataset.addk })) viewDay(date); });
});

// ================= gallery & supper pinboard =================
ROUTES.gallery = async () => {
  const tab = P5.tab;
  const list = await api('gallery' + (tab === 'all' ? '' : '?kind=' + tab));
  const months = groupBy(list.map((p) => ({ ...p, month: monthName(p.date.slice(0, 7)) })), 'month');
  const bgOn = lsGet('nest-bg', '1') === '1';
  $('#view').innerHTML = `<h1>📸 Family photos</h1>
    <div class="tabs">${[['all', 'All'], ['meal', '🍽️ Supper pinboard'], ['activity', '🎉 Activities'], ['memory', '💗 Memories']].map(([k, l]) => `<a href="#" data-gt="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="row wrap" style="margin-bottom:10px">
      <button class="btn" id="g-add">+ Add photos</button>
      <input type="date" id="g-date" value="${todayStr()}" style="width:auto">
      <label class="row muted"><input type="checkbox" id="g-bg" ${bgOn ? 'checked' : ''}> Background slideshow on this device</label></div>
    ${months.map(([m, l]) => `<h3>${m}</h3><div class="pins ${tab === 'meal' ? 'polaroid' : ''}">${l.map((p) => `<div class="pin" data-gp="${p.id}">
      <img src="${photoUrl(p.photo_key)}" loading="lazy" alt=""><span>${esc(p.caption || p.recipe_name || KIND[p.kind])}<br><small>${short(p.date)}</small></span></div>`).join('')}</div>`).join('')
      || `<div class="card empty">No photos yet. ${tab === 'meal' ? 'After supper, open the day in the calendar and tap 🍽️ Supper photo.' : 'Tap "+ Add photos".'}</div>`}`;
  $$('[data-gt]').forEach((a) => a.onclick = (e) => { e.preventDefault(); P5.tab = a.dataset.gt; ROUTES.gallery(); });
  $('#g-add').onclick = async () => { if (await addPhotos({ date: $('#g-date').value, kind: tab === 'all' ? 'memory' : tab })) ROUTES.gallery(); };
  $('#g-bg').onchange = (e) => { lsSet('nest-bg', e.target.checked ? '1' : '0'); e.target.checked ? Slides.start() : Slides.stop(); };
  $$('[data-gp]').forEach((el) => el.onclick = () => lightbox(list, list.findIndex((p) => p.id == el.dataset.gp), ROUTES.gallery));
};

// ================= monthly menu builder with budget preview =================
ROUTES.builder = async () => {
  const today = todayStr();
  const t = toD(today);
  const ym = P5.builderMonth || ymd(new Date(t.getFullYear(), t.getMonth() + 1, 1)).slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`, to = ymd(new Date(y, m, 0));
  let [cat, menu] = await Promise.all([api('catalog'), api(`menu?from=${from}&to=${to}`)]);
  if (!menu.length) { await api('menu/generate', { body: { ym } }); menu = await api(`menu?from=${from}&to=${to}`); }
  const evs = (await api(`events?from=${from}&to=${to}`)).occurrences;
  const recs = Object.fromEntries(cat.recipes.map((r) => [r.id, r]));
  const daily = recs.x_daily?.cost || 0;
  const pick = {}; menu.forEach((x) => (pick[`${x.date}|${x.meal}`] = x.recipe_id));
  const options = (meal) => cat.recipes.filter((r) => r.meal === meal && r.active && !r.name.startsWith('Rain plan:'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const opt = { b: options('b'), l: options('l'), s: options('s') };
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const cost = () => days.reduce((sum, d) => sum + daily + ['b', 'l', 's'].reduce((s2, k) => s2 + (recs[pick[`${d}|${k}`]]?.cost || 0), 0), 0);
  const gB = Number(S.settings.grocery_budget || 5000), mB = Number(S.settings.meat_budget || 2000);
  const sel = (d, k) => `<select data-bm="${d}|${k}"><option value="">–</option>${opt[k].map((r) => `<option value="${r.id}" ${pick[`${d}|${k}`] === r.id ? 'selected' : ''}>${esc(r.name)} (${R(r.cost)})</option>`).join('')}</select>`;
  $('#view').innerHTML = `<h1>🧑‍🍳 Menu builder</h1>
    <div class="spread" style="margin-bottom:8px"><button class="btn small ghost" id="bm-prev">‹</button><strong>${monthName(ym)}</strong><button class="btn small ghost" id="bm-next">›</button></div>
    <div class="card totals" id="bm-tot"></div>
    <p class="muted">Pick breakfast, lunch and supper for each day from the recipe library (${cat.recipes.filter((r) => r.active).length} recipes). The costs update as you go. "Food cost" is what the meals use; "Shopping estimate" rounds up to whole packs and takes off what's already in the cupboard.</p>
    ${days.map((d) => {
      const e = evs.filter((x) => x.date === d && ['holiday', 'school_holiday', 'birthday', 'family'].includes(x.category));
      const school = evs.some((x) => x.date === d && x.category === 'term') && weekdayOf(d) <= 5 && !e.some((x) => x.category === 'holiday');
      return `<div class="card bday ${weekdayOf(d) >= 6 ? 'wkend' : ''}">
        <div class="spread"><strong>${toD(d).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' })}</strong>
          <span class="muted">${e.map((x) => esc(x.title)).join(' · ')}${school ? ' 🎒 school' : ''} <span data-dc="${d}"></span></span></div>
        <div class="bmrow"><span>🥣</span>${sel(d, 'b')}</div><div class="bmrow"><span>🥪</span>${sel(d, 'l')}</div><div class="bmrow"><span>🍽️</span>${sel(d, 's')}</div>
      </div>`;
    }).join('')}`;
  const totals = (shop) => {
    const c = cost();
    $('#bm-tot').innerHTML = `<div class="spread"><span>🍽️ Food cost of these meals</span><strong>${R(c)}</strong></div>
      <div class="muted">incl. daily coffee, tea, milk & fruit (${R(daily)}/day)</div>
      ${shop ? `<div class="spread" style="margin-top:6px"><span>🛒 Shopping estimate: groceries & household</span><strong class="${shop.totals.groceries > gB ? 'low' : ''}">${R(shop.totals.groceries)} / ${R(gB)}</strong></div>
        <div class="spread"><span>🥩 Shopping estimate: meat</span><strong class="${shop.totals.meat > mB ? 'low' : ''}">${R(shop.totals.meat)} / ${R(mB)}</strong></div>`
      : '<button class="btn small" style="margin-top:6px" id="bm-shop">🛒 Work out the shopping estimate</button>'}
      ${shop ? '<div class="row" style="margin-top:6px"><a class="btn small" href="#plan" id="bm-plan" style="text-decoration:none">See the full list in Plan ahead</a></div>' : ''}`;
    $('#bm-shop') && ($('#bm-shop').onclick = async () => { $('#bm-shop').textContent = 'Working it out…'; totals(await api(`plan/needs?from=${from}&to=${to}`)); });
    $('#bm-plan') && ($('#bm-plan').onclick = () => { P4.planFrom = from; P4.planTo = to; });
  };
  totals(null);
  $$('[data-dc]').forEach((el) => { const d = el.dataset.dc; el.textContent = R(daily + ['b', 'l', 's'].reduce((s2, k) => s2 + (recs[pick[`${d}|${k}`]]?.cost || 0), 0)); });
  $$('[data-bm]').forEach((s) => s.onchange = async () => {
    const [d, k] = s.dataset.bm.split('|');
    if (!s.value) return;
    await put('menu', { date: d, meal: k, recipe_id: s.value });
    pick[`${d}|${k}`] = s.value;
    $(`[data-dc="${d}"]`).textContent = R(daily + ['b', 'l', 's'].reduce((s2, kk) => s2 + (recs[pick[`${d}|${kk}`]]?.cost || 0), 0));
    totals(null);
  });
  $('#bm-prev').onclick = () => { P5.builderMonth = ymd(new Date(y, m - 2, 1)).slice(0, 7); ROUTES.builder(); };
  $('#bm-next').onclick = () => { P5.builderMonth = ymd(new Date(y, m, 1)).slice(0, 7); ROUTES.builder(); };
};
