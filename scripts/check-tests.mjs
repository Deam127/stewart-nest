// The checks `npm run check` runs against a throwaway copy of the app (see scripts/check.mjs). Never against real data:
// it creates test passwords, tasks and messages.
import http from 'node:http';
const BASE = process.env.BASE || 'http://127.0.0.1:8799';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

function client() {
  let cookie = '';
  return async (path, { method, body, headers = {}, raw } = {}) => {
    const r = await fetch(BASE + '/api/' + path, {
      method: method || (body !== undefined || raw !== undefined ? 'POST' : 'GET'),
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
}
// a request that claims to be for the public website (Host header), to test the online-only rules
const asPublicHost = (path, body) => new Promise((res, rej) => {
  const u = new URL(BASE + '/api/' + path); const payload = body ? JSON.stringify(body) : null;
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: body ? 'POST' : 'GET',
    headers: { host: 'stewartza.co.za', 'x-nest-test-online': '1', ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d; } res({ status: r.statusCode, data: j }); });
  }); req.on('error', rej); if (payload) req.write(payload); req.end();
});
const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const dad = client(), kid = client(), mom = client();

// ---- 4. admin first password ----
const pubUsers = await asPublicHost('users');
const lr = Array.isArray(pubUsers.data) && pubUsers.data.find((u) => u.id === 'lee-roy');
ok(lr && lr.needs_code === true, 'online: admin first login asks for a setup code', JSON.stringify(lr && { can_set_up: lr.can_set_up, needs_code: lr.needs_code }));
const claim = await asPublicHost('login', { user: 'lee-roy', password: 'stranger123' });
ok(claim.status === 403, 'online: stranger cannot claim the admin without the code', `${claim.status} ${claim.data.error}`);
const localUsers = (await dad('users')).data;
ok(localUsers.find((u) => u.id === 'lee-roy').needs_code === false, 'laptop: no setup code needed');
let r = await dad('login', { body: { user: 'lee-roy', password: 'dadpass1' } });
ok(r.status === 200 && r.data.firstTime, 'laptop: admin sets first password', r.status);
ok(!/;\s*Secure/i.test(r.headers.get('set-cookie') || ''), 'laptop log-in cookie works over plain http (phones on the Wi-Fi)');

// family logins
r = await dad('admin/users/skyler/password', { body: { password: 'temp123' } }); ok(r.status === 200, 'admin sets Skyler temp password');
r = await dad('admin/users/shirley/password', { body: { password: 'temp123' } }); ok(r.status === 200, 'admin sets Shirley temp password');
await kid('login', { body: { user: 'skyler', password: 'temp123' } });
r = await kid('password', { body: { old: 'temp123', password: 'kidpass1' } }); ok(r.status === 200, 'Skyler chooses own password');
await mom('login', { body: { user: 'shirley', password: 'temp123' } });
await mom('password', { body: { old: 'temp123', password: 'mompass1' } });
const kidMe = (await kid('me')).data; ok(kidMe.is_child && !kidMe.perms.assign_tasks, 'Skyler is a child without assign_tasks');
// Skyler needs chat to test it
r = await dad('admin/users/skyler', { method: 'PUT', body: { perms: { ...kidMe.perms, chat: true } } }); ok(r.status === 200, 'admin switches chat on for Skyler');

// ---- 5. points & backdating ----
r = await kid('tasks', { body: { title: 'Self task', area: 'Lounge', assignee: 'skyler', points: 50, due_date: addDays(today, -2) } });
ok(r.status === 200, 'child adds own one-off task', r.status);
let t = (await kid(`tasks?date=${today}&today=${today}&user=skyler`)).data.tasks.find((x) => x.title === 'Self task');
ok(t && t.points === 0, 'self-made task by a child earns 0 points', t && `points=${t.points}`);
r = await kid(`tasks/${t.id}/done`, { body: { done: true, date: addDays(today, -2) } });
t = (await kid(`tasks?date=${today}&today=${today}&user=skyler`)).data.tasks.find((x) => x.id === t.id);
ok(t && t.done_at === today, 'child tick cannot be backdated', t && `done_at=${t.done_at}`);
r = await dad('tasks', { body: { title: 'Dad task', area: 'Lounge', assignee: 'skyler', points: 20, due_date: addDays(today, -1) } });
let dt = (await dad(`tasks?date=${today}&today=${today}&user=skyler`)).data.tasks.find((x) => x.title === 'Dad task');
ok(dt && dt.points === 20, 'parent-given task keeps its points');
await dad(`tasks/${dt.id}/done`, { body: { done: true, date: addDays(today, -1) } });
dt = (await dad(`tasks?date=${addDays(today, -1)}&today=${today}&user=skyler`)).data.tasks.find((x) => x.id === dt.id);
ok(dt && dt.done_at === addDays(today, -1), 'parent can record an earlier day');
r = await dad(`tasks/${dt.id}/done`, { body: { done: true, date: addDays(today, 3) } });
dt = (await dad(`tasks?date=${addDays(today, -1)}&today=${today}&user=skyler`)).data.tasks.find((x) => x.id === dt.id);
ok(dt && dt.done_at === today, 'nobody can record a future day');

// ---- 2. chat card links ----
r = await kid('chat', { body: { card: { type: 'task', title: 'x', link: 'javascript:alert(1)' }, client_id: 'c1' } });
ok(r.status === 400, 'chat card with javascript: link is refused', `${r.status} ${r.data.error}`);
r = await kid('chat', { body: { card: { type: 'task', title: 'x', link: 'https://evil.example' }, client_id: 'c2' } });
ok(r.status === 400, 'chat card with outside link is refused');
r = await kid('chat', { body: { card: { type: 'task', title: 'Tidy', link: '#today' }, client_id: 'c3' } });
ok(r.status === 200, 'chat card with in-app link is accepted');

// ---- 3. uploads ----
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
r = await kid('photos', { raw: svg, headers: { 'content-type': 'image/svg+xml' } });
ok(r.status === 400, 'SVG upload refused', r.status);
r = await kid('photos', { raw: '<html><script>1</script>', headers: { 'content-type': 'text/html' } });
ok(r.status === 400, 'HTML upload refused');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
r = await kid('photos', { raw: png, headers: { 'content-type': 'image/png' } });
const pkey = r.data.key; ok(r.status === 200 && /^p\//.test(pkey || ''), 'PNG upload works', pkey);
r = await kid('photos/' + pkey);
ok(r.status === 200 && r.headers.get('content-type') === 'image/png' && r.headers.get('x-content-type-options') === 'nosniff', 'photo served as image with nosniff');
const voice = Buffer.alloc(5000, 7);
r = await kid('photos', { raw: voice, headers: { 'content-type': 'audio/webm;codecs=opus' } });
const akey = r.data.key; ok(r.status === 200 && /^a\/.*\.webm$/.test(akey || ''), 'voice note upload works', akey);
r = await kid('photos/' + akey, { headers: { range: 'bytes=0-99' } });
ok(r.status === 206 && r.headers.get('content-range') === 'bytes 0-99/5000', 'voice note supports range requests (iPhone playback)', `${r.status} ${r.headers.get('content-range')}`);
r = await kid('photos', { raw: Buffer.alloc(2000, 1), headers: { 'content-type': 'video/mp4' } });
const vkey = r.data.key; ok(r.status === 200 && /^v\//.test(vkey || ''), 'video upload works', vkey);
r = await kid('photos', { raw: Buffer.alloc(5 * 1024 * 1024, 1), headers: { 'content-type': 'image/jpeg' } });
ok(r.status === 413, 'photo over 4 MB refused', r.status);
r = await kid('chat', { body: { photo_key: akey, client_id: 'v1' } }); ok(r.status === 200, 'voice note posted to chat');
r = await kid('chat', { body: { photo_key: vkey, text: 'clip', client_id: 'v2' } }); ok(r.status === 200, 'video posted to chat');
r = await kid('chat', { body: { photo_key: '../../etc', client_id: 'v3' } }); ok(r.status === 400, 'made-up media key refused');
const badges = (await dad('badges')).data;
ok(badges.latest && /Video|clip/.test(badges.latest.body), 'chat badge describes the latest message', badges.latest && badges.latest.body);
r = await dad('gallery', { body: { photo_key: akey } }); ok(r.status === 400, 'voice note cannot go into the photo gallery');
r = await dad('gallery', { body: { photo_key: pkey, caption: 'Braai night' } }); ok(r.status === 200, 'photo goes into the gallery');

// ---- push ----
r = await dad('push/key'); ok(r.status === 200 && typeof r.data.key === 'string' && r.data.key.length > 80, 'push key available');
r = await dad('push/subscribe', { body: { endpoint: 'https://127.0.0.1:1/push/fake', keys: { p256dh: 'x', auth: 'y' } } }); ok(r.status === 200, 'push subscription saved');
r = await dad('push/subscribe', { body: { endpoint: 'javascript:1' } }); ok(r.status === 400, 'bad push endpoint refused');
r = await kid('chat', { body: { text: 'hello dad', client_id: 'p1' } }); ok(r.status === 200, 'chat message (sends a push to Dad)');
r = await dad('badges'); ok(r.status === 200 && 'note' in r.data, 'badges include the newest unread notification');

// ---- reactions & polls ----
const chatNow = (await dad('chat')).data;
const lastMsg = chatNow.messages[chatNow.messages.length - 1];
r = await dad(`chat/${lastMsg.id}/react`, { body: { emoji: '❤️' } }); ok(r.status === 200, 'Dad reacts');
r = await mom(`chat/${lastMsg.id}/react`, { body: { emoji: '😂' } }); ok(r.status === 200, 'Mom reacts');
const rx = (await kid('chat')).data.reactions[lastMsg.id] || {};
ok(rx['❤️']?.[0]?.user_id === 'lee-roy' && rx['😂']?.[0]?.name === 'Mom', 'reactions come with who reacted (a child sees Mom/Dad)', JSON.stringify(rx));
r = await mom('chat', { body: { client_id: 'poll1', card: { type: 'poll', kind: 'task', q: 'Who will wash the car?', task: { title: 'Wash the car', area: 'Car' }, date: today, options: [{ label: 'Lee Roy', user_id: 'lee-roy' }, { label: 'Skyler', user_id: 'skyler' }] } } });
ok(r.status === 200, 'task poll posted');
r = await mom('chat', { body: { client_id: 'poll2', card: { type: 'poll', kind: 'schedule', q: 'When suits everyone?', event: { title: 'Visit Gran' }, options: [{ label: 'Sat', date: addDays(today, 2), time: '10:00' }, { label: 'Sun', date: addDays(today, 3), time: null }] } } });
ok(r.status === 200, 'schedule poll posted');
const polls = (await kid('chat')).data.messages.filter((m) => m.card?.type === 'poll');
r = await kid(`chat/${polls[0].id}/vote`, { body: { opt: 1 } }); ok(r.status === 200, 'child votes in task poll');

// ---- 6. shop finish once ----
r = await dad('trips/new', { body: {} }); const trip = r.data.id;
await dad(`trips/${trip}/lines`, { body: { name: 'Milk', in_trolley: true, qty: 2, price: 20 } });
r = await dad(`trips/${trip}/finish`, { body: { shop: 'Spar' } }); ok(r.status === 200, 'shop finished once');
r = await dad(`trips/${trip}/finish`, { body: { shop: 'Spar' } }); ok(r.status === 409, 'finishing the same shop again is refused', r.status);

// ---- 1. reminders ----
r = await dad('events', { body: { title: 'Test reminder', category: 'family', start_date: today, remind: 'morning' } });
ok(r.status === 200, 'event with a morning reminder added');
await kid('badges');
const notes = (await mom('notifications')).data;
const hour = new Date(Date.now() + 2 * 3600e3).getUTCHours();
ok(hour < 6 || notes.some((n) => /Test reminder/.test(n.text)), 'reminder actually delivered (was silently lost before)', hour < 6 ? '(before 06:00, skipped)' : `${notes.filter((n) => /⏰/.test(n.text)).length} reminders`);

// ---- phase 8: clean-ups ----
r = await dad(`tasks?today=2030-01-01`); ok(r.data.today === today, "a phone with the wrong date doesn't move the chores", r.data.today);
for (let i = 0; i < 5; i++) await mom('login', { body: { user: 'shirley', password: 'wrong-pass' } });
r = await dad('admin/users'); ok(r.data.users.find((u) => u.id === 'shirley').locked === 1, 'locked profile shows as locked');
r = await dad('admin/users/shirley/password', { body: { password: 'mompass2' } }); await mom('login', { body: { user: 'shirley', password: 'mompass2' } });
await mom('password', { body: { old: 'mompass2', password: 'mompass3' } });
r = await dad('admin/users'); ok(!r.data.users.find((u) => u.id === 'shirley').locked, 'unlocked after a new password');
r = await dad('admin/users/skyler', { method: 'PUT', body: { colour: '"><script>x</script>', emoji: '<img src=x>' } });
const sky = (await dad('admin/users')).data.users.find((u) => u.id === 'skyler');
ok(/^#[0-9a-f]+$/i.test(sky.colour) && !/[<>]/.test(sky.emoji), 'profile colour and emoji only take real values', `${sky.colour} ${sky.emoji}`);
const many = [];
for (let i = 0; i < 120; i++) many.push((await dad('chat', { body: { text: `bulk ${i}`, client_id: 'bulk' + i } })).data.id);
r = await dad('chat/delete', { body: { ids: many } }); ok(r.status === 200 && r.data.deleted === 120, 'admin can delete 120 messages at once', `${r.status} ${JSON.stringify(r.data)}`);

// ---- chat: search, pins ----
r = await kid('chat', { body: { text: 'The school wifi password is on the fridge', client_id: 's1' } });
const pinId = r.data.id;
r = await dad('chat/search?q=wifi'); ok(r.status === 200 && r.data.some((m) => m.id === pinId), 'chat search finds a message');
r = await dad('chat/search?q=%25'); ok(r.status === 200 && Array.isArray(r.data), 'chat search handles % safely', r.data.length);
r = await mom(`chat/${pinId}/pin`, { body: {} }); ok(r.data.pinned === true, 'pin a message');
r = await kid('chat'); ok((r.data.pins || []).some((p) => p.id === pinId), 'pinned message listed for everyone');
await mom(`chat/${pinId}/pin`, { body: {} }); r = await kid('chat'); ok(!(r.data.pins || []).length, 'unpin');

// ---- notification settings ----
r = await kid('prefs', { method: 'PUT', body: { notify_chat: false, quiet_from: '21:00', quiet_to: '06:00' } });
ok(r.data.prefs && r.data.prefs.notify_chat === false && r.data.prefs.quiet_from === '21:00', 'notification settings saved', JSON.stringify(r.data.prefs));
r = await kid('prefs', { method: 'PUT', body: { quiet_from: '25:00', quiet_to: '06:00' } }); ok(!r.data.prefs.quiet_from, 'bad quiet hours are ignored');
r = await kid('prefs', { method: 'PUT', body: { user: 'lee-roy', notify_chat: false } }); ok(r.status === 403, "a child can't change someone else's settings");
r = await dad('prefs', { method: 'PUT', body: { user: 'skyler', quiet_from: '20:30', quiet_to: '06:30' } }); ok(r.status === 200 && r.data.prefs.quiet_from === '20:30', 'admin sets quiet hours for Skyler');

// ---- baby log ----
r = await kid('baby', { body: { kind: 'feed', detail: 'left' } }); ok(r.status === 403, "a child can't write the baby log");
r = await mom('baby', { body: { kind: 'feed', detail: 'bottle', amount: 90 } }); ok(r.status === 200, 'Mom logs a bottle feed');
const sastStamp = (h) => new Date(Date.now() + 2 * 3600e3 - h * 3600e3).toISOString().slice(0, 16);
r = await dad('baby', { body: { kind: 'sleep', detail: 'start', at: sastStamp(1) } }); ok(r.status === 200, 'Dad logs sleep an hour ago');
r = await dad('baby', { body: { kind: 'feed', detail: 'left', at: sastStamp(-2) } }); ok(r.status === 400, 'future time refused');
r = await dad('baby', { body: { kind: 'feed', detail: 'sideways' } }); ok(r.status === 400, 'unknown entry refused');
r = await kid('baby'); ok(r.status === 200 && r.data.summary.bottle_ml === 90 && r.data.last.sleep?.detail === 'start' && r.data.summary.sleep_minutes >= 55, 'baby log summary (feeds, ml, asleep)', JSON.stringify(r.data.summary));
const babyId = r.data.log[0].id;
r = await mom('baby/' + babyId, { method: 'DELETE' }); ok(r.status === 200, 'remove a baby log entry');

// ---- reward shop & streaks ----
r = await dad('tasks', { body: { title: 'Earn points', area: 'Lounge', assignee: 'skyler', points: 30, due_date: today } });
const earn = (await kid(`tasks?date=${today}&user=skyler`)).data.tasks.find((t) => t.title === 'Earn points');
await kid(`tasks/${earn.id}/done`, { body: { done: true } });
r = await kid('treats', { body: { title: 'Free treat', cost: 1 } }); ok(r.status === 403, "a child can't add treats");
r = await dad('treats', { body: { title: 'Pick the movie', cost: 25, emoji: '🎬' } }); ok(r.status === 200, 'Dad adds a treat');
r = await dad('treats', { body: { title: 'Bad', cost: -5 } }); ok(r.status === 400, 'treat needs a positive price');
let tr = (await kid('treats')).data;
const skyBal = tr.people.find((p) => p.id === 'skyler').balance;
ok(skyBal >= 30, "Skyler's balance counts points earned", skyBal);
const movie = tr.items.find((i) => i.title === 'Pick the movie');
r = await kid(`treats/${movie.id}/buy`, { body: {} }); ok(r.status === 200, 'Skyler spends points');
tr = (await kid('treats')).data; ok(tr.people.find((p) => p.id === 'skyler').balance === skyBal - 25, 'balance goes down');
const buy = tr.buys.find((b) => b.title === 'Pick the movie' && b.status === 'asked');
r = await kid(`treats/buys/${buy.id}`, { body: { status: 'given' } }); ok(r.status === 403, "a child can't approve their own treat");
r = await mom(`treats/buys/${buy.id}`, { body: { status: 'declined' } }); ok(r.status === 200, 'Mom says not now');
tr = (await kid('treats')).data; ok(tr.people.find((p) => p.id === 'skyler').balance === skyBal, 'points come back when declined');
r = await mom(`treats/buys/${buy.id}`, { body: { status: 'given' } }); ok(r.status === 409, "can't handle the same request twice");
ok(typeof tr.people[0].morning === 'number' && Array.isArray(tr.people[0].badges), 'streaks are worked out');

// ---- admin: backups & storage ----
r = await kid('admin/backups'); ok(r.status === 403, "a child can't see backups");
r = await dad('admin/backups', { body: {} }); ok(r.status === 200 && /^nest-\d{4}-\d{2}-\d{2}\.json$/.test(r.data.name), 'backup made', r.data.name);
const bname = r.data.name;
r = await dad('admin/backups'); ok(r.data.some((b) => b.name === bname), 'backup listed');
r = await dad('admin/backups/' + bname);
ok(r.status === 200 && r.data.app === 'stewart-nest' && Array.isArray(r.data.tables.users) && !('sessions' in r.data.tables), 'backup downloads with the data (no log-in sessions)', Object.keys(r.data.tables || {}).length + ' tables');
r = await dad('admin/backups/..%2F..%2Fsecret'); ok(r.status === 404, 'only real backup files can be downloaded');
r = await dad('admin/storage'); ok(r.status === 200 && r.data.bytes > 0 && r.data.groups.Photos, 'storage meter adds up', JSON.stringify(r.data.groups));
r = await dad('settings', { method: 'PUT', body: { video_keep_months: 12 } }); ok(r.data.video_keep_months === '12', 'video clean-up setting saved');
await dad('settings', { method: 'PUT', body: { video_keep_months: 0 } });

r = await kid('admin/week-ahead', { body: {} }); ok(r.status === 403, "a child can't send the week ahead");
r = await dad('admin/week-ahead', { body: {} }); ok(r.status === 200, 'admin sends the week ahead');
const wa = (await mom('notifications')).data.find((n) => /Week ahead/.test(n.text));
ok(wa && /🍽️/.test(wa.text), 'week ahead arrives with suppers', wa && wa.text.slice(0, 140));
const waCount = async (c) => (await c('notifications')).data.filter((n) => /Week ahead/.test(n.text)).length;
r = await kid('prefs', { method: 'PUT', body: { week_ahead: false } });
const kidBefore = await waCount(kid), momBefore = await waCount(mom);
await dad('admin/week-ahead', { body: {} });
ok(await waCount(kid) === kidBefore && await waCount(mom) === momBefore + 1, 'someone who switched it off does not get it');

// ---- Android app link file ----
const al = await fetch(BASE.replace(/\/$/, '') + '/.well-known/assetlinks.json');
ok(al.ok && /json/.test(al.headers.get('content-type') || '') && Array.isArray(await al.json()), 'Android link file is served');

// ---- stewartza.co.za/app download page ----
const root = BASE.replace(/\/$/, '');
const page = await fetch(root + '/app', { redirect: 'follow' });
ok(page.ok && /Download the app/.test(await page.text()), '/app download page', page.status);
const apkRes = await fetch(root + '/app/stewart-nest.apk', { method: 'HEAD' });
ok(apkRes.ok, 'APK downloadable from /app', `${apkRes.status} ${apkRes.headers.get('content-type')}`);

// ---- timer job (reminders, week ahead, backup) ----
const sched = await fetch(BASE.replace(/\/$/, '') + '/__scheduled?cron=*%2F15+*+*+*+*');
ok(sched.ok, 'the 15-minute timer job runs', sched.status);

// misc screens still answer
for (const p of [`month?ym=${today.slice(0, 7)}`, 'baby', 'treats', 'chat/search?q=ab', `day?date=${today}`, 'catalog', 'rewards', 'workouts', 'events/all', `menu?from=${today}&to=${addDays(today, 27)}`, 'recipes', 'gallery', 'chat', 'trips/current', 'stock-takes/current', 'fun', 'lists', 'items', 'settings', 'ratings/summary', 'templates']) {
  r = await dad(p); ok(r.status === 200, `GET ${p}`, r.status === 200 ? '' : `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
