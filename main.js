/* THE READING ROOM — main.js: you in the room.

   Walk (WASD / arrows / left thumb), look (drag), click or tap what you want: a book to take it down,
   an open shelf or a table to set it down, a chair to sit and read. Tab rearranges the room. The room
   (furniture, every book's place, the book in your hand), where you stood and who you read as are
   saved per player with arcade.save; reading places and margin notes are saved by reader.js.

   Room state, the one source of truth (also what a shared room sends to friends):
     { v, nextId, furniture: [{id, type, v, x, z, r}], rows: {rowId: [bookIds]}, piles: {furnId: {spot: [bookIds]}},
       hands: {playerId: bookId} }
   Every change is an op ({t:'take'|'shelve'|'pile'|'swap'|'fmove'|'fadd'|'fdel'|'drop', ...}) run by applyOp,
   so a shared room's host can check and apply a friend's change exactly as it applies its own. */
'use strict';
(() => {
  // the other scripts declare top-level consts (global, but not properties of window)
  const T = window.THREE;
  const W = typeof RR_WORLD !== 'undefined' ? RR_WORLD : null, AV = typeof RR_AVATARS !== 'undefined' ? RR_AVATARS : null;
  const RD = typeof RR_READER !== 'undefined' ? RR_READER : null, NET = typeof RR_NET !== 'undefined' ? RR_NET : null;
  const CN = typeof RR_CINEMA !== 'undefined' ? RR_CINEMA : null;   // cinema.js: the screen over the fire
  const A = window.arcade || null;
  const $ = (s, r) => (r || document).querySelector(s);
  const SLUG = 'library';
  const TAU = Math.PI * 2;
  const touch = (window.matchMedia && matchMedia('(pointer:coarse)').matches) || false;
  document.body.classList.toggle('touch', touch);
  const QS = new URLSearchParams(location.search);

  /* ---------------- storage (arcade.save when present; never throws) ---------------- */
  const store = {
    load(key, fb, dev) {
      try { if (A && A.load) return A.load(SLUG, key, fb, dev ? { profile: false } : undefined); } catch (e) {}
      try { const v = localStorage.getItem(SLUG + ':' + key); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; }
    },
    save(key, v, dev) {
      try { if (A && A.save) return A.save(SLUG, key, v, dev ? { profile: false } : undefined); } catch (e) {}
      try { localStorage.setItem(SLUG + ':' + key, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
  };

  /* ---------------- little UI helpers ---------------- */
  let toastT = 0;
  function toast(msg, ms) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms || 2400); }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function openSheet(id) { closeSheets(); const el = $('#' + id); el.hidden = false; S.sheet = id; const f = el.querySelector('input,button.x'); if (f && !touch) setTimeout(() => f.focus(), 30); }
  function closeSheets() { document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; }); S.sheet = null; }
  document.querySelectorAll('.sheet').forEach(s => {
    s.addEventListener('click', (e) => { if (e.target === s || e.target.hasAttribute('data-close')) closeSheets(); });
  });

  /* ---------------- state ---------------- */
  const S = {
    books: [], byId: new Map(),
    room: null, ownRoom: null,          // ownRoom: your room, kept aside while you visit a friend's
    pid: null, me: null,
    mode: 'title',                       // title | play | arrange | reader
    view: 'first', sheet: null,
    gl: false, ready: false,
    shared: false, isHost: false, commons: false,   // commons: the one shared library everyone on this page walks into
    others: new Map(),                   // pid -> remote reader
    findId: null, findT: 0,
    taken: new Set(),                    // every book you have taken down (Malcolm X opens at ten, with one read to the end)
    lastSave: 0
  };
  const P = { x: 0, z: 6.0, yaw: 0, pitch: -0.06, vx: 0, vz: 0, seat: null, eye: 1.62, eyeNow: 1.62, walkTo: null, stuck: 0, bob: 0, speed: 0 };

  /* ---------------- default room ---------------- */
  const LAYOUT = 3;                  // the shelf plan; a room saved under an older plan is reshelved (furniture, piles and notes stay)
  const r0 = (dx, dz) => Math.atan2(dx, dz);                 // facing a point: rotation whose +z looks along (dx, dz)
  function defaultRoom() {
    const F = [];
    let n = 1;
    const add = (type, x, z, r, v) => { const f = { id: 'f' + (n++), type, x, z, r: r || 0 }; if (v) f.v = v; F.push(f); return f; };
    // by the fire
    add('rug', 0, -4.5, 0, 0);
    add('armchair', -1.8, -4.9, r0(1.8, -2.5), 0);
    add('armchair', 1.8, -4.9, r0(-1.8, -2.5), 1);
    add('sofa', 0, -2.75, Math.PI, 0);
    const low = add('coffeetable', 0, -4.25, 0);
    add('lamp', -2.95, -4.1, 0);
    add('ottoman', 2.75, -3.45, 0, 0);
    // the two reading tables
    [-3.4, 3.4].forEach((x, i) => {
      add('rug', x, 2.0, 0, i ? 2 : 1);
      add('table', x, 2.0, 0);
      [-0.6, 0.6].forEach(dx => { add('chair', x + dx, 1.2, 0); add('chair', x + dx, 2.8, Math.PI); });
    });
    // a reading nook by the narratives
    add('armchair', 9.6, -2.6, r0(1.0, 1.0), 2);
    add('roundtable', 10.35, -1.85, 0);
    add('lamp', 10.6, -3.25, 0);
    add('ottoman', 9.0, -1.55, 0, 1);
    // the window side and corners
    add('globe', -10.0, -2.3, 0);
    add('desk', -9.6, -6.85, 0);
    add('chair', -9.6, -6.15, Math.PI);
    add('bookcase', -7.4, 5.4, Math.PI / 2);
    add('bookcase', 7.4, 5.4, -Math.PI / 2);
    add('plant', -11.25, 6.95, 0); add('plant', 10.9, 6.95, 0); add('plant', -11.3, -7.0, 0);
    add('sofa', -6.4, -1.0, Math.PI / 2, 1);
    add('roundtable', -6.4, -2.6, 0);
    const piles = {};
    // every book on its section's shelves (the golden wall, the great books); the first narrative waits
    // on the low table by the fire
    const ids = S.books.map(b => b.id);
    const first = ids[0];
    if (first) piles[low.id] = { 0: [first] };
    const room = { v: 1, layout: LAYOUT, nextId: n, furniture: F, rows: {}, piles, hands: {}, doors: {} };
    shelveMany(room, ids.slice(1));
    return room;
  }
  // a room from an older shelf plan is reshelved, and books that arrived since are shelved
  function upgradeRoom(room) {
    if (room.layout !== LAYOUT) { room.rows = {}; room.layout = LAYOUT; }
    adoptStrays(room);
    return room;
  }
  // books that are nowhere (new arrivals, or a broken save) go to their own section's shelves
  function adoptStrays(room) {
    const seen = new Set();
    Object.values(room.rows).forEach(l => l.forEach(id => seen.add(id)));
    Object.values(room.piles).forEach(p => Object.values(p).forEach(l => l.forEach(id => seen.add(id))));
    Object.values(room.hands).forEach(id => seen.add(id));
    shelveMany(room, S.books.filter(b => !seen.has(b.id)).map(b => b.id));
  }
  const secOf = (id) => { const b = S.byId.get(id); return b && W.SEC[b.sec] ? b.sec : 'narr'; };
  // a section fills its rows eye level first, spread evenly across its bookcases so no shelf is crammed
  // and the room's old volumes fill out the rest of each shelf
  function shelveMany(room, ids) {
    const by = new Map();
    ids.forEach(id => { const k = secOf(id); if (!by.has(k)) by.set(k, []); by.get(k).push(id); });
    const usedOf = (r) => (room.rows[r] || []).reduce((a, id) => a + bookT(id), 0);
    for (const [k, list] of by) {
      const sc = W.SEC[k], rows = sc.rows.filter(r => W.rowInfo(r)), eye = Math.max(1, sc.units.length);
      const total = list.reduce((a, id) => a + bookT(id), 0) + rows.slice(0, eye).reduce((a, r) => a + usedOf(r), 0);
      const cap = Math.max(0.3, Math.min(1.05, total / eye + 0.06));
      list.forEach(id => {
        const t = bookT(id);
        const r = rows.find(x => usedOf(x) + t <= cap && rowRoom(room, x, id)) || rows.find(x => rowRoom(room, x, id));
        if (r) (room.rows[r] = room.rows[r] || []).push(id); else returnBook(room, id);
      });
    }
  }
  function sanitizeRoom(room) {
    if (!room || typeof room !== 'object' || !Array.isArray(room.furniture)) return null;
    room.rows = room.rows && typeof room.rows === 'object' ? room.rows : {};
    room.piles = room.piles && typeof room.piles === 'object' ? room.piles : {};
    room.hands = room.hands && typeof room.hands === 'object' ? room.hands : {};
    room.doors = room.doors && typeof room.doors === 'object' ? { hall: !!room.doors.hall, banned: !!room.doors.banned } : {};
    room.screen = CN ? CN.sanitize(room.screen) : null;
    room.furniture = room.furniture.filter(f => f && W.CATALOG[f.type] && typeof f.x === 'number' && typeof f.z === 'number');
    const known = new Set(S.books.map(b => b.id)), seen = new Set();
    const keep = (id) => { if (!known.has(id) || seen.has(id)) return false; seen.add(id); return true; };
    for (const k in room.rows) room.rows[k] = Array.isArray(room.rows[k]) ? room.rows[k].filter(keep) : [];
    for (const f in room.piles) for (const s in room.piles[f]) room.piles[f][s] = Array.isArray(room.piles[f][s]) ? room.piles[f][s].filter(keep) : [];
    for (const p in room.hands) if (!keep(room.hands[p])) delete room.hands[p];
    room.nextId = Math.max(room.nextId || 1, ...room.furniture.map(f => +String(f.id).replace(/\D/g, '') + 1 || 1));
    return room;
  }

  /* ---------------- ops ---------------- */
  function locate(room, id) {
    for (const r in room.rows) { const i = room.rows[r].indexOf(id); if (i >= 0) return { k: 'row', row: r, i }; }
    for (const f in room.piles) for (const s in room.piles[f]) { const i = room.piles[f][s].indexOf(id); if (i >= 0) return { k: 'pile', f, s: +s, i }; }
    for (const p in room.hands) if (room.hands[p] === id) return { k: 'hand', p };
    return null;
  }
  function removeBook(room, id) {
    const l = locate(room, id); if (!l) return null;
    if (l.k === 'row') room.rows[l.row].splice(l.i, 1);
    else if (l.k === 'pile') room.piles[l.f][l.s].splice(l.i, 1);
    else delete room.hands[l.p];
    return l;
  }
  const bookT = (id) => { const b = S.byId.get(id); return b ? W.bookDims(b).t + 0.002 : 0.03; };
  function rowRoom(room, rowId, extra) {
    const r = W.rowInfo(rowId); if (!r) return false;
    const used = (room.rows[rowId] || []).reduce((a, id) => a + bookT(id), 0);
    return used + bookT(extra) <= (r.x1 - r.x0) - 0.03;
  }
  function returnBook(room, id) {
    const order = W.SEC[secOf(id)].rows;
    for (const r of order) if (rowRoom(room, r, id)) { (room.rows[r] = room.rows[r] || []).push(id); return r; }
    for (const r of W.rows.keys()) if (rowRoom(room, r, id)) { (room.rows[r] = room.rows[r] || []).push(id); return r; }
    return null;
  }
  const PILE_MAX = 14;
  function applyOp(room, op) {
    const who = op.who;
    switch (op.t) {
      case 'unlock': {                                 // a door opens for good (the host's reading opens it)
        if (op.door !== 'hall' && op.door !== 'banned') return 'There is no such door.';
        room.doors = room.doors || {};
        room.doors[op.door] = true; return true;
      }
      case 'screen': return CN ? CN.applyOp(room, op) : 'There is no screen here.';   // the cinema: down/up, which film, playing
      case 'take': {
        if (room.hands[who]) return 'Your hands are full.';
        const l = locate(room, op.id); if (!l) return 'That book has gone.';
        if (l.k === 'hand') return 'Someone is holding that one.';
        removeBook(room, op.id); room.hands[who] = op.id; return true;
      }
      case 'swap': {
        const mine = room.hands[who]; if (!mine) return applyOp(room, Object.assign({}, op, { t: 'take' }));
        const l = locate(room, op.id); if (!l || l.k === 'hand') return 'Someone is holding that one.';
        removeBook(room, op.id);
        if (l.k === 'row') room.rows[l.row].splice(l.i, 0, mine); else room.piles[l.f][l.s].splice(l.i, 0, mine);
        room.hands[who] = op.id; return true;
      }
      case 'shelve': {
        const id = room.hands[who]; if (!id) return 'Nothing in your hands.';
        if (!W.rowInfo(op.row)) return 'That shelf is gone.';
        if (!rowRoom(room, op.row, id)) return 'That shelf is full.';
        delete room.hands[who];
        const l = room.rows[op.row] = room.rows[op.row] || [];
        l.splice(Math.max(0, Math.min(l.length, op.i | 0)), 0, id); return true;
      }
      case 'pile': {
        const id = room.hands[who]; if (!id) return 'Nothing in your hands.';
        const info = W.furnInfo(op.f); if (!info || !info.spots[op.s]) return 'That table is gone.';
        const p = room.piles[op.f] = room.piles[op.f] || {};
        const l = p[op.s] = p[op.s] || [];
        if (l.length >= PILE_MAX) return 'That pile is as tall as it should get.';
        delete room.hands[who]; l.push(id); return true;
      }
      case 'drop': {
        const id = room.hands[who]; if (!id) return true;
        delete room.hands[who]; returnBook(room, id); return true;
      }
      case 'fmove': {
        const f = room.furniture.find(x => x.id === op.f); if (!f) return 'That piece is gone.';
        f.x = +op.x; f.z = +op.z; f.r = +op.r || 0; return true;
      }
      case 'fadd': {
        if (!W.CATALOG[op.type]) return 'Unknown piece.';
        if (room.furniture.length >= 90) return 'The room is full enough.';
        const f = { id: op.id || ('f' + (room.nextId++)), type: op.type, x: +op.x, z: +op.z, r: +op.r || 0 };
        if (op.v) f.v = op.v | 0;
        if (room.furniture.some(x => x.id === f.id)) f.id = 'f' + (room.nextId++);
        room.furniture.push(f); op.id = f.id; return true;
      }
      case 'fdel': {
        const i = room.furniture.findIndex(x => x.id === op.f); if (i < 0) return true;
        const info = W.furnInfo(op.f);
        const holds = (info && info.rows.some(r => (room.rows[r] || []).length)) || Object.values(room.piles[op.f] || {}).some(l => l.length);
        if (holds) return 'Take the books off it first.';
        room.furniture.splice(i, 1); delete room.piles[op.f];
        if (info) info.rows.forEach(r => delete room.rows[r]);
        return true;
      }
    }
    return 'Unknown change.';
  }
  // run an op: locally (solo or host), or ask the host (guest)
  // books load on demand; taking one down fetches it, so it is ready (and kept offline) by the time you sit
  const fetched = new Set();
  function prefetchBook(id) { if (fetched.has(id)) return; fetched.add(id); fetch('books/' + id + '.json').catch(() => fetched.delete(id)); }
  function doOp(op) {
    op.who = op.who || S.pid;
    if ((op.t === 'take' || op.t === 'swap') && op.id) prefetchBook(op.id);
    if (S.shared && !S.isHost) { NET.send(op); return true; }
    const res = runOp(op);
    if (res === true && S.shared && S.isHost) NET.broadcastOp(op);
    return res;
  }
  function runOp(op) {
    const before = op.t === 'fadd' || op.t === 'fdel' || op.t === 'fmove';
    const res = applyOp(S.room, op);
    if (res !== true) { if (op.who === S.pid) toast(res); return res; }
    if (before) syncFurniture();
    relayout();
    sound(op.t);
    saveRoomSoon();
    if (op.who === S.pid) afterMyOp(op);
    return true;
  }
  function afterMyOp(op) {
    if (op.t === 'take' || op.t === 'swap') {
      const id = S.room.hands[S.pid], b = S.byId.get(id); if (b) toast('You take down ' + b.short + '.', 1600);
      if (id && !S.taken.has(id)) { S.taken.add(id); store.save('taken', [...S.taken]); checkMalcolm(); }
    }
  }

  /* ---------------- who you are: your own books, and Malcolm X ---------------- */
  // The books of the person you read as glow for you: their own, or for Harriet Bailey her son's two
  // autobiographies, where she is remembered, and for Malcolm X books he names from his reading in the
  // Norfolk Prison Colony (The Autobiography of Malcolm X, "Saved").
  const OWN = {
    douglass: (b) => /Frederick Douglass/.test(b.author),
    wells: (b) => /Ida B\. Wells/.test(b.author),
    dubois: (b) => /Du Bois/.test(b.author),
    wheatley: (b) => /Phillis Wheatley/.test(b.author),
    jacobs: (b) => /Harriet Jacobs/.test(b.author),
    washington: (b) => /Booker T\. Washington/.test(b.author),
    bailey: (b) => b.id === 'douglass-narrative' || b.id === 'douglass-bondage',
    malcolm: (b) => /^(dubois-souls|stowe-uncle-tom|kemble-journal|turner-confessions)$/.test(b.id) || /Negro in Our History/.test(b.title) || /Herodotus|Olmsted/.test(b.author)
  };
  const ownBooks = (av) => { const f = OWN[av]; return f ? S.books.filter(f).map(b => b.id) : []; };
  function paintOwn() { if (S.gl && W.setOwn) W.setOwn(ownBooks(S.me.avatar)); }
  // Malcolm X is unlocked by reading: ten books taken down, and one read to the end
  const MALCOLM = { taken: 10, done: 1 };
  const malcolmProgress = () => ({ taken: S.taken.size, done: RD.stats().books });
  function malcolmOpen() { const p = malcolmProgress(); return !!store.load('malcolm', false) || (p.taken >= MALCOLM.taken && p.done >= MALCOLM.done); }
  function checkMalcolm() {
    if (store.load('malcolm', false)) return;
    const p = malcolmProgress();
    if (p.taken < MALCOLM.taken || p.done < MALCOLM.done) return;
    store.save('malcolm', true);
    toast('You have taken down ten books and read one to the end. Malcolm X, who educated himself in a prison library, copying out the dictionary page by page, can now be chosen on the title page.', 9000);
    buildWho();
  }

  /* ---------------- world sync ---------------- */
  let myAv = null, fpHolder = null, camera, renderer, scene;
  function syncFurniture() {
    const want = new Map(S.room.furniture.map(f => [f.id, f]));
    for (const id of [...W.furn.keys()]) if (!want.has(id) && id !== '_carry') W.despawn(id);
    for (const f of S.room.furniture) { if (W.furnInfo(f.id)) W.place(f); else W.spawn(f); }
    W.setDoors(S.room.doors, true);
  }
  function handHolders() {
    const m = new Map();
    for (const pid in S.room.hands) {
      const id = S.room.hands[pid];
      if (pid === S.pid) m.set(id, (S.view === 'first' && S.mode !== 'reader') || !myAv ? fpHolder : myAv.hand);
      else { const o = S.others.get(pid); if (o) m.set(id, o.av.hand); }
    }
    return m;
  }
  function relayout() {
    if (!S.gl) return;
    W.setDoors(S.room.doors);
    W.layoutBooks(S.room, handHolders());
    W.setRibbons(RD.startedMap());
    if (CN) CN.sync(S.room);
    paintHand();
  }
  function paintHand() {
    const id = S.room && S.room.hands[S.pid], b = id && S.byId.get(id);
    $('#hand').classList.toggle('on', !!b);
    if (b) { $('#handT').textContent = b.short; $('#handSw').style.background = (W.bookInfo(id) || {}).color || '#6d1f1a'; }
  }
  let saveT = 0;
  function saveRoomSoon() {
    if (S.shared && (!S.isHost || S.commons)) return;   // a friend's room is theirs to keep; the shared library keeps itself
    clearTimeout(saveT); saveT = setTimeout(() => store.save('room', S.room, false), 350);
  }
  function savePos() { if (S.shared && (!S.isHost || S.commons)) return; store.save('pos', { x: +P.x.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), view: S.view }); }

  /* ---------------- collisions ---------------- */
  function obbPush(px, pz, rad, c) {
    const cr = Math.cos(c.r || 0), sr = Math.sin(c.r || 0);
    const dx = px - c.x, dz = pz - c.z;
    const lx = dx * cr - dz * sr, lz = dx * sr + dz * cr;          // into the rectangle's frame
    const qx = Math.max(-c.hw, Math.min(c.hw, lx)), qz = Math.max(-c.hd, Math.min(c.hd, lz));
    let ox = lx - qx, oz = lz - qz, d = Math.hypot(ox, oz);
    if (d >= rad) return null;
    let nx, nz, pen;
    if (d > 1e-6) { nx = ox / d; nz = oz / d; pen = rad - d; }
    else {                                                          // centre inside: leave by the nearest side
      const ex = c.hw - Math.abs(lx), ez = c.hd - Math.abs(lz);
      if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; pen = ex + rad; } else { nx = 0; nz = Math.sign(lz) || 1; pen = ez + rad; }
    }
    // back to world: inverse of the rotation above
    return { x: (nx * cr + nz * sr) * pen, z: (-nx * sr + nz * cr) * pen };
  }
  function collide(x, z, rad, skip) {
    const cs = W.colliders(skip);
    for (let it = 0; it < 3; it++) {
      for (const c of cs) { const p = obbPush(x, z, rad, c); if (p) { x += p.x; z += p.z; } }
      const p = W.walk(x, z, rad + 0.02); x = p.x; z = p.z;        // the open floor: the room, and the halls you've opened
    }
    return { x, z };
  }
  // oriented rectangles overlap (separating axis test)
  function obbOverlap(a, b) {
    const axes = [a.r || 0, (a.r || 0) + Math.PI / 2, b.r || 0, (b.r || 0) + Math.PI / 2];
    for (const ang of axes) {
      const ax = Math.cos(ang), az = -Math.sin(ang);
      const proj = (o) => {
        const c = Math.cos(o.r || 0), s = Math.sin(o.r || 0);
        const ux = c, uz = -s, vx = s, vz = c;                      // the rectangle's local x and z in the world
        const ctr = o.x * ax + o.z * az;
        const ext = Math.abs(ux * ax + uz * az) * o.hw + Math.abs(vx * ax + vz * az) * o.hd;
        return [ctr - ext, ctr + ext];
      };
      const pa = proj(a), pb = proj(b);
      if (pa[1] < pb[0] + 0.01 || pb[1] < pa[0] + 0.01) return false;
    }
    return true;
  }
  function placementOK(f, skipId) {
    const def = W.CATALOG[f.type];
    const me = { x: f.x, z: f.z, hw: def.w / 2, hd: def.d / 2, r: f.r || 0 };
    const c = Math.abs(Math.cos(me.r)), s = Math.abs(Math.sin(me.r));
    const ex = me.hw * c + me.hd * s, ez = me.hw * s + me.hd * c;
    if (!W.footprintOK(f.x, f.z, ex, ez)) return false;
    if (def.flat) return true;
    for (const o of W.colliders(skipId)) if (o.id !== skipId && obbOverlap(me, o)) return false;
    if (Math.hypot(f.x - P.x, f.z - P.z) < Math.max(me.hw, me.hd) + 0.25 && f.type !== 'rug') return false;
    return true;
  }

  /* ---------------- input ---------------- */
  const keys = new Set();
  const mouse = { x: 0, y: 0, in: false };
  let drag = null, stick = null, lookTouch = null, pinch = null;
  const cvs = $('#gl');
  function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  window.addEventListener('keydown', (e) => {
    if (S.mode === 'reader' || typing()) return;
    if (S.sheet) {
      if (e.key === 'Escape') closeSheets();
      else if (S.sheet === 'cineView' && CN) { const k2 = e.key.toLowerCase(); if (k2 === 'm') CN.toggleMute(); else if (k2 === 'g') CN.fullscreen(); }
      return;
    }
    if (S.mode === 'title') return;
    const k = e.key.toLowerCase();
    keys.add(e.code);
    if (k === 'tab') { e.preventDefault(); toggleArrange(); return; }
    if (k === 'escape' && Z.target > 1 && !(S.mode === 'arrange' && ARR.carry)) { zoomTo(1); return; }
    if (k === 'escape') { if (S.mode === 'arrange') { if (ARR.carry) cancelCarry(); else toggleArrange(false); } else if (P.seat) standUp(); return; }
    if (k === 'c') { openCatalog(); return; }
    if (k === 'v') { toggleView(); return; }
    if (k === '=' || k === '+') { zoomBy(1.5); return; }
    if (k === '-' || k === '_') { zoomBy(1 / 1.5); return; }
    if (k === 'z') { zoomStep(); return; }
    if (k === 't' && S.shared) { e.preventDefault(); $('#chatin').focus(); return; }
    if (k === 'enter' && S.shared) { e.preventDefault(); $('#chatin').focus(); return; }
    if (S.mode === 'arrange') {
      if (k === 'q') rotateCarry(-1); else if (k === 'e') rotateCarry(1);
      else if (k === 'delete' || k === 'backspace' || k === 'x') putAway();
      else if (k === ' ' || k === 'f') { e.preventDefault(); arrangeClick(); }
      return;
    }
    const acts = currentActs();
    const byKey = acts.find(a => a.key && a.key.toLowerCase() === k);
    if (byKey) { e.preventDefault(); byKey.fn(); return; }
    if (k === 'm' && CN && CN.toggleMute()) return;                          // the film's sound, for you alone
    if (k === 'g' && CN && CN.hasFilm()) { CN.fullscreen(); return; }
    if (k === 'r' && S.room.hands[S.pid]) { readNow(S.room.hands[S.pid]); return; }
    if (k === ' ' && P.seat) { e.preventDefault(); standUp(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  cvs.addEventListener('contextmenu', (e) => e.preventDefault());
  cvs.addEventListener('pointerdown', (e) => {
    if (S.mode !== 'play' && S.mode !== 'arrange') return;
    cvs.focus({ preventScroll: true });
    resumeAudio();
    if (e.pointerType === 'touch') {
      if (!stick && e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.3) {
        // the thumb's corner: dragging walks, a quick tap still takes a book or sits (endPointer)
        stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, t: performance.now() };
      } else if (!lookTouch) lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, t: performance.now() };
      else if (!pinch) {                                 // a second finger: pinch to zoom
        pinch = { id: e.pointerId, x: e.clientX, y: e.clientY, d0: Math.max(30, Math.hypot(e.clientX - lookTouch.x, e.clientY - lookTouch.y)), z0: Z.target };
        lookTouch.moved = true;                          // a pinch is never a tap
      }
    } else {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, btn: e.button };
    }
    try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cvs.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; }
    if (stick && e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0; const d = Math.hypot(dx, dy), m = 50;
      if (!stick.moved) {
        if (d < 12) return;
        stick.moved = true;
        const st = $('#stick'); st.style.display = 'block'; st.style.left = stick.x0 + 'px'; st.style.top = stick.y0 + 'px';
      }
      if (d > m) { dx *= m / d; dy *= m / d; }
      stick.dx = dx / m; stick.dy = dy / m;
      $('#stick i').style.transform = `translate(${dx}px,${dy}px)`;
      return;
    }
    if (pinch && (e.pointerId === pinch.id || (lookTouch && e.pointerId === lookTouch.id))) {
      const o = e.pointerId === pinch.id ? pinch : lookTouch;
      o.x = e.clientX; o.y = e.clientY;
      if (!lookTouch) return;
      const d = Math.hypot(pinch.x - lookTouch.x, pinch.y - lookTouch.y);
      zoomTo(pinch.z0 * d / pinch.d0, (pinch.x + lookTouch.x) / 2, (pinch.y + lookTouch.y) / 2);
      return;
    }
    const L = (lookTouch && e.pointerId === lookTouch.id) ? lookTouch : (drag && e.pointerId === drag.id) ? drag : null;
    if (!L) return;
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    L.x = e.clientX; L.y = e.clientY;
    if (!L.moved && Math.hypot(e.clientX - L.sx, e.clientY - L.sy) > (e.pointerType === 'touch' ? 14 : 6)) L.moved = true;
    if (L.moved) look(dx, dy, e.pointerType === 'touch' ? 0.0062 : 0.0045);
  });
  function endPointer(e) {
    if (stick && e.pointerId === stick.id) {
      const tap = !stick.moved && e.type === 'pointerup' && performance.now() - stick.t < 450;
      stick = null; $('#stick').style.display = 'none'; $('#stick i').style.transform = '';
      if (tap) tapAt(e.clientX, e.clientY);
      return;
    }
    if (pinch && e.pointerId === pinch.id) { pinch = null; return; }
    if (pinch && lookTouch && e.pointerId === lookTouch.id) {   // the first finger lifts: the second one goes on looking
      lookTouch = { id: pinch.id, x: pinch.x, y: pinch.y, sx: pinch.x, sy: pinch.y, moved: true, t: performance.now() };
      pinch = null; return;
    }
    const L = (lookTouch && e.pointerId === lookTouch.id) ? lookTouch : (drag && e.pointerId === drag.id) ? drag : null;
    if (!L) return;
    if (L === lookTouch) lookTouch = null; else drag = null;
    if (!L.moved && e.type === 'pointerup' && L.btn !== 2) tapAt(e.clientX, e.clientY);
  }
  cvs.addEventListener('pointerup', endPointer);
  cvs.addEventListener('pointercancel', endPointer);
  cvs.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') mouse.in = false; });
  cvs.addEventListener('wheel', (e) => {
    if (S.mode === 'arrange' && ARR.carry) { e.preventDefault(); rotateCarry(e.deltaY > 0 ? 1 : -1); return; }
    if (S.mode !== 'play' && S.mode !== 'arrange') return;
    e.preventDefault();                                  // the wheel (and a trackpad pinch, which comes as ctrl+wheel) zooms
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomTo(Z.target * Math.exp(-Math.max(-120, Math.min(120, d)) * (e.ctrlKey ? 0.012 : 0.0022)), e.clientX, e.clientY);
  }, { passive: false });
  function look(dx, dy, k) {
    k /= Z.level;                                        // zoomed in, the same drag turns you less
    P.yaw -= dx * k; P.pitch -= dy * k;
    P.pitch = Math.max(-1.25, Math.min(1.1, P.pitch));
  }

  /* ---------------- zoom: look closer at the shelves ----------------
     The lens narrows (field of view) up to 6x. In third person, zooming in moves the camera to your eyes
     first, so you look past your own shoulder at the spines rather than at the back of your head. A wheel
     or pinch zooms toward the point under the pointer or between the fingers. */
  const Z = { level: 1, target: 1, MAX: 6, ax: 0, ay: 0, blend: 0, shown: '' };
  const BASE_FOV = touch ? 70 : 62;
  const ZSTEPS = [1, 2.5, 6];
  function zoomTo(v, x, y) {
    Z.target = Math.max(1, Math.min(Z.MAX, v));
    if (Z.target < 1.02) Z.target = 1;
    if (x != null) { Z.ax = (x / innerWidth) * 2 - 1; Z.ay = -(y / innerHeight) * 2 + 1; } else Z.ax = Z.ay = 0;
  }
  function zoomBy(f) { zoomTo(Z.target * f); }
  function zoomStep() { const i = ZSTEPS.findIndex(z => z > Z.target + 0.05); zoomTo(i < 0 ? 1 : ZSTEPS[i]); }
  const fovAt = (lv) => 2 * Math.atan(Math.tan(BASE_FOV * Math.PI / 360) / lv) * 180 / Math.PI;
  // angle off the view axis of a screen point, for a given vertical fov
  function offAngles(fov, ax, ay) {
    const ty = Math.tan(fov * Math.PI / 360), tx = ty * camera.aspect;
    return [Math.atan(ax * tx), Math.atan(ay * ty)];
  }
  function updateZoom(dt) {
    const before = Z.level;
    Z.level += (Z.target - Z.level) * Math.min(1, dt * 12);
    if (Math.abs(Z.target - Z.level) < 0.003) Z.level = Z.target;
    if (Z.level !== before) {
      const f0 = fovAt(before), f1 = fovAt(Z.level);
      // keep what was under the pointer under the pointer (eye view only)
      if ((Z.ax || Z.ay) && (S.view === 'first' || Z.blend >= 1)) {
        const [x0, y0] = offAngles(f0, Z.ax, Z.ay), [x1, y1] = offAngles(f1, Z.ax, Z.ay);
        P.yaw -= x0 - x1; P.pitch = Math.max(-1.25, Math.min(1.1, P.pitch + (y0 - y1)));
      }
    }
    const fov = fovAt(Z.level);
    if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    Z.blend = Math.max(0, Math.min(1, (Z.level - 1) / 0.6));
    const on = Z.level > 1.05;
    document.body.classList.toggle('zoomed', on);
    const lbl = on ? (Math.round(Z.level * 10) / 10).toFixed(1).replace(/\.0$/, '') + '\u00d7' : 'Zoom';
    if (lbl !== Z.shown) { Z.shown = lbl; $('#bZoomL').textContent = lbl; $('#bZoom').setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }
  const _q1 = new T.Quaternion(), _q3 = new T.Quaternion(), _e1 = new T.Euler();

  /* ---------------- aiming ---------------- */
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  let target = null;                   // what the pointer is on
  function aimFrom(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  function resolve(hit) {
    if (!hit) return null;
    const t = { kind: hit.kind, point: hit.point, dist: hit.dist, object: hit.object };
    if (hit.kind === 'book') { t.id = hit.id; t.loc = locate(S.room, hit.id); return t; }
    if (hit.kind === 'row') { t.row = hit.row; return t; }
    if (hit.kind === 'spot') { t.f = hit.id; t.s = hit.s; return t; }
    if (hit.kind === 'fseat') { t.seat = W.seatList().find(s => s.key === hit.key); return t.seat ? t : null; }
    if (hit.kind === 'door') { t.door = hit.door; return t; }
    if (hit.kind === 'catalog') return t;
    if (hit.kind === 'exhibit') { t.id = hit.id; t.head = hit.head; return t; }
    if (hit.kind === 'furn') {
      const info = W.furnInfo(hit.id); if (!info) return null;
      t.f = hit.id; t.def = info.def;
      if (info.def.flat) return { kind: 'floor', point: hit.point, dist: hit.dist };
      if (info.def.seats) {
        let best = null, bd = 9;
        for (const s of W.seatList()) if (s.f === hit.id) { const d = Math.hypot(s.x - hit.point.x, s.z - hit.point.z); if (d < bd) { bd = d; best = s; } }
        if (best) { t.kind = 'seat'; t.seat = best; return t; }
      }
      if (info.def.spots) {
        const lp = info.obj.worldToLocal(hit.point.clone());
        let bs = 0, bd = 9; info.def.spots.forEach((s, i) => { const d = Math.hypot(s.x - lp.x, s.z - lp.z); if (d < bd) { bd = d; bs = i; } });
        t.kind = 'spot'; t.s = bs; return t;
      }
      if (info.rows.length) {
        const lp = info.obj.worldToLocal(hit.point.clone());
        let best = info.rows[0];
        for (const rid of info.rows) { const r = W.rowInfo(rid); if (lp.y >= r.y - 0.02) best = rid; }
        t.kind = 'row'; t.row = best; return t;
      }
      return t;
    }
    return t;
  }
  function targetPoint(t) {
    if (!t) return null;
    if (t.seat) return { x: t.seat.x, z: t.seat.z };
    return t.point ? { x: t.point.x, z: t.point.z } : null;
  }
  const REACH = 1.9;
  function inReach(t) { const p = targetPoint(t); return !p || Math.hypot(p.x - P.x, p.z - P.z) <= REACH; }

  // the things you can do with what you're pointing at; the first is what a click does
  function actsFor(t) {
    const out = [];
    const hand = S.room.hands[S.pid];
    const hb = hand && S.byId.get(hand);
    if (!t) return out;
    if (t.kind === 'book' && t.loc && t.loc.k !== 'hand') {
      const b = S.byId.get(t.id);
      if (!hand) { out.push({ label: 'Take down', key: 'E', fn: () => act(t, () => doOp({ t: 'take', id: t.id })) }); out.push({ label: READ(), key: 'R', fn: () => act(t, () => { if (doOp({ t: 'take', id: t.id }) === true) readNow(t.id); }) }); }
      else out.push({ label: 'Swap for ' + hb.short, key: 'E', fn: () => act(t, () => doOp({ t: 'swap', id: t.id })) });
      t.label = `<i>${esc(b.short)}</i> — ${esc(b.author)}, ${b.year}`;
      return out;
    }
    if (t.kind === 'row') {
      if (hand) out.push({ label: 'Shelve it here', key: 'E', fn: () => act(t, () => doOp({ t: 'shelve', row: t.row, i: rowIndexAt(t.row, t.point) })) });
      t.label = hand ? 'An open shelf' : '';
      return out;
    }
    if (t.kind === 'spot') {
      const pile = ((S.room.piles[t.f] || {})[t.s] || []);
      const top = pile[pile.length - 1];
      if (hand) out.push({ label: pile.length ? 'Add it to the pile' : 'Set it down here', key: 'E', fn: () => act(t, () => doOp({ t: 'pile', f: t.f, s: t.s })) });
      else if (top) {
        const b = S.byId.get(top);
        out.push({ label: 'Take ' + b.short, key: 'E', fn: () => act(t, () => doOp({ t: 'take', id: top })) });
        out.push({ label: READ(), key: 'R', fn: () => act(t, () => { if (doOp({ t: 'take', id: top }) === true) readNow(top); }) });
      }
      const info = W.furnInfo(t.f);
      t.label = pile.length ? `A pile of ${pile.length} on the ${info.def.name.toLowerCase()}` : (hand ? 'The ' + info.def.name.toLowerCase() : '');
      return out;
    }
    if (t.kind === 'seat' || t.kind === 'fseat') {
      const taken = seatTaken(t.seat.key);
      if (P.seat && P.seat.key === t.seat.key) return out;
      if (taken) { t.label = taken + ' is sitting here'; return out; }
      out.push({ label: hb ? (listens() ? 'Sit and listen' : 'Sit and read') : 'Sit', key: 'E', fn: () => act(t, () => sit(t.seat)) });
      t.label = 'The ' + t.seat.name;
      return out;
    }
    if (t.kind === 'door') {
      const st = RD.stats(), guest = S.shared && !S.isHost;
      if (t.door === 'hall') t.label = 'The doors to the Great Hall. ' + (guest ? 'They open as the host of this room reads.' : 'They open when you finish your first chapter.');
      else {
        const short = S.books.filter(b => b.words).sort((a, b) => a.words - b.words).slice(0, 2).map(b => '<i>' + esc(b.short) + '</i>');
        t.label = 'The doors to the Banned Books gallery. ' + (guest ? 'They open as the host of this room reads.' : 'They open when you finish a whole book' + (st.books ? '.' : ' — some are short, like ' + short.join(' or ') + '.'));
      }
      out.push({ label: 'Find something to read', key: 'E', fn: () => openCatalog() });
      return out;
    }
    if (t.kind === 'catalog') {
      t.label = 'The card catalog';
      out.push({ label: 'Open the catalog', key: 'E', fn: () => openCatalog() });
      return out;
    }
    if (t.kind === 'cinema' && CN) { t.label = CN.label(t); return CN.acts(t); }   // the screen, its pull-cord, the projector
    if (t.kind === 'exhibit') {
      const b = S.byId.get(t.id); if (!b) return out;
      t.label = `<i>${esc(b.short)}</i> — ${esc(t.head)}`;
      out.push({ label: READ(), key: 'E', fn: () => readNow(t.id) });
      out.push({ label: 'Find it on the shelves', key: 'F', fn: () => findBook(t.id) });
      return out;
    }
    if (t.kind === 'furn' && t.def) {
      if (t.def.type === 'globe') out.push({ label: 'Look closer', key: 'E', fn: () => act(t, () => toast('A celestial globe. The Big Dipper points to Polaris, the North Star. “Guided by the unchangable North Star by night” — Henry Bibb, 1849.', 6000)) });
      t.label = t.def.name;
    }
    return out;
  }
  function currentActs() {
    const out = actsFor(target);
    if (P.seat) {
      const hand = S.room.hands[S.pid];
      if (hand && !out.some(a => a.key === 'R')) out.push({ label: READ(), key: 'R', fn: () => readNow(hand) });
      out.push({ label: 'Stand up', key: 'Space', fn: standUp });
    } else if (S.room.hands[S.pid] && !out.some(a => a.key === 'R')) {
      out.push({ label: READ() + ' standing', key: 'R', fn: () => readNow(S.room.hands[S.pid]) });
    }
    return out;
  }
  // run an action now if in reach, otherwise walk over and run it on arrival
  function act(t, fn) {
    if (inReach(t)) { fn(); return; }
    const p = targetPoint(t); if (!p) return;
    if (P.seat) standUp(true);
    P.walkTo = { x: p.x, z: p.z, then: fn, reach: REACH - 0.25, t: 0 };
  }
  function rowIndexAt(rowId, point) {
    const r = W.rowInfo(rowId); if (!r || !point) return 999;
    const lp = r.parent.worldToLocal(point.clone());
    const ids = S.room.rows[rowId] || [];
    let x = r.x0 + 0.015;
    for (let i = 0; i < ids.length; i++) { const t = bookT(ids[i]); if (lp.x < x + t / 2) return i; x += t; }
    return ids.length;
  }
  function tapAt(x, y) {
    if (S.mode === 'arrange') {
      aimFrom(x, y);
      if (ARR.carry && touch) {                       // on a phone: the tap says where it goes
        if (ray.ray.intersectPlane(floorPlane, _fp)) { ARR.carry.f.x = _fp.x; ARR.carry.f.z = _fp.z; W.place(ARR.carry.f); ARR.carry.ok = placementOK(ARR.carry.f, ARR.carry.id); }
        placeCarry(); return;
      }
      arrangePick(true); arrangeClick(); return;
    }
    if (S.mode !== 'play') return;
    let t = resolve(W.pick(aimFrom(x, y), 'play', 40));
    if (touch && !actsFor(t).length) t = nearBook(x, y) || t;
    target = t;
    const acts = actsFor(t);
    if (acts.length) { acts[0].fn(); return; }
    if (t && t.kind === 'floor') { if (P.seat) standUp(true); P.walkTo = { x: t.point.x, z: t.point.z, reach: 0.25, t: 0 }; }
  }
  // the book nearest a tap that missed: rings of rays around the fingertip, closest ring first
  function nearBook(x, y) {
    for (const r of [10, 20, 30]) {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + (r === 20 ? Math.PI / 8 : 0);
        const t = resolve(W.pick(aimFrom(x + Math.cos(a) * r, y + Math.sin(a) * r), 'play', 40));
        if (t && t.kind === 'book' && t.loc && t.loc.k !== 'hand') { if (t.point) t.point = t.point.clone(); return t; }
      }
    }
    return null;
  }
  function updateTarget() {
    if (S.mode !== 'play') return;
    if (touch && Z.level <= 1.05) { paintBar(); return; }
    const x = mouse.in && !touch ? mouse.x : innerWidth / 2, y = mouse.in && !touch ? mouse.y : innerHeight / 2;
    if (drag && drag.moved) { paintBar(); return; }
    const t = resolve(W.pick(aimFrom(x, y), 'play', 14));
    target = t && t.kind !== 'floor' ? t : null;
    const show = target && actsFor(target).length && target.object;
    if (show) {
      if (target.kind === 'row') W.highlight(W.rowBox(target.row));
      else if (target.kind === 'spot') W.highlight(W.spotBox(target.f, target.s));
      else if (target.kind === 'book') W.highlight(W.bookMesh(target.id));
      else if (target.kind === 'seat' && target.f) W.highlight(W.furnInfo(target.f).obj);
      else if (target.kind === 'fseat') W.highlight({ box: new T.Box3().setFromCenterAndSize(new T.Vector3(target.seat.x, 0.35, target.seat.z), new T.Vector3(0.6, 0.6, 0.6)) });
      else W.highlight(target.object);
    } else if (S.findId && W.bookMesh(S.findId) && W.bookMesh(S.findId).parent) W.highlight(W.bookMesh(S.findId));
    else W.highlight(null);
    document.body.classList.toggle('mouse-hover', mouse.in);
    cvs.style.cursor = show ? 'pointer' : 'grab';
    paintBar();
  }
  let barKey = '';
  // the bar's height, for a phone's chat to sit on (index.html): measured whenever its prompt or buttons change
  const barEl = $('#bar');
  let barH = -1;
  function sizeBar() { const h = barEl.offsetHeight; if (h !== barH) { barH = h; document.documentElement.style.setProperty('--barh', h + 'px'); } }
  const barWatch = window.ResizeObserver ? new ResizeObserver(sizeBar) : null;
  if (barWatch) barWatch.observe(barEl);
  function paintBar() {
    const acts = currentActs();
    let label = target && target.label ? target.label : '';
    if (!label && P.seat) label = 'Sitting in the ' + P.seat.name;
    if (target && !inReach(target) && acts.length) label += label ? ' <span style="color:var(--dim)">· click to walk over</span>' : '';
    const key = label + '|' + acts.map(a => a.label).join('|');
    if (key === barKey) return;
    barKey = key;
    $('#prompt').innerHTML = label;
    const box = $('#acts'); box.innerHTML = '';
    acts.forEach((a, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'act' + (i === 0 ? ' primary' : '');
      b.innerHTML = (a.key ? `<kbd>${esc(a.key)}</kbd>` : '') + esc(a.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); a.fn(); });
      box.appendChild(b);
    });
    sizeBar();
  }

  /* ---------------- sitting and reading ---------------- */
  function seatTaken(key) { for (const o of S.others.values()) if (o.seat === key) return o.name; return null; }
  function sit(seat) {
    P.walkTo = null;
    P.seat = seat; P.x = seat.x; P.z = seat.z;
    P.yaw = seat.ry + Math.PI; P.pitch = -0.22;
    P.eye = seat.y + 0.62;
    sound('sit');
    const hand = S.room.hands[S.pid];
    if (hand) setTimeout(() => { if (P.seat === seat && S.mode === 'play') readNow(hand); }, 420);
    else toast(listens() ? 'Bring a book here and it will be read to you.' : 'Bring a book here to read.', 1800);
    barKey = '';
  }
  function standUp(quiet) {
    if (!P.seat) return;
    const s = P.seat; P.seat = null;
    const fx = Math.sin(s.ry), fz = Math.cos(s.ry);
    const p = collide(s.x + fx * 0.6, s.z + fz * 0.6, 0.28);
    P.x = p.x; P.z = p.z; P.eye = 1.62;
    if (!quiet) sound('stand');
    barKey = '';
  }
  // a reader marked `listens` in avatars.js never learned to read: as them, books are read aloud to you (none of today's readers)
  const listens =() => !!((AV.LIST.find(p => p.id === (S.me && S.me.avatar)) || {}).listens);
  const READ = () => (listens() ? 'Listen' : 'Read');
  function readNow(id) {
    const b = S.byId.get(id); if (!b) return;
    S.mode = 'reader';
    W && S.gl && W.highlight(null);
    relayout();
    RD.open(b, { listen: listens() });
  }
  // the doors open as you read: the Great Hall after your first chapter, the Banned Books gallery after
  // your first whole book. They're part of the room, so in a friend's room they follow the host's reading.
  function checkDoors() {
    if (!S.gl || !S.room || S.mode !== 'play' || (S.shared && !S.isHost && !S.commons)) return;
    const st = RD.stats(), d = S.room.doors || {}, said = [];
    if (!d.hall && st.chapters >= 1 && doOp({ t: 'unlock', door: 'hall' }) === true) said.push('You finished your first chapter, and the doors on the south wall, across from the fire, have opened. The Great Hall is through them.');
    if (!d.banned && st.books >= 1 && (S.room.doors || {}).hall && doOp({ t: 'unlock', door: 'banned' }) === true) said.push('You finished a whole book. The Banned Books gallery, off the east side of the Great Hall, is open.');
    if (said.length) toast(said.join(' '), 7000);
  }
  function onReaderClosed() {
    if (S.mode !== 'reader') return;
    S.mode = S.ready && !$('#title').classList.contains('gone') ? 'title' : 'play';
    relayout();
    setTimeout(() => { checkDoors(); checkMalcolm(); }, 400);
    barKey = '';
    if (S.mode === 'play') cvs.focus({ preventScroll: true });
  }

  /* ---------------- views ---------------- */
  function toggleView() {
    S.view = S.view === 'first' ? 'third' : 'first';
    $('#bView').setAttribute('aria-pressed', S.view === 'third' ? 'true' : 'false');
    relayout(); savePos();
    toast(S.view === 'third' ? 'Third person — you can see yourself.' : 'First person.', 1400);
  }

  /* ---------------- arrange mode ---------------- */
  const ARR = { carry: null, hover: null };
  function toggleArrange(on) {
    if (on === undefined) on = S.mode !== 'arrange';
    if (on && S.mode !== 'play') return;
    if (!on && ARR.carry) cancelCarry();
    if (on && P.seat) standUp(true);
    S.mode = on ? 'arrange' : 'play';
    document.body.classList.toggle('arranging', on);
    $('#arrBanner').hidden = !on;
    $('#bArr').setAttribute('aria-pressed', on ? 'true' : 'false');
    W.highlight(null); barKey = '';
    if (on) toast(touch ? 'Tap a piece to pick it up, then tap where it goes.' : 'Click a piece to pick it up · Q / E or the wheel to turn it · click to set it down · Delete puts it away.', 4200);
    paintArrangeBar(true);
  }
  function arrangePick(force) {
    if (ARR.carry) return;
    const hit = W.pick(ray, 'arrange', 16);
    const id = hit && hit.kind === 'furn' ? hit.id : null;
    ARR.hover = id;
    W.highlight(id ? W.furnInfo(id).obj : null);
    paintArrangeBar(force);
  }
  function arrangeClick() {
    if (ARR.carry) { placeCarry(); return; }
    if (ARR.hover) pickUp(ARR.hover);
  }
  function pickUp(id) {
    const f = S.room.furniture.find(x => x.id === id); if (!f) return;
    ARR.carry = { id, f: Object.assign({}, f), orig: { x: f.x, z: f.z, r: f.r || 0 }, isNew: false };
    sound('lift'); paintArrangeBar(true);
  }
  function spawnNew(type) {
    if (S.mode !== 'arrange') toggleArrange(true);
    if (ARR.carry) cancelCarry();
    const v = W.CATALOG[type].variants ? Math.floor(Math.random() * W.CATALOG[type].variants) : 0;
    const f = { id: '_carry', type, x: P.x - Math.sin(P.yaw) * 2.4, z: P.z - Math.cos(P.yaw) * 2.4, r: P.yaw + Math.PI, v };
    W.spawn(f);
    ARR.carry = { id: '_carry', f, orig: null, isNew: true };
    paintArrangeBar(true);
  }
  function rotateCarry(dir) {
    if (!ARR.carry) { if (ARR.hover) { pickUp(ARR.hover); } else return; }
    ARR.carry.f.r = (ARR.carry.f.r || 0) + dir * Math.PI / 12;
  }
  const floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const _fp = new T.Vector3();
  function updateCarry() {
    const c = ARR.carry; if (!c) return;
    if (touch) { W.place(c.f); c.ok = placementOK(c.f, c.id); W.highlight(W.furnInfo(c.id).obj, !c.ok); return; }
    const x = touch ? innerWidth / 2 : (mouse.in ? mouse.x : innerWidth / 2), y = touch ? innerHeight * 0.62 : (mouse.in ? mouse.y : innerHeight / 2);
    aimFrom(x, y);
    if (ray.ray.intersectPlane(floorPlane, _fp)) {
      let dx = _fp.x - P.x, dz = _fp.z - P.z; const d = Math.hypot(dx, dz);
      const def = W.CATALOG[c.f.type], minD = Math.max(def.w, def.d) / 2 + 0.6, maxD = 7;
      if (d < minD) { const k = minD / (d || 1); dx *= k; dz *= k; } else if (d > maxD) { const k = maxD / d; dx *= k; dz *= k; }
      c.f.x = P.x + dx; c.f.z = P.z + dz;
    }
    W.place(c.f);
    c.ok = placementOK(c.f, c.id);
    W.highlight(W.furnInfo(c.id).obj, !c.ok);
  }
  function placeCarry() {
    const c = ARR.carry; if (!c) return;
    if (!c.ok) { toast('Not enough room there.'); sound('bump'); return; }
    const f = { x: +c.f.x.toFixed(2), z: +c.f.z.toFixed(2), r: +(((c.f.r || 0) % TAU + TAU) % TAU).toFixed(3) };
    if (c.isNew) { W.despawn('_carry'); ARR.carry = null; doOp(Object.assign({ t: 'fadd', type: c.f.type, v: c.f.v }, f)); }
    else { ARR.carry = null; doOp(Object.assign({ t: 'fmove', f: c.id }, f)); }
    sound('set'); paintArrangeBar(true);
  }
  function cancelCarry() {
    const c = ARR.carry; if (!c) return;
    ARR.carry = null;
    if (c.isNew) W.despawn('_carry');
    else { const f = S.room.furniture.find(x => x.id === c.id); if (f) W.place(f); }
    W.highlight(null); paintArrangeBar(true);
  }
  function putAway() {
    const id = ARR.carry ? ARR.carry.id : ARR.hover; if (!id) return;
    if (ARR.carry && ARR.carry.isNew) { cancelCarry(); return; }
    if (ARR.carry) cancelCarry();
    const res = doOp({ t: 'fdel', f: id });
    if (res === true) { ARR.hover = null; W.highlight(null); toast('Put away.', 1200); }
    paintArrangeBar(true);
  }
  function paintArrangeBar(force) {
    if (S.mode !== 'arrange') { barKey = ''; return; }
    const k = 'arr|' + (ARR.carry ? 'c' + ARR.carry.id : 'h' + (ARR.hover || ''));
    if (!force && k === barKey) return;
    const box = $('#acts'); box.innerHTML = '';
    const add = (label, key, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'act' + (primary ? ' primary' : ''); b.innerHTML = (key ? `<kbd>${key}</kbd>` : '') + esc(label); b.onclick = (e) => { e.stopPropagation(); fn(); }; box.appendChild(b); };
    const c = ARR.carry;
    if (c) {
      $('#prompt').innerHTML = `Carrying the <i>${esc(W.CATALOG[c.f.type].name.toLowerCase())}</i>`;
      add('Set it down', touch ? '' : 'Click', placeCarry, true); add('Turn', 'Q', () => rotateCarry(-1)); add('Turn', 'E', () => rotateCarry(1));
      add(c.isNew ? 'Never mind' : 'Put it back', 'Esc', cancelCarry);
      if (!c.isNew) add('Put away', 'Del', putAway);
    } else {
      const f = ARR.hover && W.furnInfo(ARR.hover);
      $('#prompt').innerHTML = f ? `The <i>${esc(f.def.name.toLowerCase())}</i>` : (touch ? 'Tap a piece of furniture to move it' : 'Point at a piece of furniture to move it');
      if (f) { add('Move', touch ? '' : 'Click', () => pickUp(ARR.hover), true); add('Put away', 'Del', putAway); }
      add('Done', 'Tab', () => toggleArrange(false));
    }
    barKey = k;
  }
  function buildPalette() {
    const box = $('#arrange');
    const list = [['armchair', 'Armchair'], ['sofa', 'Sofa'], ['chair', 'Chair'], ['ottoman', 'Footstool'], ['table', 'Reading table'], ['desk', 'Desk'], ['roundtable', 'Side table'], ['coffeetable', 'Low table'], ['bookcase', 'Bookcase'], ['lamp', 'Floor lamp'], ['rug', 'Rug'], ['plant', 'Plant'], ['globe', 'Globe']];
    list.forEach(([type, label]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = '+ ' + label; b.onclick = () => spawnNew(type); box.appendChild(b); });
  }

  /* ---------------- movement and camera ---------------- */
  const _fwd = new T.Vector3();
  function moveInput() {
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    if (stick) { fx += stick.dx; fz -= stick.dy; }
    const m = Math.hypot(fx, fz);
    if (m > 1) { fx /= m; fz /= m; }
    return { fx, fz, run: keys.has('ShiftLeft') || keys.has('ShiftRight') || (stick && Math.hypot(stick.dx, stick.dy) > 0.95) };
  }
  function step(dt) {
    const inp = (S.mode === 'play' || S.mode === 'arrange') ? moveInput() : { fx: 0, fz: 0 };
    let wantX = 0, wantZ = 0;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    if (inp.fx || inp.fz) {
      if (P.seat) standUp();
      P.walkTo = null;
      const sp = inp.run ? 3.6 : 2.0;
      wantX = (-sy * inp.fz + cy * inp.fx) * sp; wantZ = (-cy * inp.fz - sy * inp.fx) * sp;
    } else if (P.walkTo && !P.seat) {
      const w = P.walkTo; w.t += dt;
      if (!w.via) w.via = W.route(P.x, P.z, w.x, w.z);             // doorways on the way, if it's in another hall
      const tgt = w.via.length ? w.via[0] : w;
      const dx = tgt.x - P.x, dz = tgt.z - P.z, d = Math.hypot(dx, dz);
      if (w.via.length && d < 0.45) { w.via.shift(); w.t = 0; }
      else if (!w.via.length && d <= w.reach) { P.walkTo = null; if (w.then) w.then(); }
      else {
        const sp = Math.min(2.4, 1 + d);
        let ux = dx / d, uz = dz / d;
        if (w.detour && w.detour.t > 0) { w.detour.t -= dt; const sx = -uz * w.detour.side, sz = ux * w.detour.side; ux = sx * 0.85 + ux * 0.3; uz = sz * 0.85 + uz * 0.3; const m = Math.hypot(ux, uz); ux /= m; uz /= m; }
        wantX = ux * sp; wantZ = uz * sp;
        // turn to face where we're going (first person turns gently)
        const want = Math.atan2(-dx, -dz);
        let da = ((want - P.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
        P.yaw += da * Math.min(1, dt * 3);
        if (w.t > 25) P.walkTo = null;
      }
    }
    const k = Math.min(1, dt * 10);
    P.vx += (wantX - P.vx) * k; P.vz += (wantZ - P.vz) * k;
    if (!P.seat) {
      const ox = P.x, oz = P.z;
      const p = collide(P.x + P.vx * dt, P.z + P.vz * dt, 0.28);
      P.x = p.x; P.z = p.z;
      const moved = Math.hypot(P.x - ox, P.z - oz) / Math.max(dt, 1e-4);
      P.speed = moved;
      if (P.walkTo) {
        if (moved < 0.15) P.stuck += dt; else P.stuck = 0;
        if (P.stuck > 0.5) {
          const w = P.walkTo; P.stuck = 0;
          if (w.then && Math.hypot(w.x - P.x, w.z - P.z) < REACH + 0.4) { P.walkTo = null; w.then(); }
          else if ((w.tries = (w.tries || 0) + 1) <= 5) w.detour = { t: 0.6 + w.tries * 0.15, side: w.tries % 2 ? 1 : -1 };
          else { P.walkTo = null; toast('Something is in the way. Walk a little closer and try again.'); }
        }
      }
      if (moved > 0.3) { P.bob += dt * moved * 2.4; stepSound(moved); }
    } else { P.vx = P.vz = 0; P.speed = 0; }
    P.eyeNow += (P.eye - P.eyeNow) * Math.min(1, dt * 6);
  }
  function updateCamera(dt, t) {
    if (S.mode === 'title') {
      const a = t * 0.045;
      camera.position.set(Math.sin(a) * 3.2, 2.1 + Math.sin(t * 0.13) * 0.2, 1.4 + Math.cos(a) * 1.6);
      camera.lookAt(Math.sin(a * 0.7) * 1.5, 1.4, -6);
      return;
    }
    updateZoom(dt);
    const bob = P.seat ? 0 : Math.sin(P.bob * 2) * 0.025 * Math.min(1, P.speed / 2) / Z.level;
    if (S.view === 'first' || Z.blend >= 1) {
      camera.position.set(P.x, P.eyeNow + bob, P.z);
      camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    } else {
      const head = (myAv ? myAv.height : 1.75) * (P.seat ? 0.62 : 0.92);
      const dist = 2.7, cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
      let cx = P.x + Math.sin(P.yaw) * dist * cp, cz = P.z + Math.cos(P.yaw) * dist * cp, cy = head - sp * dist + 0.35;
      ({ x: cx, y: cy, z: cz } = W.clampCam(cx, cy, cz));
      camera.position.set(cx, cy, cz);
      camera.lookAt(P.x, head + 0.1, P.z);
      if (Z.blend > 0) {                                 // on the way in: glide from over the shoulder to the eyes
        const s = Z.blend * Z.blend * (3 - 2 * Z.blend);
        _q3.copy(camera.quaternion);
        _q1.setFromEuler(_e1.set(P.pitch, P.yaw, 0, 'YXZ'));
        camera.position.lerp(_v3.set(P.x, P.eyeNow, P.z), s);
        camera.quaternion.slerpQuaternions(_q3, _q1, s);
      }
    }
  }
  const _v3 = new T.Vector3();
  function updateMyAvatar(dt) {
    if (!myAv) return;
    myAv.root.visible = S.view === 'third' && S.mode !== 'title' && Z.blend < 0.55;
    myAv.root.position.set(P.x, P.seat ? 0 : 0, P.z);
    if (P.seat) { myAv.root.position.set(P.seat.x, 0, P.seat.z); myAv.root.rotation.y = P.seat.ry; }
    else if (P.speed > 0.2) { const want = Math.atan2(P.vx, P.vz); let da = ((want - myAv.root.rotation.y + Math.PI) % TAU + TAU) % TAU - Math.PI; myAv.root.rotation.y += da * Math.min(1, dt * 10); }
    else if (S.view === 'first') myAv.root.rotation.y = P.yaw + Math.PI;
    myAv.setState({ speed: P.speed, sit: !!P.seat, read: S.mode === 'reader' && !!S.room.hands[S.pid], listen: listens() });
    myAv.update(dt);
  }

  /* ---------------- other readers (shared rooms) ---------------- */
  const tagsEl = $('#tags');
  function upsertOther(pid, d) {
    let o = S.others.get(pid);
    if (!o) {
      const av = AV.build(d.avatar || 'douglass');
      scene.add(av.root);
      const tag = document.createElement('div'); tag.className = 'tag'; tag.innerHTML = '<span class="say" hidden></span><span class="nm"></span><span class="rd"></span>'; tagsEl.appendChild(tag);
      o = { pid, av, tag, x: d.x || 0, z: d.z || 0, yaw: d.yaw || 0, name: d.name || 'Reader', sayT: 0 };
      S.others.set(pid, o);
      if (o.avatarId !== d.avatar) o.avatarId = d.avatar;
      relayout();
    }
    if (d.avatar && d.avatar !== o.avatarId && o.avatarId) {   // changed who they read as
      scene.remove(o.av.root); o.av = AV.build(d.avatar); scene.add(o.av.root); o.avatarId = d.avatar; relayout();
    }
    o.avatarId = d.avatar || o.avatarId;
    Object.assign(o, { tx: d.x, tz: d.z, tyaw: d.yaw, seat: d.seat || null, sitRY: d.sry, reading: d.reading || null, name: d.name || o.name, speed: d.speed || 0, view: d.view });
    const nmEl = o.tag.querySelector('.nm'); if (nmEl.textContent !== o.name) nmEl.textContent = o.name;
    const rb = o.reading && S.byId.get(o.reading);
    const lis = !!((AV.LIST.find(p => p.id === o.avatarId) || {}).listens);
    const rd = rb ? (lis ? 'listening to ' : 'reading ') + rb.short : '', rdEl = o.tag.querySelector('.rd'); if (rdEl.textContent !== rd) rdEl.textContent = rd;
    o.listens = lis;
  }
  function removeOther(pid) {
    const o = S.others.get(pid); if (!o) return;
    scene.remove(o.av.root); o.tag.remove(); S.others.delete(pid);
    relayout();
  }
  const _tv = new T.Vector3();
  function updateOthers(dt) {
    for (const o of S.others.values()) {
      if (o.tx == null) continue;
      const k = Math.min(1, dt * 8);
      o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
      let da = ((o.tyaw - o.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI; o.yaw += da * k;
      o.av.root.position.set(o.x, 0, o.z);
      o.av.root.rotation.y = o.seat && o.sitRY != null ? o.sitRY : o.yaw;
      o.av.setState({ speed: o.speed, sit: !!o.seat, read: !!o.reading, listen: !!o.listens });
      o.av.update(dt);
      // the name tag over their head
      _tv.set(o.x, (o.seat ? o.av.height * 0.68 : o.av.height) + 0.28, o.z).project(camera);
      const vis = _tv.z < 1 && Math.abs(_tv.x) < 1.2 && Math.abs(_tv.y) < 1.2;
      o.tag.style.display = vis ? '' : 'none';
      if (vis) o.tag.style.transform = `translate(${(_tv.x * 0.5 + 0.5) * innerWidth}px, ${(-_tv.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`;
      if (o.sayT > 0) { o.sayT -= dt; if (o.sayT <= 0) o.tag.querySelector('.say').hidden = true; }
    }
  }
  function myPresence() {
    return {
      pid: S.pid, name: S.me.name, avatar: S.me.avatar, x: +P.x.toFixed(2), z: +P.z.toFixed(2),
      yaw: +(myAv ? myAv.root.rotation.y : P.yaw).toFixed(2), speed: +P.speed.toFixed(2),
      seat: P.seat ? P.seat.key : null, sry: P.seat ? P.seat.ry : null,
      reading: S.mode === 'reader' ? RD.currentId() : null
    };
  }
  function chatLine(name, text, sys) {
    const log = $('#chatlog'); const d = document.createElement('div');
    if (sys) { d.className = 'sys'; d.textContent = text; } else d.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}`;
    log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
  }
  $('#chatin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = e.target.value.trim(); e.target.value = '';
      if (v && S.shared) { NET.chat(v); chatLine(S.me.name, v); }
      e.target.blur(); cvs.focus({ preventScroll: true });
    } else if (e.key === 'Escape') { e.target.blur(); cvs.focus({ preventScroll: true }); }
    e.stopPropagation();
  });

  /* ---------------- shared rooms: the app side of net.js ---------------- */
  function shareLabel(t) { const l = $('#ndShareL'); if (l && l.lastChild && l.lastChild.nodeType === 3) l.lastChild.textContent = t; }
  const app = {
    snapshot: () => JSON.parse(JSON.stringify(S.room)),
    presence: myPresence,
    me: () => ({ pid: S.pid, name: S.me.name, avatar: S.me.avatar }),
    started(isHost, code, commons) {
      S.shared = true; S.isHost = isHost; S.commons = !!commons;
      document.body.classList.add('shared');
      shareLabel(commons ? ' Share with everyone in this library (kept for those who come later)' : ' Share with the room');
      $('#bInvL').textContent = commons ? 'Together' : isHost ? 'Room open' : 'In a room';
      if (isHost) chatLine('', 'Your room is open. Share the link and friends walk in.', true);
    },
    // the shared library: who holds the pen changes as readers come and go
    role(isHost) { S.isHost = isHost; if (S.sheet === 'invite') paintInvite(); },
    freshRoom: () => defaultRoom(),
    // the saved library moved on without us (we missed a change): catch up where we stand
    syncRoom(room) {
      const r = sanitizeRoom(room); if (!r) return;
      S.room = upgradeRoom(r); syncFurniture(); relayout();
    },
    // a guest receives the host's room: put yours aside, step into theirs
    enterRoom(room, hostPid) {
      if (!S.ownRoom) {
        if (S.room.hands[S.pid]) { const keep = JSON.parse(JSON.stringify(S.room)); S.ownRoom = keep; } else S.ownRoom = JSON.parse(JSON.stringify(S.room));
        S.ownPos = { x: P.x, z: P.z, yaw: P.yaw };
      }
      if (P.seat) standUp(true);
      S.room = sanitizeRoom(room) || S.room;
      if (S.commons) upgradeRoom(S.room);            // the same on every page, so everyone's copy stays the same
      syncFurniture(); relayout();
      // arrive at the door of their room
      const p = collide(S.commons ? (Math.random() - 0.5) * 1.6 : 0, 6.6, 0.28); P.x = p.x; P.z = p.z; P.yaw = 0;
      chatLine('', S.commons ? 'You walk into the shared library. Everyone who opens this page walks in here with you, and the library stays as you all leave it.' : 'You walk into the room.', true);
    },
    remoteOp(op) { const res = applyOp(S.room, op); if (res === true) { if (op.t === 'fadd' || op.t === 'fdel' || op.t === 'fmove') syncFurniture(); relayout(); sound(op.t, op.who !== S.pid); if (op.who === S.pid) afterMyOp(op); } else if (op.who === S.pid) toast(res); return res; },
    hostOp(op) { return runOp(op); },
    rejected(reason) { toast(reason); },
    peer(pid, data) { if (pid !== S.pid) upsertOther(pid, data); },
    peerLeft(pid, name) { removeOther(pid); chatLine('', (name || 'A reader') + ' left.', true); if (S.sheet === 'invite') paintInvite(); },
    peerJoined(pid, name, here) { chatLine('', (name || 'A reader') + (here ? ' is here.' : ' walked in.'), true); if (!here) sound('door'); setTimeout(() => { if (S.sheet === 'invite') paintInvite(); }, 300); },
    chat(pid, name, text) {
      chatLine(name, text);
      const o = S.others.get(pid); if (o) { const say = o.tag.querySelector('.say'); say.textContent = text; say.hidden = false; o.sayT = 7; }
    },
    note(pid, name, book, note, quiet) {
      if (!S.byId.has(book)) return;
      const was = RD.addShared(book, Object.assign({}, note, { by: name, pid }));
      if (was && !quiet) { const b = S.byId.get(book); chatLine('', `${name} ${was === 'new' ? 'left a note in' : 'changed a note in'} ${b.short}.`, true); }
    },
    noteGone(book, id) { RD.removeShared(book, id); },
    status(msg) { paintInvite(msg); },
    ended(reason) {
      const wasGuest = S.shared && (!S.isHost || S.commons), wasHost = S.shared && S.isHost && !S.commons;
      S.shared = false; S.isHost = false; S.commons = false;
      shareLabel(' Share with the room');
      document.body.classList.remove('shared');
      $('#bInvL').textContent = 'Invite';
      for (const pid of [...S.others.keys()]) removeOther(pid);
      if (wasGuest && S.ownRoom) {
        S.room = S.ownRoom; S.ownRoom = null;
        if (P.seat) standUp(true);
        syncFurniture(); relayout();
        if (S.ownPos) { P.x = S.ownPos.x; P.z = S.ownPos.z; P.yaw = S.ownPos.yaw; }
      } else if (wasHost) {
        // the host's own room: return books that friends were holding
        for (const pid in S.room.hands) if (pid !== S.pid) applyOp(S.room, { t: 'drop', who: pid });
        relayout(); saveRoomSoon();
      }
      if (reason) toast(reason, 3200);
      paintInvite();
    }
  };

  /* ---------------- invite sheet ---------------- */
  function paintInvite(msg) {
    const b = $('#invBody'); if (!b) return;
    const st = NET ? NET.state() : { active: false };
    if (st.commons && st.active) {
      const people = [`<li><i style="background:var(--gold)"></i>${esc(S.me.name)} (you)</li>`]
        .concat([...S.others.values()].map(o => `<li><i style="background:#8fb8ff"></i>${esc(o.name)}${o.reading && S.byId.get(o.reading) ? ' — reading <i>' + esc(S.byId.get(o.reading).short) + '</i>' : ''}</li>`));
      const here = location.href.split(/[?#]/)[0];
      b.innerHTML = `<p class="muted">You're in the shared library. Everyone who opens this page walks into the same library, with up to six readers at once, and whatever you move stays moved after you all leave.</p>
        ${st.where === 'relays' ? `<p class="muted">Send anyone this link; whoever opens it walks in:</p>
        <div class="inv-link"><input id="invUrl" readonly value="${esc(here)}"><button class="sbtn solid" id="copyInv" type="button">${navigator.share ? 'Share' : 'Copy'}</button></div>
        <p class="muted">The library is kept on open public relays: what you leave here, notes included, anyone can read.</p>`
          : `<p class="muted">To bring someone in, share this page with them from the Share menu (they need to be allowed to interact with it to move books).</p>`}
        <ul class="people">${people.join('')}</ul>
        <button class="sbtn" id="leaveRoom" type="button">Read alone in my own room</button>
        ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}`;
      $('#leaveRoom').onclick = () => { NET.leave(); };
      const cp = $('#copyInv');
      if (cp) cp.onclick = async () => {
        try { if (navigator.share) await navigator.share({ title: 'The Reading Room', text: 'Come read with me', url: here }); else { await navigator.clipboard.writeText(here); toast('Link copied.'); } }
        catch (e) { const i = $('#invUrl'); i.select(); try { document.execCommand('copy'); toast('Link copied.'); } catch (err) {} }
      };
      return;
    }
    if (!st.active && !st.connecting && S.canCommons) {
      b.innerHTML = `<p class="muted">You're reading alone in your own room. The shared library is where everyone who opens this page meets.</p>
        <button class="big" id="openRoom" type="button" style="margin-top:6px">Walk into the shared library</button>
        ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}`;
      $('#openRoom').onclick = () => { NET.commons(); paintInvite('Walking in…'); };
      return;
    }
    if (!st.active && !st.connecting) {
      b.innerHTML = `<p class="muted">Open your room to friends. You'll get a link; whoever opens it walks into this room as their reader, sees what you're reading and can sit and read beside you. Books and furniture they move stay moved — it's your room.</p>
        <p class="muted">Rooms connect browser to browser. Only a short room code goes through a public matchmaking server (PeerJS); the room itself never does.</p>
        <button class="big" id="openRoom" type="button" style="margin-top:6px">Open my room</button>
        ${msg ? `<p class="muted" style="color:var(--red)">${esc(msg)}</p>` : ''}`;
      $('#openRoom').onclick = () => { NET.host(); paintInvite('Opening…'); };
      return;
    }
    if (st.connecting) { b.innerHTML = `<p class="muted">${esc(msg || 'Connecting…')}</p><button class="sbtn" id="leaveRoom" type="button">Cancel</button>`; $('#leaveRoom').onclick = () => NET.leave(); return; }
    const link = st.isHost ? NET.link() : '';
    const people = [`<li><i style="background:var(--gold)"></i>${esc(S.me.name)} (you${st.isHost ? ', host' : ''})</li>`]
      .concat([...S.others.values()].map(o => `<li><i style="background:#8fb8ff"></i>${esc(o.name)}${o.reading && S.byId.get(o.reading) ? ' — reading <i>' + esc(S.byId.get(o.reading).short) + '</i>' : ''}</li>`));
    b.innerHTML = (st.isHost ? `<p class="muted">Your room is open. Send this link:</p>
      <div class="inv-link"><input id="invUrl" readonly value="${esc(link)}"><button class="sbtn solid" id="copyInv" type="button">${navigator.share ? 'Share' : 'Copy'}</button></div>
      <p class="muted">Room code <b style="color:var(--gold2);letter-spacing:.12em">${esc(st.code)}</b> · keep this tab open while friends visit.</p>` :
      `<p class="muted">You're visiting a friend's room. Your own room is safe and waits for you.</p>`) +
      `<ul class="people">${people.join('')}</ul>
      <button class="sbtn" id="leaveRoom" type="button">${st.isHost ? 'Close my room' : 'Leave and go home'}</button>
      ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}`;
    const cp = $('#copyInv');
    if (cp) cp.onclick = async () => {
      try { if (navigator.share) await navigator.share({ title: 'The Reading Room', text: 'Come read with me', url: link }); else { await navigator.clipboard.writeText(link); toast('Link copied.'); } }
      catch (e) { const i = $('#invUrl'); i.select(); try { document.execCommand('copy'); toast('Link copied.'); } catch (err) {} }
    };
    $('#leaveRoom').onclick = () => { NET.leave(); };
  }

  /* ---------------- card catalog ---------------- */
  function whereIs(id) {
    const l = locate(S.room, id);
    if (!l) return 'Not on the shelves';
    if (l.k === 'hand') { if (l.p === S.pid) return 'In your hands'; const o = S.others.get(l.p); return 'With ' + (o ? o.name : 'a friend'); }
    if (l.k === 'pile') { const info = W.furnInfo(l.f); return 'On a pile — ' + (info ? info.def.name.toLowerCase() : 'a table'); }
    const [unit, r] = l.row.split('.');
    const n = (+r) + 1, ord = ['', 'bottom shelf', 'second shelf', 'third shelf', 'fourth shelf', 'fifth shelf', 'top shelf'][n] || ('shelf ' + n);
    if (unit[0] === 'f') return 'Freestanding bookcase, ' + ord;
    if (unit[0] === 'H') return 'The Great Hall, ' + ord;
    const wall = { N: 'North wall, by the fireplace', S: 'South wall, by the doors', E: 'East wall' }[unit[0]] || 'Bookcase';
    const hi = r === '3' || r === '4';
    const sc = W.SECTIONS.find(x => x.units.includes(unit) && (x.key === 'narr' ? !hi : x.key === 'wpa' ? hi : true));
    return (sc ? sc.name + ' · ' : '') + wall + ', ' + ord;
  }
  function openCatalog() {
    if (S.mode === 'arrange') toggleArrange(false);
    paintCatalog();
    openSheet('catalog');
  }
  let catSec = 'all';
  const secInfo = (b) => (W && W.SEC && W.SEC[b.sec]) || null;
  const goldBook = (b) => { const sc = secInfo(b); return !sc || !!sc.gold; };
  const isStart = (b) => !b.sec || b.sec === 'narr' || b.sec === 'wpa';
  const isSacred = (b) => b.sec === 'sacred';
  function paintCatalog() {
    const q = ($('#q').value || '').trim().toLowerCase();
    const list = $('#catList'); list.innerHTML = '';
    const nGold = S.books.filter(goldBook).length, nSacred = S.books.filter(isSacred).length;
    const tabs = [['all', 'Everything', S.books.length], ['start', 'Start here: the narratives', S.books.filter(isStart).length], ['gold', 'The Black canon', nGold],
      ['sacred', 'Scripture & spirit', nSacred], ['great', 'The great books', S.books.length - nGold - nSacred]];
    const tb = $('#catTabs'); tb.innerHTML = '';
    tabs.forEach(([k, label, n]) => {
      if (!n && k !== 'all') return;
      const t = document.createElement('button'); t.type = 'button'; t.className = 'ctab'; t.setAttribute('aria-pressed', catSec === k ? 'true' : 'false');
      t.innerHTML = `${esc(label)} <small>${n}</small>`; t.onclick = () => { catSec = k; paintCatalog(); }; tb.appendChild(t);
    });
    let n = 0, lastSec = '';
    S.books.forEach(b => {
      if (catSec === 'start' && !isStart(b)) return;
      if (catSec === 'gold' && !goldBook(b)) return;
      if (catSec === 'sacred' && !isSacred(b)) return;
      if (catSec === 'great' && (goldBook(b) || isSacred(b))) return;
      if (q && !(b.title + ' ' + b.author + ' ' + (b.about || '') + ' ' + (b.with || '')).toLowerCase().includes(q)) return;
      n++;
      const sc = secInfo(b);
      if (sc && sc.key !== lastSec) {
        lastSec = sc.key;
        const h = document.createElement('h3'); h.className = 'csec' + (sc.gold ? ' gold' : '');
        h.innerHTML = `${esc(sc.name)} <span>${esc(sc.sub)}</span>`; list.appendChild(h);
      }
      const pr = RD.progress(b.id);
      const row = document.createElement('div'); row.className = 'bk';
      const col = S.gl && W.bookInfo(b.id) ? W.bookInfo(b.id).color : '#6d1f1a';
      row.innerHTML = `<span class="sp${goldBook(b) ? ' gilt' : ''}" style="background:${col}"></span>
        <div><div class="ti">${esc(b.title)}</div><div class="au">${esc(b.author)}${b.with ? ' <span style="color:var(--dim)">· with ' + esc(b.with) + '</span>' : ''} · ${b.year < 0 ? 'c. ' + -b.year + ' BC' : b.year < 1000 ? 'c. ' + b.year : b.year}</div>
        <div class="bl">${esc(b.blurb || '')}</div>
        <div class="wh">${S.gl ? esc(whereIs(b.id)) + ' · ' : ''}${pr ? (pr.done ? 'Finished' : Math.round(pr.pct) + '% read') : (Math.round((b.words || 0) / 1000) + 'k words')}${pr && pr.notes ? ' · ' + pr.notes + ' note' + (pr.notes > 1 ? 's' : '') : ''}</div>
        ${pr ? `<div class="pr"><i style="width:${Math.min(100, pr.pct)}%"></i></div>` : ''}</div>
        <div class="bt"><button class="sbtn solid" type="button" data-read>${pr && !pr.done ? 'Continue' : READ()}</button>${S.gl && S.mode !== 'title' ? '<button class="sbtn" type="button" data-find>Find it</button>' : ''}</div>`;
      row.querySelector('[data-read]').onclick = () => { closeSheets(); readNow(b.id); };
      const fb = row.querySelector('[data-find]'); if (fb) fb.onclick = () => { closeSheets(); findBook(b.id); };
      list.appendChild(row);
    });
    $('#catFoot').textContent = n ? `${S.books.length} books, all U.S. public domain. On the shelves, the gilt cloth spines along the east wall and the leather spines with dark labels on the north wall are these books; the plain old volumes are the room's own.` : 'Nothing matches that.';
  }
  $('#q').addEventListener('input', paintCatalog);
  function findBook(id) {
    const l = locate(S.room, id); if (!l) return;
    if (l.k === 'hand') { toast(whereIs(id) + '.'); return; }
    const m = W.bookMesh(id); if (!m) return;
    const wp = new T.Vector3(); m.getWorldPosition(wp);
    S.findId = id; S.findT = 10;
    if (P.seat) standUp(true);
    // walk to a spot in front of it, then face it
    const n = new T.Vector3(0, 0, 1).applyQuaternion(m.parent.getWorldQuaternion(new T.Quaternion()));
    const tx = wp.x + n.x * 1.1, tz = wp.z + n.z * 1.1;
    P.walkTo = { x: tx, z: tz, reach: 0.3, t: 0, then: () => { P.yaw = Math.atan2(-(wp.x - P.x), -(wp.z - P.z)); P.pitch = Math.atan2(wp.y - P.eye, Math.hypot(wp.x - P.x, wp.z - P.z)) * 0.9; } };
    toast(S.byId.get(id).short + ' — ' + whereIs(id) + '.', 3000);
  }

  /* ---------------- sound: a small procedural room ---------------- */
  let AC = null, master = null, fireG = null, muted = A && A.mute ? A.mute.get() : !!store.load('muted', false, true);
  function paintMute() {
    $('#bSnd').setAttribute('aria-pressed', muted ? 'true' : 'false');
    $('#sndIcon').setAttribute('d', muted ? 'M3 8h3l4-3v10l-4-3H3z M12.5 7.5l4 5 M16.5 7.5l-4 5' : 'M3 8h3l4-3v10l-4-3H3z M13 7a4 4 0 0 1 0 6');
    if (master) master.gain.value = muted ? 0 : 0.8;
  }
  function resumeAudio() {
    if (muted) return;
    try {
      if (!AC) {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
        // the fire: noise through a low band, with crackles
        const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
        let b = 0; for (let i = 0; i < len; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 3 + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0); }
        const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
        const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        fireG = AC.createGain(); fireG.gain.value = 0;
        src.connect(lp); lp.connect(fireG); fireG.connect(master); src.start();
      }
      if (AC.state === 'suspended') AC.resume();
    } catch (e) { AC = null; }
  }
  function blip(type) {
    if (!AC || muted) return;
    const t = AC.currentTime;
    const noise = (dur, f, q, vol, decay) => {
      const n = AC.createBufferSource(), len = Math.ceil(AC.sampleRate * dur), buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay || 2);
      n.buffer = buf; const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = AC.createGain(); g.gain.value = vol; n.connect(bp); bp.connect(g); g.connect(master); n.start(t);
    };
    const thump = (f, vol, dur) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur); };
    if (type === 'take' || type === 'swap') { noise(0.18, 2400, 0.8, 0.25, 3); thump(160, 0.15, 0.12); }
    else if (type === 'shelve' || type === 'pile') { thump(120, 0.3, 0.16); noise(0.08, 1800, 1, 0.15, 4); }
    else if (type === 'sit') { noise(0.35, 300, 0.6, 0.35, 1.5); thump(80, 0.2, 0.25); }
    else if (type === 'stand') noise(0.2, 400, 0.6, 0.15, 2);
    else if (type === 'step') { noise(0.06, 500 + Math.random() * 200, 1.2, 0.12, 5); }
    else if (type === 'lift' || type === 'set' || type === 'fmove' || type === 'fadd') { thump(90, 0.3, 0.2); noise(0.12, 600, 0.7, 0.2, 3); }
    else if (type === 'bump') thump(70, 0.2, 0.15);
    else if (type === 'door') { thump(60, 0.35, 0.4); noise(0.4, 900, 0.5, 0.1, 2); }
    else if (type === 'unlock') {                      // heavy doors swinging, and a bell
      thump(55, 0.4, 0.6); noise(1.2, 700, 0.4, 0.12, 1.2);
      [660, 990].forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + 0.3 + i * 0.25); g.gain.exponentialRampToValueAtTime(0.12, t + 0.32 + i * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2 + i * 0.25); o.connect(g); g.connect(master); o.start(t + 0.3 + i * 0.25); o.stop(t + 2.4 + i * 0.25); });
    }
    else if (type === 'page') { noise(0.24, 3200, 0.45, 0.16, 1.3); noise(0.1, 1200, 0.8, 0.06, 3); }
  }
  function sound(type, far) { if (!far) blip(type); }
  let stepAcc = 0;
  function stepSound(sp) { stepAcc += sp * 0.016; if (stepAcc > 0.62) { stepAcc = 0; blip('step'); } }
  function updateAudio() {
    if (!fireG || !AC) return;
    const d = Math.hypot(P.x - 0, P.z - (W.ROOM.z0 + 1));
    fireG.gain.setTargetAtTime(muted || S.mode === 'title' ? 0 : 0.5 / (1 + d * 0.35), AC.currentTime, 0.4);
  }
  $('#bSnd').onclick = () => {
    if (A && A.mute) muted = A.mute.toggle(); else { muted = !muted; store.save('muted', muted, true); }
    if (!muted) resumeAudio();
    paintMute(); toast(muted ? 'Sound off.' : 'Sound on.', 1200);
  };
  if (A && A.mute) A.mute.on((v) => { muted = v; paintMute(); });
  RD && RD.setSound && RD.setSound((t) => blip(t));

  /* ---------------- title screen ---------------- */
  function buildWho() {
    const box = $('#who');
    if (S.me.avatar === 'malcolm' && !malcolmOpen()) S.me.avatar = 'douglass';
    if (!AV.LIST.some(p => p.id === S.me.avatar)) S.me.avatar = AV.LIST[0].id;
    // the tiles are in index.html, so the faces show before any script runs; here each gets its state, in AV.LIST's order
    const have = new Map([...box.querySelectorAll('.who[data-id]')].map(b => [b.dataset.id, b]));
    have.forEach((b, id) => { if (!AV.LIST.some(p => p.id === id)) b.remove(); });
    const pr = malcolmProgress();
    AV.LIST.forEach(p => {
      let b = have.get(p.id);
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'who'; b.dataset.id = p.id; b.innerHTML = `<img alt="" src="portraits/${p.id}.webp"><span class="n"></span><span class="y"></span>`; }
      box.appendChild(b);
      // a hidden reader until you meet them: a dark figure, no name, and how far you are from meeting them
      const locked = p.id === 'malcolm' && !malcolmOpen();
      b.classList.toggle('locked', locked);
      b.setAttribute('aria-pressed', S.me.avatar === p.id ? 'true' : 'false');
      b.title = locked ? `Someone is waiting to be met. Take down ten books (${Math.min(pr.taken, 10)} so far) and read one to the end (${Math.min(pr.done, 1)} of 1).` : p.line;
      let q = b.querySelector('.q');
      if (locked && !q) { q = document.createElement('span'); q.className = 'q'; q.setAttribute('aria-hidden', 'true'); q.textContent = '?'; b.querySelector('img').after(q); }
      if (!locked && q) q.remove();
      b.querySelector('.n').textContent = locked ? 'Hidden' : p.name;
      b.querySelector('.y').textContent = locked ? `${Math.min(pr.taken, 10)}/10 books · ${Math.min(pr.done, 1)}/1 read` : p.years;
      b.onclick = () => {
        if (b.classList.contains('locked')) { toast('Someone is waiting to be met. Take down ten books and read one of them to the end.', 4200); return; }
        S.me.avatar = p.id; box.querySelectorAll('.who').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      };
      // a missing picture is drawn here instead, after the page is up
      const im = b.querySelector('img');
      const redraw = () => { if (S.gl) setTimeout(() => { try { im.src = AV.portrait(renderer, p.id); } catch (e) {} }, 50); };
      if (im.complete && im.naturalWidth === 0 && im.getAttribute('src')) redraw();
      else im.onerror = () => { im.onerror = null; redraw(); };
    });
  }
  function enter() {
    const nm = $('#nm').value.trim().slice(0, 14) || defaultName();
    S.me.name = nm;
    store.save('me', S.me);
    if (myAv) scene.remove(myAv.root);
    myAv = AV.build(S.me.avatar); scene.add(myAv.root);
    if (W.setLit) W.setLit(S.books.filter(b => b.sec === 'narr').map(b => b.id));   // the narratives glow where they stand
    paintOwn();
    $('#title').classList.add('gone');
    document.body.classList.add('playing');
    S.mode = 'play';
    resumeAudio();
    relayout();
    cvs.focus({ preventScroll: true });
    if (!store.load('seenHelp', false)) { store.save('seenHelp', true); setTimeout(() => toast((touch ? 'Left thumb to walk, drag to look, tap a book to take it down.' : 'WASD to walk, drag to look, click a book to take it down. Press ? for more.') + ' The golden wall on your right holds the narratives of those who lived through slavery: follow the gilt runner and begin at the lit shelves.', 8000), 600); }
    const code = QS.get('room');
    if (!code) setTimeout(checkDoors, 1800);           // reading you did before these doors existed counts too
    if (!code && NET) NET.detect().then(ok => { S.canCommons = ok; if (ok && S.mode !== 'title' && !NET.state().active) NET.commons().then(() => setTimeout(checkDoors, 2500)); });
    if (code && NET) { NET.join(code); openSheet('invite'); paintInvite('Joining ' + code + '…'); history.replaceState(null, '', location.pathname); }
  }
  function defaultName() {
    try { if (A && A.profile) return A.profile.active().initials; } catch (e) {}
    return 'Reader';
  }

  /* ---------------- boot ---------------- */
  const msg = (t) => { $('#loadmsg').textContent = t; };
  function makeRenderer() {
    try {
      const r = new T.WebGLRenderer({ canvas: cvs, alpha: true, antialias: !touch || devicePixelRatio < 2, powerPreference: 'high-performance' });
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.5 : 1.75));
      r.setSize(innerWidth, innerHeight, false);
      return r;
    } catch (e) { return null; }
  }
  function onResize() {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  }
  async function boot() {
    S.pid = store.load('pid', null) || ('r' + Math.random().toString(36).slice(2, 9));
    S.taken = new Set(Array.isArray(store.load('taken', [])) ? store.load('taken', []) : []);
    store.save('pid', S.pid);
    S.me = Object.assign({ avatar: 'douglass', name: '' }, store.load('me', {}));
    if (AV && AV.ALIAS && AV.ALIAS[S.me.avatar]) S.me.avatar = AV.ALIAS[S.me.avatar];   // saved 'tubman' -> 'wheatley', 'truth' -> 'bailey'
    $('#nm').value = S.me.name || defaultName();
    if (QS.get('room')) { const n = $('#invNote'); n.hidden = false; n.textContent = 'You’re invited to a friend’s reading room. Choose who you’ll be, then walk in.'; $('#go').textContent = 'Walk into their room'; }
    buildWho();                                          // the faces first: pictures, before any of the room is built
    msg('Opening the doors…');
    try {
      const res = await fetch('books/index.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      S.books = await res.json();
    } catch (e) { msg('The catalog could not be loaded. If you are offline, open the arcade once online first.'); return; }
    S.books.forEach(b => S.byId.set(b.id, b));
    RD.init({ store, books: S.books, onClose: onReaderClosed, award: (n) => { try { if (A && A.award) { const k = A.award(SLUG, 'read', n || 1); if (k && k.awarded) toast('+1 bead on your keyring for a chapter read.', 2200); } } catch (e) {} },
      onNote: (bookId, note) => { if (S.shared && note.shared) NET.note(bookId, note); },
      onNoteChange: (bookId, note, id) => { if (S.shared && NET) NET.noteChange(bookId, note, id); }, others: () => S.shared });
    buildWho();                                          // again, with your reading counted (how near you are to meeting Malcolm X)
    renderer = W ? makeRenderer() : null;
    S.gl = !!renderer;
    if (!S.gl) {
      $('#nogl').hidden = false; $('#go').hidden = true; $('#who').hidden = true; document.querySelector('.pick-h').hidden = true; $('#nm').parentNode.hidden = true;
      msg(''); S.ready = true; return;
    }
    msg('Setting out the books…');
    await new Promise(r => setTimeout(r, 30));
    camera = new T.PerspectiveCamera(touch ? 70 : 62, innerWidth / innerHeight, 0.03, 60);
    scene = W.init(renderer, S.books);
    scene.add(camera);
    fpHolder = new T.Group(); fpHolder.userData.hand = true;
    fpHolder.position.set(0.24, -0.25, -0.52); fpHolder.rotation.set(0.25, -1.2, 0.08);
    camera.add(fpHolder);
    if (CN) CN.init({ scene, camera, renderer, W, doOp, openSheet, closeSheets, toast, shared: () => S.shared, host: () => !S.shared || S.isHost });
    // your room
    S.room = sanitizeRoom(store.load('room', null)) || defaultRoom();
    syncFurniture();
    upgradeRoom(S.room);
    // a book held by an old player id (a shared visit that ended badly) goes back to a shelf
    for (const p in S.room.hands) if (p !== S.pid) applyOp(S.room, { t: 'drop', who: p });
    relayout();
    const pos = store.load('pos', null);
    if (pos && typeof pos.x === 'number') { const p = collide(pos.x, pos.z, 0.28); P.x = p.x; P.z = p.z; P.yaw = pos.yaw || 0; P.pitch = pos.pitch || 0; if (pos.view === 'third') { S.view = 'third'; $('#bView').setAttribute('aria-pressed', 'true'); } }
    buildPalette();
    addEventListener('resize', onResize);
    if (NET) {
      NET.init(app);
      NET.detect().then(ok => { S.canCommons = ok; document.body.classList.toggle('can-commons', ok); if (ok && !QS.get('room') && S.mode === 'title') $('#go').textContent = 'Walk into the shared library'; });
    }
    paintMute();
    S.ready = true;
    msg('');
    requestAnimationFrame(frame);
    // first-frame shader compile happens behind the title
  }

  /* ---------------- frame ---------------- */
  let last = performance.now(), clock = 0, posT = 0, netT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; clock += dt;
    if (S.mode === 'reader' && !S.shared) return;           // the book covers the room; let it rest
    step(dt);
    if (S.mode === 'arrange') { if (ARR.carry) updateCarry(); else if (!touch) { aimFrom(mouse.in ? mouse.x : innerWidth / 2, mouse.in ? mouse.y : innerHeight / 2); arrangePick(); } }
    if (fpHolder) fpHolder.visible = S.mode !== 'title';
    updateCamera(dt, clock);
    if (S.mode === 'play') updateTarget();
    updateMyAvatar(dt);
    updateOthers(dt);
    if (S.findT > 0) { S.findT -= dt; if (S.findT <= 0) S.findId = null; }
    W.tick(dt, clock, camera.position);
    updateAudio();
    posT += dt; if (posT > 3 && S.mode !== 'title') { posT = 0; savePos(); }
    netT += dt; if (S.shared && netT > 0.1) { netT = 0; NET.presence(myPresence()); }
    if (S.mode !== 'reader') renderer.render(scene, camera);
  }
  addEventListener('pagehide', () => { if (S.ready && S.room && S.mode !== 'title') { savePos(); if (!S.shared || (S.isHost && !S.commons)) store.save('room', S.room); } });

  /* ---------------- buttons ---------------- */
  $('#go').onclick = () => { if (S.ready && S.gl) enter(); };
  $('#nm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#go').click(); } e.stopPropagation(); });
  $('#justRead').onclick = () => { if (S.ready) openCatalog(); };
  $('#bCat').onclick = openCatalog;
  $('#bArr').onclick = () => toggleArrange();
  $('#bView').onclick = toggleView;
  $('#bZoom').onclick = () => zoomStep();
  $('#bInv').onclick = () => { paintInvite(); openSheet('invite'); };
  $('#bHelp').onclick = () => openSheet('help');

  // a small window for tests and the console: read-only views plus a couple of helpers
  window.RR = { S, P, store, sim: (n, dt) => { for (let i = 0; i < n; i++) step(dt || 0.05); updateCamera(0.016, clock); return { x: +P.x.toFixed(2), z: +P.z.toFixed(2), walking: !!P.walkTo }; }, tapAt: (x, y) => tapAt(x, y), screenOf: (id) => { const m = W.bookMesh(id); if (!m || !m.parent) return null; const v = new T.Vector3(); m.getWorldPosition(v); v.project(camera); return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth), y: Math.round((-v.y * 0.5 + 0.5) * innerHeight) }; }, pickAt: (x, y) => { const t = resolve(W.pick(aimFrom(x, y), 'play', 40)); return t && { kind: t.kind, id: t.id, row: t.row, f: t.f, s: t.s, dist: +(t.dist || 0).toFixed(2), acts: actsFor(t).map(a => a.label) }; }, applyOp, locate, defaultRoom, doOp, sit, standUp, readNow, toggleArrange, spawnNew, openCatalog, findBook, enter, checkDoors, unlock: (door) => doOp({ t: 'unlock', door }), stats: () => RD.stats(), W, Z, zoom: (v) => { zoomTo(v); Z.level = Z.target; updateCamera(0.016, clock); return Z.level; }, frameOnce: () => { updateCamera(0.016, clock); renderer.render(scene, camera); const i = renderer.info.render; return { calls: i.calls, tris: i.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }; } };
  boot();
})();
