/*! Appointment booking widget v1 — vanilla JS, no dependencies, Shadow DOM.
 *  Embed:  <script src="https://API_HOST/widget/v1.js" async></script>
 *  Options (data- attributes on the script tag, or ?query params on /widget/frame):
 *    data-color="0f6b52"  data-title="Clinic name"  data-position="right|left"
 *    data-branch="<branchId>" (lock to one branch)  data-open="1" (auto-open)  data-mode="float|inline"
 */
(() => {
  'use strict';
  if (window.__cpfWidget) return;
  window.__cpfWidget = true;

  const script = document.currentScript || document.querySelector('script[src*="/widget/v1.js"]');
  const ds = (script && script.dataset) || {};
  const qs = new URLSearchParams(location.search);
  const opt = (k, d) => ds[k] || qs.get(k) || d;

  const ORIGIN = script && script.src ? new URL(script.src, location.href).origin : location.origin;
  const API = String(opt('api', ORIGIN)).replace(/\/$/, '') + '/api/v1/widget';
  const hex = String(opt('color', '')).replace('#', '');
  const COLOR = /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex : '#0f6b52';
  const INLINE = opt('mode', 'float') === 'inline';
  const LEFT = opt('position', 'right') === 'left';
  const LOCK = opt('branch', '');
  const TITLE = opt('title', '');
  const SITE = (() => {
    try { return location.hostname !== new URL(ORIGIN).hostname ? location.hostname : new URL(document.referrer).hostname; } catch (e) { return ''; }
  })();

  /* ------------------------------------------------------------------ helpers */
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    kids.forEach((c) => { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const low = (s) => String(s || '').trim().toLowerCase();

  const api = (path, o = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    return fetch(API + path, { method: o.body ? 'POST' : 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined })
      .then((r) => r.json().catch(() => ({})).then((j) => {
        if (!r.ok || j.success === false) {
          const e = new Error((j.details && j.details[0] && j.details[0].message) || j.message || 'Something went wrong. Please try again.');
          e.status = r.status;
          e.details = j.details;
          if (r.status === 401 && o.token) { S.token = ''; S.who = ''; store.clear(); } // token expired or invalid
          throw e;
        }
        return j.data;
      }, () => { throw new Error('Network problem. Please try again.'); }), () => { throw new Error('Network problem. Please try again.'); });
  };

  const addDay = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTime = (t) => { const [H, M] = t.split(':').map(Number); return ((H % 12) || 12) + ':' + String(M).padStart(2, '0') + ' ' + (H < 12 ? 'AM' : 'PM'); };

  /* ------------------------------------------------------------------ styles */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
.wrap{position:fixed;bottom:20px;right:20px;z-index:2147483000;--c:${COLOR}}
.wrap.left{right:auto;left:20px}
.wrap.inline{position:static}
.launch{display:flex;align-items:center;gap:10px;border:0;cursor:pointer;background:var(--c);color:#fff;font-size:15px;font-weight:600;padding:14px 20px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.launch svg{width:22px;height:22px;fill:#fff}
.panel{display:none;flex-direction:column;width:370px;max-width:100vw;height:620px;max-height:calc(100vh - 40px);background:#e7e0d4;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3)}
.open .panel{display:flex}
.open .launch{display:none}
.inline .panel{display:flex;width:100%;height:100vh;max-height:none;border-radius:0;box-shadow:none}
.head{background:var(--c);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}
.av{width:40px;height:40px;border-radius:50%;background:#f3a6d0;color:#5b1a3f;display:grid;place-items:center;font-weight:700;font-size:18px;flex:none}
.ht{flex:1;min-width:0}
.ht b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ht span{font-size:12px;opacity:.85}
.x{background:none;border:0;color:#fff;font-size:28px;line-height:1;cursor:pointer;padding:2px 8px}
.msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;background-image:radial-gradient(rgba(0,0,0,.06) 1px,transparent 1px);background-size:14px 14px}
.b{max-width:86%;padding:9px 12px;border-radius:10px;font-size:14.5px;line-height:1.4;box-shadow:0 1px 1px rgba(0,0,0,.12);white-space:pre-wrap;word-wrap:break-word;color:#1b1b1b}
.bot{background:#fff;align-self:flex-start;border-top-left-radius:2px}
.me{background:#d9f7c5;align-self:flex-end;border-top-right-radius:2px}
.ok{border-left:4px solid #25b35a}
.pdfb{width:94%;max-width:94%;padding:6px}
.pdf{display:block;width:100%;height:340px;border:0;border-radius:8px;background:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px;align-self:flex-start;max-width:94%}
.chip{border:0;cursor:pointer;background:var(--c);color:#fff;padding:9px 16px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;display:inline-block}
.chip:hover{filter:brightness(1.12)}
.chip.alt{background:#fff;color:var(--c);box-shadow:inset 0 0 0 1.5px var(--c)}
.chip.t{padding:8px 12px;font-size:13px}
.chip.cta{flex-basis:100%;text-align:center;background:#25b35a;font-size:16px;padding:14px;box-shadow:0 4px 12px rgba(0,0,0,.2)}
.chip:focus-visible,.send:focus-visible,.launch:focus-visible,.x:focus-visible,.bar input:focus-visible{outline:3px solid #ffb703;outline-offset:2px}
.typing{display:flex;gap:4px;padding:12px 14px;width:56px}
.typing i{width:7px;height:7px;border-radius:50%;background:#999;animation:bl 1s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes bl{0%,60%,100%{opacity:.3}30%{opacity:1}}
.bar{display:flex;gap:8px;padding:10px;background:#f0f0f0}
.bar input{flex:1;min-width:0;border:0;border-radius:999px;padding:11px 16px;font-size:15px;background:#fff;color:#1b1b1b}
.bar input:disabled{background:#e4e4e4}
.send{width:44px;height:44px;flex:none;border:0;border-radius:50%;background:var(--c);color:#fff;cursor:pointer;display:grid;place-items:center}
.send svg{width:20px;height:20px;fill:#fff}
@media (max-width:480px){.wrap:not(.inline).open .panel{position:fixed;inset:0;width:100vw;height:100%;max-height:none;border-radius:0}}
@media (prefers-reduced-motion:reduce){.typing i{animation:none}}
`;
  const ICON_CAL = '<svg viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10zm2 2v2h4v-2H7z"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

  /* ------------------------------------------------------------------ state */
  let cfg = null;
  let step = 'idle';
  let q = Promise.resolve(); // keeps bubbles in order
  let hist = []; // AI conversation
  const S = { branch: null, date: null, start: null, slotOk: false, mobile: '', token: '', name: '', age: null, gender: '', profiles: [], after: '', who: '', exp: 0 };

  /* ------------------------------------------------------------------ session (2 hours, kept in this browser) */
  const SKEY = 'cpfw_session';
  const TTL = 2 * 60 * 60 * 1000;
  const store = {
    load() {
      try {
        const j = JSON.parse(localStorage.getItem(SKEY) || 'null');
        if (j && j.token && j.exp > Date.now()) return j;
        localStorage.removeItem(SKEY);
      } catch (e) { /* storage blocked */ }
      return null;
    },
    save() { try { localStorage.setItem(SKEY, JSON.stringify({ token: S.token, mobile: S.mobile, exp: S.exp })); } catch (e) { /* ignore */ } },
    clear() { try { localStorage.removeItem(SKEY); } catch (e) { /* ignore */ } },
  };
  /** drops the login once the 2 hours are over */
  const checkExp = () => { if (S.token && Date.now() > S.exp) { S.token = ''; S.who = ''; store.clear(); } };
  /** re-use a saved login if it is still valid on the server */
  const restore = () => {
    const s = store.load();
    if (!s) return Promise.resolve();
    return api('/me', { token: s.token }).then((r) => {
      S.token = s.token; S.mobile = s.mobile; S.exp = s.exp;
      S.profiles = r.profiles || []; S.who = r.name || '';
    }).catch(() => store.clear());
  };
  function logout() {
    S.token = ''; S.who = ''; S.mobile = ''; S.profiles = []; S.name = ''; S.age = null; S.gender = ''; S.after = '';
    store.clear();
    bot('You are logged out. Your session was cleared from this browser.');
    chips(menu());
  }

  /* ------------------------------------------------------------------ DOM */
  const host = h('div');
  const root = host.attachShadow({ mode: 'open' });
  const wrap = h('div', { class: 'wrap' + (INLINE ? ' inline open' : '') + (LEFT ? ' left' : '') });
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', placeholder: 'Type a message', 'aria-label': 'Your message', autocomplete: 'off', maxlength: '500' });
  const sendBtn = h('button', { class: 'send', 'aria-label': 'Send', type: 'button', onclick: () => onSend() });
  sendBtn.innerHTML = ICON_SEND;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSend(); } });
  const avatar = h('div', { class: 'av', text: 'C' });
  const title = h('b', { text: TITLE || 'Book an appointment' });
  const closeBtn = h('button', { class: 'x', 'aria-label': 'Close', type: 'button', text: '×', onclick: () => toggle(false) });
  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Book an appointment' },
    h('div', { class: 'head' }, avatar, h('div', { class: 'ht' }, title, h('span', { text: 'Online · books in under a minute' })), INLINE ? null : closeBtn),
    msgs,
    h('div', { class: 'bar' }, input, sendBtn));
  const launch = h('button', { class: 'launch', type: 'button', 'aria-label': 'Book appointment', onclick: () => toggle(true) }, h('span', { text: 'Book Appointment' }));
  launch.insertAdjacentHTML('afterbegin', ICON_CAL);
  wrap.append(launch, panel);
  root.append(h('style', { text: CSS }), wrap);

  const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
  const emit = (fn) => { q = q.then(fn).catch(() => {}); return q; };

  const bot = (text, cls) => emit(() => {
    const t = h('div', { class: 'b bot typing' }, h('i'), h('i'), h('i'));
    msgs.appendChild(t); scroll();
    return sleep(320).then(() => { t.remove(); msgs.appendChild(h('div', { class: 'b bot' + (cls ? ' ' + cls : ''), text })); scroll(); });
  });
  const me = (text) => { msgs.appendChild(h('div', { class: 'b me', text })); scroll(); };
  const clearChips = () => { msgs.querySelectorAll('.chips').forEach((c) => c.remove()); };
  /** items: { t, fn, cls, href, dl, keep } */
  const chips = (items) => emit(() => {
    const box = h('div', { class: 'chips' });
    items.forEach((it) => {
      const onPick = () => { if (!it.keep) { clearChips(); me(it.t); } if (it.fn) it.fn(); };
      if (it.href) {
        const a = h('a', { class: 'chip ' + (it.cls || ''), href: it.href, target: '_blank', rel: 'noopener', text: it.t });
        if (it.dl) a.setAttribute('download', it.dl);
        box.appendChild(a);
      } else {
        box.appendChild(h('button', { class: 'chip ' + (it.cls || ''), type: 'button', text: it.t, onclick: onPick }));
      }
    });
    msgs.appendChild(box); scroll();
  });
  /** which kind of text the input expects now */
  const setStep = (name, placeholder, textOk = true, attrs = {}) => emit(() => {
    step = name;
    input.placeholder = placeholder || 'Type a message';
    input.disabled = !textOk && !(cfg && cfg.ai);
    input.type = attrs.type || 'text';
    input.inputMode = attrs.mode || '';
    input.maxLength = attrs.max || 500;
    if (!input.disabled && wrap.classList.contains('open')) input.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------------ flow */
  const tel = () => (cfg.clinic.phone ? [{ t: 'Call ' + cfg.clinic.phone, href: 'tel:' + cfg.clinic.phone.replace(/[^\d+]/g, ''), cls: 'alt' }] : []);
  const bookChip = () => ({ t: 'Book Appointment', cls: 'cta', fn: () => { S.after = ''; advance(); } });
  const menu = () => [bookChip(), { t: 'My bookings', cls: 'alt', fn: () => myBookings() }]
    .concat(cfg.ai ? [{ t: 'Ask a question', cls: 'alt', fn: ask }] : [])
    .concat(S.token && S.who ? [{ t: 'Not ' + S.who.split(' ')[0] + '? Log out', cls: 'alt t', fn: logout }] : []);

  const BOOKINGS_RE = /\b(my|meri|mera|recent|last|previous|past|upcoming)\b[\w\s]{0,20}\b(bookings?|appointments?)\b|\b(bookings?|appointments?)\s+(status|history|details)\b|\bslip\b/i;
  const BOOKING_ID_RE = /\b[A-Za-z]{2,6}-\d{5,8}-\d{3,6}\b/;
  const CONTACT_RE = /\b(phone|call|contact|address|location|where|directions?|branch(es)?)\b/i;

  const begin = () => {
    avatar.textContent = (cfg.clinic.name || 'C').trim().charAt(0).toUpperCase();
    if (!TITLE) title.textContent = cfg.clinic.name;
    bot(S.token && S.who
      ? 'Welcome back, ' + S.who + ' 👋 You are signed in, so no OTP is needed. I can book an appointment, show your bookings or answer questions.'
      : 'Hi 👋 Welcome to ' + cfg.clinic.name + '! I can book your appointment, show your bookings or answer questions.');
    chips(menu());
    setStep('idle', 'Type or choose an option', true);
  };

  const ask = () => { bot('Sure — type your question below.'); setStep('chat', 'Type your question'); };

  function showContact() {
    const lines = cfg.branches.map((b) => b.name + (b.address ? '\n' + b.address : '') + (b.phone ? '\n📞 ' + b.phone : ''));
    bot(lines.length ? lines.join('\n\n') : 'Please call us and our team will help.');
    chips(tel().concat(menu()));
  }

  function advance() {
    checkExp();
    if (!S.branch) return askBranch();
    if (!S.date) return askDay();
    if (!S.start || !S.slotOk) return askSlot();
    if (cfg.paymentRequired) return payRedirect();
    if (!S.token) return S.mobile ? sendOtp() : askMobile();
    if (!S.name) return askWho();
    const known = S.profiles.some((p) => low(p.name) === low(S.name));
    if (!known && S.age == null) return askAge();
    if (!known && !S.gender) return askGender();
    return doBook();
  }

  function askBranch() {
    const list = cfg.branches;
    const lock = list.find((b) => b._id === LOCK);
    if (lock || list.length === 1) { S.branch = lock || list[0]; return advance(); }
    if (!list.length) { bot('Online booking is not available right now.'); return chips(tel()); }
    bot('Which branch would you like to visit?');
    chips(list.map((b) => ({ t: b.name, fn: () => { S.branch = b; advance(); } })));
    setStep('idle', 'Choose an option above', false);
  }

  function askDay() {
    return api('/days?branch=' + S.branch._id).then((r) => {
      if (!r.days.length) { bot('Sorry, no slots are open in the next few days. Please call us.'); return chips(tel()); }
      bot('Which day suits you?');
      chips(r.days.map((d) => ({ t: d === cfg.today ? 'Today' : d === addDay(cfg.today, 1) ? 'Tomorrow' : fmtDate(d), cls: 't', fn: () => { S.date = d; S.start = null; S.slotOk = false; advance(); } })));
      setStep('idle', 'Choose a day above', false);
    }).catch((e) => { bot(e.message); chips([{ t: 'Try again', fn: () => advance() }].concat(tel())); });
  }

  function askSlot() {
    const date = S.date;
    return api('/slots?branch=' + S.branch._id + '&date=' + date).then((r) => {
      if (S.start && r.slots.some((s) => s.start === S.start)) { S.slotOk = true; return advance(); }
      if (S.start) bot(fmtTime(S.start) + ' is not free on ' + fmtDate(date) + '.');
      S.start = null; S.slotOk = false;
      if (!r.slots.length) { S.date = null; bot('No free slots on ' + fmtDate(date) + '. Pick another day.'); return advance(); }
      bot('Available times on ' + fmtDate(date) + ':');
      chips(r.slots.map((s) => ({ t: fmtTime(s.start), cls: 't', fn: () => { S.start = s.start; S.slotOk = true; advance(); } })));
      chips([{ t: 'Change day', cls: 'alt t', fn: () => { S.date = null; advance(); } }]);
      setStep('idle', 'Choose a time above', false);
    }).catch((e) => { S.date = null; S.start = null; bot(e.message); advance(); });
  }

  function payRedirect() {
    bot('A small advance payment is needed for online booking. Please finish on our secure booking page.');
    chips((cfg.bookingUrl ? [{ t: 'Continue to booking page', cls: 'cta', href: cfg.bookingUrl }] : []).concat(tel()));
    setStep('idle', 'Choose an option above', false);
  }

  function askMobile() {
    bot('Enter your 10-digit mobile number. We will send a code on WhatsApp to confirm it is you.');
    setStep('mobile', 'Mobile number', true, { type: 'tel', mode: 'numeric', max: 10 });
  }

  function sendOtp() {
    return api('/otp/send', { body: { mobile: S.mobile } }).then(() => {
      bot('Code sent to +91 ' + S.mobile.slice(0, 2) + '••••••' + S.mobile.slice(-2) + '. Enter the 6-digit code.');
      chips([{ t: 'Resend code', cls: 'alt t', fn: () => sendOtp() }, { t: 'Change number', cls: 'alt t', fn: () => { S.mobile = ''; askMobile(); } }]);
      setStep('otp', '6-digit code', true, { type: 'text', mode: 'numeric', max: 6 });
    }).catch((e) => { bot(e.message); chips([{ t: 'Try again', fn: () => sendOtp() }, { t: 'Change number', cls: 'alt', fn: () => { S.mobile = ''; askMobile(); } }]); });
  }

  function verify(code) {
    return api('/otp/verify', { body: { mobile: S.mobile, otp: code } }).then((r) => {
      S.token = r.token; S.profiles = r.profiles || []; S.who = r.name || '';
      S.exp = Date.now() + TTL; store.save();
      bot(S.who ? 'Number verified ✅ Welcome, ' + S.who + '!' : 'Number verified ✅');
      if (S.after === 'bookings') { S.after = ''; return myBookings(); }
      if (S.after.indexOf('slip:') === 0) { const id = S.after.slice(5); S.after = ''; return findBooking(id); }
      advance();
    }).catch((e) => { bot(e.message + ' Please enter the code again.'); });
  }

  function askWho() {
    if (S.profiles.length) {
      bot('Who is the appointment for?');
      chips(S.profiles.map((p) => ({ t: p.name, fn: () => { S.name = p.name; advance(); } })).concat([{ t: 'Someone else', cls: 'alt', fn: askName }]));
      return setStep('idle', 'Choose an option above', false);
    }
    return askName();
  }
  function askName() { bot("What is the patient's full name?"); setStep('name', 'Full name'); }
  function askAge() { bot('Age of the patient (in years)?'); setStep('age', 'Age', true, { type: 'text', mode: 'numeric', max: 3 }); }
  function askGender() {
    bot('Gender? Tap an option or type it.');
    chips(['Male', 'Female', 'Other'].map((g) => ({ t: g, fn: () => { S.gender = g.toLowerCase(); advance(); } })));
    setStep('gender', 'Male / Female / Other', true);
  }

  function doBook() {
    setStep('idle', 'Booking…', false);
    const known = S.profiles.some((p) => low(p.name) === low(S.name));
    const body = { branch: S.branch._id, date: S.date, start: S.start, name: S.name, site: SITE };
    if (!known) { body.ageYears = S.age; body.gender = S.gender; }
    return api('/book', { token: S.token, body }).then(done).catch((e) => {
      if (e.details && e.details.paymentRequired) return payRedirect();
      if (e.status === 401) { S.token = ''; bot('Your session expired. Let us verify again.'); return advance(); }
      bot(e.message);
      if (e.status === 409 && /already has/i.test(e.message)) return chips([{ t: 'Choose another day', fn: () => { S.date = null; S.start = null; S.slotOk = false; advance(); } }].concat(tel()));
      if (e.status === 409) { S.start = null; S.slotOk = false; return chips([{ t: 'Choose another time', fn: () => advance() }]); }
      return chips([{ t: 'Try again', fn: () => doBook() }].concat(tel()));
    });
  }

  function done(r) {
    const when = fmtDate(r.date) + ' · ' + fmtTime(r.start);
    const lines = ['✅ Appointment booked', 'ID: ' + r.bookingId, 'Patient: ' + r.patient, 'When: ' + when, 'Where: ' + r.branch.name + (r.branch.address ? ', ' + r.branch.address : '')];
    if (r.doctor) lines.push('Doctor: ' + r.doctor);
    bot(lines.join('\n'), 'ok');
    bot('You will get a confirmation and reminder on WhatsApp.');
    const d = (x, t) => x.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
    const cal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Appointment - ' + cfg.clinic.name) + '&dates=' + d(r.date, r.start) + '/' + d(r.date, r.end || r.start) + '&location=' + encodeURIComponent(r.branch.name + (r.branch.address ? ', ' + r.branch.address : '')) + '&details=' + encodeURIComponent('Booking ID: ' + r.bookingId);
    const finish = (slipUrl) => chips(
      (slipUrl ? [
        { t: 'Open slip', href: slipUrl },
        { t: 'Download slip', cls: 'alt', href: slipUrl, dl: 'appointment-' + r.bookingId + '.pdf' },
      ] : []).concat([
        { t: 'Add to calendar', cls: 'alt', href: cal },
        { t: 'My bookings', cls: 'alt', fn: () => myBookings() },
        { t: 'Book another', cls: 'alt', fn: () => { S.date = null; S.start = null; S.slotOk = false; S.name = ''; S.age = null; S.gender = ''; advance(); } },
      ]));
    showSlip(r.id, r.bookingId, finish);
    setStep('idle', 'Type or choose an option', true);
  }

  /* ------------------------------------------------------------------ my bookings + slip */
  function myBookings() {
    checkExp();
    if (!S.token) {
      S.after = 'bookings';
      bot('To show your bookings, please verify your mobile number first.');
      return S.mobile ? sendOtp() : askMobile();
    }
    return api('/my-bookings', { token: S.token }).then((r) => {
      if (!r.bookings.length) { bot('No bookings found for this number yet.'); return chips(menu()); }
      const lines = r.bookings.map((b, i) =>
        (i + 1) + '. ' + (b.upcoming ? '🟢 ' : '⚪ ') + fmtDate(b.date) + ' · ' + fmtTime(b.start) + (b.status ? ' — ' + b.status : '') +
        '\n    ' + b.patient + (b.branch ? ' · ' + b.branch : '') + (b.doctor ? ' · Dr ' + b.doctor : '') +
        '\n    ID: ' + b.bookingId);
      bot('Your recent bookings:\n\n' + lines.join('\n\n') + '\n\n🟢 upcoming  ⚪ past');
      const afterSlip = (url) => chips((url ? [
        { t: 'Open slip', href: url },
        { t: 'Download slip', cls: 'alt', href: url, dl: 'appointment.pdf' },
      ] : []).concat(menu()));
      chips(r.bookings.slice(0, 5).map((b) => ({ t: 'Slip ' + b.bookingId, cls: 'alt t', fn: () => showSlip(b.id, b.bookingId, afterSlip) })));
      chips(menu());
      setStep('idle', 'Type or choose an option', true);
    }).catch((e) => {
      if (e.status === 401) { S.token = ''; S.after = 'bookings'; bot('Your session expired. Let us verify again.'); return S.mobile ? sendOtp() : askMobile(); }
      bot(e.message);
      chips([{ t: 'Try again', fn: () => myBookings() }].concat(menu()));
    });
  }

  /** visitor typed a booking ID → verify mobile, check ownership, show that slip */
  function findBooking(id) {
    checkExp();
    if (!S.token) {
      S.after = 'slip:' + id;
      bot('To protect your details, please verify your mobile number first. Then I will show the slip for ' + id + '.');
      return S.mobile ? sendOtp() : askMobile();
    }
    return api('/booking/' + encodeURIComponent(id), { token: S.token }).then((b) => {
      bot('Found it ✅\n' + b.bookingId + '\n' + b.patient + ' · ' + fmtDate(b.date) + ' · ' + fmtTime(b.start) + (b.status ? ' — ' + b.status : '') + (b.branch ? '\n' + b.branch : '') + (b.doctor ? ' · Dr ' + b.doctor : ''), 'ok');
      showSlip(b.id, b.bookingId, (url) => chips((url ? [
        { t: 'Open slip', href: url },
        { t: 'Download slip', cls: 'alt', href: url, dl: 'appointment-' + b.bookingId + '.pdf' },
      ] : []).concat(menu())));
      setStep('idle', 'Type or choose an option', true);
    }).catch((e) => {
      if (e.status === 401) { S.token = ''; S.after = 'slip:' + id; bot('Your session expired. Let us verify again.'); return S.mobile ? sendOtp() : askMobile(); }
      bot(e.status === 404 ? 'I could not find booking ' + id + ' on this mobile number. Please check the ID or try another number.' : e.message);
      chips([{ t: 'Change number', cls: 'alt', fn: () => { S.mobile = ''; S.token = ''; S.after = 'slip:' + id; askMobile(); } }, { t: 'My bookings', cls: 'alt', fn: () => myBookings() }].concat(menu().slice(0, 1)));
    });
  }

  /** fetches the slip PDF with the patient token and shows it inside the chat */
  function showSlip(id, bookingId, then) {
    return emit(() => fetch(API + '/slip/' + id, { headers: { Authorization: 'Bearer ' + S.token } })
      .then((res) => { if (!res.ok) throw new Error('slip'); return res.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        msgs.appendChild(h('div', { class: 'b bot pdfb' }, h('iframe', { class: 'pdf', src: url, title: 'Appointment slip ' + bookingId })));
        scroll();
        then(url);
      })
      .catch(() => { bot('Could not load the slip right now. It is also sent on WhatsApp.'); then(null); }));
  }

  /* ------------------------------------------------------------------ typed input */
  function onSend() {
    const v = input.value.trim();
    if (!v || input.disabled) return;
    input.value = '';
    clearChips();
    me(v);
    if (step === 'mobile') {
      if (!/^[6-9]\d{9}$/.test(v)) { bot('Please enter a valid 10-digit mobile number.'); return; }
      S.mobile = v; return sendOtp();
    }
    if (step === 'otp') {
      if (!/^\d{6}$/.test(v)) { bot('The code has 6 digits.'); return; }
      return verify(v);
    }
    if (step === 'name') {
      if (v.length < 2) { bot('Please enter the full name.'); return; }
      S.name = v.slice(0, 80); return advance();
    }
    if (step === 'age') {
      const n = parseInt(v, 10);
      if (!(n >= 0 && n <= 120)) { bot('Please enter age as a number, e.g. 34.'); return; }
      S.age = n; return advance();
    }
    if (step === 'gender') {
      const g = low(v);
      const val = /^(m|male|man|boy|purush|ladka)$/.test(g) ? 'male'
        : /^(f|female|woman|girl|mahila|ladki)$/.test(g) ? 'female'
        : /^(o|other|others|non-?binary)$/.test(g) ? 'other' : '';
      if (!val) { bot('Please choose Male, Female or Other.'); return; }
      S.gender = val; return advance();
    }
    const idm = v.match(BOOKING_ID_RE);
    if (idm) return findBooking(idm[0].toUpperCase());
    if (BOOKINGS_RE.test(v)) return myBookings();
    if (CONTACT_RE.test(v)) return showContact();
    return aiTurn(v);
  }

  function aiTurn(v) {
    if (!cfg.ai) { bot('I can help you book, show your bookings or share contact details. Please choose an option.'); return chips(menu()); }
    hist.push({ role: 'user', content: v });
    return api('/chat', { body: { messages: hist.slice(-8) } }).then((r) => {
      hist.push({ role: 'assistant', content: r.reply });
      bot(r.reply);
      if (r.intent === 'bookings') return myBookings();
      if (r.intent === 'book') {
        S.after = '';
        const b = cfg.branches.find((x) => x._id === r.branch);
        if (b && !LOCK) S.branch = b;
        if (r.date) { S.date = r.date; S.start = null; S.slotOk = false; }
        if (r.time) { S.start = r.time; S.slotOk = false; }
        return advance();
      }
      chips(menu());
    }).catch(() => { bot('Sorry, I cannot reply right now. Please choose an option.'); chips(menu().concat(tel())); });
  }

  /* ------------------------------------------------------------------ open / close */
  let started = false;
  function toggle(open) {
    wrap.classList.toggle('open', open);
    if (open && !started) {
      started = true;
      api('/config').then((c) => { cfg = c; return restore(); }).then(() => begin()).catch(() => { bot('Booking is unavailable right now. Please try again later.'); });
    }
    if (open) setTimeout(() => { if (!input.disabled) input.focus({ preventScroll: true }); }, 50);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !INLINE) toggle(false); });

  const mount = () => {
    (document.body || document.documentElement).appendChild(host);
    if (INLINE) toggle(true);
    else if (opt('open', '') === '1') toggle(true);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();