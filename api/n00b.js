'use strict';
/* n00b: chatrooms for holders. Your age, size and location are read from the chain.
 * age      = how long ago the wallet's first transaction happened
 * size     = how much of the coin's supply the wallet holds right now
 * location = the wallet's place in the holder list
 * Sign-in is a free signed message, never a transaction. Nothing here holds or asks for a key. */
const crypto = require('crypto');

const E = (k, d = '') => String(process.env[k] == null ? d : process.env[k]).trim();
const CA = E('N00B_CA'), XH = E('N00B_X');
const RPC_URL = E('RPC_URL');
// public nodes refuse some indexed calls (publicnode) or rate-limit (mainnet-beta); a private RPC_URL goes first when set
const RPCS = E('N00B_RPCS') ? E('N00B_RPCS').split(',') : [RPC_URL, 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
const DB_URL = E('DATABASE_URL') || E('POSTGRES_URL');
const MIN_PCT = Number(E('N00B_MIN_PCT', '0.01')) || 0.01;   // % of supply needed to enter a room
const KICK = Number(E('N00B_KICK', '0.5')) || 0.5;           // kicked when the bag falls to this share of its peak
const SECRET = E('SESSION_SECRET') || crypto.createHash('sha256').update('n00b-session:' + DB_URL).digest('hex');
const SYS = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const META = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bmuvJh8';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME_RE = /^[A-Za-z0-9_.-]{3,16}$/;
const RESERVED = /^(system|admin|mod|mods|moderator|n00b|noob|dev|devs|team|support|official|helpdesk|owner|root|kicked)$/i;
/* slur filter for every public name and line: leetspeak and separators are normalised before matching. */
const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };
const letters = w => String(w).toLowerCase().replace(/[01!|34@5$7+89]/g, c => LEET[c]).replace(/[^a-z]/g, '');
const squash = w => w.replace(/(.)\1+/g, '$1');
const LONG = /(niger|niga|nigr|nibba|fagot|fagit|trany|wetback|raghead|towelhead|junglebuny|porchmonkey|ziperhead|jigabo|retard)/;
const SHORT = /^(kikes?|chinks?|beaners?|gooks?|spics?|spick|coons?|dykes?|negro(es)?|cunts?|fags?|faggy|niggaz)$/;
const SAFE = /^(niger|nigeria|nigerian|nigerians|snigger|sniggers|sniggered|sniggering|retardant|spice|spicy|despicable|conspicuous|suspicious|auspicious|raccoon|cocoon|tycoon|scunthorpe|negroni)$/;
function slurry(w) { const a = letters(w); if (!a || SAFE.test(a)) return false; return SHORT.test(a) || LONG.test(squash(a)); }
function scrub(text) { return text.split(/(\s+)/).map(w => /^\s+$/.test(w) || !slurry(w) ? w : '*'.repeat(Math.min(8, Math.max(3, w.length)))).join(''); }
function spacedSlur(text) {
  const runs = String(text).match(/(?:^|\s)((?:\S[\s._*-]+){3,}\S)(?=\s|$)/g) || [];
  return runs.some(r => { const a = letters(r); return !SAFE.test(a) && (SHORT.test(a) || LONG.test(squash(a))); });
}

/* ---------------- plumbing ---------------- */
function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function http(code, msg, extra) { const e = new Error(msg); e.code = code; if (extra) e.extra = extra; return e; }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > 20000) break; }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return {}; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timedFetch = ms => (url, opt = {}) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
const nowS = () => Math.floor(Date.now() / 1000);
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const clean = s => String(s == null ? '' : s).replace(/\u0000/g, '').replace(/[\u0001-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').trim();
function addr(s, what) { const v = String(s || '').trim(); if (!B58.test(v)) throw http(400, `That ${what || 'address'} doesn't look like a Solana address.`); return v; }

/* base58 */
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) {
  let n = 0n; for (const c of s) { const i = ALPH.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let z = 0; while (z < s.length && s[z] === '1') z++;
  return Buffer.concat([Buffer.alloc(z), body]);
}
function b58enc(buf) {
  buf = Buffer.from(buf); let n = BigInt('0x' + (buf.toString('hex') || '0')); let s = '';
  while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}

/* in-memory cache, per warm instance */
const mem = new Map();
async function cached(key, ms, fn) {
  const c = mem.get(key);
  if (c && c.has && Date.now() - c.t < ms) return c.v;
  if (c && c.p) return c.p;
  const p = (async () => {
    try { const v = await fn(); mem.set(key, { t: Date.now(), v, has: true }); return v; }
    catch (e) { if (c && c.has) { mem.set(key, { t: c.t, v: c.v, has: true }); return c.v; } mem.delete(key); throw e; }
  })();
  mem.set(key, Object.assign({}, c || {}, { p }));
  if (mem.size > 4000) for (const k of [...mem.keys()].slice(0, 1000)) mem.delete(k);
  return p;
}
const hits = new Map();
function limit(key, n, ms) {
  const t = Date.now(), a = (hits.get(key) || []).filter(x => t - x < ms);
  if (a.length >= n) throw http(429, 'Slow down a little.');
  a.push(t); hits.set(key, a);
  if (hits.size > 5000) hits.clear();
}

/* ---------------- Solana RPC (raw JSON-RPC, no keys) ---------------- */
async function rpc(method, params, opt = {}) {
  const list = opt.only || RPCS; let last;
  for (let pass = 0; pass < 2; pass++) {
    for (const u of list) {
      try {
        const r = await timedFetch(opt.ms || 9000)(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        if (r.status === 429) throw new Error('429 Too many requests');
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        return j.result;
      } catch (e) { last = e; }
    }
    if (opt.once || !/429|Too many|busy|timeout|abort|fetch failed|rate|ECONN|socket/i.test(String(last && last.message))) break;
    await sleep(600 + Math.random() * 600);
  }
  throw http(502, 'Solana RPC is busy, try again in a moment.', { why: String(last && last.message || '').replace(/https?:\/\/\S+/g, '').slice(0, 100) });
}
const rotated = k => RPCS.slice(k % RPCS.length).concat(RPCS.slice(0, k % RPCS.length));
// ask each node in turn until one gives an answer that passes `good` (a node answering empty or null is not trusted on its own)
async function rpcEach(method, params, good, list = RPCS) {
  let last, any = false, lastErr;
  for (const u of list) {
    try { const r = await rpc(method, params, { only: [u] }); any = true; last = r; if (good(r)) return r; } catch (e) { lastErr = e; }
  }
  if (any) return last;
  throw lastErr || http(502, 'Solana RPC is busy, try again in a moment.');
}

async function getJson(url, ms = 6000) {
  const r = await timedFetch(ms)(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 n00b' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// the mint: supply, decimals and (Token-2022) metadata. Some public RPCs answer null for accounts they do not index.
async function mintRead(mint) {
  return cached('mint:' + mint, 300e3, async () => {
    let v = null;
    for (const u of RPCS) { try { const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }], { only: [u] }); if (r && r.value) { v = r.value; break; } } catch (e) { } }
    if (!v || !v.data || !v.data.parsed || v.data.parsed.type !== 'mint') throw http(404, 'That address is not a coin.');
    const i = v.data.parsed.info;
    const ext = (i.extensions || []).find(x => x.extension === 'tokenMetadata');
    return { program: v.owner, decimals: i.decimals, supply: Number(i.supply) / 10 ** i.decimals, meta: ext && ext.state ? { name: ext.state.name, symbol: ext.state.symbol, uri: ext.state.uri } : null };
  });
}
// classic SPL coins keep their name in a Metaplex metadata account
async function metaplex(mint) {
  const { PublicKey } = require('@solana/web3.js');
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), new PublicKey(META).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(META));
  const r = await rpcEach('getAccountInfo', [pda.toBase58(), { encoding: 'base64' }], x => x && x.value);
  if (!r || !r.value) return null;
  const b = Buffer.from(r.value.data[0], 'base64'); let o = 65;
  const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.slice(o, o + n).toString('utf8'); o += n; return clean(s); };
  return { name: str(), symbol: str(), uri: str() };
}
async function uriImage(uri) {
  if (!/^https?:\/\//.test(uri || '')) return null;
  const j = await getJson(uri, 4500);
  const img = j && (j.image || (j.properties && j.properties.files && j.properties.files[0] && j.properties.files[0].uri));
  return /^https?:\/\//.test(img || '') ? String(img).slice(0, 400) : null;
}
async function market(mint) {
  return cached('mkt:' + mint, 60e3, async () => {
    try {
      const j = await getJson('https://api.dexscreener.com/tokens/v1/solana/' + mint, 5000);
      const p = (Array.isArray(j) ? j : []).sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0))[0];
      if (!p) return null;
      return { mc: p.marketCap || p.fpv || null, price: p.priceUsd ? Number(p.priceUsd) : null, dex: p.dexId, image: p.info && p.info.imageUrl || null };
    } catch (e) { return null; }
  });
}

// every token account this wallet holds for the coin, summed
async function bag(owner, mint, k = 0) {
  const r = await rpcEach('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }], x => x && x.value && x.value.length, rotated(k));
  return (r && r.value || []).reduce((a, x) => { const t = x.account.data.parsed.info.tokenAmount; return a + Number(t.uiAmountString != null ? t.uiAmountString : t.uiAmount || 0); }, 0);
}

// the holder list. Program-owned accounts (bonding curve, pools, lockers) are not people, so they are left out.
async function holders(mint) {
  return cached('h:' + mint, 45e3, async () => {
    const big = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    const accs = (big && big.value || []).slice(0, 20);
    const infos = accs.length ? await rpc('getMultipleAccounts', [accs.map(a => a.address), { encoding: 'jsonParsed' }]) : { value: [] };
    const rows = accs.map((a, i) => { const v = infos.value[i]; return { owner: v && v.data && v.data.parsed ? v.data.parsed.info.owner : null, amt: Number(a.uiAmountString != null ? a.uiAmountString : a.uiAmount || 0) }; });
    const uniq = [...new Set(rows.map(r => r.owner).filter(Boolean))];
    const prog = new Set();
    if (uniq.length) {
      const oi = await rpc('getMultipleAccounts', [uniq, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
      uniq.forEach((o, i) => { const v = oi.value[i]; if (v && v.owner !== SYS) prog.add(o); });
    }
    const by = new Map();
    for (const r of rows) if (r.owner && !prog.has(r.owner)) by.set(r.owner, (by.get(r.owner) || 0) + r.amt);
    let people = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([owner, amt]) => ({ owner, amt }));
    let full = accs.length < 20, count = full ? people.length : null;
    // with a private RPC we can read every holder and give an exact place
    if (RPC_URL && !full) {
      try {
        const all = await fullList(mint, prog);
        if (all) { people = all; full = true; count = all.length; }
      } catch (e) { }
    }
    return { people, full, count };
  });
}
async function fullList(mint, prog) {
  const mi = await mintRead(mint);
  const filters = [{ memcmp: { offset: 0, bytes: mint } }];
  if (mi.program === TOKEN) filters.push({ dataSize: 165 });
  const r = await rpc('getProgramAccounts', [mi.program === T22 ? T22 : TOKEN, { encoding: 'base64', filters, dataSlice: { offset: 32, length: 40 }, commitment: 'confirmed' }], { only: [RPC_URL], ms: 20000, once: true });
  if (!Array.isArray(r)) return null;
  const by = new Map(), div = 10 ** mi.decimals;
  for (const a of r) {
    const b = Buffer.from(a.account.data[0], 'base64'); if (b.length < 40) continue;
    const owner = b58enc(b.slice(0, 32)), amt = Number(b.readBigUInt64LE(32)) / div;
    if (amt > 0 && !prog.has(owner)) by.set(owner, (by.get(owner) || 0) + amt);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([owner, amt]) => ({ owner, amt }));
}
function place(h, wallet) {
  if (!h) return { l: '?', rank: null };
  const i = h.people.findIndex(p => p.owner === wallet);
  if (i >= 0) return { l: '#' + (i + 1), rank: i + 1, of: h.count };
  return { l: h.full ? '—' : '20+', rank: null, of: h.count };
}

/* ---------------- the three readings ---------------- */
async function ageOf(wallet) {
  const s = db();
  const u = (await s`SELECT first_ts, age_done, age_cursor, age_seen FROM nb_users WHERE wallet=${wallet}`)[0];
  if (u && u.age_done && u.first_ts != null) return { ts: Number(u.first_ts), done: true };
  let before = u && u.first_ts != null ? u.age_cursor : null, seen = u && u.first_ts != null ? Number(u.age_seen || 0) : 0, first = u && u.first_ts != null ? Number(u.first_ts) : null, done = false;
  for (let i = 0; i < 3; i++) {
    const opt = { limit: 1000, commitment: 'confirmed' }; if (before) opt.before = before;
    const page = !before ? await rpcEach('getSignaturesForAddress', [wallet, opt], x => Array.isArray(x) && x.length) : await rpc('getSignaturesForAddress', [wallet, opt]);
    if (!before && (!Array.isArray(page) || !page.length)) return { ts: null, done: false };  // no node showed any history: unknown, never "fresh"
    seen += page.length;
    if (page.length) { const last = page[page.length - 1]; before = last.signature; if (last.blockTime) first = last.blockTime; }
    if (page.length < 1000) { done = true; break; }
  }
  await s`INSERT INTO nb_users (wallet, first_ts, age_done, age_cursor, age_seen, age_at) VALUES (${wallet}, ${first}, ${done}, ${before}, ${seen}, now())
          ON CONFLICT (wallet) DO UPDATE SET first_ts=EXCLUDED.first_ts, age_done=EXCLUDED.age_done, age_cursor=EXCLUDED.age_cursor, age_seen=EXCLUDED.age_seen, age_at=now()`;
  return { ts: first, done };
}
function ageLabel(a) {
  if (!a || !a.ts) return '?';
  const d = (nowS() - a.ts) / 86400;
  const t = d < 1 ? '0d' : d < 60 ? Math.floor(d) + 'd' : d < 730 ? Math.floor(d / 30.44) + 'mo' : String(Math.floor(d / 365.25 * 10) / 10).replace(/\.0$/, '') + 'y';
  return a.done ? t : t + '+';
}
const isNoob = a => /^[0-6]d$/.test(String(a || ''));
function sizeLabel(p) { return p <= 0 ? '0%' : p < 0.01 ? '<0.01%' : (p < 10 ? p.toFixed(2) : p.toFixed(1)) + '%'; }

/* ---------------- sign-in ---------------- */
const b64u = b => Buffer.from(b).toString('base64url');
function issue(wallet) { const p = b64u(JSON.stringify({ w: wallet, e: Date.now() + 7 * 864e5 })); return p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(p).digest()); }
function who(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/); if (!m) return null;
  const want = b64u(crypto.createHmac('sha256', SECRET).update(m[1]).digest());
  if (want.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null;
  try { const j = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return j.w && j.e > Date.now() ? j.w : null; } catch (e) { return null; }
}
function verifySig(wallet, msg, sig) {
  try {
    const pub = b58dec(wallet); if (pub.length !== 32 || sig.length !== 64) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' });
    return crypto.verify(null, msg, key, sig);
  } catch (e) { return false; }
}
function signText(host, wallet, nonce, iso) {
  return `${host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to n00b. This is a free signature, not a transaction. It cannot move anything.\n\nNonce: ${nonce}\nIssued At: ${iso}`;
}

/* ---------------- database ---------------- */
let sqlFn, ready;
function db() {
  if (!sqlFn) {
    if (E('N00B_LOCAL_PG')) {
      const { Pool } = require('pg'); const pool = new Pool({ connectionString: E('N00B_LOCAL_PG') });
      sqlFn = async (strs, ...vals) => { let q = strs[0]; vals.forEach((v, i) => { q += '$' + (i + 1) + strs[i + 1]; }); return (await pool.query(q, vals)).rows; };
    } else {
      if (!DB_URL) throw http(503, 'The database is not connected yet.');
      const { neon } = require('@neondatabase/serverless'); sqlFn = neon(DB_URL);
    }
  }
  return sqlFn;
}
async function ensure() {
  if (ready) return ready;
  ready = (async () => {
    const s = db();
    await s`CREATE TABLE IF NOT EXISTS nb_nonces (nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, text TEXT NOT NULL, used BOOLEAN DEFAULT false, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS nb_users (wallet TEXT PRIMARY KEY, name TEXT, first_ts BIGINT, age_done BOOLEAN DEFAULT false, age_cursor TEXT, age_seen INT DEFAULT 0, age_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE UNIQUE INDEX IF NOT EXISTS nb_users_name ON nb_users (lower(name))`;
    await s`CREATE TABLE IF NOT EXISTS nb_rooms (mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, image TEXT, msgs INT DEFAULT 0, last_at TIMESTAMPTZ, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS nb_members (mint TEXT, wallet TEXT, status TEXT, bal DOUBLE PRECISION, peak DOUBLE PRECISION, pct DOUBLE PRECISION, a TEXT, l TEXT, kicks INT DEFAULT 0, joined TIMESTAMPTZ, checked TIMESTAMPTZ, seen TIMESTAMPTZ, last_msg TIMESTAMPTZ, PRIMARY KEY (mint, wallet))`;
    await s`CREATE TABLE IF NOT EXISTS nb_msgs (id BIGSERIAL PRIMARY KEY, mint TEXT NOT NULL, wallet TEXT, name TEXT, kind TEXT NOT NULL, body TEXT, a TEXT, s TEXT, l TEXT, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE INDEX IF NOT EXISTS nb_msgs_room ON nb_msgs (mint, id)`;
    await s`CREATE INDEX IF NOT EXISTS nb_msgs_kind ON nb_msgs (kind, id)`;
  })();
  try { await ready; } catch (e) { ready = null; throw e; }
  return ready;
}
async function nameOf(wallet) { const r = await db()`SELECT name FROM nb_users WHERE wallet=${wallet}`; return (r[0] && r[0].name) || short(wallet); }

async function room(mint) {
  const s = db();
  const r = (await s`SELECT * FROM nb_rooms WHERE mint=${mint}`)[0];
  if (r && r.name) return r;
  const mi = await mintRead(mint);
  let meta = mi.meta; if (!meta || !meta.name) meta = await metaplex(mint).catch(() => null);
  let image = meta && meta.uri ? await uriImage(meta.uri).catch(() => null) : null;
  if (!image) { const m = await market(mint); image = m && m.image; }
  const name = clean(meta && meta.name).slice(0, 40) || short(mint), symbol = clean(meta && meta.symbol).slice(0, 14);
  const out = await s`INSERT INTO nb_rooms (mint, name, symbol, image) VALUES (${mint}, ${name}, ${symbol}, ${image})
                      ON CONFLICT (mint) DO UPDATE SET name=EXCLUDED.name, symbol=EXCLUDED.symbol, image=EXCLUDED.image RETURNING *`;
  return out[0];
}
function roomOut(r, mi, mk) {
  return { mint: r.mint, name: r.name, symbol: r.symbol, image: r.image, supply: mi.supply, min: Math.ceil(mi.supply * MIN_PCT / 100), minPct: MIN_PCT, kick: KICK, mc: mk && mk.mc || null };
}
async function say(mint, wallet, name, kind, body, tag) {
  const s = db();
  const r = await s`INSERT INTO nb_msgs (mint, wallet, name, kind, body, a, s, l) VALUES (${mint}, ${wallet}, ${name}, ${kind}, ${body || ''}, ${tag && tag.a || null}, ${tag && tag.s || null}, ${tag && tag.l || null}) RETURNING id, at`;
  await s`UPDATE nb_rooms SET msgs = msgs + 1, last_at = now() WHERE mint=${mint}`;
  return r[0];
}

// read a member's bag again. A drop is confirmed with a second read on another RPC before anyone is kicked.
async function recheck(m, mint, self) {
  const s = db(), mi = await mintRead(mint);
  let bal = await bag(m.wallet, mint, 0);
  const peak = Math.max(Number(m.peak || 0), bal), min = mi.supply * MIN_PCT / 100;
  const low = b => b <= peak * KICK || b < min;
  if (low(bal)) { await sleep(350); const again = await bag(m.wallet, mint, 1).catch(() => bal); bal = Math.max(bal, again); }
  const h = await holders(mint).catch(() => null);
  const pl = place(h, m.wallet), p = bal / mi.supply * 100;
  let a = m.a;
  if (self && a && /\+|\?/.test(a)) a = ageLabel(await ageOf(m.wallet).catch(() => null)) || a;
  if (low(bal)) {
    const drop = peak > 0 ? Math.round((1 - bal / peak) * 100) : 100;
    const k = await s`UPDATE nb_members SET status='kicked', bal=${bal}, pct=${p}, l=${pl.l}, kicks=kicks+1, checked=now() WHERE mint=${mint} AND wallet=${m.wallet} AND status='in' RETURNING wallet`;
    if (k.length) await say(mint, m.wallet, await nameOf(m.wallet), 'kick', drop >= Math.round((1 - KICK) * 100) ? `bag −${drop}%` : `under the ${MIN_PCT}% line`, { a, s: sizeLabel(p), l: pl.l });
    return { kicked: true, drop };
  }
  await s`UPDATE nb_members SET bal=${bal}, peak=${peak}, pct=${p}, l=${pl.l}, a=${a}, checked=now() WHERE mint=${mint} AND wallet=${m.wallet}`;
  return { kicked: false };
}
const sweeping = new Map();
async function sweep(mint) {
  const t = sweeping.get(mint) || 0; if (Date.now() - t < 8000) return; sweeping.set(mint, Date.now());
  const stale = await db()`SELECT * FROM nb_members WHERE mint=${mint} AND status='in' AND checked < now() - interval '45 seconds' ORDER BY checked ASC LIMIT 3`;
  await Promise.race([Promise.all(stale.map(m => recheck(m, mint, false).catch(() => null))), sleep(6500)]);
}

/* ---------------- routes ---------------- */
const R = {};
R['GET config'] = async () => ({ ca: CA || null, x: XH || null, minPct: MIN_PCT, kick: KICK, home: CA || null, rank: RPC_URL ? 'full' : 'top20' });

R['GET nonce'] = async ({ q, req }) => {
  const wallet = addr(q.wallet, 'wallet'); limit('n:' + wallet, 8, 60e3);
  const nonce = b64u(crypto.randomBytes(12)), iso = new Date().toISOString();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'asl').replace(/[^\w.:-]/g, '').slice(0, 80);
  const text = signText(host, wallet, nonce, iso);
  await db()`INSERT INTO nb_nonces (nonce, wallet, text) VALUES (${nonce}, ${wallet}, ${text})`;
  db()`DELETE FROM nb_nonces WHERE at < now() - interval '1 day'`.catch(() => { });
  return { nonce, message: text };
};
R['POST login'] = async ({ b }) => {
  const wallet = addr(b.wallet, 'wallet');
  const row = (await db()`SELECT * FROM nb_nonces WHERE nonce=${String(b.nonce || '')} AND wallet=${wallet} AND used=false AND at > now() - interval '10 minutes'`)[0];
  if (!row) throw http(401, 'That sign-in expired. Try again.');
  let sig; try { sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(b.sig || '') ? b58dec(b.sig) : Buffer.from(String(b.sig || ''), 'base64'); } catch (e) { throw http(400, 'Bad signature.'); }
  const msg = b.msg ? Buffer.from(String(b.msg), 'base64') : Buffer.from(row.text, 'utf8');
  if (!msg.toString('utf8').includes(row.text)) throw http(401, 'The signed message does not match.');
  if (!verifySig(wallet, msg, sig)) throw http(401, 'The signature does not match this wallet.');
  const used = await db()`UPDATE nb_nonces SET used=true WHERE nonce=${row.nonce} AND used=false RETURNING nonce`;
  if (!used.length) throw http(401, 'That sign-in was already used.');
  await db()`INSERT INTO nb_users (wallet, signed_at) VALUES (${wallet}, now()) ON CONFLICT (wallet) DO UPDATE SET signed_at=now()`;
  const u = (await db()`SELECT name FROM nb_users WHERE wallet=${wallet}`)[0];
  return { token: issue(wallet), wallet, name: u && u.name || null };
};
R['GET me'] = async ({ me }) => {
  if (!me) throw http(401, 'Sign in first.');
  const u = (await db()`SELECT name, first_ts, age_done FROM nb_users WHERE wallet=${me}`)[0] || {};
  const rooms = await db()`SELECT m.mint, m.status, r.name, r.symbol, r.image FROM nb_members m JOIN nb_rooms r USING (mint) WHERE m.wallet=${me} ORDER BY m.joined DESC LIMIT 20`;
  return { wallet: me, name: u.name || null, rooms };
};
R['POST name'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Sign in first.');
  const name = String(b.name || '').trim();
  if (!NAME_RE.test(name)) throw http(400, '3 to 16 letters, numbers, dots, dashes or underscores.');
  if (RESERVED.test(name)) throw http(400, 'That name is reserved.');
  if (slurry(name) || name.split(/[_.-]+/).some(slurry)) throw http(400, 'Pick another name.');
  limit('nm:' + me, 6, 3600e3);
  try { await db()`INSERT INTO nb_users (wallet, name) VALUES (${me}, ${name}) ON CONFLICT (wallet) DO UPDATE SET name=EXCLUDED.name`; }
  catch (e) { if (/duplicate|unique/i.test(e.message)) throw http(409, 'Someone already has that name.'); throw e; }
  return { name };
};

R['GET room'] = async ({ q, me }) => {
  const mint = addr(q.mint, 'coin address'); const s = db();
  const [r, mi, mk] = await Promise.all([room(mint), mintRead(mint), market(mint)]);
  const after = Math.max(0, parseInt(q.after, 10) || 0);
  if (me) await s`UPDATE nb_members SET seen=now() WHERE mint=${mint} AND wallet=${me}`;
  await sweep(mint).catch(() => { });
  const msgs = after
    ? await s`SELECT id, kind, wallet, name, body, a, s, l, at FROM nb_msgs WHERE mint=${mint} AND id > ${after} ORDER BY id ASC LIMIT 120`
    : (await s`SELECT id, kind, wallet, name, body, a, s, l, at FROM nb_msgs WHERE mint=${mint} ORDER BY id DESC LIMIT 80`).reverse();
  const people = await s`SELECT m.wallet, coalesce(u.name, '') AS name, m.pct, m.a, m.l, m.kicks, (m.seen > now() - interval '2 minutes') AS online FROM nb_members m LEFT JOIN nb_users u USING (wallet) WHERE m.mint=${mint} AND m.status='in' ORDER BY m.pct DESC NULLS LAST LIMIT 150`;
  const mine = me ? (await s`SELECT status, bal, peak, pct, a, l, kicks FROM nb_members WHERE mint=${mint} AND wallet=${me}`)[0] || null : null;
  return {
    room: roomOut(r, mi, mk),
    msgs: msgs.map(m => ({ id: Number(m.id), kind: m.kind, wallet: m.wallet, name: m.name, body: m.body, a: m.a, s: m.s, l: m.l, at: m.at })),
    people: people.map(p => ({ wallet: p.wallet, name: p.name || short(p.wallet), a: p.a, s: sizeLabel(Number(p.pct || 0)), l: p.l, kicks: p.kicks, online: !!p.online })),
    me: mine ? { status: mine.status, bal: mine.bal, peak: mine.peak, s: sizeLabel(Number(mine.pct || 0)), a: mine.a, l: mine.l, kicks: mine.kicks, line: Number(mine.peak || 0) * KICK } : null,
  };
};

R['POST join'] = async ({ b, me, ip }) => {
  if (!me) throw http(401, 'Sign in first.');
  const mint = addr(b.mint, 'coin address'); limit('j:' + me, 10, 60e3); limit('ji:' + ip, 30, 60e3);
  const s = db();
  const [r, mi] = await Promise.all([room(mint), mintRead(mint)]);
  const [bal, age, h] = await Promise.all([bag(me, mint), ageOf(me).catch(() => null), holders(mint).catch(() => null)]);
  const min = mi.supply * MIN_PCT / 100, p = bal / mi.supply * 100;
  const tag = { a: ageLabel(age), s: sizeLabel(p), l: place(h, me).l };
  if (bal < min) throw http(403, `You need ${Math.ceil(min).toLocaleString('en-US')} ${r.symbol ? '$' + r.symbol : 'tokens'} (${MIN_PCT}% of supply) to enter. This wallet holds ${Math.floor(bal).toLocaleString('en-US')}.`, { need: Math.ceil(min), have: bal, tag });
  const prev = (await s`SELECT status FROM nb_members WHERE mint=${mint} AND wallet=${me}`)[0];
  if (prev && prev.status === 'in') { await s`UPDATE nb_members SET seen=now() WHERE mint=${mint} AND wallet=${me}`; return { ok: true, tag, already: true }; }
  await s`INSERT INTO nb_members (mint, wallet, status, bal, peak, pct, a, l, joined, checked, seen) VALUES (${mint}, ${me}, 'in', ${bal}, ${bal}, ${p}, ${tag.a}, ${tag.l}, now(), now(), now())
          ON CONFLICT (mint, wallet) DO UPDATE SET status='in', bal=EXCLUDED.bal, peak=EXCLUDED.peak, pct=EXCLUDED.pct, a=EXCLUDED.a, l=EXCLUDED.l, joined=now(), checked=now(), seen=now()`;
  await say(mint, me, await nameOf(me), 'join', '', tag);
  return { ok: true, tag };
};
R['POST leave'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Sign in first.');
  const mint = addr(b.mint, 'coin address');
  const k = await db()`UPDATE nb_members SET status='left' WHERE mint=${mint} AND wallet=${me} AND status='in' RETURNING a, l, pct`;
  if (k.length) await say(mint, me, await nameOf(me), 'left', '', { a: k[0].a, s: sizeLabel(Number(k[0].pct || 0)), l: k[0].l });
  return { ok: true };
};
R['POST say'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Sign in first.');
  const mint = addr(b.mint, 'coin address'); const s = db();
  let text = clean(b.text).replace(/\s+/g, ' ').slice(0, 240);
  if (!text) throw http(400, 'Say something.');
  if (spacedSlur(text)) throw http(400, 'That line was blocked.');
  text = scrub(text);
  limit('s:' + me, 12, 30e3);
  let m = (await s`SELECT * FROM nb_members WHERE mint=${mint} AND wallet=${me}`)[0];
  if (!m || m.status !== 'in') throw http(403, m && m.status === 'kicked' ? 'You were kicked from this room. Hold enough again to rejoin.' : 'Join the room first.');
  if (m.last_msg && Date.now() - new Date(m.last_msg).getTime() < 1200) throw http(429, 'Slow down a little.');
  if (!m.checked || Date.now() - new Date(m.checked).getTime() > 5000) {
    const c = await recheck(m, mint, true);
    if (c.kicked) throw http(403, `You were kicked: your bag is down ${c.drop}% from its peak.`, { kicked: true });
    m = (await s`SELECT * FROM nb_members WHERE mint=${mint} AND wallet=${me}`)[0];
  }
  await s`UPDATE nb_members SET last_msg=now(), seen=now() WHERE mint=${mint} AND wallet=${me}`;
  const r = await say(mint, me, await nameOf(me), 'say', text, { a: m.a, s: sizeLabel(Number(m.pct || 0)), l: m.l });
  return { ok: true, id: Number(r.id) };
};

R['GET lobby'] = async () => {
  const s = db();
  const rooms = await s`SELECT r.mint, r.name, r.symbol, r.image, r.msgs, r.last_at,
      (SELECT count(*) FROM nb_members m WHERE m.mint=r.mint AND m.status='in')::int AS members,
      (SELECT count(*) FROM nb_members m WHERE m.mint=r.mint AND m.status='in' AND m.seen > now() - interval '2 minutes')::int AS online,
      (SELECT row_to_json(x) FROM (SELECT name, body, kind FROM nb_msgs WHERE mint=r.mint AND kind='say' ORDER BY id DESC LIMIT 1) x) AS last
    FROM nb_rooms r WHERE r.msgs > 0 ORDER BY online DESC, r.last_at DESC NULLS LAST LIMIT 40`;
  const kicks = await s`SELECT m.id, m.mint, m.wallet, m.name, m.body, m.a, m.s, m.l, m.at, r.symbol FROM nb_msgs m JOIN nb_rooms r USING (mint) WHERE m.kind='kick' ORDER BY m.id DESC LIMIT 24`;
  const said = await s`SELECT m.name, m.body, r.symbol, m.mint FROM nb_msgs m JOIN nb_rooms r USING (mint) WHERE m.kind='say' ORDER BY m.id DESC LIMIT 14`;
  const tape = await s`SELECT m.kind, m.name, m.a, m.body, m.at, r.symbol FROM nb_msgs m JOIN nb_rooms r USING (mint) WHERE m.kind IN ('join','kick') ORDER BY m.id DESC LIMIT 20`;
  const paper = await s`SELECT wallet, max(name) AS name, count(*)::int AS n FROM nb_msgs WHERE kind='kick' GROUP BY wallet ORDER BY n DESC, max(id) DESC LIMIT 10`;
  const diamond = await s`SELECT m.wallet, coalesce(u.name, '') AS name, m.joined, m.pct, r.symbol, m.mint FROM nb_members m JOIN nb_rooms r USING (mint) LEFT JOIN nb_users u USING (wallet) WHERE m.status='in' ORDER BY m.joined ASC LIMIT 10`;
  const loud = await s`SELECT wallet, max(name) AS name, count(*)::int AS n FROM nb_msgs WHERE kind='say' AND at > now() - interval '7 days' GROUP BY wallet ORDER BY n DESC LIMIT 10`;
  const noobs = await s`SELECT m.id, m.mint, m.wallet, m.name, m.a, m.s, m.l, m.at, r.symbol FROM nb_msgs m JOIN nb_rooms r USING (mint) WHERE m.kind='join' AND m.a ~ '^[0-6]d$' ORDER BY m.id DESC LIMIT 24`;
  const t = (await s`SELECT (SELECT count(*) FROM nb_rooms WHERE msgs > 0)::int AS rooms, (SELECT count(*) FROM nb_members WHERE status='in')::int AS inside, (SELECT count(*) FROM nb_msgs WHERE kind='kick')::int AS kicks, (SELECT count(*) FROM nb_msgs WHERE kind='say')::int AS said`)[0];
  return { rooms, kicks: kicks.map(k => ({ ...k, id: Number(k.id) })), noobs: noobs.map(k => ({ ...k, id: Number(k.id) })), said, tape, boards: { paper, diamond: diamond.map(d => ({ ...d, s: sizeLabel(Number(d.pct || 0)) })), loud }, totals: t };
};

// anyone can read any wallet's a/s/l for a coin. Read only, nothing is joined.
R['GET check'] = async ({ q, ip }) => {
  const wallet = addr(q.wallet, 'wallet'), mint = addr(q.mint, 'coin address');
  limit('c:' + ip, 15, 60e3);
  const [r, mi] = await Promise.all([room(mint), mintRead(mint)]);
  const [bal, age, h] = await Promise.all([bag(wallet, mint), ageOf(wallet).catch(() => null), holders(mint).catch(() => null)]);
  const p = bal / mi.supply * 100, pl = place(h, wallet);
  return {
    wallet, room: { mint, name: r.name, symbol: r.symbol, image: r.image },
    a: ageLabel(age), s: sizeLabel(p), l: pl.l, of: pl.of || null,
    firstTx: age && age.ts ? age.ts : null, ageExact: !!(age && age.done), n00b: isNoob(ageLabel(age)),
    bal, pct: p, canEnter: p >= MIN_PCT, need: Math.ceil(mi.supply * MIN_PCT / 100),
  };
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = String((req.query && req.query.__p) || url.searchParams.get('__p') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  const q = Object.fromEntries(url.searchParams);
  const key = `${req.method} ${path}`;
  const fn = R[key];
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!fn) return send(res, 404, { ok: false, error: 'No such endpoint.' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (key !== 'GET config') await ensure();
    const b = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn({ q, b, req, me: who(req), ip });
    send(res, 200, out);
  } catch (e) {
    const code = e.code && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(key, e);
    send(res, code, Object.assign({ ok: false, error: code === 500 ? 'Something broke on our side. Try again.' : e.message }, e.extra || {}));
  }
};
module.exports._t = { b58enc, b58dec, verifySig, signText, ageLabel, sizeLabel, place, scrub, slurry, spacedSlur };
