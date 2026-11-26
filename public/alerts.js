// The Stewart Nest — alerts on this device: sound and vibration for new messages and notifications.
// Settings are per device (stored in this browser) — see More → Alerts on this device.
'use strict';

const Alerts = {
  get(k, d) { try { const v = localStorage.getItem('nest-' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nest-' + k, v); } catch { /* private mode */ } },
  ctx: null,
  // browsers only allow sound after the person has touched the page once — unlock on the first tap
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* no audio */ }
  },
  TONES: {
    ding: [[880, 0, 0.18], [1320, 0.09, 0.22]],
    pop: [[620, 0, 0.07], [930, 0.05, 0.08]],
    chime: [[784, 0, 0.25], [988, 0.12, 0.25], [1175, 0.24, 0.35]],
    nest: [[659, 0, 0.12], [880, 0.1, 0.12], [1047, 0.2, 0.3]],
  },
  play(tone) {
    if (this.get('sound', '1') !== '1') return;
    try {
      this.unlock();
      const ctx = this.ctx; if (!ctx) return;
      const t0 = ctx.currentTime + 0.01, vol = Number(this.get('volume', '0.5'));
      for (const [f, at, len] of this.TONES[tone || this.get('tone', 'ding')] || this.TONES.ding) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.connect(g).connect(ctx.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.05);
      }
    } catch { /* ignore */ }
  },
  // chat: one alert per message, however many parts of the app notice it
  chatSeen() { return Number(this.get('chat-seen-' + (typeof S !== 'undefined' && S.me ? S.me.id : ''), '0')); },
  markChat(id) { if (id > this.chatSeen()) this.set('chat-seen-' + (typeof S !== 'undefined' && S.me ? S.me.id : ''), String(id)); },
  chatAlert(m, quiet = false) {
    if (!m || !m.id || m.id <= this.chatSeen()) return;
    this.markChat(m.id);
    this.ping({ title: `💬 ${m.name || 'Family chat'}`, body: m.body || '', link: '#chat', quiet });
  },
  buzz(pattern = [120, 60, 120]) { if (this.get('vibrate', '1') === '1' && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* */ } },
  // a new message/notification: in the app → sound + vibrate; app in the background → phone notification
  async ping({ title = 'The Stewart Nest', body = '', link = '#chat', quiet = false } = {}) {
    if (!document.hidden) { this.play(quiet ? 'pop' : undefined); this.buzz(quiet ? [60] : undefined); return; }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
        const opts = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'nest-' + link, renotify: true, data: { link },
          vibrate: this.get('vibrate', '1') === '1' ? [120, 60, 120] : [], silent: this.get('sound', '1') !== '1' };
        if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
      } catch { /* ignore */ }
    }
  },
};
window.Alerts = Alerts;
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => Alerts.unlock(), { once: true, passive: true }));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
