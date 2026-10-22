/* THE READING ROOM — reader.js: the open book.

   One chapter at a time, laid out in CSS columns and turned a page (or a two-page spread on a wide
   screen) at a time. Your place is kept as chapter + the first paragraph on the page, so it survives
   a new type size or a turned phone. Notes in the margin hang on a paragraph and the words you chose;
   a shared room passes them to friends (they show in the margin with the friend's name).

   Saved per player (arcade.save via main.js's store):
     reading: { bookId: { ch, b, f (how far into block b the page starts, 0..1), pct, t, done, chDone: [chapter indexes] } }
     notes:   { bookId: [ { id, ch, b, quote, text, t, shared, by?, pid? } ] }   (by = a friend's note)
     readset (device-wide): { fs, theme, spread, others }
   API: init(cfg), open(meta, { listen }), close(), progress(id), startedMap(), currentId(), addShared(bookId, note), setSound(fn) */
'use strict';
const RR_READER = (() => {
  const $ = (s) => document.querySelector(s);
  let cfg = null, store = null, sound = () => {};
  const cache = new Map();
  let reading = {}, notes = {}, set = { fs: 19, theme: 'paper', spread: true, others: true };
  let cur = null;          // { meta, data, ch, page, pages, perView, words: [], total }
  let saveT = 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => esc(s).replace(/_([^_]+?)_/g, '<em>$1</em>');
  const plain = (blk) => typeof blk === 'string' ? blk : (blk.h || blk.v || blk.n || '');
  const words = (s) => (s.match(/\S+/g) || []).length;

  function init(c) {
    cfg = c; store = c.store;
    reading = store.load('reading', {}) || {};
    notes = store.load('notes', {}) || {};
    set = Object.assign(set, store.load('readset', {}, true) || {});
    wire();
  }
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { store.save('reading', reading); }, 300);
  }
  function saveNotes() { store.save('notes', notes); }
  function saveSet() { store.save('readset', set, true); }

  /* ---------------- open / close ---------------- */
  // listen: the reader never learned to read (Truth, Tubman), so the book starts reading itself aloud
  async function open(meta, opts) {
    const el = $('#reader');
    el.hidden = false;
    document.body.classList.add('reading');
    el.className = set.theme;
    $('#rTitle').textContent = meta.title;
    $('#rCh').textContent = meta.author + (meta.with ? ' · with ' + meta.with : '') + ' · ' + (meta.year < 0 ? 'c. ' + -meta.year + ' BC' : meta.year < 1000 ? 'c. ' + meta.year : meta.year);
    $('#rcols').innerHTML = '<p class="end">Opening the book…</p>';
    panels(null);
    cur = { meta, data: null, ch: 0, page: 0, pages: 1, perView: 1 };
    let data = cache.get(meta.id);
    if (!data) {
      try {
        const res = await fetch('books/' + meta.id + '.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        cache.set(meta.id, data);
      } catch (e) {
        if (cur && cur.meta === meta) $('#rcols').innerHTML = '<p class="end">This book could not be opened. If you are offline, open the arcade once while online so it can keep a copy.</p>';
        return;
      }
    }
    if (!cur || cur.meta !== meta) return;
    cur.data = data;
    cur.words = data.chapters.map(c => c.b.reduce((a, b) => a + words(plain(b)), 0));
    cur.total = cur.words.reduce((a, b) => a + b, 0) || 1;
    const r = reading[meta.id];
    const ch = r && r.ch < data.chapters.length ? r.ch : 0;
    show(ch, r && !r.done ? { block: r.b, frac: r.f } : { page: 0 });
    sound('page');
    if (opts && opts.listen) {
      if ('speechSynthesis' in window) setTimeout(() => { if (cur && cur.meta === meta && !speaking) toggleSpeak(); }, 350);
      else $('#rCh').textContent = 'This device cannot read aloud. Ask someone nearby to read it to you.';
    }
    if (!document.querySelector('#reader :focus')) $('#rNext').focus({ preventScroll: true });
  }
  function close() {
    stopSpeaking();
    if (cur && cur.data) remember();
    $('#reader').hidden = true;
    document.body.classList.remove('reading');
    selHide();
    $('#noted').hidden = true;
    cur = null;
    if (cfg && cfg.onClose) cfg.onClose();
  }

  /* ---------------- layout ---------------- */
  function geometry() {
    const view = $('#rview'), rb = $('#rbook');
    const w = view.clientWidth, h = view.clientHeight;
    const spread = set.spread && w >= 900;
    rb.classList.toggle('spread', spread);
    const padX = Math.round(Math.max(22, Math.min(64, w * (spread ? 0.045 : 0.07))));
    const padY = Math.round(Math.max(18, Math.min(48, h * 0.06)));
    const n = spread ? 2 : 1;
    const inner = w - padX * 2, gap = padX * 2;
    const colW = (inner - (n - 1) * gap) / n;
    return { w, h, padX, padY, n, inner, gap, colW };
  }
  function show(ch, at) {
    if (!cur || !cur.data) return;
    stopSpeaking(true);
    cur.ch = Math.max(0, Math.min(cur.data.chapters.length - 1, ch));
    const C = cur.data.chapters[cur.ch];
    const g = geometry();
    const cols = $('#rcols');
    cols.classList.add('snap');
    cols.style.cssText = `position:absolute;left:${g.padX}px;top:${g.padY}px;width:${g.inner}px;height:${g.h - g.padY * 2}px;column-width:${g.colW}px;column-gap:${g.gap}px;--fs:${set.fs}px;transform:translateX(0)`;
    cols.innerHTML = renderChapter(C, cur.ch);
    cur.perView = g.n; cur.step = g.inner + g.gap;
    // pages: how far the last block reaches
    const left0 = cols.getBoundingClientRect().left;
    let maxRight = 0;
    for (const el of cols.children) { const rc = el.getBoundingClientRect(); if (rc.width) maxRight = Math.max(maxRight, rc.right - left0); }
    cur.pages = Math.max(1, Math.ceil((maxRight + g.gap * 0.5) / cur.step));
    let page = 0;
    if (at && at.block != null) page = at.frac ? pageOfAnchor(at.block, at.frac) : pageOfBlock(at.block);
    else if (at && at.page === 'last') page = cur.pages - 1;
    else if (at && at.page) page = at.page;
    turnTo(page, true);
    $('#rCh').textContent = C.t;
    paintToc();
    requestAnimationFrame(() => cols.classList.remove('snap'));
  }
  function renderChapter(C, ci) {
    const mine = (notes[cur.meta.id] || []).filter(n => n.ch === ci && (set.others || !n.by));
    const byBlock = new Map();
    mine.forEach(n => { if (!byBlock.has(n.b)) byBlock.set(n.b, []); byBlock.get(n.b).push(n); });
    let out = `<h2>${fmt(C.t)}</h2>`;
    let firstP = true;
    C.b.forEach((blk, i) => {
      const ns = byBlock.get(i) || [];
      if (typeof blk === 'string') {
        let html = fmt(blk);
        ns.forEach(n => { if (n.quote) { const q = esc(n.quote); const k = html.indexOf(q); if (k >= 0) html = html.slice(0, k) + `<mark data-n="${n.id}">` + q + '</mark>' + html.slice(k + q.length); } });
        const cls = (firstP ? 'first' : '') + (ns.length ? ' annot' : '');
        out += `<p data-b="${i}"${cls.trim() ? ` class="${cls.trim()}"` : ''}>${html}</p>`;
        firstP = false;
      } else if (blk.h) out += `<h3 data-b="${i}">${fmt(blk.h)}</h3>`;
      else if (blk.v) out += `<div class="v" data-b="${i}">${fmt(blk.v)}</div>`;
      else if (blk.n) out += `<p class="fn" data-b="${i}">${fmt(blk.n)}</p>`;
      ns.forEach(n => { out += `<span class="note" data-n="${n.id}">${n.by ? `<small>${esc(n.by)}</small>` : ''}${esc(n.text)}</span>`; });
    });
    const last = ci === cur.data.chapters.length - 1;
    out += last
      ? `<div class="end">— The end —<br><button class="sbtn" type="button" data-end="close">Close the book</button></div>`
      : `<div class="end"><button class="sbtn" type="button" data-end="next">Next: ${esc(cur.data.chapters[ci + 1].t)} →</button></div>`;
    return out;
  }
  // positions are measured against the column box itself: it and its children move together, so this
  // holds mid-transition and whatever page is showing
  function pageOfBlock(b) {
    const cols = $('#rcols');
    const el = cols.querySelector(`[data-b="${b}"]`); if (!el) return 0;
    const x = el.getBoundingClientRect().left - cols.getBoundingClientRect().left;
    return Math.max(0, Math.min(cur.pages - 1, Math.floor((x + 4) / cur.step)));
  }
  function firstBlockOnPage() { return anchor().b; }
  // where the page starts: the first block that reaches it, and how far into that block (0..1, measured by the
  // height of its column fragments, which is how text flows) — a long paragraph split across pages keeps its place
  const frags = (el) => [...el.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  function anchor() {
    const cols = $('#rcols');
    const L = cols.getBoundingClientRect().left, x0 = cur.page * cur.step;
    for (const el of cols.querySelectorAll('[data-b]')) {
      const rs = frags(el); if (!rs.length || rs[rs.length - 1].right - L <= x0 + 4) continue;
      let tot = 0, before = 0;
      rs.forEach(r => { tot += r.height; if (r.right - L <= x0 + 4) before += r.height; });
      return { b: +el.dataset.b, f: tot ? +(before / tot).toFixed(3) : 0 };
    }
    return { b: 0, f: 0 };
  }
  function pageOfAnchor(b, f) {
    const cols = $('#rcols');
    const el = cols.querySelector(`[data-b="${b}"]`); if (!el) return 0;
    const L = cols.getBoundingClientRect().left, rs = frags(el);
    if (!rs.length) return pageOfBlock(b);
    const tot = rs.reduce((a, r) => a + r.height, 0);
    let acc = 0, pick = rs[0];
    for (const r of rs) { if (acc / tot >= (f || 0) - 0.002) { pick = r; break; } acc += r.height; pick = r; }
    return Math.max(0, Math.min(cur.pages - 1, Math.floor((pick.left - L + 4) / cur.step)));
  }
  function turnTo(page, instant) {
    cur.page = Math.max(0, Math.min(cur.pages - 1, page));
    const cols = $('#rcols');
    if (instant) cols.classList.add('snap');
    cols.style.transform = `translateX(${-cur.page * cur.step}px)`;
    if (instant) requestAnimationFrame(() => cols.classList.remove('snap'));
    paintFoot();
    remember();
  }
  function next() {
    if (!cur || !cur.data) return;
    if (cur.page < cur.pages - 1) { turnTo(cur.page + 1); sound('page'); return; }
    finishChapter(cur.ch);
    if (cur.ch < cur.data.chapters.length - 1) { show(cur.ch + 1, { page: 0 }); sound('page'); }
  }
  function prev() {
    if (!cur || !cur.data) return;
    if (cur.page > 0) { turnTo(cur.page - 1); sound('page'); return; }
    if (cur.ch > 0) { show(cur.ch - 1, { page: 'last' }); sound('page'); }
  }
  function finishChapter(ci) {
    const r = reading[cur.meta.id] = reading[cur.meta.id] || {};
    r.chDone = r.chDone || [];
    if (r.chDone.indexOf(ci) < 0) {
      r.chDone.push(ci);
      if (cur.words[ci] > 400 && cfg.award) cfg.award(1);
    }
    if (ci === cur.data.chapters.length - 1) r.done = true;
    saveSoon();
  }
  function remember() {
    if (!cur || !cur.data) return;
    const r = reading[cur.meta.id] = reading[cur.meta.id] || {};
    const a = anchor();
    r.ch = cur.ch; r.b = a.b; r.f = a.f; r.t = Date.now();
    const before = cur.words.slice(0, cur.ch).reduce((a, b) => a + b, 0);
    const frac = cur.pages > 1 ? cur.page / (cur.pages - 1) : 1;
    r.pct = Math.min(100, ((before + cur.words[cur.ch] * frac) / cur.total) * 100);
    if (cur.ch === cur.data.chapters.length - 1 && cur.page === cur.pages - 1) r.done = true;
    saveSoon();
  }
  function paintFoot() {
    const p = reading[cur.meta.id];
    $('#rPg').textContent = cur.pages > 1 ? `Page ${cur.page + 1} of ${cur.pages}` : '';
    const seek = $('#rSeek'); seek.max = Math.max(0, cur.pages - 1); seek.value = cur.page; seek.disabled = cur.pages < 2;
    const before = cur.words.slice(0, cur.ch).reduce((a, b) => a + b, 0);
    const frac = cur.pages > 1 ? cur.page / (cur.pages - 1) : 1;
    $('#rPct').textContent = Math.round(((before + cur.words[cur.ch] * frac) / cur.total) * 100) + '% of the book';
    void p;
  }

  /* ---------------- panels ---------------- */
  function panels(which) {
    ['pToc', 'pNotes', 'pSet'].forEach(id => { $('#' + id).hidden = id !== which; });
    $('#rToc').setAttribute('aria-pressed', which === 'pToc' ? 'true' : 'false');
    $('#rNotes').setAttribute('aria-pressed', which === 'pNotes' ? 'true' : 'false');
    $('#rSet').setAttribute('aria-pressed', which === 'pSet' ? 'true' : 'false');
    if (which === 'pNotes') paintNotes();
    if (which === 'pSet') paintSet();
  }
  function toggle(which) { panels($('#' + which).hidden ? which : null); }
  function paintToc() {
    if (!cur || !cur.data) return;
    const r = reading[cur.meta.id] || {}, done = new Set(r.chDone || []);
    const box = $('#tocList'); box.innerHTML = '';
    cur.data.chapters.forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ch' + (i === cur.ch ? ' cur' : '');
      b.innerHTML = fmt(c.t) + `<small>${done.has(i) ? '✓ ' : ''}${Math.max(1, Math.round(cur.words[i] / 250))} min</small>`;
      b.onclick = () => { panels(null); show(i, { page: 0 }); sound('page'); };
      box.appendChild(b);
    });
  }
  function paintNotes() {
    const box = $('#noteList'); box.innerHTML = '';
    const list = (notes[cur.meta.id] || []).slice().sort((a, b) => a.ch - b.ch || a.b - b.b);
    if (!list.length) { box.innerHTML = '<p class="muted">No notes yet. Select a few words on the page (or tap a paragraph) and choose <b>Note</b>.</p>'; return; }
    list.forEach(n => {
      const d = document.createElement('div'); d.className = 'nt';
      d.innerHTML = `${n.quote ? `<q>${esc(n.quote.length > 140 ? n.quote.slice(0, 140) + '…' : n.quote)}</q>` : ''}<span>${esc(n.text)}</span><small>${n.by ? esc(n.by) + ' · ' : ''}${esc(cur.data.chapters[n.ch] ? cur.data.chapters[n.ch].t : '')}</small>`;
      d.onclick = () => { panels(null); if (cur.ch !== n.ch) show(n.ch, { block: n.b }); else turnTo(pageOfBlock(n.b)); };
      box.appendChild(d);
    });
    const ex = document.createElement('button'); ex.type = 'button'; ex.className = 'sbtn'; ex.style.marginTop = '12px'; ex.textContent = 'Copy all my notes';
    ex.onclick = async () => {
      const txt = `${cur.meta.title} — ${cur.meta.author}\n\n` + list.filter(n => !n.by).map(n => `[${cur.data.chapters[n.ch].t}]\n“${n.quote}”\n${n.text}\n`).join('\n');
      try { await navigator.clipboard.writeText(txt); ex.textContent = 'Copied'; } catch (e) { ex.textContent = 'Could not copy'; }
    };
    box.appendChild(ex);
  }
  function paintSet() {
    document.querySelectorAll('#pSet [data-th]').forEach(b => b.classList.toggle('solid', b.dataset.th === set.theme));
    $('#spreadT').textContent = set.spread ? 'On' : 'Off';
    $('#othersT').textContent = set.others ? 'Shown' : 'Hidden';
  }
  function relayout() { if (!cur || !cur.data) return; const a = anchor(); show(cur.ch, { block: a.b, frac: a.f }); }

  /* ---------------- notes ---------------- */
  let pending = null;      // { ch, b, quote, id? }
  function selShow(x, y, data) {
    pending = data;
    const el = $('#rsel'); el.classList.add('on');
    el.style.left = Math.max(70, Math.min(innerWidth - 70, x)) + 'px'; el.style.top = Math.max(60, y - 8) + 'px';
  }
  function selHide() { $('#rsel').classList.remove('on'); }
  function blockOf(node) { while (node && node !== document.body) { if (node.dataset && node.dataset.b != null && node.closest && node.closest('#rcols')) return node; node = node.parentNode; } return null; }
  function onSelect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const rng = sel.getRangeAt(0);
    const blk = blockOf(rng.startContainer.nodeType === 3 ? rng.startContainer.parentNode : rng.startContainer);
    if (!blk) return false;
    let quote = sel.toString().replace(/\s+/g, ' ').trim();
    const bt = blk.textContent.replace(/\s+/g, ' ');
    if (quote.length > 400) quote = quote.slice(0, 400);
    if (bt.indexOf(quote) < 0) quote = quote.split(' ').slice(0, 12).join(' ');
    if (!quote) return false;
    const rc = rng.getBoundingClientRect();
    selShow(rc.left + rc.width / 2, rc.top, { ch: cur.ch, b: +blk.dataset.b, quote });
    return true;
  }
  function editNote(data) {
    pending = data;
    const nd = $('#noted');
    $('#ndQ').textContent = data.quote ? '“' + data.quote + '”' : '';
    $('#ndT').value = data.text || '';
    $('#ndDel').hidden = !data.id || !!data.by;
    $('#ndShareL').hidden = !(cfg.others && cfg.others()) || !!data.id;
    $('#ndT').readOnly = !!data.by;
    $('#ndOk').textContent = data.by ? 'Close' : 'Keep note';
    nd.hidden = false;
    selHide();
    setTimeout(() => $('#ndT').focus(), 30);
  }
  function keepNote() {
    const d = pending; if (!d) return;
    if (d.by) { $('#noted').hidden = true; return; }
    const text = $('#ndT').value.trim();
    const list = notes[cur.meta.id] = notes[cur.meta.id] || [];
    if (d.id) {
      const n = list.find(x => x.id === d.id);
      if (n) {
        if (text) n.text = text; else list.splice(list.indexOf(n), 1);
        if (n.shared && cfg.onNoteChange) cfg.onNoteChange(cur.meta.id, text ? n : null, n.id);
      }
    } else if (text) {
      const n = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ch: d.ch, b: d.b, quote: d.quote, text, t: Date.now(), shared: $('#ndShare').checked };
      list.push(n);
      if (cfg.onNote) cfg.onNote(cur.meta.id, n);
    }
    saveNotes();
    $('#noted').hidden = true; pending = null;
    window.getSelection().removeAllRanges();
    relayout();
  }
  function eraseNote() {
    const d = pending; if (!d || !d.id) return;
    const list = notes[cur.meta.id] || [];
    const i = list.findIndex(x => x.id === d.id);
    if (i >= 0) { const n = list[i]; list.splice(i, 1); if (n.shared && !n.by && cfg.onNoteChange) cfg.onNoteChange(cur.meta.id, null, n.id); }
    saveNotes(); $('#noted').hidden = true; pending = null; relayout();
  }
  // a friend's note: new ('new'), changed ('changed'), or already here as it is (false)
  function addShared(bookId, note) {
    const list = notes[bookId] = notes[bookId] || [];
    const had = list.find(n => n.id === note.id), text = String(note.text).slice(0, 1200);
    if (had) {
      if (!had.by || had.text === text) return false;               // your own note, or nothing new
      had.text = text; saveNotes(); if (cur && cur.meta.id === bookId) relayout(); return 'changed';
    }
    list.push({ id: note.id, ch: note.ch, b: note.b, quote: note.quote, text, t: note.t || Date.now(), by: String(note.by || 'A friend').slice(0, 20), pid: note.pid });
    saveNotes();
    if (cur && cur.meta.id === bookId) relayout();
    return 'new';
  }
  // a friend erased their note
  function removeShared(bookId, id) {
    const list = notes[bookId] || [], i = list.findIndex(n => n.id === id && n.by);
    if (i < 0) return;
    list.splice(i, 1); saveNotes();
    if (cur && cur.meta.id === bookId) relayout();
  }

  /* ---------------- read aloud ---------------- */
  let speaking = false, spBlock = -1;
  function speakFrom(b) {
    if (!('speechSynthesis' in window)) return;
    const C = cur.data.chapters[cur.ch];
    let i = b;
    while (i < C.b.length && !plain(C.b[i]).trim()) i++;
    if (i >= C.b.length) { if (cur.ch < cur.data.chapters.length - 1) { finishChapter(cur.ch); show(cur.ch + 1, { page: 0 }); speakFrom(0); } else stopSpeaking(); return; }
    spBlock = i;
    document.querySelectorAll('#rcols .speaking').forEach(e => e.classList.remove('speaking'));
    const el = document.querySelector(`#rcols [data-b="${i}"]`);
    if (el) { el.classList.add('speaking'); const pg = pageOfBlock(i); if (pg !== cur.page) turnTo(pg); }
    const u = new SpeechSynthesisUtterance(plain(C.b[i]).replace(/_/g, ''));
    u.rate = 0.95; u.lang = 'en-US';
    const v = speechSynthesis.getVoices().find(x => /^en(-|_)/i.test(x.lang) && /natural|premium|enhanced/i.test(x.name)) || speechSynthesis.getVoices().find(x => /^en(-|_)/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => { if (speaking && spBlock === i) speakFrom(i + 1); };
    u.onerror = () => { if (speaking && spBlock === i) stopSpeaking(); };
    speechSynthesis.speak(u);
  }
  function toggleSpeak() {
    if (!('speechSynthesis' in window)) { $('#rCh').textContent = 'Read-aloud is not available in this browser.'; return; }
    if (speaking) { stopSpeaking(); return; }
    speaking = true; $('#rSpeak').setAttribute('aria-pressed', 'true');
    speechSynthesis.cancel();
    speakFrom(firstBlockOnPage());
  }
  function stopSpeaking(keepFlag) {
    if (!keepFlag) { speaking = false; const b = $('#rSpeak'); if (b) b.setAttribute('aria-pressed', 'false'); }
    spBlock = -1;
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
    document.querySelectorAll('#rcols .speaking').forEach(e => e.classList.remove('speaking'));
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $('#rClose').onclick = close;
    $('#rNext').onclick = next; $('#rPrev').onclick = prev;
    $('#rToc').onclick = () => toggle('pToc');
    $('#rNotes').onclick = () => toggle('pNotes');
    $('#rSet').onclick = () => toggle('pSet');
    $('#rSpeak').onclick = toggleSpeak;
    $('#rSeek').oninput = (e) => turnTo(+e.target.value, true);
    $('#fsUp').onclick = () => { set.fs = Math.min(28, set.fs + 1); saveSet(); relayout(); };
    $('#fsDn').onclick = () => { set.fs = Math.max(14, set.fs - 1); saveSet(); relayout(); };
    document.querySelectorAll('#pSet [data-th]').forEach(b => { b.onclick = () => { set.theme = b.dataset.th; $('#reader').className = set.theme; saveSet(); paintSet(); }; });
    $('#spreadT').onclick = () => { set.spread = !set.spread; saveSet(); paintSet(); relayout(); };
    $('#othersT').onclick = () => { set.others = !set.others; saveSet(); paintSet(); relayout(); };
    $('#rsNote').onclick = () => { if (pending) editNote(pending); };
    $('#rsCopy').onclick = async () => { const q = pending && pending.quote; selHide(); if (q) { try { await navigator.clipboard.writeText(q); } catch (e) {} } };
    $('#ndOk').onclick = keepNote; $('#ndX').onclick = () => { $('#noted').hidden = true; pending = null; };
    $('#ndDel').onclick = eraseNote;
    $('#ndT').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) keepNote(); e.stopPropagation(); });
    const cols = $('#rcols');
    cols.addEventListener('click', (e) => {
      const endB = e.target.closest('[data-end]');
      if (endB) { if (endB.dataset.end === 'close') { finishChapter(cur.ch); close(); } else next(); return; }
      const nEl = e.target.closest('[data-n]');
      if (nEl) {
        const n = (notes[cur.meta.id] || []).find(x => x.id === nEl.dataset.n);
        if (n) { editNote(Object.assign({}, n)); return; }
      }
      if (onSelect()) return;
      const blk = blockOf(e.target);
      if (blk && $('#rsel').classList.contains('on') === false) {
        const t = blk.textContent.replace(/\s+/g, ' ').trim();
        selShow(e.clientX, e.clientY - 6, { ch: cur.ch, b: +blk.dataset.b, quote: t.split(' ').slice(0, 14).join(' ') + (t.split(' ').length > 14 ? '…' : '') });
      } else selHide();
    });
    document.addEventListener('selectionchange', () => { if (cur && !$('#reader').hidden) { const s = window.getSelection(); if (s && !s.isCollapsed) setTimeout(onSelect, 10); } });
    // swipes turn pages
    let sw = null;
    $('#rview').addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    $('#rview').addEventListener('pointerup', (e) => {
      if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; const quick = performance.now() - sw.t < 600; sw = null;
      const s = window.getSelection(); if (s && !s.isCollapsed) return;
      if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) { selHide(); dx < 0 ? next() : prev(); }
    });
    window.addEventListener('keydown', (e) => {
      if ($('#reader').hidden) return;
      if (!$('#noted').hidden) { if (e.key === 'Escape') { $('#noted').hidden = true; pending = null; } return; }
      const a = document.activeElement; if (a && (a.tagName === 'INPUT' && a.type !== 'range' || a.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); selHide(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); selHide(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); if ($('#rsel').classList.contains('on')) selHide(); else if (!$('#pToc').hidden || !$('#pNotes').hidden || !$('#pSet').hidden) panels(null); else close(); }
    });
    let rz = 0;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (cur && !$('#reader').hidden) relayout(); }, 160); });
  }

  /* ---------------- queries ---------------- */
  function progress(id) {
    const r = reading[id]; const n = (notes[id] || []).filter(x => !x.by).length;
    if (!r && !n) return null;
    return { pct: r ? r.pct || 0 : 0, done: !!(r && r.done), ch: r ? r.ch : 0, notes: n };
  }
  // how much you've read: chapters finished (any book) and whole books finished — the doors open on these
  function stats() { let chapters = 0, books = 0; for (const id in reading) { const r = reading[id]; if (!r) continue; chapters += (r.chDone || []).length; if (r.done) books++; } return { chapters, books }; }
  function startedMap() { const m = {}; for (const id in reading) if (reading[id] && (reading[id].pct > 0.5 || reading[id].ch > 0) && !reading[id].done) m[id] = true; return m; }
  return {
    init, open, close, progress, stats, startedMap, addShared, removeShared,
    currentId: () => (cur ? cur.meta.id : null),
    setSound: (fn) => { sound = fn || (() => {}); },
    _state: () => ({ reading, notes, set, cur })
  };
})();
