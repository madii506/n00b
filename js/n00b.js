/* n00b: chatrooms for holders. Everything on this page reads the real API; nothing is seeded. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } } };
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const num = n => Math.round(n).toLocaleString('en-US');
  const ago = t => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const money = v => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + Math.round(v);
  const isNoob = a => /^[0-6]d$/.test(String(a || ''));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
  const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const say = t => { $('#live2').textContent = t; };

  const S = { cfg: null, tok: store.get('n00b:tok'), me: store.get('n00b:me'), name: store.get('n00b:name'), mint: null, room: null, last: 0, mine: null, people: [], lobby: null, busy: false, first: true,
    view: { sys: store.get('n00b:sys') !== '0', stamps: store.get('n00b:stamps') !== '0', online: store.get('n00b:online') === '1' } };

  async function api(p, body) {
    const h = { 'content-type': 'application/json' }; if (S.tok) h.authorization = 'Bearer ' + S.tok;
    const r = await fetch('/api/' + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (r.status === 401 && S.tok && !/^(login|nonce)/.test(p)) signOut(true);
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong (' + r.status + ').'); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  /* ---------------- smooth scroll, reveal, typed headings ---------------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new Lenis({ lerp: .085, smoothWheel: true, wheelMultiplier: .9 });
    const raf = t => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  }
  const goTo = el => { if (!el) return; const y = el.getBoundingClientRect().top + scrollY - 40; lenis ? lenis.scrollTo(Math.max(0, y), { duration: 1.2 }) : scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' }); };
  function typeH2(h) {
    if (h.dataset.done) return; h.dataset.done = 1;
    const sp = h.querySelector('span'), full = h.dataset.type || sp.textContent;
    if (reduce) { sp.textContent = full; return; }
    sp.textContent = ''; h.classList.add('typing'); let i = 0;
    const step = () => { sp.textContent = full.slice(0, ++i); if (i < full.length) setTimeout(step, 45 + Math.random() * 40); else setTimeout(() => h.classList.remove('typing'), 1600); };
    setTimeout(step, 200);
  }
  if (!reduce) $$('.h2').forEach(h => { h.querySelector('span').textContent = ''; });
  const lightUp = el => { el.classList.add('vis'); if (el.classList.contains('win')) setTimeout(() => el.classList.add('lit'), 380 + (parseFloat(getComputedStyle(el).getPropertyValue('--k')) || 0) * 110); };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; const el = e.target;
    if (el.classList.contains('h2')) typeH2(el); else lightUp(el);
    io.unobserve(el);
  }), { rootMargin: '0px 0px -8% 0px' });
  $$('.rv, .h2').forEach(el => io.observe(el));
  const sweep = () => { $$('.rv:not(.vis)').forEach(el => { if (el.getBoundingClientRect().top < innerHeight) lightUp(el); }); $$('.h2:not([data-done])').forEach(h => { if (h.getBoundingClientRect().top < innerHeight) typeH2(h); }); };
  addEventListener('scroll', () => { clearTimeout(sweep.t); sweep.t = setTimeout(sweep, 120); }, { passive: true });

  /* ---------------- clock ---------------- */
  const tick = () => { const d = new Date(); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; $('#clock').textContent = h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap; };
  tick(); setInterval(tick, 10000);

  /* ---------------- menu bar: scroll spy with a sliding highlight ---------------- */
  const navLinks = $$('#mlinks a'), ind = $('#ind'), secs = navLinks.map(a => $('#' + a.dataset.s));
  function moveInd(a) {
    navLinks.forEach(x => x.classList.toggle('on', x === a));
    if (!a) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft}px)`;
  }
  function spy() { let cur = 0; secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * .42) cur = i; }); moveInd(navLinks[cur]); }
  addEventListener('scroll', spy, { passive: true }); addEventListener('resize', spy);
  $('#mlinks').addEventListener('click', e => { const a = e.target.closest('a[data-s]'); if (!a) return; e.preventDefault(); goTo($('#' + a.dataset.s)); });

  /* ---------------- windows: minimize, maximize, focus ---------------- */
  document.addEventListener('pointerdown', e => { const w = e.target.closest('.win[data-win]'); if (w) $$('.win[data-win]').forEach(x => x.classList.toggle('act', x === w)); }, true);
  function toggleMax(w) {
    const on = !w.classList.contains('maxi'); w.classList.toggle('maxi', on); w.classList.remove('mini');
    if (lenis) on ? lenis.stop() : lenis.start();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const w = b.closest('.win');
    if (b.dataset.act === 'min') { if (w.classList.contains('maxi')) toggleMax(w); w.classList.toggle('mini'); }
    if (b.dataset.act === 'max') toggleMax(w);
  });
  $$('.tb').forEach(tb => tb.addEventListener('dblclick', e => { const w = tb.closest('.win'); if (w && w.querySelector('[data-act=max]') && !e.target.closest('button')) toggleMax(w); }));
  addEventListener('keydown', e => { if (e.key === 'Escape') { const m = $('.win.maxi'); if (m && !$('.dlg')) toggleMax(m); } });

  $('#welcome').addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'enter') { const i = $('#goIn'); i.focus({ preventScroll: true }); if (i.animate && !reduce) i.animate([{ backgroundColor: '#ffff80' }, { backgroundColor: '#ffffff' }], { duration: 900, easing: 'ease-out' }); }
    if (b.dataset.go === 'whois') { goTo($('#whois')); if (S.me && !$('#wW').value) $('#wW').value = S.me; setTimeout(() => $('#wW').focus({ preventScroll: true }), 900); }
    if (b.dataset.go === 'how') goTo($('#how'));
  });

  /* ---------------- dialogs ---------------- */
  function dialog({ title, icon, html, buttons = [{ t: 'OK', def: true }], toast = false, modal = false, onBuild, timeout }) {
    const layer = $('#layer');
    let shade = null; if (modal) { shade = document.createElement('div'); shade.className = 'shade'; layer.appendChild(shade); }
    const d = document.createElement('div'); d.className = 'win lit dlg' + (toast ? ' toast' : ''); d.setAttribute('role', 'dialog');
    d.innerHTML = `<div class="tb"><span class="tt">${esc(title)}</span><span class="tbbs"><button class="tbb x" type="button" aria-label="Close" data-x></button></span></div><div class="wb">${icon || html ? `<div class="dmsg">${icon ? `<img src="${icon}" alt="">` : ''}<div class="dtx">${html || ''}</div></div>` : ''}<div class="dbtns">${buttons.map((b, i) => `<button class="btn${b.def ? ' def' : ''}" type="button" data-i="${i}">${esc(b.t)}</button>`).join('')}</div></div>`;
    layer.appendChild(d);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; document.removeEventListener('keydown', onKey);
      if (reduce || !d.animate) { d.remove(); if (shade) shade.remove(); return; }
      d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out' }).onfinish = () => d.remove();
      if (shade) shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180 }).onfinish = () => shade.remove();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    if (shade) shade.addEventListener('click', close);
    d.addEventListener('click', e => { if (e.target.closest('[data-x]')) return close(); const b = e.target.closest('.dbtns [data-i]'); if (!b) return; const bt = buttons[+b.dataset.i]; if (!bt.fn || bt.fn(d, close) !== false) close(); });
    if (onBuild) onBuild(d, close);
    if (timeout) setTimeout(close, timeout);
    const def = d.querySelector('.btn.def'); if (def && !toast && !d.querySelector('input')) def.focus({ preventScroll: true });
    return { el: d, close };
  }
  const alertBox = (title, html, icon = '/img/i-help.png') => dialog({ title, html, icon, modal: true });

  /* ---------------- config, token ---------------- */
  async function loadCfg() {
    try { S.cfg = await api('config'); } catch (e) { S.cfg = { minPct: 0.01, kick: 0.5 }; }
    $$('.minp').forEach(x => x.textContent = (S.cfg.minPct || 0.01) + '%');
    renderToken(); renderHelp();
  }
  function renderToken() {
    const c = S.cfg || {}, x = c.x ? `<a class="btn" href="https://x.com/${esc(String(c.x).replace(/^@/, ''))}" target="_blank" rel="noopener">X</a>` : '';
    if (c.ca) {
      $('#tokBody').innerHTML = `<p>The only $N00B. Anything else is not us.</p><div class="row"><input class="field" readonly value="${esc(c.ca)}" aria-label="contract address"><button class="btn" type="button" data-copy="${esc(c.ca)}">Copy</button></div><div class="links"><a class="btn" href="https://dexscreener.com/solana/${esc(c.ca)}" target="_blank" rel="noopener">Chart</a><a class="btn" href="https://pump.fun/coin/${esc(c.ca)}" target="_blank" rel="noopener">pump.fun</a><button class="btn" type="button" data-room="${esc(c.ca)}">Its room</button>${x}</div>`;
      $('#welCa').innerHTML = `<input class="field" readonly value="${esc(c.ca)}" aria-label="contract address"><button class="btn" type="button" data-copy="${esc(c.ca)}">Copy CA</button>`;
    } else {
      $('#tokBody').innerHTML = `<div class="warn"><img src="/img/i-token.png" alt=""><p>The token does not exist yet. Anyone posting a CA before it shows up here is not us.</p></div>${x ? `<div class="links">${x}</div>` : ''}`;
      $('#welCa').innerHTML = `<span class="soon"><img src="/img/i-token.png" alt="">$N00B isn't live yet. A CA posted anywhere before it shows up here is not ours.</span>`;
    }
  }
  document.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'); if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); const t = c.textContent; c.textContent = 'Copied'; setTimeout(() => c.textContent = t, 1400); } catch (_) { } }
    const r = e.target.closest('[data-room]'); if (r) { e.preventDefault(); openRoom(r.dataset.room, true); setPane('chat'); goTo($('#rooms')); }
  });

  /* ---------------- wallet sign-in (one signed message, never a transaction) ---------------- */
  const W = { list: [] };
  function addWallet(w) {
    try {
      if (!w || !w.features || !w.name) return;
      const ok = (w.chains || []).some(c => String(c).startsWith('solana:')) && w.features['standard:connect'] && w.features['solana:signMessage'];
      if (ok && !W.list.some(x => x.name === w.name)) W.list.push(w);
    } catch (e) { }
  }
  const wapi = Object.freeze({ register: (...ws) => { ws.forEach(addWallet); return () => { }; } });
  addEventListener('wallet-standard:register-wallet', e => { try { e.detail(wapi); } catch (_) { } });
  try { dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: wapi })); } catch (_) { }
  function legacy() {
    const out = [];
    const ph = window.phantom && window.phantom.solana; if (ph && ph.signMessage && !W.list.some(w => /phantom/i.test(w.name))) out.push({ name: 'Phantom', legacy: ph });
    const sf = window.solflare; if (sf && sf.signMessage && !W.list.some(w => /solflare/i.test(w.name))) out.push({ name: 'Solflare', legacy: sf });
    return out;
  }
  const mobile = /iphone|ipad|android/i.test(navigator.userAgent);
  function signInDialog() {
    const list = W.list.concat(legacy());
    const here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin);
    const body = list.length
      ? `<div class="wl">${list.map((w, i) => `<button class="btn" type="button" data-w="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}</button>`).join('')}</div>`
      : mobile ? `<div class="wl"><a class="btn" href="https://phantom.app/ul/browse/${here}?ref=${ref}">Open in Phantom</a><a class="btn" href="https://solflare.com/ul/v1/browse/${here}?ref=${ref}">Open in Solflare</a></div>`
        : `<p>No Solana wallet found in this browser.</p><div class="wl"><a class="btn" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a><a class="btn" href="https://solflare.com/download" target="_blank" rel="noopener">Get Solflare</a></div>`;
    dialog({
      title: 'Sign in', modal: true, buttons: [{ t: 'Cancel' }],
      html: `<b>Sign in with your wallet</b><br><small>One free signature. It is not a transaction and cannot move anything.</small><div style="margin-top:10px">${body}</div><p class="err" data-err></p>`,
      onBuild: (d, close) => d.addEventListener('click', async e => {
        const b = e.target.closest('[data-w]'); if (!b) return;
        const err = d.querySelector('[data-err]'); err.textContent = '';
        $$('[data-w]', d).forEach(x => x.disabled = true); b.textContent = 'Check your wallet…';
        try { await signIn(list[+b.dataset.w]); close(); }
        catch (x) { err.textContent = /reject|cancel|declin|denied/i.test(x.message) ? 'Cancelled.' : x.message; $$('[data-w]', d).forEach(y => y.disabled = false); b.textContent = list[+b.dataset.w].name; }
      }),
    });
  }
  async function signIn(w) {
    let address, sign;
    if (w.legacy) {
      const r = await w.legacy.connect(); address = String((r && r.publicKey) || w.legacy.publicKey);
      sign = async bytes => { const o = await w.legacy.signMessage(bytes, 'utf8'); return { sig: o.signature || o, msg: bytes }; };
    } else {
      const r = await w.features['standard:connect'].connect(); const acct = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]);
      if (!acct) throw new Error('The wallet did not share an account.');
      address = acct.address;
      sign = async bytes => { const [o] = await w.features['solana:signMessage'].signMessage({ account: acct, message: bytes }); return { sig: o.signature, msg: o.signedMessage || bytes }; };
    }
    const n = await api('nonce?wallet=' + encodeURIComponent(address));
    const bytes = new TextEncoder().encode(n.message);
    const o = await sign(bytes);
    const j = await api('login', { wallet: address, nonce: n.nonce, sig: b58(new Uint8Array(o.sig)), msg: b64(new Uint8Array(o.msg)) });
    S.tok = j.token; S.me = j.wallet; S.name = j.name || '';
    store.set('n00b:tok', S.tok); store.set('n00b:me', S.me); store.set('n00b:name', S.name);
    renderMe(); renderSay(); poll();
    if (!j.name) setTimeout(nameDialog, 250);
  }
  function signOut(expired) {
    S.tok = null; S.me = null; S.name = null; ['tok', 'me', 'name'].forEach(k => store.set('n00b:' + k, ''));
    S.mine = null; renderMe(); renderSay();
    if (expired) say('Your sign-in expired. Sign in again to talk.');
  }
  function nameDialog() {
    const save = async (d, close) => {
      const v = d.querySelector('[data-n]').value.trim(), err = d.querySelector('[data-err]');
      try { const j = await api('name', { name: v }); S.name = j.name; store.set('n00b:name', S.name); renderMe(); close(); }
      catch (e) { err.textContent = e.message; }
    };
    dialog({
      title: 'Screen name', modal: true,
      html: `<b>Pick a screen name</b><br><small>3 to 16 letters, numbers, dots, dashes or underscores. Everyone in every room sees it.</small><input class="field" data-n maxlength="16" spellcheck="false" autocomplete="off" placeholder="xX_trencher_Xx" style="margin-top:10px"><p class="err" data-err></p>`,
      buttons: [{ t: 'Save', def: true, fn: (d, close) => { save(d, close); return false; } }, { t: 'Later' }],
      onBuild: (d, close) => { const i = d.querySelector('[data-n]'); setTimeout(() => i.focus(), 60); i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(d, close); } }); },
    });
  }
  function renderMe() {
    $('#meBtn').classList.toggle('on', !!S.me);
    $('#meLabel').textContent = S.me ? (S.name || short(S.me)) : 'sign in';
    $('#sb1').textContent = S.me ? 'Signed in as ' + (S.name || short(S.me)) : 'Not signed in';
    $('#wMine').hidden = !S.me;
    renderMeWin();
  }
  async function renderMeWin() {
    const box = $('#meBody');
    if (!S.me) { box.innerHTML = `<div class="who"><img src="/img/head.png" alt=""><div><b>Not signed in</b><small>One free signature. Not a transaction.</small></div></div><div class="links"><button class="btn def" type="button" data-do2="signin">Sign in</button></div>`; return; }
    box.innerHTML = `<div class="who"><img src="/img/head.png" alt=""><div style="min-width:0"><b>${esc(S.name || short(S.me))}</b><small>${esc(short(S.me))}</small></div></div><div class="links"><button class="btn" type="button" data-do2="name">${S.name ? 'Change name' : 'Pick a name'}</button><button class="btn" type="button" data-do2="asl">My a/s/l</button><button class="btn" type="button" data-do2="out">Sign out</button></div><div class="list field myrooms" id="myRooms" data-lenis-prevent><div class="empty">Reading your rooms…</div></div>`;
    try {
      const j = await api('me'); const b2 = $('#myRooms'); if (!b2) return;
      b2.innerHTML = j.rooms.length ? j.rooms.map(r => `<button type="button" class="room" data-room="${esc(r.mint)}">${av(r.image, r.symbol || r.name)}<b>${esc(r.symbol ? '$' + r.symbol : r.name)}</b><small class="${r.status === 'in' ? '' : 'z'}" style="${r.status === 'kicked' ? 'color:var(--red)' : ''}">${esc(r.status === 'in' ? 'inside' : r.status)}</small></button>`).join('') : `<div class="empty">You haven't entered a room yet.</div>`;
    } catch (e) { const b2 = $('#myRooms'); if (b2) b2.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  $('#meBody').addEventListener('click', e => {
    const b = e.target.closest('[data-do2]'); if (!b) return; const d = b.dataset.do2;
    if (d === 'signin') signInDialog(); if (d === 'name') nameDialog(); if (d === 'out') signOut();
    if (d === 'asl') { $('#wW').value = S.me; goTo($('#whois')); }
  });
  $('#meBtn').addEventListener('click', () => {
    if (!S.me) return signInDialog();
    dialog({ title: S.name || short(S.me), icon: '/img/head.png', modal: true, html: `<b>${esc(S.name || 'No screen name yet')}</b><br><small>${esc(S.me)}</small>`,
      buttons: [{ t: 'Change name', fn: () => { setTimeout(nameDialog, 200); } }, { t: 'My a/s/l', fn: () => { $('#wW').value = S.me; goTo($('#whois')); } }, { t: 'Sign out', fn: () => signOut() }, { t: 'Close', def: true }] });
  });

  /* ---------------- lobby, rooms, chat ---------------- */
  const PAL = ['#000080', '#007800', '#800000', '#800080', '#008080', '#806000', '#0050d0', '#a0006a', '#505050', '#b04000'];
  const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };
  const av = (img, sym) => img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<i class=&quot;av&quot;>${esc((sym || '?')[0]).toUpperCase()}</i>'">` : `<i class="av">${esc((sym || '?')[0]).toUpperCase()}</i>`;
  const tagHtml = m => (m.a || m.s || m.l) ? `<span class="tg"><i class="a">${esc(m.a || '?')}</i><i class="s">${esc(m.s || '?')}</i><i class="l">${esc(m.l || '?')}</i></span>` : '';
  const noobHtml = a => isNoob(a) ? `<span class="nb" title="wallet younger than 7 days"><img src="/img/prop.png" alt="">n00b</span>` : '';

  async function loadLobby() {
    try { S.lobby = await api('lobby'); S.lobby.err = false; } catch (e) { if (!S.lobby) S.lobby = { rooms: [], kicks: [], noobs: [], said: [], totals: null }; S.lobby.err = true; }
    renderRooms(); renderLive(); renderStatus(); bgFeed(S.lobby.said || []);
  }
  function renderRooms() {
    const L = S.lobby || { rooms: [] }, box = $('#roomList');
    if (L.err && !L.rooms.length) { box.innerHTML = `<div class="empty"><b>Can't reach the rooms.</b>Retrying…</div>`; return; }
    let rooms = L.rooms.slice();
    if (S.mint && S.room && !rooms.some(r => r.mint === S.mint)) rooms.unshift({ mint: S.mint, symbol: S.room.symbol, name: S.room.name, image: S.room.image, online: 0, members: S.people.length });
    if (!rooms.length) { box.innerHTML = `<div class="empty"><b>No rooms open yet.</b>Paste any coin above. The first holder in opens it for everyone.</div>`; return; }
    box.innerHTML = rooms.map(r => `<button type="button" class="room${r.mint === S.mint ? ' on' : ''}" data-m="${esc(r.mint)}">${av(r.image, r.symbol || r.name)}<b>${esc(r.symbol ? '$' + r.symbol : r.name)}</b><small class="${r.online ? '' : 'z'}">${r.online ? r.online + ' on' : (r.members || 0) + ' in'}</small></button>`).join('');
  }
  $('#roomList').addEventListener('click', e => { const b = e.target.closest('.room'); if (b) { openRoom(b.dataset.m, true); setPane('chat'); } });
  $('#goForm').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#goIn').value.trim();
    const m = (v.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/) || [])[0];
    if (!m) { alertBox('n00b chat', 'That doesn\'t look like a coin address. Paste the full address from pump.fun or a chart.'); return; }
    $('#goIn').value = ''; openRoom(m, true); setPane('chat');
  });
  function setPane(p) { $('#panes').dataset.pane = p; $$('#ptabs button').forEach(b => b.classList.toggle('on', b.dataset.p === p)); }
  $('#ptabs').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) setPane(b.dataset.p); });

  async function openRoom(mint, push) {
    if (!B58.test(mint) || (S.mint === mint && S.room)) return;
    S.mint = mint; S.room = null; S.last = 0; S.people = []; S.mine = null; S.first = true;
    if (push) history.pushState(null, '', '/r/' + mint);
    $('#log').innerHTML = `<div class="lempty">Opening the room…</div>`; $('#people').innerHTML = ''; $('#rhead').innerHTML = '';
    $('#chatT').textContent = 'n00b chat - ' + short(mint);
    $('#wRoom').hidden = false;
    renderRooms(); renderSay();
    await poll();
  }
  async function poll() {
    if (!S.mint || S.busy) return; S.busy = true; const mint = S.mint;
    try {
      const j = await api(`room?mint=${mint}&after=${S.last}`);
      if (mint !== S.mint) return;
      const firstLoad = S.first; S.first = false;
      const prevStatus = S.mine && S.mine.status;
      S.room = j.room; S.people = j.people; S.mine = j.me;
      renderHead(); renderPeople(); addLines(j.msgs, firstLoad); renderSay(); renderStatus(); renderRooms();
      if (prevStatus === 'in' && S.mine && S.mine.status === 'kicked') youWereKicked();
      if ((prevStatus || null) !== ((S.mine && S.mine.status) || null) && S.me && !firstLoad) renderMeWin();
    } catch (e) {
      if (mint === S.mint && S.first) { $('#log').innerHTML = `<div class="lempty"><b>:(</b>${esc(e.message)}</div>`; $('#chatT').textContent = 'n00b chat - error'; }
    } finally { S.busy = false; }
  }
  setInterval(() => { if (!document.hidden && S.mint) poll(); }, 2500);

  function renderHead() {
    const r = S.room; if (!r) return;
    $('#chatT').textContent = 'n00b chat - ' + (r.symbol ? '$' + r.symbol : r.name);
    $('#rhead').innerHTML = `${av(r.image, r.symbol || r.name)}<div class="rt"><b>${esc(r.name)}${r.symbol ? ' ($' + esc(r.symbol) + ')' : ''}</b><small>entry ${num(r.min)} ${r.symbol ? '$' + esc(r.symbol) : 'tokens'} (${r.minPct}%) · kicked at −${Math.round((1 - r.kick) * 100)}% from your peak</small></div>${r.mc ? `<span class="mc">${money(r.mc)} mc</span>` : ''}`;
  }
  function lineHtml(m) {
    const ts = `<span class="ts">[${hhmm(m.at)}]</span>`;
    if (m.kind === 'say') return `<div class="ln" data-id="${m.id}">${ts}${noobHtml(m.a)}<b class="nm" style="color:${colorOf(m.wallet || m.name)}">&lt;${esc(m.name)}&gt;</b>${tagHtml(m)}<span class="tx">${esc(m.body)}</span></div>`;
    if (m.kind === 'join') return `<div class="ln sys" data-id="${m.id}">${ts}*** ${esc(m.name)} entered ${noobHtml(m.a)}${tagHtml(m)}</div>`;
    if (m.kind === 'left') return `<div class="ln sys" data-id="${m.id}">${ts}*** ${esc(m.name)} left the room</div>`;
    if (m.kind === 'kick') return `<div class="ln kick" data-id="${m.id}">${ts}*** ${esc(m.name)} was kicked (${esc(m.body)})</div>`;
    return '';
  }
  function addLines(msgs, firstLoad) {
    const log = $('#log');
    if (firstLoad) log.innerHTML = '';
    if (firstLoad && !msgs.length) { log.innerHTML = `<div class="lempty"><b>a/s/l?</b>Nobody has said anything here yet.<br>Hold ${num(S.room.min)} ${S.room.symbol ? '$' + esc(S.room.symbol) : 'tokens'} and be the first.</div>`; return; }
    if (!msgs.length) return;
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const empty = log.querySelector('.lempty'); if (empty) empty.remove();
    const frag = document.createElement('div'); frag.innerHTML = msgs.map(lineHtml).join('');
    if (firstLoad) $$('.ln', frag).forEach(l => l.style.animation = 'none');
    log.append(...frag.childNodes);
    while (log.children.length > 400) log.firstChild.remove();
    S.last = Math.max(S.last, ...msgs.map(m => m.id));
    if (firstLoad || near) log.scrollTo({ top: log.scrollHeight, behavior: firstLoad || reduce ? 'auto' : 'smooth' });
    if (!firstLoad) for (const m of msgs) {
      if (m.kind === 'kick' && m.wallet !== S.me) dialog({ title: 'kicked', icon: '/img/i-kicked.png', toast: true, timeout: 6500, html: `<b>${esc(m.name)}</b> was kicked from ${esc(S.room && S.room.symbol ? '$' + S.room.symbol : 'the room')}.<br>${esc(m.body.replace(/^bag /, 'Bag '))}.` });
      if (m.kind === 'say') bgPush(m.name + ': ' + m.body);
    }
  }
  function youWereKicked() {
    const drop = (S.mine && S.mine.peak) ? Math.round((1 - S.mine.bal / S.mine.peak) * 100) : null;
    dialog({ title: 'kicked', icon: '/img/i-kicked.png', modal: true, html: `${drop != null && drop > 0 ? `Your bag dropped ${drop}%.<br>` : ''}You have been kicked.` });
  }
  function renderPeople() {
    let p = S.people.slice(); if (S.view.online) p = p.filter(x => x.online);
    $('#pc').textContent = S.people.length || '';
    $('#people').innerHTML = p.length ? p.map(x => `<div class="prow${x.wallet === S.me ? ' me' : ''}" title="${esc(x.wallet)}"><span class="pn"><i class="${x.online ? 'on' : ''}"></i>${isNoob(x.a) ? '<img src="/img/prop.png" alt="n00b" width="13" height="6">' : ''}<span style="color:${colorOf(x.wallet)}">${esc(x.name)}</span>${x.kicks ? `<small class="kk">k${x.kicks}</small>` : ''}</span><span>${esc(x.a || '')}</span><span>${esc(x.s || '')}</span><span>${esc(x.l || '')}</span></div>`).join('')
      : `<div class="empty">${S.room ? (S.view.online ? 'Nobody online right now.' : 'Nobody inside yet.') : 'Open a room to see who is in it.'}</div>`;
  }
  function renderSay() {
    const row = $('#sayRow'), r = S.room, sym = r && r.symbol ? '$' + esc(r.symbol) : 'tokens';
    if (!S.mint) { row.innerHTML = `<span class="note2">Pick a room or paste any coin above.</span>`; return; }
    if (!r) { row.innerHTML = `<span class="note2">Opening…</span>`; return; }
    if (!S.me) { row.innerHTML = `<span class="note2"><b>Sign in to talk.</b> One free signature, not a transaction.</span><button class="btn def" type="button" data-do="signin">Sign in</button>`; return; }
    const m = S.mine;
    if (!m || m.status === 'left') { row.innerHTML = `<span class="note2">Hold <b>${num(r.min)} ${sym}</b> (${r.minPct}%) to enter.</span><button class="btn def" type="button" data-do="join">Enter room</button>`; return; }
    if (m.status === 'kicked') { row.innerHTML = `<span class="note2"><b>You were kicked.</b> Hold ${num(r.min)} ${sym} again to come back.</span><button class="btn" type="button" data-do="join">Enter again</button>`; return; }
    if (!row.querySelector('#sayIn')) {
      row.innerHTML = `<form id="sayF" style="display:flex;gap:6px;flex:1;min-width:0" autocomplete="off"><input class="field" id="sayIn" maxlength="240" spellcheck="true" placeholder="a/s/l?" aria-label="message"><button class="btn def" type="submit">Send</button></form>`;
      $('#sayF').addEventListener('submit', sendLine);
    }
  }
  $('#sayRow').addEventListener('click', async e => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    if (b.dataset.do === 'signin') return signInDialog();
    if (b.dataset.do === 'join') {
      b.disabled = true; b.textContent = 'Reading your bag…';
      try { await api('join', { mint: S.mint }); await poll(); setTimeout(() => { const i = $('#sayIn'); if (i) i.focus({ preventScroll: true }); }, 50); }
      catch (x) { alertBox('Can\'t enter', esc(x.message), '/img/i-kicked.png'); b.disabled = false; b.textContent = 'Enter room'; }
    }
  });
  async function sendLine(e) {
    e.preventDefault(); const i = $('#sayIn'); const t = i.value.trim(); if (!t) return;
    i.disabled = true;
    try { await api('say', { mint: S.mint, text: t }); i.value = ''; await poll(); }
    catch (x) { if (x.data && x.data.kicked) { await poll(); youWereKicked(); } else alertBox('n00b chat', esc(x.message), '/img/i-help.png'); }
    finally { const j = $('#sayIn'); if (j) { j.disabled = false; j.focus({ preventScroll: true }); } }
  }
  function renderStatus() {
    const L = S.lobby || {};
    if (S.room) {
      const on = S.people.filter(p => p.online).length;
      $('#sb2').textContent = `${on} online · ${S.people.length} inside`;
      const m = S.mine;
      $('#sb3').textContent = m && m.status === 'in' ? `your bag ${m.s} · kicked under ${num(m.line)}` : m && m.kicks ? `kicked ${m.kicks}× here` : '';
    } else {
      const t = L.totals; $('#sb2').textContent = t ? `${t.rooms} room${t.rooms === 1 ? '' : 's'} open · ${t.inside} inside` : '';
      $('#sb3').textContent = '';
    }
  }
  const menu = $('#chatMenu');
  menu.addEventListener('click', e => {
    const t = e.target.closest('.mt'); if (t) { const mi = t.parentElement, open = !mi.classList.contains('open'); $$('.mi', menu).forEach(x => x.classList.remove('open')); mi.classList.toggle('open', open); return; }
    const c = e.target.closest('[data-c]'); if (!c) return;
    $$('.mi', menu).forEach(x => x.classList.remove('open'));
    cmd(c.dataset.c);
  });
  menu.addEventListener('mouseover', e => { const t = e.target.closest('.mt'); if (t && menu.querySelector('.mi.open') && !t.parentElement.classList.contains('open')) { $$('.mi', menu).forEach(x => x.classList.remove('open')); t.parentElement.classList.add('open'); } });
  document.addEventListener('click', e => { if (!e.target.closest('#chatMenu')) $$('.mi', menu).forEach(x => x.classList.remove('open')); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.mi', menu).forEach(x => x.classList.remove('open')); });
  function applyView() {
    $('#log').classList.toggle('nosys', !S.view.sys); $('#log').classList.toggle('nots', !S.view.stamps);
    $$('[data-c=sys]').forEach(b => b.classList.toggle('on', S.view.sys)); $$('[data-c=stamps]').forEach(b => b.classList.toggle('on', S.view.stamps)); $$('[data-c=online]').forEach(b => b.classList.toggle('on', S.view.online));
    renderPeople();
  }
  async function cmd(c) {
    if (c === 'open') $('#goIn').focus();
    if (c === 'copy') { if (!S.mint) return alertBox('n00b chat', 'Open a room first.'); try { await navigator.clipboard.writeText(location.origin + '/r/' + S.mint); dialog({ title: 'n00b chat', toast: true, timeout: 2400, html: 'Room link copied.', icon: '/img/i-rooms.png', buttons: [] }); } catch (_) { } }
    if (c === 'whoisRoom') { if (S.mint) $('#wM').value = S.mint; goTo($('#whois')); setTimeout(() => $('#wW').focus({ preventScroll: true }), 900); }
    if (c === 'leave') { if (!S.mine || S.mine.status !== 'in') return alertBox('n00b chat', 'You are not in this room.'); try { await api('leave', { mint: S.mint }); await poll(); } catch (x) { alertBox('n00b chat', esc(x.message)); } }
    if (c === 'sys' || c === 'stamps' || c === 'online') { S.view[c] = !S.view[c]; store.set('n00b:' + c, S.view[c] ? (c === 'online' ? '1' : '') : (c === 'online' ? '' : '0')); applyView(); }
    if (c === 'how') goTo($('#how'));
    if (c === 'help') goTo($('#help'));
  }
  applyView();

  /* ---------------- whois ---------------- */
  $('#wMine').addEventListener('click', () => { if (S.me) $('#wW').value = S.me; });
  $('#wRoom').addEventListener('click', () => { if (S.mint) $('#wM').value = S.mint; });
  $('#wForm').addEventListener('submit', e => { e.preventDefault(); whois($('#wW').value.trim(), $('#wM').value.trim(), true); });
  function countUp(el, label) {
    const m = /^([#<]?)(\d+(?:\.\d+)?)(.*)$/.exec(label || '');
    if (!m || reduce) { el.textContent = label; return; }
    const pre = m[1], end = parseFloat(m[2]), post = m[3], dec = (m[2].split('.')[1] || '').length, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 900), v = end * (1 - Math.pow(1 - k, 3)); el.textContent = pre + v.toFixed(dec) + post; if (k < 1) requestAnimationFrame(step); else el.textContent = label; };
    requestAnimationFrame(step);
  }
  async function whois(w, m, push) {
    const msg = $('#wMsg'); msg.className = 'wmsg'; msg.textContent = '';
    if (!B58.test(w)) { msg.textContent = 'Paste a full Solana wallet address.'; return; }
    if (!B58.test(m)) { msg.textContent = 'Paste a full coin address.'; return; }
    const go = $('#wGo'); go.disabled = true; go.textContent = 'Reading…'; msg.className = 'wmsg ok'; msg.textContent = 'Reading the chain…';
    try {
      const j = await api(`check?wallet=${encodeURIComponent(w)}&mint=${encodeURIComponent(m)}`);
      const sym = j.room.symbol ? '$' + j.room.symbol : 'tokens';
      $('#wCoin').innerHTML = `${av(j.room.image, j.room.symbol || j.room.name)}<b>${esc(j.room.name)}${j.room.symbol ? ' ($' + esc(j.room.symbol) + ')' : ''}</b><small style="margin-left:auto">${esc(short(j.wallet))}</small>`;
      $('#wEmpty').hidden = true; const res = $('#wRes'); res.hidden = false; res.style.animation = 'none'; void res.offsetWidth; res.style.animation = '';
      countUp($('#rA'), j.a); countUp($('#rS'), j.s); countUp($('#rL'), j.l);
      $('#rA2').textContent = j.firstTx ? (j.ageExact ? 'first transaction ' : 'oldest seen so far ') + new Date(j.firstTx * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : (j.ageExact ? 'no transactions yet' : 'history not read yet');
      $('#rS2').textContent = `${num(j.bal)} ${sym}`;
      $('#rL2').textContent = j.l === '20+' ? 'outside the top 20 holders' : j.l === '—' ? 'not a holder' : j.of ? `of ${num(j.of)} holders` : 'in the holder list';
      $('#rV').innerHTML = `<div>n00b: ${j.n00b ? `<span class="yes">yes</span> ${noobHtml('0d')} wallet younger than 7 days` : '<span class="no">no</span>'}</div><div>Can enter the ${esc(sym)} room: ${j.canEnter ? '<span class="yes">yes</span>' : `<span class="no">no</span>, needs ${num(j.need)} ${esc(sym)}`}</div><div class="lk"><button class="btn" type="button" data-room="${esc(m)}">Open room</button><button class="btn" type="button" data-copy="${esc(location.origin + '/?whois=' + w + '&coin=' + m)}">Copy link</button></div>`;
      msg.textContent = '';
      if (push) history.replaceState(null, '', '/?whois=' + w + '&coin=' + m);
    } catch (e) { msg.className = 'wmsg'; msg.textContent = e.message; }
    finally { go.disabled = false; go.textContent = 'Look up'; }
  }

  /* ---------------- live: rooms.dir, kicked.log, n00bs.log ---------------- */
  function renderLive() {
    const L = S.lobby || {}, t = L.totals;
    const fail = `<div class="empty"><b>Can't reach the log.</b>Retrying…</div>`;
    const rooms = L.rooms || [], kicks = L.kicks || [], noobs = L.noobs || [];
    $('#dList').innerHTML = L.err && !rooms.length ? fail : rooms.length ? rooms.map((r, i) => `<a class="lrow" href="/r/${esc(r.mint)}" data-room="${esc(r.mint)}" style="animation-delay:${i * 40}ms">${av(r.image, r.symbol || r.name)}<span><b>${esc(r.symbol ? '$' + r.symbol : r.name)}</b><small>${r.last ? esc(r.last.name + ': ' + r.last.body) : 'nobody has talked yet'}</small></span><em class="${r.online ? 'g' : ''}">${r.online ? r.online + ' on' : (r.members || 0) + ' in'}</em></a>`).join('')
      : `<div class="empty"><b>No rooms open yet.</b>Paste any coin into the chat above to open the first one.</div>`;
    $('#kList').innerHTML = L.err && !kicks.length ? fail : kicks.length ? kicks.map((x, i) => `<a class="lrow" href="/r/${esc(x.mint)}" data-room="${esc(x.mint)}" style="animation-delay:${i * 40}ms"><img src="/img/i-kicked.png" alt=""><span><b>${esc(x.name)}</b><small>${x.symbol ? '$' + esc(x.symbol) : 'a room'} · ${ago(x.at)}</small></span><em class="r">${esc(x.body)}</em></a>`).join('')
      : `<div class="empty"><b>Nobody has been kicked yet.</b>Sell half your bag inside a room and your name lands here.</div>`;
    $('#nList').innerHTML = L.err && !noobs.length ? fail : noobs.length ? noobs.map((x, i) => `<a class="lrow" href="/r/${esc(x.mint)}" data-room="${esc(x.mint)}" style="animation-delay:${i * 40}ms"><img src="/img/head.png" alt=""><span><b>${esc(x.name)}</b><small>${x.symbol ? '$' + esc(x.symbol) : 'a room'} · ${ago(x.at)} · ${esc(x.s || '')}</small></span><em class="m">${esc(x.a)}</em></a>`).join('')
      : `<div class="empty"><b>No n00bs spotted yet.</b>Wallets younger than 7 days that enter a room show up here.</div>`;
    $('#dSb').textContent = t ? `${num(t.rooms)} room${t.rooms === 1 ? '' : 's'} open · ${num(t.inside)} inside` : '';
    $('#kSb').textContent = t ? (t.kicks ? `${num(t.kicks)} kick${t.kicks === 1 ? '' : 's'} so far` : 'No kicks yet') : '';
    $('#nSb').textContent = noobs.length ? `${noobs.length} recent n00b${noobs.length === 1 ? '' : 's'}` : '';
  }

  /* ---------------- help viewer ---------------- */
  let topics = [];
  function renderHelp() {
    const c = S.cfg || {}, minp = (c.minPct || 0.01) + '%', drop = Math.round((1 - (c.kick || .5)) * 100);
    topics = [
      ['What is n00b?', `<p>Chatrooms for holders. Every Solana coin gets a room. You can read any room, but only wallets that hold at least ${minp} of the coin can talk in it.</p><p>Next to every name sit three readings taken from the chain: the wallet's age, its share of the supply and its place in the holder list. Nobody types them in, so nobody can fake them.</p>`],
      ['Is signing in safe?', `<p>You sign a short plain-text message that says it is not a transaction. A signed message cannot move tokens or SOL, and it cannot approve anything.</p><p>n00b never asks for a seed phrase, a private key or a transaction approval. If anything claiming to be n00b asks for one, it is not us.</p>`],
      ['What do age, size and location mean?', `<p><b>Age</b> is the time since the wallet's first transaction on Solana. For wallets with a very long history it shows a lower bound, like <code>2y+</code>, and fills in as more history is read.</p><p><b>Size</b> is the wallet's share of the coin's total supply right now.</p><p><b>Location</b> is the wallet's place in the holder list, with the bonding curve, pools and other program accounts left out.</p>`],
      ['Who counts as a n00b?', `<p>Any wallet whose first transaction is less than 7 days old. Its name gets the propeller tag in every room and shows up in n00bs.log, so fresh alts and bundled wallets stand out.</p>`],
      ['When am I kicked?', `<p>Your bag is read again every time you talk and about once a minute while the room is open. If it falls to half of your peak since you entered (−${drop}%), or under the ${minp} entry line, you are kicked and the room sees it.</p><p>Moving tokens to another wallet counts the same as selling. A drop is read twice, on two different nodes, before anyone is kicked.</p>`],
      ['Can I come back after a kick?', `<p>Yes. Hold enough again and press Enter. Your peak starts fresh, and your kick count stays next to your name in that room.</p>`],
      ['Can I fake my a/s/l?', `<p>No. All three readings come from the chain for the wallet that signed in, and they are read again while you are inside.</p>`],
      [c.rank === 'full' ? 'How exact is the location?' : 'Why do some people show 20+?', c.rank === 'full' ? `<p>The full holder list is read for every room, so each wallet gets its exact place.</p>` : `<p>Public Solana nodes only return a coin's 20 largest accounts. Anyone below that shows as 20+.</p>`],
      ['Which coins have rooms?', `<p>Every Solana coin, pump.fun or not. Paste its address in the Coin field. The room opens the first time someone visits it, and shows up in rooms.dir once someone enters.</p>`],
      ['Does it cost anything?', `<p>No. There is no fee and nothing to approve. Holding the coin is the ticket.</p>`],
      ['Who can read the chat?', `<p>Rooms are public. Anyone can read them, only holders can talk. Every line is stored with the readings it was sent with. Links are shown as plain text and are never clickable.</p>`],
      ['Is n00b part of pump.fun?', `<p>No. n00b is independent. It reads public chain data and works with any wallet that can sign a message.</p>`],
      ['What is $N00B?', c.ca ? `<p>The coin of the site. Its address is in the $N00B window. Rooms work for every coin, with or without it.</p>` : `<p>The coin of the site. It does not exist yet. Its address will show up in the $N00B window first. Anyone posting one before that is not us.</p>`],
    ];
    drawTopics(0);
  }
  function drawTopics(sel) {
    const q = $('#hFind').value.trim().toLowerCase();
    const list = topics.map((t, i) => [t, i]).filter(([t]) => !q || (t[0] + ' ' + t[1]).toLowerCase().replace(/<[^>]+>/g, '').includes(q));
    $('#hList').innerHTML = list.length ? list.map(([t, i]) => `<button type="button" class="htop${i === sel ? ' on' : ''}" data-t="${i}">${esc(t[0])}</button>`).join('') : `<div class="empty">No topic matches.</div>`;
    const show = list.find(([, i]) => i === sel) || list[0];
    if (show) { $('#hArt').innerHTML = `<h3>${esc(show[0][0])}</h3>${show[0][1]}`; $$('.htop').forEach(b => b.classList.toggle('on', +b.dataset.t === show[1])); }
  }
  $('#hList').addEventListener('click', e => { const b = e.target.closest('.htop'); if (b) { drawTopics(+b.dataset.t); $('#hArt').scrollTop = 0; } });
  $('#hFind').addEventListener('input', () => drawTopics(-1));

  /* ---------------- live background: twinkles, drifting propellers, real lines floating up ---------------- */
  const cv = $('#bg'), cx = cv.getContext('2d');
  let BW = 0, BH = 0, stars = [], props = [], bubbles = [], feed = [], fi = 0, last = 0, frame = 0;
  const propImg = new Image(); propImg.src = '/img/prop.png';
  function size() {
    BW = cv.width = Math.ceil(innerWidth / 2); BH = cv.height = Math.ceil(innerHeight / 2);
    const n = Math.round(BW * BH / 900);
    stars = Array.from({ length: n }, () => ({ x: Math.random() * BW, y: Math.random() * BH * 3, t: Math.random() * 60 | 0, p: 40 + Math.random() * 80 | 0, k: Math.random() * 3 | 0, z: .2 + Math.random() * .5 }));
    props = Array.from({ length: Math.max(4, Math.round(BW / 120)) }, () => newProp(true));
  }
  function newProp(any) { return { x: Math.random() * BW, y: any ? Math.random() * BH : BH + 10, v: .1 + Math.random() * .18, s: Math.random() * 6.28, f: Math.random() * 8 | 0 }; }
  function bgFeed(list) { if (list.length) feed = list.map(x => `${x.name}: ${x.body}`); }
  function bgPush(t) { feed.unshift(t); feed = feed.slice(0, 20); }
  const COLS = ['255,255,255', '160,255,240', '255,240,140'];
  function draw(ts) {
    requestAnimationFrame(draw);
    if (document.hidden || ts - last < 40) return; last = ts; frame++;
    cx.clearRect(0, 0, BW, BH);
    const sy = scrollY / 2;
    for (const s of stars) {
      s.t++; if (s.t > s.p) { s.t = 0; s.x = Math.random() * BW; s.y = Math.random() * BH * 3; s.k = Math.random() * 3 | 0; }
      const on = Math.sin(s.t / s.p * Math.PI); if (on < .15) continue;
      let y = (s.y - sy * s.z) % (BH * 3); if (y < 0) y += BH * 3; if (y > BH) continue;
      cx.fillStyle = `rgba(${COLS[s.k]},${(on * .8).toFixed(2)})`;
      const x = s.x | 0, yy = y | 0;
      if (on > .85 && s.k !== 1) { cx.fillRect(x - 1, yy, 3, 1); cx.fillRect(x, yy - 1, 1, 3); } else cx.fillRect(x, yy, 1, 1);
    }
    for (const p of props) {
      p.y -= p.v; p.s += .025; p.f++;
      const x = Math.round(p.x + Math.sin(p.s) * 7), y = Math.round(p.y);
      if (propImg.complete && propImg.naturalWidth) { if ((p.f >> 3) % 2) cx.drawImage(propImg, x, y, 13, 6); else cx.drawImage(propImg, 0, 0, 13, 6, x + 3, y, 7, 6); }
      if (p.y < -10) Object.assign(p, newProp(false));
    }
    if (feed.length && frame % 110 === 0 && bubbles.length < 3) {
      const t = feed[fi++ % feed.length]; const txt = t.length > 44 ? t.slice(0, 43) + '…' : t;
      bubbles.push({ t: txt, x: 8 + Math.random() * Math.max(10, BW - 200), y: BH + 6, v: .28 + Math.random() * .1 });
    }
    cx.font = '7px "n00b sys", monospace'; cx.textBaseline = 'top';
    bubbles = bubbles.filter(b => {
      b.y -= b.v; const w = Math.ceil(cx.measureText(b.t).width) + 8, a = Math.min(1, (b.y - BH * .12) / (BH * .3));
      if (a <= 0) return false;
      cx.globalAlpha = a * .85;
      const x = Math.round(b.x), y = Math.round(b.y);
      cx.fillStyle = '#000'; cx.fillRect(x - 1, y - 1, w + 2, 12); cx.fillStyle = '#fff'; cx.fillRect(x, y, w, 10);
      cx.fillStyle = '#000'; cx.fillRect(x + 4, y + 10, 3, 3); cx.fillStyle = '#fff'; cx.fillRect(x + 5, y + 10, 1, 2);
      cx.fillStyle = '#000'; cx.fillText(b.t, x + 4, y + 2);
      cx.globalAlpha = 1; return true;
    });
  }
  size(); addEventListener('resize', size);
  if (!reduce) requestAnimationFrame(draw); else { last = -1e9; draw(0); }

  /* ---------------- boot ---------------- */
  renderMe(); renderSay(); renderPeople(); setTimeout(spy, 60);
  (async () => {
    await loadCfg();
    loadLobby(); setInterval(() => { if (!document.hidden) loadLobby(); }, 15000);
    const path = location.pathname.match(/^\/r\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
    const q = new URLSearchParams(location.search);
    if (path) openRoom(path[1], false);
    else if (S.cfg && S.cfg.home) openRoom(S.cfg.home, false);
    if (q.get('whois') && q.get('coin')) { $('#wW').value = q.get('whois'); $('#wM').value = q.get('coin'); setTimeout(() => goTo($('#whois')), 500); whois(q.get('whois'), q.get('coin'), false); }
  })();
  addEventListener('popstate', () => { const p = location.pathname.match(/^\/r\/([1-9A-HJ-NP-Za-km-z]{32,44})/); if (p) openRoom(p[1], false); });
})();
