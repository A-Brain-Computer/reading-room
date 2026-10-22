/* THE READING ROOM — commons-nostr.js: the shared library away from claude.ai.

   On claude.ai the page's own room and db capabilities carry the shared library (net.js). Published
   anywhere else (library.jordanstrudwick.com), this file stands in for those capabilities over public
   Nostr relays, so whoever opens the link walks into the same library, with no server of our own and
   no accounts. It answers window.claude.use('room' | 'db' | 'user') with the calls net.js already makes:
   - presence and room events travel as ephemeral events (kind 25150): relayed live, never stored;
   - documents (the library itself, shared margin notes) are addressable events (kind 30078, NIP-78),
     one per document per browser. The newest across browsers wins; an erased one is an empty
     replacement.
   Each browser signs with its own random key, kept in localStorage. Everything sent is public: the
   relays are open, and anyone with the link can read the library and change it.

   Configured by window.RR_COMMONS = { relays: [...], library: 'main' } (commons-config.js); a test can
   point a page elsewhere with ?relays=ws://127.0.0.1:7777&lib=test. Needs NostrTools
   (vendor/nostr-tools.bundle.js) loaded first. */
'use strict';
(() => {
  const cfg = window.RR_COMMONS, N = window.NostrTools;
  if (!cfg || window.claude || !N || !N.SimplePool) return;
  const QS = new URLSearchParams(location.search);
  const RELAYS = (QS.get('relays') ? QS.get('relays').split(',') : cfg.relays || []).filter(u => /^wss?:\/\/[^\s]+$/.test(u)).slice(0, 6);
  if (!RELAYS.length) return;
  const LIB = String(QS.get('lib') || cfg.library || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'main';
  const TAG = 'reading-room:' + LIB, DOCS = TAG + '|docs';
  const EPH = 25150, DOC = 30078;
  const secs = () => Math.floor(Date.now() / 1000);
  const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const unhex = (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const call = (f, a) => { try { f(a); } catch (e) { setTimeout(() => { throw e; }); } };

  // this browser's key (it signs everything it sends) and this page's own label among the readers
  let sk = null;
  try { const h = localStorage.getItem('rr-nostr-key'); if (h && /^[0-9a-f]{64}$/.test(h)) sk = unhex(h); } catch (e) {}
  if (!sk) { sk = N.generateSecretKey(); try { localStorage.setItem('rr-nostr-key', hex(sk)); } catch (e) {} }
  const pk = N.getPublicKey(sk);
  const me = 'p' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const pool = new N.SimplePool({ enableReconnect: true, enablePing: true });
  const sign = (kind, tags, content) => N.finalizeEvent({ kind, created_at: secs(), tags, content }, sk);
  const send = (ev) => { try { pool.publish(RELAYS, ev).forEach(p => p.catch(() => {})); } catch (e) {} };
  const seen = new Set();                                  // each relay delivers its own copy of an event
  function fresh(id) {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 6000) { const it = seen.values(); for (let i = 0; i < 3000; i++) seen.delete(it.next().value); }
    return true;
  }

  /* ---------------- room: who is here, and moments ---------------- */
  const peers = new Map(), heard = new Map(), handlers = new Map(), peerFns = new Set();
  let snapshot = Object.freeze([]), joined = [], left = [], updated = [], deliverT = 0;
  const sender = (peer, by) => ({ peer, by, isMe: by === pk, sameTab: peer === me, kind: 'viewer', guest: false });
  function deliver() {
    if (deliverT) return;
    deliverT = setTimeout(() => {
      deliverT = 0;
      snapshot = Object.freeze([...peers.values()]);
      const ch = Object.freeze({ peers: snapshot, joined: Object.freeze(joined), left: Object.freeze(left), updated: Object.freeze(updated) });
      joined = []; left = []; updated = [];
      peerFns.forEach(f => call(f, ch));
    }, 50);
  }
  function setPeer(peer, by, presence) {
    const had = peers.has(peer);
    const p = Object.freeze(Object.assign(sender(peer, by), { presence: Object.freeze(presence), updatedAt: Date.now() }));
    peers.set(peer, p); heard.set(peer, Date.now());
    (had ? updated : joined).push(p);
    deliver();
  }
  function dropPeer(peer) {
    const p = peers.get(peer); if (!p || peer === me) return;
    peers.delete(peer); heard.delete(peer); left.push(p); deliver();
  }
  // my presence goes out at most three times a second, and again every 8 s, so newcomers meet me and
  // the other pages' 25-second timeout keeps me in the room
  let mine = {}, presT = 0, presAt = 0, dirty = false, said = false;
  function sendPresence(hi) {
    presAt = Date.now(); dirty = false;
    send(sign(EPH, [['t', TAG]], JSON.stringify({ p: me, k: 'pres', d: mine, hi: hi ? 1 : 0 })));
  }
  function soon() {
    dirty = true;
    if (presT) return;
    presT = setTimeout(() => { presT = 0; if (dirty) sendPresence(); }, Math.max(0, 340 - (Date.now() - presAt)));
  }
  setInterval(() => {
    if (said && Date.now() - presAt > 8000) sendPresence();
    const cut = Date.now() - 25000;
    for (const [peer, t] of heard) if (peer !== me && t < cut) dropPeer(peer);
  }, 2000);
  addEventListener('pagehide', () => { if (said) send(sign(EPH, [['t', TAG]], JSON.stringify({ p: me, k: 'bye' }))); });
  let answerT = 0;
  function onMoment(ev) {
    if (!fresh(ev.id)) return;
    let m; try { m = JSON.parse(ev.content); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.p !== 'string' || m.p.length > 40 || m.p === me) return;
    if (m.k === 'pres' && m.d && typeof m.d === 'object' && !Array.isArray(m.d)) {
      const isNew = !peers.has(m.p);
      setPeer(m.p, ev.pubkey, m.d);
      // a newcomer only hears presence sent after it arrived, so answer it (once, soon)
      if ((m.hi || isNew) && said && !answerT) answerT = setTimeout(() => { answerT = 0; sendPresence(); }, 150 + Math.random() * 500);
    } else if (m.k === 'bye') dropPeer(m.p);
    else if (m.k === 'emit' && typeof m.topic === 'string') {
      if (peers.has(m.p)) heard.set(m.p, Date.now());
      const fns = handlers.get(m.topic); if (!fns) return;
      const msg = Object.freeze(Object.assign(sender(m.p, ev.pubkey), { topic: m.topic, data: m.data }));
      fns.forEach(f => call(f, msg));
    }
  }
  const bad = (message) => Promise.reject({ code: 'invalid_argument', message });
  const room = Object.freeze({
    emit(topic, data) {
      if (typeof topic !== 'string' || !/^[a-z][a-z0-9_.-]{0,47}$/.test(topic)) return bad('bad topic');
      let body; try { body = JSON.stringify({ p: me, k: 'emit', topic, data }); } catch (e) { return bad('data is not JSON'); }
      if (body.length > 4300) return bad('data over 4 KiB');
      send(sign(EPH, [['t', TAG]], body));
      const fns = handlers.get(topic);
      if (fns) { const msg = Object.freeze(Object.assign(sender(me, pk), { topic, data: clone(data) })); queueMicrotask(() => fns.forEach(f => call(f, msg))); }
      return Promise.resolve();
    },
    on(topic, fn) {
      if (typeof fn !== 'function') throw new TypeError('handler must be a function');
      if (!handlers.has(topic)) handlers.set(topic, new Set());
      handlers.get(topic).add(fn);
      return () => { const s = handlers.get(topic); if (s) s.delete(fn); };
    },
    presence(patch) {
      if (!patch || typeof patch !== 'object') return bad('presence must be an object');
      const next = Object.assign({}, mine);
      for (const k in patch) { if (patch[k] === null) delete next[k]; else next[k] = clone(patch[k]); }
      if (JSON.stringify(next).length > 4096) return bad('presence over 4 KiB');
      mine = next;
      setPeer(me, pk, clone(mine));
      if (!said) { said = true; sendPresence(true); } else soon();
      return Promise.resolve();
    },
    peers: () => snapshot,
    onPeers(fn) {
      peerFns.add(fn);
      setTimeout(() => { if (peerFns.has(fn)) call(fn, Object.freeze({ peers: snapshot, joined: snapshot, left: Object.freeze([]), updated: Object.freeze([]) })); }, 0);
      return () => { peerFns.delete(fn); };
    },
    connected: () => true
  });

  /* ---------------- db: documents as addressable events ---------------- */
  const docs = new Map();          // path -> { v, ms, id } — the newest version heard from any browser (v null: erased)
  const docFns = new Map(), colFns = new Map();
  const PATH = /^[A-Za-z0-9_.~:@+-]{1,200}(\/[A-Za-z0-9_.~:@+-]{1,200}){1,14}$/;
  const colOf = (path) => path.slice(0, path.lastIndexOf('/'));
  function onDoc(ev) {
    if (!fresh(ev.id)) return;
    const d = (ev.tags.find(t => t[0] === 'd') || [])[1] || '';
    if (!d.startsWith(TAG + '|')) return;
    const path = d.slice(TAG.length + 1); if (!PATH.test(path)) return;
    let body = null;
    if (ev.content) { try { body = JSON.parse(ev.content); } catch (e) { return; } if (!body || typeof body !== 'object') return; }
    // order by the signed second, and by the writer's milliseconds within it (never beyond it)
    const base = ev.created_at * 1000, ms = body && +body.ms >= base && +body.ms < base + 1000 ? +body.ms : base;
    const cur = docs.get(path);
    if (cur && (cur.ms > ms || (cur.ms === ms && cur.id >= ev.id))) return;
    docs.set(path, { v: body && body.v != null ? body.v : null, ms, id: ev.id });
    changed(path);
  }
  function snap(path, v) {
    const exists = v != null;
    return Object.freeze({ id: path.split('/').pop(), exists, data: () => (exists ? clone(v) : undefined), metadata: Object.freeze({ hasPendingWrites: false, fromCache: false }) });
  }
  const docSnap = (path) => snap(path, (docs.get(path) || {}).v);
  function colNow(cpath) { const m = new Map(); for (const [p, d] of docs) if (d.v != null && colOf(p) === cpath) m.set(p.slice(cpath.length + 1), d.v); return m; }
  function colDeliver(cpath, c) {
    const now = colNow(cpath), changes = [];
    for (const [id, v] of now) { const j = JSON.stringify(v), was = c.known.get(id); if (was === undefined) changes.push({ type: 'added', doc: snap(cpath + '/' + id, v) }); else if (was !== j) changes.push({ type: 'modified', doc: snap(cpath + '/' + id, v) }); }
    for (const [id, j] of c.known) if (!now.has(id)) changes.push({ type: 'removed', doc: snap(cpath + '/' + id, JSON.parse(j)) });
    if (!changes.length && !c.first) return;
    c.first = false;
    c.known = new Map([...now].map(([id, v]) => [id, JSON.stringify(v)]));
    const list = [...now].map(([id, v]) => snap(cpath + '/' + id, v));
    const qs = Object.freeze({ docs: list, size: list.length, empty: !list.length, docChanges: () => changes.map((x, i) => Object.assign({ oldIndex: -1, newIndex: i }, x)), metadata: Object.freeze({ hasPendingWrites: false, fromCache: false }) });
    call(c.fn, qs);
  }
  function changed(path) {
    const fs = docFns.get(path); if (fs) { const s = docSnap(path); fs.forEach(f => call(f, s)); }
    const cs = colFns.get(colOf(path)); if (cs) cs.forEach(c => colDeliver(colOf(path), c));
  }
  // every document of this library, in one subscription; ready once the relays have sent what they hold
  const ready = new Promise((res) => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    try { pool.subscribe(RELAYS, { kinds: [DOC], '#t': [DOCS], limit: 3000 }, { onevent: onDoc, oneose: fin, maxWait: 4000 }); } catch (e) { fin(); }
    setTimeout(fin, 4500);
  });
  try { pool.subscribe(RELAYS, { kinds: [EPH], '#t': [TAG], since: secs() - 5 }, { onevent: onMoment }); } catch (e) {}
  function write(path, value) {
    if (!PATH.test(path)) return bad('bad path');
    let content = '';
    if (value != null) {
      try { content = JSON.stringify({ v: value, ms: Date.now() }); } catch (e) { return bad('not JSON'); }
      if (content.length > 120000) return bad('document too large');
    }
    const ev = sign(DOC, [['d', TAG + '|' + path], ['t', DOCS]], content);
    onDoc(ev);                                                                  // ours at once
    send(ev);
    return Promise.resolve();
  }
  function docRef(path) {
    return Object.freeze({
      id: path.split('/').pop(), path,
      get: () => ready.then(() => docSnap(path)),
      set: (data) => write(path, data),
      update(data) {
        const cur = docs.get(path); if (!cur || cur.v == null) return bad('document does not exist');
        const merge = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; return o; };
        return write(path, merge(cur.v, data));
      },
      delete: () => write(path, null),
      onSnapshot(fn) {
        if (!docFns.has(path)) docFns.set(path, new Set());
        docFns.get(path).add(fn);
        ready.then(() => { if (docFns.get(path).has(fn)) call(fn, docSnap(path)); });
        return () => { docFns.get(path).delete(fn); };
      },
      collection: (sub) => colRef(path + '/' + sub)
    });
  }
  function colRef(cpath) {
    const q = {
      path: cpath,
      where: () => q, orderBy: () => q, limit: () => q,
      doc: (id) => docRef(cpath + '/' + (id || ('d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)))),
      add: (data) => { const r = q.doc(); return r.set(data).then(() => r); },
      get: () => ready.then(() => { const c = { fn: null, known: new Map(), first: true }; let out = null; c.fn = (s) => { out = s; }; colDeliver(cpath, c); return out; }),
      onSnapshot(fn) {
        const c = { fn, known: new Map(), first: true };
        if (!colFns.has(cpath)) colFns.set(cpath, new Set());
        colFns.get(cpath).add(c);
        ready.then(() => { if (colFns.get(cpath).has(c)) colDeliver(cpath, c); });
        return () => { colFns.get(cpath).delete(c); };
      }
    };
    return Object.freeze(q);
  }
  const db = Object.freeze({ doc: docRef, collection: colRef });
  const user = Object.freeze({
    id: async () => pk, me: async () => ({ id: pk, name: '', email: null }),
    isOwner: async () => false, canEdit: async () => false, can: async () => true, profiles: async () => ({})
  });
  const caps = { room, db, user };
  window.claude = Object.freeze({ use: (name) => Promise.resolve(caps[name] || null), relays: Object.freeze(RELAYS.slice()) });
})();
