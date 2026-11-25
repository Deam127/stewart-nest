// The Stewart Nest — admin (family profiles & passwords) and meal ratings.
'use strict';

// ================= admin: family profiles =================
ROUTES.users = async () => {
  if (!S.me.is_admin) { location.hash = '#hub'; return; }
  const users = await api('admin/users');
  const status = (u) => !u.active ? '<span class="badge">Switched off</span>'
    : !u.has_password ? '<span class="badge warn">No password yet</span>'
    : u.locked ? '<span class="badge warn">Locked (wrong passwords)</span>'
    : u.must_change ? '<span class="badge rain">Temporary password, must change it</span>'
    : '<span class="badge ok">Password set</span>';
  $('#view').innerHTML = `<h1>👥 Family profiles</h1>
    <p class="muted">You're the admin. Give someone a temporary password here: they log in with it once and then choose their own. Nobody else can see or change passwords.</p>
    ${users.map((u) => `<div class="card" style="${u.active ? '' : 'opacity:.6'}">
      <div class="spread"><strong>${u.emoji} ${esc(u.full_name || u.name)}</strong>${u.is_admin ? '<span class="badge">Admin</span>' : u.is_parent ? '<span class="badge">Grown-up</span>' : '<span class="badge">Child</span>'}</div>
      <div style="margin:6px 0">${status(u)}</div>
      <div class="row wrap">
        ${u.id !== S.me.id ? `<button class="btn small" data-temp="${u.id}">🔑 Set temporary password</button>` : ''}
        <button class="btn small ghost" data-edit="${u.id}">✏️ Edit</button>
      </div></div>`).join('')}
    <details class="card"><summary><strong>+ Add a family member</strong></summary>
      <p class="muted">E.g. Madilea later on, or a grandparent who helps out.</p>
      <div class="row"><div class="grow"><label class="f">Short name</label><input type="text" id="nu-name"></div>
        <div style="width:80px"><label class="f">Emoji</label><input type="text" id="nu-emoji" value="🙂"></div></div>
      <label class="f">Full name</label><input type="text" id="nu-full">
      <div class="row"><div class="grow"><label class="f">Colour</label><input type="color" id="nu-col" value="#7a6a9a" style="height:40px"></div>
        <label class="row grow" style="margin-top:20px"><input type="checkbox" id="nu-parent"> Grown-up (can approve rewards)</label></div>
      <label class="f">Temporary password (6+ characters)</label><input type="text" id="nu-pw" autocomplete="off">
      <button class="btn" style="margin-top:10px" id="nu-add">Add</button></details>`;

  $$('[data-temp]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => x.id === b.dataset.temp);
    const suggestion = ['nest', 'braai', 'rooibos', 'koeksister', 'biltong', 'protea'][Math.floor(Math.random() * 6)] + (100 + Math.floor(Math.random() * 900));
    const s = sheet(`<h2 style="margin-top:0">Temporary password for ${esc(u.name)}</h2>
      <p class="muted">Tell ${esc(u.name)} this password. They'll use it once, then pick their own. It also signs them out of other devices.</p>
      <input type="text" id="tp" value="${suggestion}" autocomplete="off">
      <div class="err" id="tp-err"></div>
      <button class="btn" style="width:100%" id="tp-save">Save temporary password</button>`);
    $('#tp-save', s).onclick = async () => {
      try {
        await api(`admin/users/${u.id}/password`, { body: { password: $('#tp', s).value } });
        s.remove(); toast(`Done. ${u.name}'s temporary password: ${$('#tp', s).value}`); ROUTES.users();
      } catch (e) { $('#tp-err', s).textContent = e.message; }
    };
  });

  $$('[data-edit]').forEach((b) => b.onclick = () => {
    const u = users.find((x) => x.id === b.dataset.edit);
    const self = u.id === S.me.id;
    const s = sheet(`<h2 style="margin-top:0">Edit ${esc(u.name)}</h2>
      <div class="row"><div class="grow"><label class="f">Short name</label><input type="text" id="eu-name" value="${esc(u.name)}"></div>
        <div style="width:80px"><label class="f">Emoji</label><input type="text" id="eu-emoji" value="${esc(u.emoji)}"></div></div>
      <label class="f">Full name</label><input type="text" id="eu-full" value="${esc(u.full_name || '')}">
      <label class="f">Colour</label><input type="color" id="eu-col" value="${esc(u.colour)}" style="height:40px">
      <label class="row" style="margin-top:8px"><input type="checkbox" id="eu-parent" ${u.is_parent ? 'checked' : ''}> Grown-up (can approve rewards, change settings)</label>
      <label class="row" style="margin-top:6px"><input type="checkbox" id="eu-admin" ${u.is_admin ? 'checked' : ''} ${self ? 'disabled' : ''}> Admin (manages profiles & passwords)</label>
      <label class="row" style="margin-top:6px"><input type="checkbox" id="eu-active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Profile switched on (can log in)</label>
      <div class="err" id="eu-err"></div>
      <button class="btn" style="width:100%" id="eu-save">Save</button>`);
    $('#eu-save', s).onclick = async () => {
      const body = { name: $('#eu-name', s).value.trim(), full_name: $('#eu-full', s).value.trim(), emoji: $('#eu-emoji', s).value.trim() || '🙂',
        colour: $('#eu-col', s).value, is_parent: $('#eu-parent', s).checked };
      if (!self) { body.is_admin = $('#eu-admin', s).checked; body.active = $('#eu-active', s).checked; }
      try { await put('admin/users/' + u.id, body); s.remove(); toast('Saved'); S.users = await api('users'); ROUTES.users(); }
      catch (e) { $('#eu-err', s).textContent = e.message; }
    };
  });

  $('#nu-add').onclick = async () => {
    try {
      await api('admin/users', { body: { name: $('#nu-name').value, full_name: $('#nu-full').value, emoji: $('#nu-emoji').value, colour: $('#nu-col').value, is_parent: $('#nu-parent').checked, password: $('#nu-pw').value } });
      toast('Added'); S.users = await api('users'); ROUTES.users();
    } catch (e) { toast(e.message); }
  };
};

// ================= meal ratings =================
const starsHtml = (n, attr = '') => [1, 2, 3, 4, 5].map((i) => `<button class="star ${i <= (n || 0) ? 'on' : ''}" data-star="${i}" ${attr}>★</button>`).join('');

// Rating box under the meals on a day (supper only, once it's been eaten)
window.dayExtras = async (date, day) => {
  const box = $('#day-rate'); if (!box) return;
  const supper = day.menu.find((m) => m.meal === 's');
  if (!supper || date > todayStr()) return;
  const recipeId = supper.use_backup && supper.rain_backup ? supper.rain_backup : supper.recipe_id;
  const mealName = supper.use_backup && supper.backup_name ? supper.backup_name : supper.name;
  const all = (await api('ratings?date=' + date)).filter((r) => r.recipe_id === recipeId);
  const mine = all.find((r) => r.user_id === S.me.id) || {};
  const others = all.filter((r) => r.user_id !== S.me.id);
  let stars = mine.stars || 0, verdict = mine.verdict || null;
  box.innerHTML = `<div class="card">
    <div class="spread"><strong>⭐ How was supper?</strong><span class="muted">${esc(mealName)}</span></div>
    <div class="stars" style="margin:6px 0">${starsHtml(stars)}</div>
    <div class="seg" style="margin-bottom:8px"><button data-v="keep" class="${verdict === 'keep' ? 'on' : ''}">👍 Keep it</button><button data-v="swap" class="${verdict === 'swap' ? 'on' : ''}">🔄 Swap it</button></div>
    <input type="text" id="rt-c" placeholder="Comment (e.g. less spicy, more sauce)" value="${esc(mine.comment || '')}">
    <button class="btn small" style="margin-top:8px" id="rt-save">${mine.user_id ? 'Update my rating' : 'Save my rating'}</button>
    ${others.length ? `<div style="margin-top:10px">${others.map((r) => `<div class="muted">${r.emoji} ${esc(r.name)}: ${'★'.repeat(r.stars || 0)}${r.verdict ? ` · ${r.verdict === 'keep' ? '👍 keep' : '🔄 swap'}` : ''}${r.comment ? ` · “${esc(r.comment)}”` : ''}</div>`).join('')}</div>` : ''}
  </div>`;
  $$('[data-star]', box).forEach((b) => b.onclick = () => { stars = Number(b.dataset.star); $$('[data-star]', box).forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= stars)); });
  $$('.seg [data-v]', box).forEach((b) => b.onclick = () => { verdict = verdict === b.dataset.v ? null : b.dataset.v; $$('.seg [data-v]', box).forEach((x) => x.classList.toggle('on', x.dataset.v === verdict)); });
  $('#rt-save', box).onclick = async () => {
    if (!stars && !verdict) return toast('Tap some stars first');
    await put('ratings', { date, recipe_id: recipeId, stars, verdict, comment: $('#rt-c', box).value });
    toast('Thanks for rating! ⭐'); window.dayExtras(date, day);
  };
};

ROUTES.ratings = async () => {
  const rows = await api('ratings/summary');
  const suppers = rows.filter((r) => r.meal === 's');
  const rated = suppers.filter((r) => r.n).sort((a, b) => (b.avg || 0) - (a.avg || 0));
  const unrated = suppers.filter((r) => !r.n);
  $('#view').innerHTML = `<h1>⭐ Meal ratings</h1>
    <p class="muted">Rate supper on any day in the calendar after you've eaten it. When planning next month, copy the report and paste it into Claude.</p>
    <button class="btn" id="rt-export">📋 Copy report for Claude</button>
    <h2>Rated suppers</h2>
    ${rated.length ? `<div class="card">${rated.map((r) => `<div class="recipe-row" style="display:block">
      <div class="spread"><strong>${esc(r.name)}</strong><span>${r.avg ? r.avg.toFixed(1) + ' ★' : ''}</span></div>
      <div class="muted">${r.n} rating${r.n > 1 ? 's' : ''}${r.keep ? ` · 👍 ${r.keep}` : ''}${r.swap ? ` · 🔄 ${r.swap}` : ''}${r.by.length ? ' · ' + esc(r.by.join(', ')) : ''}${r.active ? '' : ' · out of rotation'}</div>
      ${r.comments.map((c) => `<div class="muted">“${esc(c.comment)}”, ${esc(c.name)}</div>`).join('')}
    </div>`).join('')}</div>` : '<div class="card empty">No ratings yet. Open a day in the calendar after supper and rate it.</div>'}
    ${unrated.length ? `<h2>Not rated yet</h2><div class="card muted">${unrated.map((r) => esc(r.name)).join(' · ')}</div>` : ''}`;
  $('#rt-export').onclick = async () => {
    const { text } = await api('ratings/export');
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a chat with Claude.'); }
    catch { sheet(`<h2 style="margin-top:0">Report for Claude</h2><p class="muted">Copy this and paste it into Claude:</p><textarea style="min-height:300px">${esc(text)}</textarea>`); }
  };
};
