/* THE READING ROOM — net.js: reading together.

   One reader opens their room (the host); friends join with a link (?room=CODE). Browsers connect
   directly over WebRTC with PeerJS (vendor/peerjs.min.js, loaded only when someone opens or joins a
   room). Only the short room code goes through PeerJS's public matchmaking server; the room itself
   travels browser to browser.

   The host's room is the room. A guest's changes are sent to the host as ops; the host checks and
   applies them with the same applyOp as its own and sends every applied op to everyone, so all copies
   stay the same. Presence (where you stand, what you read) goes out ten times a second through the
   host. A guest's own room is put aside while visiting and comes back when they leave.

   Messages (JSON): hello {pid,name,avatar} | welcome {room, host, peers} | op {op} | no {reason}
                    me {d} | chat {pid,name,text} | note {pid,name,book,note} | joined/left {pid,name} | bye
   Testing against a local PeerJS server: ?peer=localhost:9000 (kept in the invite link).

   The shared library (opened on claude.ai): there the page itself is the meeting place. Everyone who has it
   open walks into one library, with no link or code. Where each reader stands travels as their presence
   (the page's room capability); changes travel as room events; and the library itself is kept in a db
   document, so it is still there, as it was left, after everyone has gone. One reader holds the pen: the
   earliest to arrive who may write. It checks changes as a host does, sends them on and saves the library;
   when it leaves, the next earliest takes over with its own copy. */
'use strict';
const RR_NET = (() => {
  const PREFIX = 'arcade-reading-room-';
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let app = null, peer = null, hostConn = null;
  const guests = new Map();            // host side: conn.peer -> { conn, pid, name, n, t0 }
  const st = { active: false, connecting: false, isHost: false, code: null, commons: false, where: null };
  let joinTimer = 0;
  const QS = new URLSearchParams(location.search);
  // storage can be blocked entirely (even reading window.sessionStorage throws), so every touch is guarded
  const devPeer = QS.get('peer') || (() => { try { return window.sessionStorage.getItem('rr-peer'); } catch (e) { return null; } })();
  if (QS.get('peer')) { try { window.sessionStorage.setItem('rr-peer', QS.get('peer')); } catch (e) {} }

  function init(a) { app = a; }
  function state() { return Object.assign({}, st); }
  function loadLib() {
    if (window.Peer) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js';
      s.onload = () => (window.Peer ? res() : rej(new Error('PeerJS missing')));
      s.onerror = () => rej(new Error('PeerJS failed to load'));
      document.head.appendChild(s);
    });
  }
  function opts() {
    const o = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
    if (devPeer) { const [host, port] = devPeer.split(':'); Object.assign(o, { host, port: +port || 9000, path: '/', secure: false, config: { iceServers: [] } }); }
    return o;
  }
  const code6 = () => Array.from({ length: 6 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('');
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  function link() {
    const u = new URL(location.href); u.search = ''; u.hash = '';
    u.searchParams.set('room', st.code);
    if (devPeer) u.searchParams.set('peer', devPeer);
    return u.href;
  }
  function errText(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No room with that code is open right now.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Could not reach the matchmaking server. Check the connection and try again.';
    if (t === 'browser-incompatible') return 'This browser cannot share rooms.';
    return 'Something went wrong connecting (' + (t || 'unknown') + ').';
  }

  /* ---------------- host ---------------- */
  async function host(tries) {
    if (st.active || st.connecting) return;
    st.connecting = true; st.isHost = true;
    try { await loadLib(); } catch (e) { st.connecting = false; app.status('Could not load the sharing code. Are you offline?'); return; }
    st.code = code6();
    peer = new window.Peer(PREFIX + st.code, opts());
    peer.on('open', () => {
      st.connecting = false; st.active = true;
      app.started(true, st.code);
      app.status();
    });
    peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id' && (tries || 0) < 3) { cleanup(); st.connecting = false; host((tries || 0) + 1); return; }
      if (!st.active) { const m = errText(err); cleanup(); reset(); app.status(m); }
      else app.status(errText(err));
    });
    peer.on('disconnected', () => { if (st.active && peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} } });
    peer.on('connection', (conn) => {
      conn.on('open', () => { guests.set(conn.peer, { conn, pid: null, name: 'Reader', n: 0, t0: performance.now() }); });
      conn.on('data', (msg) => fromGuest(conn, msg));
      conn.on('close', () => dropGuest(conn));
      conn.on('error', () => dropGuest(conn));
    });
  }
  function toGuests(msg, except) { for (const [k, g] of guests) if (g.pid && k !== except) { try { g.conn.send(msg); } catch (e) {} } }
  function fromGuest(conn, msg) {
    const g = guests.get(conn.peer); if (!g || !msg || typeof msg !== 'object') return;
    // a polite flood limit: 60 messages a second
    const now = performance.now(); if (now - g.t0 > 1000) { g.t0 = now; g.n = 0; } if (++g.n > 60) return;
    if (msg.t === 'hello') {
      g.pid = clip(msg.pid, 24) || ('g' + conn.peer.slice(-6)); g.name = clip(msg.name, 14) || 'Reader';
      if ([...guests.values()].some(o => o !== g && o.pid === g.pid)) g.pid += '_' + Math.random().toString(36).slice(2, 5);
      const peers = [];
      for (const o of guests.values()) if (o !== g && o.pid && o.last) peers.push(o.last);
      conn.send({ t: 'welcome', room: app.snapshot(), host: app.presence(), peers, pid: g.pid });
      toGuests({ t: 'joined', pid: g.pid, name: g.name }, conn.peer);
      app.peerJoined(g.pid, g.name);
      app.peer(g.pid, { pid: g.pid, name: g.name, avatar: clip(msg.avatar, 12), x: 0, z: 6.6, yaw: 0 });
      return;
    }
    if (!g.pid) return;
    if (msg.t === 'op' && msg.op && typeof msg.op === 'object') {
      const op = Object.assign({}, msg.op, { who: g.pid });
      const res = app.hostOp(op);
      if (res === true) toGuests({ t: 'op', op });
      else { try { conn.send({ t: 'no', reason: clip(res, 120) }); } catch (e) {} }
    } else if (msg.t === 'me' && msg.d) {
      const d = sanitizePresence(msg.d); d.pid = g.pid; d.name = g.name;
      g.last = d;
      app.peer(g.pid, d);
      toGuests({ t: 'me', d }, conn.peer);
    } else if (msg.t === 'chat') {
      const text = clip(msg.text, 160); if (!text) return;
      app.chat(g.pid, g.name, text);
      toGuests({ t: 'chat', pid: g.pid, name: g.name, text }, conn.peer);
    } else if (msg.t === 'note' && msg.note) {
      const note = sanitizeNote(msg.note), book = clip(msg.book, 60);
      app.note(g.pid, g.name, book, note);
      toGuests({ t: 'note', pid: g.pid, name: g.name, book, note }, conn.peer);
    }
  }
  function dropGuest(conn) {
    const g = guests.get(conn.peer); if (!g) return;
    guests.delete(conn.peer);
    if (!g.pid) return;
    const op = { t: 'drop', who: g.pid };
    if (app.hostOp(op) === true) toGuests({ t: 'op', op });
    toGuests({ t: 'left', pid: g.pid, name: g.name });
    app.peerLeft(g.pid, g.name);
  }

  /* ---------------- guest ---------------- */
  async function join(code) {
    if (st.active || st.connecting) return;
    code = clip(code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return;
    st.connecting = true; st.isHost = false; st.code = code;
    try { await loadLib(); } catch (e) { reset(); app.status('Could not load the sharing code. Are you offline?'); return; }
    peer = new window.Peer(undefined, opts());
    peer.on('open', () => {
      hostConn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      hostConn.on('open', () => { const me = app.me(); hostConn.send({ t: 'hello', pid: me.pid, name: me.name, avatar: me.avatar, v: 1 }); });
      hostConn.on('data', fromHost);
      hostConn.on('close', () => { if (st.active || st.connecting) end('The room has closed. You walk home to your own room.'); });
      hostConn.on('error', () => { if (!st.active) { end('Could not join that room.'); } });
    });
    peer.on('error', (err) => { if (st.connecting || st.active) end(errText(err)); });
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (st.connecting) end('No answer from that room. It may have closed.'); }, 20000);
  }
  function fromHost(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      clearTimeout(joinTimer);
      st.connecting = false; st.active = true;
      app.started(false, st.code);
      app.enterRoom(msg.room, msg.host && msg.host.pid);
      if (msg.host) app.peer(msg.host.pid, sanitizePresence(msg.host));
      (msg.peers || []).forEach(d => app.peer(d.pid, sanitizePresence(d)));
      app.status();
    } else if (msg.t === 'op' && msg.op) app.remoteOp(msg.op);
    else if (msg.t === 'no') app.rejected(clip(msg.reason, 120));
    else if (msg.t === 'me' && msg.d) app.peer(clip(msg.d.pid, 30), sanitizePresence(msg.d));
    else if (msg.t === 'joined') app.peerJoined(clip(msg.pid, 30), clip(msg.name, 14));
    else if (msg.t === 'left') app.peerLeft(clip(msg.pid, 30), clip(msg.name, 14));
    else if (msg.t === 'chat') app.chat(clip(msg.pid, 30), clip(msg.name, 14), clip(msg.text, 160));
    else if (msg.t === 'note' && msg.note) app.note(clip(msg.pid, 30), clip(msg.name, 14), clip(msg.book, 60), sanitizeNote(msg.note));
    else if (msg.t === 'bye') end('The host closed the room. You walk home to your own room.');
  }

  /* ---------------- the shared library (claude.ai) ---------------- */
  const C = { room: null, db: null, user: null, ref: null, ready: null, unsub: [], since: 0, w: true, rev: 0,
    mePeer: '', hostPeer: null, byPeer: new Map(), saveT: 0, saving: null, dirty: false, settleT: 0 };
  function capability(name) {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
      return Promise.resolve(window.claude.use(name)).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }
  // is this page open somewhere readers can share it? (false outside claude.ai; settles within ~10 s)
  function detect() {
    if (C.ready) return C.ready;
    C.ready = Promise.all([capability('room'), capability('db'), capability('user')])
      .then(([room, db, user]) => {
        C.room = room; C.db = db; C.user = user;
        st.where = room && window.claude && window.claude.relays ? 'relays' : room ? 'claude' : null;   // relays: the self-hosted site (commons-nostr.js)
        return !!room;
      }, () => false);
    return C.ready;
  }
  async function commons() {
    if (st.active || st.connecting) return false;
    if (!(await detect())) return false;
    if (st.active || st.connecting) return false;
    st.connecting = true; st.commons = true; st.isHost = false; st.code = null;
    C.rev = 0; C.hostPeer = null; C.byPeer.clear(); C.since = 0; C.mePeer = ''; C.t0 = Date.now(); C.lastMe = '';
    let w = null; try { w = C.user ? await C.user.can('data.write') : null; } catch (e) {}
    C.w = w !== false;
    let saved = null;
    if (C.db) { try { C.ref = C.db.doc('library/room'); const snap = await C.ref.get(); if (snap.exists) saved = snap.data(); } catch (e) { C.ref = null; } }
    if (!st.connecting || !st.commons) return false;                  // left while the library was fetched
    st.connecting = false; st.active = true;
    app.started(false, null, true);
    const was = savedRoom(saved);
    if (was) { C.rev = +saved.rev || 0; app.enterRoom(was); } else app.enterRoom(app.freshRoom());
    const R = C.room, me = app.me();
    C.unsub.push(R.on('op', (m) => {
      if (m.sameTab || !m.data || !m.data.op || typeof m.data.op !== 'object') return;
      C.rev = Math.max(C.rev, +m.data.rev || 0);
      app.remoteOp(m.data.op);
    }, () => {}));
    C.unsub.push(R.on('req', (m) => {
      if (!st.isHost || m.sameTab || !m.data || !m.data.op || typeof m.data.op !== 'object') return;
      const p = C.byPeer.get(m.peer); if (!p) return;
      const op = Object.assign({}, m.data.op, { who: p.pid });              // a reader can only act as themselves
      const res = app.hostOp(op);
      if (res === true) hostSend(op);
      else R.emit('no', { to: m.peer, reason: clip(res, 120) }).catch(() => {});
    }, () => {}));
    C.unsub.push(R.on('no', (m) => { if (m.data && m.data.to && m.data.to === C.mePeer) app.rejected(clip(m.data.reason, 120)); }, () => {}));
    C.unsub.push(R.on('chat', (m) => {
      if (m.sameTab || !m.data) return;
      const p = C.byPeer.get(m.peer); const text = clip(m.data.text, 160); if (!p || !text) return;
      app.chat(p.pid, p.name, text);
    }, () => {}));
    C.unsub.push(R.on('note', (m) => {
      if (m.sameTab || !m.data || !m.data.note || typeof m.data.note !== 'object') return;
      const p = C.byPeer.get(m.peer); if (!p) return;
      app.note(p.pid, p.name, clip(m.data.book, 60), sanitizeNote(m.data.note));
    }, () => {}));
    C.unsub.push(R.onPeers(peersChanged, () => {}));
    if (C.ref) C.unsub.push(C.ref.onSnapshot(fromSaved, () => {}));
    // the library's shared margin notes: kept one to a document, so they outlast everyone's visit
    if (C.db) {
      let first = true;
      try {
        C.unsub.push(C.db.collection('notes').limit(1000).onSnapshot((qs) => {
          const quiet = first; first = false;
          for (const ch of qs.docChanges()) {
            const d = ch.doc.data(); if (!d || typeof d !== 'object') continue;
            const pid = clip(d.pid, 30), book = clip(d.book, 60);
            if (!book || pid === app.me().pid) continue;                 // your own notes are already yours
            if (ch.type === 'removed') app.noteGone(book, clip(ch.doc.id, 30));
            else app.note(pid, clip(d.by, 14) || 'A reader', book, sanitizeNote(Object.assign({}, d, { id: ch.doc.id })), quiet);
          }
        }, () => {}));
      } catch (e) {}
    }
    R.presence({ v: 1, pid: me.pid, name: me.name, avatar: me.avatar, since: 0, w: false }).catch(() => {});
    // let the room answer before standing for the pen, so a newcomer never takes it from someone already here
    clearTimeout(C.settleT);
    C.settleT = setTimeout(() => {
      if (!st.commons || !st.active) return;
      let mx = 0; for (const p of R.peers()) if (!p.sameTab && p.presence && +p.presence.since) mx = Math.max(mx, +p.presence.since);
      C.since = Math.max(Date.now(), mx + 1);
      R.presence({ since: C.since, w: C.w }).catch(() => {});
      elect();
    }, 1800);
    app.status();
    return true;
  }
  function peersChanged(ch) {
    if (!st.commons || !st.active) return;
    const mine = app.me().pid, live = new Map();
    for (const p of ch.peers) {
      if (p.sameTab) { C.mePeer = p.peer; continue; }
      if (p.kind !== 'viewer') continue;
      const pr = p.presence || {}, pid = clip(pr.pid, 30);
      if (!pid || pid === mine) continue;                               // not walked in yet, or your own other tab
      live.set(p.peer, { pid, name: clip(pr.name, 14) || 'Reader', avatar: clip(pr.avatar, 12), since: +pr.since || 0, w: !!pr.w, d: pr.d && typeof pr.d === 'object' ? pr.d : null });
    }
    const left = [];
    for (const [peer, o] of C.byPeer) if (!live.has(peer) || live.get(peer).pid !== o.pid) left.push(o);
    const fresh = [];
    for (const [peer, o] of live) { const old = C.byPeer.get(peer); if (!old || old.pid !== o.pid) fresh.push(o); }
    C.byPeer = live;
    elect();                                                             // before departures, so a new pen-holder tidies up after the old
    for (const o of left) {
      app.peerLeft(o.pid, o.name);
      if (st.isHost) { const op = { t: 'drop', who: o.pid }; if (app.hostOp(op) === true) hostSend(op); }
    }
    for (const o of fresh) app.peerJoined(o.pid, o.name, Date.now() - C.t0 < 4000);   // the readers already here when you arrive
    // only readers who arrived or moved since the last delivery need drawing again
    const moved = ch.joined || ch.updated ? new Set([...(ch.joined || []), ...(ch.updated || [])].map(p => p.peer)) : null;
    for (const [peer, o] of live) if (o.d && (!moved || moved.has(peer) || fresh.includes(o))) app.peer(o.pid, sanitizePresence(Object.assign({}, o.d, { pid: o.pid, name: o.name, avatar: o.avatar })));
  }
  function elect() {
    if (!st.commons || !st.active) return;
    let best = null;
    const consider = (since, peer) => { if (since && (!best || since < best[0] || (since === best[0] && peer < best[1]))) best = [since, peer]; };
    for (const [peer, o] of C.byPeer) if (o.w) consider(o.since, peer);
    if (C.w) consider(C.since, C.mePeer);
    C.hostPeer = best ? best[1] : null;
    const amHost = !!best && !!C.since && best[0] === C.since && best[1] === C.mePeer;
    if (amHost === st.isHost) return;
    st.isHost = amHost;
    app.role(amHost);
    if (amHost) {
      // books in the hands of readers who are no longer here go back to the shelves
      const here = new Set([app.me().pid, ...[...C.byPeer.values()].map(o => o.pid)]);
      for (const pid of Object.keys(app.snapshot().hands || {})) if (!here.has(pid)) { const op = { t: 'drop', who: pid }; if (app.hostOp(op) === true) hostSend(op); }
      saveSoon();
    }
  }
  function hostSend(op) { C.rev++; if (C.room) C.room.emit('op', { op, rev: C.rev }).catch(() => {}); saveSoon(); }
  function saveSoon() { if (!C.ref || !st.isHost) return; clearTimeout(C.saveT); C.saveT = setTimeout(saveNow, 700); }
  function saveNow() {
    if (!C.ref || !st.isHost || !st.commons) return;
    if (C.saving) { C.dirty = true; return; }
    // the library goes in as one JSON string: shelf ids like "E5.2" stay plain text, never field paths
    C.saving = C.ref.set({ v: 2, rev: C.rev, at: Date.now(), room: JSON.stringify(app.snapshot()) }).catch(() => {}).then(() => {
      C.saving = null; if (C.dirty) { C.dirty = false; saveNow(); }
    });
  }
  // the saved library changed: whoever holds the pen is the authority, everyone else catches up if behind
  function fromSaved(snap) {
    if (!st.commons || !st.active || st.isHost || !snap || !snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
    const d = snap.data(), room = savedRoom(d); if (!room) return;
    if ((+d.rev || 0) <= C.rev) return;
    C.rev = +d.rev || 0;
    app.syncRoom(room);
  }
  function savedRoom(d) {
    if (!d || !d.room) return null;
    try { const r = typeof d.room === 'string' ? JSON.parse(d.room) : JSON.parse(JSON.stringify(d.room)); return r && typeof r === 'object' ? r : null; } catch (e) { return null; }
  }
  function leaveCommons(reason) {
    clearTimeout(C.settleT);
    for (const u of C.unsub.splice(0)) { try { u(); } catch (e) {} }
    if (st.isHost) { clearTimeout(C.saveT); C.saving = null; saveNow(); }
    if (C.room) C.room.presence({ v: null, pid: null, name: null, avatar: null, since: null, w: null, d: null }).catch(() => {});
    C.byPeer = new Map(); C.hostPeer = null;
    const was = st.active || st.connecting;
    reset();
    if (was) app.ended(reason);
  }
  function keepNote(book, note) {
    if (!C.db) return;
    const me = app.me();
    try { C.db.collection('notes').doc(note.id).set({ v: 1, book, ch: note.ch, b: note.b, quote: note.quote, text: note.text, t: note.t, by: me.name, pid: me.pid }).catch(() => {}); } catch (e) {}
  }
  // you changed or erased a note you had shared
  function noteChange(book, n, id) {
    if (!st.commons || !st.active || !C.db) return;
    if (n) keepNote(book, sanitizeNote(n));
    else { try { C.db.collection('notes').doc(clip(id, 30)).delete().catch(() => {}); } catch (e) {} }
  }
  function people() { return [...C.byPeer.values()].map(o => ({ pid: o.pid, name: o.name })); }

  /* ---------------- both ---------------- */
  function sanitizePresence(d) {
    const n = (v, lo, hi) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
    return { pid: clip(d.pid, 30), name: clip(d.name, 14) || 'Reader', avatar: clip(d.avatar, 12), x: n(d.x, -30, 30), z: n(d.z, -12, 36), yaw: n(d.yaw, -50, 50), speed: n(d.speed, 0, 6),
      seat: d.seat ? clip(d.seat, 24) : null, sry: d.sry == null ? null : n(d.sry, -50, 50), reading: d.reading ? clip(d.reading, 60) : null };
  }
  function sanitizeNote(n) {
    return { id: clip(n.id, 30), ch: Math.max(0, n.ch | 0), b: Math.max(0, n.b | 0), quote: clip(n.quote, 400), text: clip(n.text, 1200), t: +n.t || Date.now() };
  }
  function send(op) {
    if (st.commons) { if (st.active && C.room) C.room.emit('req', { op }).catch((e) => { if (e && e.code === 'not_permitted') app.rejected('You can look around, but only readers the owner lets in can move things here.'); }); return; }
    if (hostConn && st.active) { try { hostConn.send({ t: 'op', op }); } catch (e) {} }
  }
  function broadcastOp(op) { if (st.commons) { if (st.isHost && st.active) hostSend(op); return; } if (st.isHost && st.active) toGuests({ t: 'op', op }); }
  function presence(d) {
    if (!st.active) return;
    if (st.commons) {                        // presence stays put on the platform: send it only when it changes
      if (!C.room) return;
      const o = Object.assign({}, d); delete o.pid; delete o.name; delete o.avatar;
      const j = JSON.stringify(o); if (j === C.lastMe) return; C.lastMe = j;
      C.room.presence({ d: o }).catch(() => {});
      return;
    }
    if (st.isHost) toGuests({ t: 'me', d });
    else if (hostConn) { try { hostConn.send({ t: 'me', d }); } catch (e) {} }
  }
  function chat(text) {
    text = clip(text, 160); if (!text || !st.active) return;
    const me = app.me();
    if (st.commons) { if (C.room) C.room.emit('chat', { text }).catch(() => {}); return; }
    if (st.isHost) toGuests({ t: 'chat', pid: me.pid, name: me.name, text });
    else if (hostConn) hostConn.send({ t: 'chat', text });
  }
  function note(book, n) {
    if (!st.active) return;
    const me = app.me(), note = sanitizeNote(n);
    if (st.commons) { if (C.room) C.room.emit('note', { book, note }).catch(() => {}); keepNote(book, note); return; }
    if (st.isHost) toGuests({ t: 'note', pid: me.pid, name: me.name, book, note });
    else if (hostConn) hostConn.send({ t: 'note', book, note });
  }
  function cleanup() {
    for (const g of guests.values()) { try { g.conn.close(); } catch (e) {} }
    guests.clear();
    if (hostConn) { try { hostConn.close(); } catch (e) {} hostConn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
  }
  function reset() { st.active = false; st.connecting = false; st.isHost = false; st.code = null; st.commons = false; }
  function end(reason) {
    clearTimeout(joinTimer);
    const was = st.active || st.connecting;
    cleanup(); reset();
    if (was) app.ended(reason);
  }
  function leave() {
    if (st.commons) { leaveCommons('You step out of the shared library into a room of your own.'); return; }
    if (st.isHost) { toGuests({ t: 'bye' }); setTimeout(() => end('Your room is closed to visitors.'), 120); }
    else end('You walk home to your own room.');
  }
  addEventListener('pagehide', () => { if (st.commons) { if (st.isHost) { clearTimeout(C.saveT); C.saving = null; saveNow(); } return; } if (st.isHost) toGuests({ t: 'bye' }); });

  return { init, state, host, join, leave, send, broadcastOp, presence, chat, note, noteChange, link, detect, commons, people };
})();
