/* THE READING ROOM — cinema.js: a picture house over the fire.

   A roll-up screen hangs in a walnut case on the chimney breast, in front of the Sankofa; behind the
   sofa a walnut stand hides a projector under a brass lid. Pull the cord (or ask at the stand) and the
   screen unrolls; choose a film and the projector rises, the lamp strikes and the lights go down.

   The programme is race films and early Black cinema in the U.S. public domain (SOURCES.md, "The
   cinema"). A direct .mp4 or .webm link also plays on the screen; a YouTube link plays in a window over
   the room, because an embedded player cannot be painted onto the 3D screen.

   The screen belongs to the room: room.screen = {down, src, kind: 'file'|'youtube', title, playing,
   pos, at}. It changes only through the 'screen' op, so in a shared room everyone sees the screen come
   down and the same film, at pos + (now - at) seconds while it plays. Each copy of the room stamps `at`
   with its own clock when it applies the op, so friends' clocks never have to agree.

   Nothing is made for the video until a film is chosen: the <video> element, its texture and the
   YouTube frame are built on first use, and the per-frame loop runs only while something moves or plays.

   Some things belong to each viewer alone: the volume, muting (M), watching up close in a window (a
   click on the screen) and full screen (G). In the window, or full screen, the player's own buttons
   (and a click on the film, where the browser does that) steer the room's film.

   How the picture reaches the 3D screen depends on the browser. Where it can, each frame is copied
   through a canvas into the screen's texture. Safari (iPhone, iPad, Mac) plays these films but hands
   only black to a canvas, and a film whose server sends no CORS headers can't be copied at all: then
   the <video> itself sits over the canvas, warped in perspective onto the screen every frame.

   API (main.js): init(ctx), sanitize(screen), applyOp(room, op), sync(room), acts(t), label(t), open(),
   fullscreen(), toggleMute(), hasFilm(), afterRender() */
'use strict';
const RR_CINEMA = (() => {
  if (!window.THREE) return null;
  const T = THREE;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICO = {
    on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------------- the programme ----------------
     Every file is on Wikimedia Commons (upload.wikimedia.org serves it with CORS, so it can be painted on
     the screen). Where the only copy is a 1080p master of several GB, the 480p VP9 copy Commons makes of it
     is tried first and the master second. */
  const UP = 'https://upload.wikimedia.org/wikipedia/commons/';
  const orig = (h, f) => UP + h + '/' + f;
  const v480 = (h, f) => UP + 'transcoded/' + h + '/' + f + '/' + f + '.480p.vp9.webm';
  const page = (f) => 'https://commons.wikimedia.org/wiki/File:' + f;
  const FILMS = [
    { title: 'A Natural Born Gambler', year: 1916, by: 'Bert Williams', mins: 23,
      note: 'Broadway star Bert Williams directs himself in his famous pantomime, a poker game played alone in a jail cell. He wears the blackface make-up his era demanded.',
      files: [orig('3/37', 'A_Natural_Born_Gambler_(1916).webm')], page: page('A_Natural_Born_Gambler_(1916).webm') },
    { title: 'Within Our Gates', year: 1920, by: 'Oscar Micheaux', mins: 79,
      note: 'Micheaux’s answer to The Birth of a Nation, with Evelyn Preer: the oldest known surviving feature by an African-American director, found in Spain as La Negra.',
      files: [v480('0/0e', 'Within_Our_Gates_HQ.webm'), orig('e/e8', 'Within_Our_Gates_(1920).webm')], page: page('Within_Our_Gates_(1920).webm') },
    { title: 'The Symbol of the Unconquered', year: 1920, by: 'Oscar Micheaux', mins: 59,
      note: 'A Black homesteader strikes oil in the Northwest, and hooded night riders come to drive him off. With Iris Hall and Walker Thompson.',
      files: [orig('7/7d', 'The_Symbol_of_the_Unconquered_(1920).webm'), v480('8/83', 'Oscar_Micheaux_-_The_Symbol_of_the_Unconquered_(1920).webm')], page: page('The_Symbol_of_the_Unconquered_(1920).webm') },
    { title: 'Body and Soul', year: 1925, by: 'Oscar Micheaux', mins: 79,
      note: 'Paul Robeson’s first film, in two parts: an escaped convict posing as a small-town preacher, and his upright brother.',
      files: [orig('f/fd', 'BODY_AND_SOUL-Paul_Robeson-silent.webm'), v480('6/67', 'Body_and_Soul_(1925).webm')], page: page('BODY_AND_SOUL-Paul_Robeson-silent.webm') },
    { title: 'The Flying Ace', year: 1926, by: 'Richard E. Norman', mins: 66,
      note: 'Norman Studios’ all-Black aviation thriller, shot in Jacksonville, Florida: a war-hero pilot turns detective when a railroad agent vanishes with $25,000.',
      files: [v480('7/7d', 'The_Flying_Ace_(1926_film).webm'), orig('7/7d', 'The_Flying_Ace_(1926_film).webm')], page: page('The_Flying_Ace_(1926_film).webm') },
    { title: 'Ten Nights in a Barroom', year: 1926, by: 'Roy Calnek', mins: 63,
      note: 'Charles S. Gilpin, the stage’s first Emperor Jones, in the old temperance melodrama, made in Philadelphia by the Colored Players Film Corporation.',
      files: [v480('9/90', 'Ten_Nights_in_a_Barroom_(1926).webm'), orig('9/90', 'Ten_Nights_in_a_Barroom_(1926).webm')], page: page('Ten_Nights_in_a_Barroom_(1926).webm') },
    { title: 'The Scar of Shame', year: 1927, by: 'Frank Peregini', mins: 87,
      note: 'Love and marriage across lines of class and colour in Black Philadelphia, from the Colored Players. Shot in 1927, released in 1929.',
      files: [v480('4/47', 'The_Scar_of_Shame_(1929)_by_Frank_Peregini.webm'), orig('4/47', 'The_Scar_of_Shame_(1929)_by_Frank_Peregini.webm')], page: page('The_Scar_of_Shame_(1929)_by_Frank_Peregini.webm') },
    { title: 'St. Louis Blues', year: 1929, by: 'Dudley Murphy', mins: 15,
      note: 'Bessie Smith’s only film: she sings W. C. Handy’s song at the bar of a Harlem speakeasy.',
      files: [orig('3/38', 'St_Louis_Blues_(1929).webm'), v480('2/25', 'St._Louis_Blues.webm')], page: page('St_Louis_Blues_(1929).webm') },
    { title: 'Black and Tan', year: 1929, by: 'Dudley Murphy', mins: 18,
      note: 'Duke Ellington’s first film, with his orchestra, and Fredi Washington as a dancer with a failing heart.',
      files: [orig('f/ff', 'Black_and_Tan_(1929).webm')], page: page('Black_and_Tan_(1929).webm') },
    { title: 'Hallelujah', year: 1929, by: 'King Vidor', mins: 100,
      note: 'One of the first Hollywood studio films with an all-Black cast, an early MGM talkie with Daniel L. Haynes, Nina Mae McKinney and Eva Jessye’s choir.',
      files: [v480('c/c2', 'Hallelujah_(1929).webm'), orig('c/c2', 'Hallelujah_(1929).webm')], page: page('Hallelujah_(1929).webm') },
    { title: 'The Blood of Jesus', year: 1941, by: 'Spencer Williams', mins: 57, why: 'Published in 1941; its copyright was not renewed (Wikimedia Commons: PD-US-not renewed).',
      note: 'Spencer Williams writes, directs and acts: a dying woman’s soul at the crossroads between Zion and Hell. Made in Texas; National Film Registry, 1991.',
      files: [v480('5/5a', 'The_Blood_of_Jesus_(1941)_by_Spencer_Williams.webm'), orig('5/5a', 'The_Blood_of_Jesus_(1941)_by_Spencer_Williams.webm')], page: page('The_Blood_of_Jesus_(1941)_by_Spencer_Williams.webm') },
    { title: 'The Negro Soldier', year: 1944, by: 'Stuart Heisler', mins: 40, why: 'Made by the U.S. War Department, so never under copyright.',
      note: 'The U.S. Army’s wartime film. Its writer, Carlton Moss, plays the preacher who tells the history of Black soldiers in America’s wars.',
      files: [v480('3/3e', '%22The_Negro_Soldier%22_1944.webm'), orig('c/cf', 'The_Negro_Soldier_(1944).webm')], page: page('%22The_Negro_Soldier%22_1944.webm') }
  ];
  FILMS.forEach(f => { f.why = f.why || 'Published in ' + f.year + '; U.S. copyright on works published before 1931 has run out.'; });
  const FILM_OF = new Map();
  FILMS.forEach(f => f.files.forEach(u => FILM_OF.set(u, f)));
  const filmTitle = (f) => f.title + ' (' + f.year + ')';

  /* ---------------- room state: checking it, changing it ---------------- */
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
  const num = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  function httpUrl(s) {
    if (typeof s !== 'string' || !s || s.length > 2000) return '';
    try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href : ''; } catch (e) { return ''; }
  }
  function clean(s, now) {
    if (!s || typeof s !== 'object') return null;
    const kind = s.kind === 'youtube' ? 'youtube' : 'file';
    const src = kind === 'youtube' ? (YT_ID.test(String(s.src || '')) ? String(s.src) : '') : httpUrl(s.src);
    const out = { down: !!s.down, src, kind, title: src ? (clip(s.title, 120) || 'A film') : '', playing: false, pos: src ? num(s.pos, -10, 86400, 0) : 0, at: Math.min(now, num(s.at, 0, 1e13, now)) };
    out.playing = !!(s.playing && src && out.down);
    if (out.playing && now - out.at > 12 * 3600e3) { out.playing = false; out.pos = 0; }   // left running long ago
    return out.down || out.src ? out : null;
  }
  // main.js sanitizeRoom: whatever came from storage or a friend's room
  function sanitize(s) { return clean(s, Date.now()); }
  // main.js applyOp, for {t: 'screen', down, src, kind, title, playing, pos} (checked the same way for everyone)
  function applyOp(room, op) {
    if (op.src && op.kind === 'youtube' && !YT_ID.test(String(op.src))) return 'That is not a YouTube video the screen can show.';
    if (op.src && op.kind !== 'youtube' && !httpUrl(op.src)) return 'Only http and https links can be shown.';
    room.screen = clean(Object.assign({}, op, { at: Date.now() }), Date.now());
    return true;
  }

  /* ---------------- per-viewer memory: volume, muting, and where you stopped in each film ---------------- */
  const LS = 'rr-cinema';
  let mem = {};
  try { mem = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { mem = {}; }
  if (!mem || typeof mem !== 'object') mem = {};
  if (!mem.at || typeof mem.at !== 'object') mem.at = {};
  let vol = typeof mem.vol === 'number' ? Math.max(0, Math.min(1, mem.vol)) : 0.8;
  let muted = mem.mute === true;
  function remember() { try { localStorage.setItem(LS, JSON.stringify(mem)); } catch (e) {} }
  function notePlace(src, t, dur) {
    if (!src || !isFinite(t)) return;
    if (t < 20 || (dur && t > dur - 40)) delete mem.at[src]; else mem.at[src] = Math.round(t);
    const k = Object.keys(mem.at); if (k.length > 40) delete mem.at[k[0]];
    remember();
  }

  /* ---------------- the page: panel, big-screen window, now-showing chip ---------------- */
  const css = `
#cinema .card{width:min(820px,100%)}
.cin-now{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:4px 0 8px;background:rgba(0,0,0,.28)}
.cin-now .k{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
.cin-now .t{font-family:var(--serif);font-size:19px;font-weight:700;color:var(--gold2);margin:3px 0 2px;line-height:1.2}
.cin-now .st{font-size:13px;color:var(--dim);margin-bottom:8px}
.cin-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.cin-row label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.cin-row input[type=range]{accent-color:var(--gold);width:150px}
.cin-seek{display:flex;align-items:center;gap:10px;margin-top:10px;font:12px ui-monospace,Menlo,monospace;color:var(--dim)}
.cin-seek input{flex:1;min-width:0;accent-color:var(--gold)}
.bk .reel{width:14px;height:58px;border-radius:2px;background-color:#17120d;box-shadow:inset 0 0 0 1px rgba(232,176,75,.3);
  background-image:repeating-linear-gradient(180deg,rgba(243,234,214,.7) 0 3px,transparent 3px 7px),repeating-linear-gradient(180deg,rgba(243,234,214,.7) 0 3px,transparent 3px 7px);
  background-size:3px 100%,3px 100%;background-position:1px 0,10px 0;background-repeat:no-repeat}
.bk.on .ti{color:var(--gold2)}
.cin-link{display:flex;gap:8px;margin:10px 0 4px}
.cin-link input{flex:1;min-width:0;border:1px solid var(--line);background:rgba(0,0,0,.3);border-radius:10px;padding:10px;color:var(--ink);font-size:15px;outline:none}
.cin-link input:focus{border-color:var(--gold)}
.sheet.cine-view{background:rgba(0,0,0,.84)}
.cine-frame{width:min(1100px,100%,calc((100vh - 120px) * 1.7778));display:flex;flex-direction:column;gap:8px}
.cine-frame header{display:flex;align-items:center;gap:10px;color:var(--ink)}
.cine-frame header .k{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
.cine-frame header b{flex:1;min-width:0;font-family:var(--serif);color:var(--gold2);font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cine-frame .cx{appearance:none;border:1px solid var(--line);background:rgba(13,10,7,.7);color:var(--ink);border-radius:10px;min-width:40px;min-height:40px;font-size:18px}
.cine-stage{position:relative;width:100%;aspect-ratio:16/9;background:#000;border:6px solid #2a1d10;outline:2px solid var(--gold);border-radius:3px;box-shadow:0 20px 70px rgba(0,0,0,.8)}
.cine-stage iframe,.cine-stage video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
#cineHud{position:fixed;z-index:30;left:calc(var(--sal) + 12px);top:calc(var(--sat) + 60px);display:flex;gap:6px;align-items:center;max-width:calc(100vw - 24px)}
body:not(.playing) #cineHud,body.reading #cineHud{display:none}
#cineHud .chip{min-height:36px;padding:6px 10px}
#cineHud .nm{max-width:min(46vw,260px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--serif);font-weight:700;color:var(--gold2)}
#cineHud small{color:var(--dim);font-weight:600;font:600 11px ui-monospace,Menlo,monospace}
#cineHold{position:fixed;width:2px;height:2px;right:0;bottom:0;overflow:hidden;opacity:.01;pointer-events:none;z-index:-1}
#cineFull{position:fixed;width:2px;height:2px;right:0;bottom:0;overflow:hidden;z-index:-1}
#cineOver{position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:1;pointer-events:none}
#cineOver video{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;background:#000;object-fit:fill;max-width:none}
body:not(.playing) #cineOver,body.reading #cineOver{display:none}
#cineFull video{width:100%;height:100%;object-fit:contain;background:#000}
#cineHud .chip.ic{padding:6px 9px;min-width:40px;justify-content:center}
.cine-frame header .cx{display:inline-flex;align-items:center;justify-content:center}
.cine-frame header .cx svg{width:18px;height:18px}
.cine-stage:fullscreen{border:0;outline:0;border-radius:0;box-shadow:none}
.cine-stage:-webkit-full-screen{border:0;outline:0;border-radius:0;box-shadow:none}
@media (max-width:640px){ #cineHud .nm{max-width:34vw} #cineHud small{display:none} }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<div class="sheet" id="cinema" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="cinH">
    <header><h2 id="cinH">The Cinema</h2><button class="x" type="button" data-close aria-label="Close">✕</button></header>
    <div class="body">
      <div class="cin-now" id="cinNow">
        <div class="k" id="cinK">The screen</div>
        <div class="t" id="cinT"></div>
        <div class="st" id="cinSt"></div>
        <div class="cin-row">
          <button class="sbtn solid" type="button" id="cinPlay">Play</button>
          <button class="sbtn" type="button" id="cinWatch">Watch</button>
          <button class="sbtn" type="button" id="cinStart">From the start</button>
          <button class="sbtn" type="button" id="cinStop">Stop the film</button>
          <button class="sbtn" type="button" id="cinRoll">Pull the screen down</button>
          <button class="sbtn" type="button" id="cinMute" aria-pressed="false" title="Only for you: everyone else keeps the sound (M)" hidden>Mute for me</button>
          <button class="sbtn" type="button" id="cinFull" title="The film fills your screen, nobody else's (G)" hidden>Full screen</button>
        </div>
        <div class="cin-seek" id="cinSeekRow"><span id="cinPos">0:00</span><input type="range" id="cinSeek" min="0" max="1000" value="0" aria-label="Position in the film"><span id="cinDur">–:––</span></div>
        <div class="cin-row"><label>Volume <input type="range" id="cinVol" min="0" max="100" aria-label="Volume"></label></div>
      </div>
      <h3 class="csec gold">The programme <span>Race films and early Black cinema. All are in the U.S. public domain; the sources are in SOURCES.md.</span></h3>
      <div id="cinList"></div>
      <h3 class="csec">Play a link <span>A direct .mp4 or .webm file plays on the screen. A YouTube link plays in a window over the room.</span></h3>
      <div class="cin-link"><input id="cinUrl" type="url" inputmode="url" placeholder="https://… .mp4, .webm, or a YouTube link" autocomplete="off" spellcheck="false"><button class="sbtn solid" type="button" id="cinGo">Play</button></div>
      <p class="muted" id="cinFoot">In a shared room everyone sees the same film. Volume, mute and full screen are yours alone.</p>
    </div>
  </div>
</div>
<div class="sheet cine-view" id="cineView" hidden>
  <div class="cine-frame" role="dialog" aria-modal="true" aria-labelledby="cvT">
    <header><span class="k">Now showing</span><b id="cvT"></b><button class="cx" type="button" id="cvMute" aria-pressed="false" aria-label="Mute, just for you" title="Mute — only for you (M)">${ICO.on}</button><button class="cx" type="button" id="cvFull" aria-label="Full screen" title="Full screen (G)">${ICO.full}</button><button class="cx" type="button" data-close aria-label="Stop watching" title="Stop watching (Esc)">✕</button></header>
    <div class="cine-stage" id="cvStage"></div>
  </div>
</div>
<div id="cineHud" hidden>
  <button class="chip" type="button" id="chPlay" aria-label="Pause">❚❚</button>
  <button class="chip" type="button" id="chOpen" title="The cinema"><span class="nm" id="chT"></span><small id="chTime"></small></button>
  <button class="chip ic" type="button" id="chMute" aria-pressed="false" aria-label="Mute, just for you" title="Mute — only for you (M)">${ICO.on}</button>
  <button class="chip ic" type="button" id="chFull" aria-label="Full screen" title="Full screen (G)">${ICO.full}</button>
</div>
<div id="cineHold"></div>
<div id="cineFull"></div>
<div id="cineOver" aria-hidden="true"></div>`;
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
  const fmt = (t) => {
    if (!isFinite(t) || t < 0) t = 0;
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  (function buildList() {
    const box = $('#cinList');
    let sec = '';
    FILMS.forEach((f, i) => {
      const s2 = f.year < 1931 ? 'old' : 'later';
      if (s2 !== sec && s2 === 'later') { const h = document.createElement('h3'); h.className = 'csec'; h.innerHTML = 'Later, and free for other reasons <span>One was never renewed, one was made by the U.S. government.</span>'; box.appendChild(h); }
      sec = s2;
      const row = document.createElement('div'); row.className = 'bk'; row.dataset.i = i;
      row.innerHTML = `<span class="reel"></span>
        <div><div class="ti">${esc(f.title)}</div><div class="au">${esc(f.by)} · ${f.year} · ${f.mins} min</div>
        <div class="bl">${esc(f.note)}</div><div class="wh">${esc(f.why)}</div></div>
        <div class="bt"><button class="sbtn solid" type="button">Play</button></div>`;
      row.querySelector('button').onclick = () => playFilm(f);
      box.appendChild(row);
    });
  })();

  /* ---------------- geometry helpers (as world.js builds furniture: one mesh per material) ---------------- */
  const _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3(), _v = new T.Vector3(), _n = new T.Vector3(), _nm = new T.Matrix3();
  function mtx(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    return new T.Matrix4().compose(_p, _q, _s);
  }
  function bake(list, uvScale) {
    let count = 0;
    const prep = list.map(([g, m]) => { const ng = g.index ? g.toNonIndexed() : g; count += ng.attributes.position.count; return [ng, m]; });
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let o = 0;
    for (const [g, m] of prep) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      _nm.getNormalMatrix(m);
      for (let i = 0; i < P.count; i++, o++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(m); _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z; nor[o * 3] = _n.x; nor[o * 3 + 1] = _n.y; nor[o * 3 + 2] = _n.z;
        if (uvScale) {
          const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
          const [u, w] = ax >= ay && ax >= az ? [_v.z, _v.y] : ay >= az ? [_v.x, _v.z] : [_v.x, _v.y];
          uv[o * 2] = u / uvScale; uv[o * 2 + 1] = w / uvScale;
        } else if (U) { uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i); }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  function kit() {
    const parts = new Map();
    const k = {
      add(geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {   // one scale given: uniform, as in world.js
        if (sx == null) sx = 1; if (sy == null) sy = sx; if (sz == null) sz = sx;
        if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push([geo, mtx(x, y, z, rx, ry, rz, sx, sy, sz)]); return k;
      },
      box(mat, w, h, d, x, y, z, rx, ry, rz) { return k.add(G.box, mat, x, y, z, rx, ry, rz, w, h, d); },
      build(into) { for (const [mat, list] of parts) into.add(new T.Mesh(bake(list, mat.userData.boxUV || 0), mat)); return into; }
    };
    return k;
  }
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function ctex(c) { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; }

  /* ---------------- where things stand ----------------
     The chimney breast's face is at z = -7.38, 4.2 m wide; the mantel shelf reaches z = -6.95 at 1.55 m
     and its clock and candlesticks top out near 2.06 m. The screen hangs just in front of the shelf, so
     nothing pokes through it, and its foot clears the shelf. The stand sits behind the sofa (whose back is
     at z = -2.28 in the default room), on the walk from the doors to the fire, out of every shelf's way. */
  const SCR = { z: -6.86, roll: 4.62, w: 3.8, L: 2.98, pw: 3.6, ph: 2.7, pb: 0.1 };   // roll: the bottom of the case
  const PIC_Y = SCR.roll - SCR.L + SCR.pb + SCR.ph / 2;                                 // centre of the picture area
  const STAND = { x: 0, z: -1.55, h: 0.92 };
  const PROJ = { down: 0.15, up: 1.34, lens: [0, 0.16, -0.275] };
  const CORD_X = 2.0;

  let ctx = null, W = null, G = null, M = null, built = false;
  const O = {};                           // the 3D parts
  let fabricTex = null, cardTex = null, cardC = null, cardKey = '';
  const A = { k: 0, lift: 0, lid: 0, lamp: 0, dim: 0, reel: 0, beamW: 0, beamH: 0 };   // what's shown now
  const want = { down: false };
  let baseExposure = 1;

  function fabricCanvas() {
    const c = cv(512, 402), g = c.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 512, 402);
    const x0 = Math.round(512 * (SCR.w - SCR.pw) / 2 / SCR.w), y0 = Math.round(402 * (SCR.L - SCR.pb - SCR.ph) / SCR.L), y1 = Math.round(402 * (SCR.L - SCR.pb) / SCR.L);
    g.fillStyle = '#ecE7dc'; g.fillRect(x0, y0, 512 - 2 * x0, y1 - y0);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(x0 + Math.random() * (512 - 2 * x0), y0 + Math.random() * (y1 - y0), 1, 1 + Math.random() * 3); }
    return c;
  }
  function plateCanvas() {
    const c = cv(512, 184), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 184); gr.addColorStop(0, '#e9c87a'); gr.addColorStop(0.5, '#b88a35'); gr.addColorStop(1, '#e0bd6c');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 184);
    g.strokeStyle = '#6a4a18'; g.lineWidth = 5; g.strokeRect(9, 9, 494, 166);
    g.fillStyle = '#3a2508'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 52px Georgia, serif'; g.fillText('THE CINEMA', 256, 70, 460);
    g.font = 'italic 600 30px Georgia, serif'; g.fillText('choose a film', 256, 128, 460);
    return c;
  }

  /* ---------------- the title cards the projector shows ---------------- */
  function wrapLines(g, text, maxW) {
    const words = String(text).split(/\s+/), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  }
  function drawCard(kind, s, extra) {
    const key = kind + '|' + (s ? s.title : '') + '|' + (extra || '');
    if (key === cardKey) return; cardKey = key;
    const g = cardC.getContext('2d'), W2 = 1024, H = 768, F = 'Georgia, "Times New Roman", serif';
    if (kind === 'blank') { g.fillStyle = '#000'; g.fillRect(0, 0, W2, H); cardTex.needsUpdate = true; return; }
    g.fillStyle = '#0b0a09'; g.fillRect(0, 0, W2, H);
    const vg = g.createRadialGradient(W2 / 2, H / 2, 60, W2 / 2, H / 2, 620); vg.addColorStop(0, 'rgba(70,56,38,.55)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = vg; g.fillRect(0, 0, W2, H);
    g.strokeStyle = '#c9a85a'; g.lineWidth = 5; g.strokeRect(46, 46, W2 - 92, H - 92); g.lineWidth = 1.6; g.strokeRect(62, 62, W2 - 124, H - 124);
    g.fillStyle = '#c9a85a';
    [[46, 46], [W2 - 46, 46], [46, H - 46], [W2 - 46, H - 46]].forEach(([x, y]) => { g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-11, -11, 22, 22); g.restore(); });
    const rule = (y) => { g.fillRect(W2 / 2 - 150, y, 300, 2); g.save(); g.translate(W2 / 2, y + 1); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore(); };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const small = (t, y) => { g.fillStyle = '#c9a85a'; g.font = `600 30px ${F}`; g.fillText(t.toUpperCase().split('').join(' '), W2 / 2, y, 860); };
    const big = (t, y, size) => {
      g.fillStyle = '#f3ead6'; let f = size || 92; g.font = `700 ${f}px ${F}`;
      let lines = wrapLines(g, t, 820);
      while (lines.length > 3 && f > 46) { f -= 6; g.font = `700 ${f}px ${F}`; lines = wrapLines(g, t, 820); }
      lines = lines.slice(0, 3);
      const lh = f * 1.12, y0 = y - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => g.fillText(l, W2 / 2, y0 + i * lh, 860));
      return y0 + (lines.length - 1) * lh + f / 2;
    };
    const line = (t, y, it) => { g.fillStyle = '#d8c8a8'; g.font = `${it ? 'italic ' : ''}400 36px ${F}`; g.fillText(t, W2 / 2, y, 840); };
    const f = s && s.src ? FILM_OF.get(s.src) : null;
    const byline = f ? f.by + '  ·  ' + f.year : s && s.kind === 'youtube' ? 'from YouTube' : s && s.src ? hostOf(s.src) : '';
    if (kind === 'house') {
      small('The Reading Room', 210); big('Cinema', 330, 132); rule(430);
      line('Choose a film at the projector', 505, true);
      g.fillStyle = '#9a8a6c'; g.font = `400 26px ${F}`; g.fillText('Race films and early Black cinema, in the public domain', W2 / 2, 600, 840);
    } else if (kind === 'error') {
      small('The film has broken', 220); const yb = big(s.title, 360, 72); rule(yb + 50);
      line(extra || 'It could not be loaded from its source.', yb + 120, true);
    } else {
      const head = { intro: 'Now showing', paused: 'Intermission', end: 'The End', window: 'Now showing', wait: 'Now showing' }[kind] || 'Now showing';
      small(head, 200); const yb = big(s.title, 350); rule(yb + 46);
      if (byline) line(byline, yb + 110);
      if (extra) { g.fillStyle = '#9a8a6c'; g.font = `italic 400 30px ${F}`; g.fillText(extra, W2 / 2, Math.min(H - 110, yb + 180), 840); }
    }
    // a faint scratch or two: it is an old print
    g.strokeStyle = 'rgba(243,234,214,.06)'; g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const x = 120 + Math.random() * 780; g.beginPath(); g.moveTo(x, 70); g.lineTo(x + (Math.random() - 0.5) * 30, H - 70); g.stroke(); }
    cardTex.needsUpdate = true;
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  /* ---------------- building it ---------------- */
  const pickables = [];
  function hit(w, h, d, x, y, z, part, parent) {
    const m = new T.Mesh(G.box, M.hit); m.scale.set(w, h, d); m.position.set(x, y, z);
    m.userData.pick = { kind: 'cinema', part }; parent.add(m);
    if (W.caseHits) W.caseHits.push(m);
    pickables.push(m);
    return m;
  }
  function build() {
    const root = O.root = new T.Group(); root.name = 'cinema'; ctx.scene.add(root);
    // the case on the chimney breast, on two brackets
    const ck = kit(), z = SCR.z, cy = SCR.roll + 0.12;
    ck.box(M.walnut, 4.1, 0.24, 0.26, 0, cy, z - 0.06);
    ck.box(M.walnutDark, 4.14, 0.03, 0.28, 0, cy + 0.12, z - 0.06);
    [-1.55, 1.55].forEach(x => ck.box(M.walnutDark, 0.07, 0.16, 0.34, x, cy, -7.215));
    [-1, 1].forEach(sx => ck.add(G.cyl, M.brass, sx * 2.065, cy, z - 0.06, 0, 0, Math.PI / 2, 0.3, 0.03, 0.3));
    ck.box(M.brass, 4.1, 0.022, 0.012, 0, cy + 0.085, z + 0.075);
    ck.box(M.brass, 4.1, 0.022, 0.012, 0, cy - 0.105, z + 0.075);
    // the pull-cord down the right-hand side, with a tassel at hand height
    ck.add(G.cyl8, M.cushion, CORD_X, (SCR.roll + 1.64) / 2, z, 0, 0, 0, 0.014, SCR.roll - 1.64, 0.014);
    ck.add(G.cyl, M.brass, CORD_X, 1.62, z, 0, 0, 0, 0.05, 0.06, 0.05);
    ck.add(G.sph, M.brass, CORD_X, 1.56, z, 0, 0, 0, 0.08, 0.1, 0.08);
    ck.add(G.cyl8, M.velvetOchre, CORD_X, 1.46, z, 0, 0, 0, 0.07, 0.14, 0.07);
    ck.build(root);
    hit(0.2, 1.7, 0.2, CORD_X, 2.25, z, 'cord', root);
    // the fabric: a plane hung from its top edge; it unrolls by revealing more of its texture
    fabricTex = ctex(fabricCanvas()); fabricTex.wrapT = T.ClampToEdgeWrapping;
    const fg = new T.PlaneGeometry(SCR.w, 1); fg.translate(0, -0.5, 0);
    O.fabric = new T.Mesh(fg, new T.MeshStandardMaterial({ map: fabricTex, roughness: 0.95, metalness: 0, envMapIntensity: 0.25 }));
    O.fabric.position.set(0, SCR.roll, z); root.add(O.fabric);
    // the weighted bar along its foot, with a ring to pull
    const bar = O.bar = new T.Group(); bar.position.set(0, SCR.roll, z); root.add(bar);
    kit().add(G.cyl, M.brass, 0, -0.02, 0.01, 0, 0, Math.PI / 2, 0.05, 3.88, 0.05)
      .add(G.sph, M.brass, -1.95, -0.02, 0.01, 0, 0, 0, 0.08).add(G.sph, M.brass, 1.95, -0.02, 0.01, 0, 0, 0, 0.08)
      .add(G.torus, M.brass, 0, -0.1, 0.015, 0, 0, 0, 0.11, 0.11, 0.11).build(bar);
    // what the lamp throws on it: a dim field (the projector's black) and the picture
    O.pic = new T.Group(); O.pic.position.set(0, PIC_Y, z); root.add(O.pic);
    O.field = new T.Mesh(new T.PlaneGeometry(SCR.pw, SCR.ph), new T.MeshBasicMaterial({ color: 0x0f0e0c, transparent: true, opacity: 0, toneMapped: false }));
    O.field.position.z = 0.004; O.pic.add(O.field);
    cardC = cv(1024, 768); cardTex = ctex(cardC);
    O.picMat = new T.MeshBasicMaterial({ map: cardTex, transparent: true, opacity: 0, toneMapped: false });
    O.picture = new T.Mesh(new T.PlaneGeometry(1, 1), O.picMat); O.picture.position.z = 0.008; O.picture.scale.set(SCR.pw, SCR.ph, 1); O.pic.add(O.picture);
    O.pic.visible = false;
    O.screenHit = hit(SCR.w, SCR.L, 0.06, 0, SCR.roll - SCR.L / 2, z, 'screen', root);
    // the stand behind the sofa: walnut, a brass rim and lid, a brass plate
    const stand = O.stand = new T.Group(); stand.position.set(STAND.x, 0, STAND.z); root.add(stand);
    const sk = kit();
    sk.box(M.walnutDark, 0.82, 0.08, 0.82, 0, 0.04, 0); sk.box(M.walnutDark, 0.76, 0.05, 0.76, 0, 0.105, 0);
    sk.box(M.walnut, 0.7, 0.76, 0.05, 0, 0.51, 0.325); sk.box(M.walnut, 0.7, 0.76, 0.05, 0, 0.51, -0.325);
    sk.box(M.walnut, 0.05, 0.76, 0.6, 0.325, 0.51, 0); sk.box(M.walnut, 0.05, 0.76, 0.6, -0.325, 0.51, 0);
    sk.box(M.black, 0.6, 0.02, 0.6, 0, 0.14, 0);
    sk.box(M.brass, 0.78, 0.04, 0.09, 0, STAND.h - 0.02, 0.345); sk.box(M.brass, 0.78, 0.04, 0.09, 0, STAND.h - 0.02, -0.345);
    sk.box(M.brass, 0.09, 0.04, 0.6, 0.345, STAND.h - 0.02, 0); sk.box(M.brass, 0.09, 0.04, 0.6, -0.345, STAND.h - 0.02, 0);
    sk.box(M.brass, 0.72, 0.02, 0.72, 0, 0.74, 0);
    sk.build(stand);
    const plate = new T.Mesh(new T.PlaneGeometry(0.5, 0.18), new T.MeshStandardMaterial({ map: ctex(plateCanvas()), roughness: 0.35, metalness: 0.55 }));
    plate.position.set(0, 0.56, 0.3515); stand.add(plate);
    O.flaps = [-1, 1].map(side => {
      const pv = new T.Group(); pv.position.set(side * 0.3, STAND.h - 0.01, 0); stand.add(pv);
      const f = new T.Mesh(G.box, M.brass); f.scale.set(0.3, 0.02, 0.6); f.position.x = -side * 0.15; pv.add(f);
      pv.userData.side = side; return pv;
    });
    O.standHit = hit(0.84, STAND.h + 0.04, 0.84, 0, (STAND.h + 0.04) / 2, 0, 'stand', stand);
    if (W.fixedColliders) W.fixedColliders.push({ x: STAND.x, z: STAND.z, hw: 0.41, hd: 0.41, r: 0 });
    // the projector: body, lamp house, lens, two reels; it rides up on a brass column
    O.column = new T.Mesh(G.cyl, M.brass); O.column.scale.set(0.08, 0.01, 0.08); stand.add(O.column);
    const pj = O.proj = new T.Group(); stand.add(pj);
    kit().box(M.iron, 0.4, 0.03, 0.5, 0, 0.015, 0)
      .box(M.black, 0.24, 0.24, 0.34, 0, 0.15, 0).add(G.cyl, M.black, 0, 0.2, 0.2, 0, 0, 0, 0.14, 0.2, 0.14)
      .box(M.iron, 0.025, 0.22, 0.025, 0, 0.36, -0.12).box(M.iron, 0.025, 0.22, 0.025, 0, 0.36, 0.14)
      .add(G.cyl, M.brass, 0, 0.16, -0.22, Math.PI / 2, 0, 0, 0.085, 0.11, 0.085).add(G.cyl, M.brass, 0, 0.325, 0.2, 0, 0, 0, 0.09, 0.05, 0.09)
      .build(pj);
    O.lens = new T.Mesh(G.cyl, new T.MeshBasicMaterial({ color: 0x1a2230 })); O.lens.rotation.x = Math.PI / 2; O.lens.scale.set(0.066, 0.006, 0.066); O.lens.position.set(...PROJ.lens); pj.add(O.lens);
    const reelGeo = (() => {
      const r = kit(); r.add(G.torus, M.iron, 0, 0, 0, 0, Math.PI / 2, 0, 0.26, 0.26, 0.4);
      [0, 1, 2].forEach(i => r.box(M.iron, 0.012, 0.25, 0.014, 0, 0, 0, i * Math.PI / 3, 0, 0));
      r.add(G.cyl, M.iron, 0, 0, 0, 0, 0, Math.PI / 2, 0.16, 0.026, 0.16);
      const g = new T.Group(); r.build(g); return g.children[0].geometry;
    })();
    O.reels = [-0.12, 0.15].map(rz => { const m = new T.Mesh(reelGeo, M.iron); m.position.set(0, 0.5, rz); pj.add(m); return m; });
    // the beam: four soft sides from the lens to the picture, added light, built when the picture's size is known.
    // A faint haze, brightest at the lens and gone before the screen, so it never washes over the film
    O.beamMat = new T.ShaderMaterial({
      uniforms: { uO: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uO; uniform float uT; varying vec2 vUv;
        void main(){
          float s = sin(3.14159 * vUv.x), across = s * s;
          float along = pow(1.0 - vUv.y, 1.6);
          float drift = 0.8 + 0.2 * sin(vUv.y * 34.0 - uT * 2.3 + vUv.x * 5.0) * sin(vUv.y * 13.0 + uT * 1.1);
          float a = uO * across * along * drift * 0.09;
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.82) * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
    });
    O.beam = new T.Mesh(new T.BufferGeometry(), O.beamMat); O.beam.visible = false; O.beam.frustumCulled = false; O.beam.renderOrder = 4; root.add(O.beam);
    pose();
  }
  // the beam from the lens (fully up) to a w x h picture centred on the picture area
  function beamTo(w, h) {
    if (Math.abs(w - A.beamW) < 1e-3 && Math.abs(h - A.beamH) < 1e-3) return;
    A.beamW = w; A.beamH = h;
    const lx = STAND.x + PROJ.lens[0], ly = PROJ.up + PROJ.lens[1], lz = STAND.z + PROJ.lens[2] - 0.003;
    const a = [[-0.03, -0.022], [0.03, -0.022], [0.03, 0.022], [-0.03, 0.022]].map(([x, y]) => [lx + x, ly + y, lz]);
    const zz = SCR.z + 0.01, b = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [x, PIC_Y + y, zz]);
    const pos = [], uv = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, q = [[a[i], 0, 0], [a[j], 1, 0], [b[j], 1, 1], [a[i], 0, 0], [b[j], 1, 1], [b[i], 0, 1]];
      q.forEach(([p, u, v]) => { pos.push(p[0], p[1], p[2]); uv.push(u, v); });
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    O.beam.geometry.dispose(); O.beam.geometry = g;
  }
  // set every moving part from A
  function pose() {
    const k = Math.max(0.0005, A.k), ease = (x) => x * x * (3 - 2 * x);
    O.fabric.scale.y = k * SCR.L; fabricTex.repeat.y = k; fabricTex.offset.y = 0;
    O.fabric.visible = A.k > 0.002;
    O.bar.position.y = SCR.roll - k * SCR.L;
    O.screenHit.visible = A.k > 0.97;
    const lid = ease(A.lid); O.flaps.forEach(pv => { pv.rotation.z = -pv.userData.side * lid * 1.9; });
    const y = PROJ.down + (PROJ.up - PROJ.down) * ease(A.lift);
    O.proj.position.y = y; O.proj.visible = A.lid > 0.02 || A.lift > 0;
    O.column.visible = O.proj.visible; O.column.scale.y = Math.max(0.01, y - 0.14); O.column.position.y = (y + 0.14) / 2;
    const hh = STAND.h + 0.04 + (y - PROJ.down) * 0.75; O.standHit.scale.y = hh; O.standHit.position.y = hh / 2;   // the risen projector is part of it
    const L = A.lamp;
    O.pic.visible = L > 0.003; O.picMat.opacity = L; O.field.material.opacity = L * 0.92;
    O.beam.visible = L > 0.003; O.beamMat.uniforms.uO.value = L;
    O.lens.material.color.setRGB(0.1 + 0.9 * L, 0.13 + 0.82 * L, 0.19 + 0.6 * L);
    O.reels.forEach((r, i) => { r.rotation.x = A.reel * (i ? 1 : 1.35); });
  }

  /* ---------------- the film being shown, here ----------------
     cur: the room's screen as last synced. F: this copy's player for it, made lazily:
       F = { kind, src, list (urls to try), i, cors, mode: 'idle'|'loading'|'tex'|'over'|'dom'|'yt'|'error', dur, frame, ended, mine } */
  let cur = null, curKey = '', syncs = 0, F = null, pending = null;
  let video = null, vtex = null, watching = false, viewOpen = false, Y = null;
  let ours = 0;                                         // when this page last told the player to do something
  const own = { play: 0, pause: 0, seek: 0 };           // ...and the film's player, by command: your pause just after a sync seek is still yours
  const mark = (k) => { ours = own[k] = now(); };
  let lastDrift = 0, lastNote = 0;
  let sysAt = 0;                                        // when this page last set the video's volume or muting itself
  let fullVid = false;                                  // the film's own <video> fills the screen (from the 3D screen)
  let sysFull = false;                                  // ... in an iPhone's own player
  let texAt = -1, blindBrowser = false;                 // the frame last handed to the 3D screen; this browser can't paint films there
  let probeC = null, probeAt = 0, probeT = -1, blank = 0, dark = 0, darkSig = '';
  let relayC = null, relayG = null;                     // the canvas each frame is drawn into for the 3D screen
  let overW = 640, overH = 480;                         // the overlaid <video>'s own size, before its warp
  // Safari and everything on an iPhone or iPad (Chrome and Firefox there are Safari underneath), or ?overlay to try it
  const APPLE = (/AppleWebKit/.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(navigator.userAgent)) || /[?&]overlay\b/.test(location.search);
  const now = () => performance.now();
  const shared = () => !!(ctx && ctx.shared && ctx.shared());
  const isHost = () => !ctx || !ctx.host || ctx.host();
  const expected = () => (cur ? (cur.playing ? cur.pos + (Date.now() - cur.at) / 1000 : cur.pos) : 0);
  const screenReady = () => A.k > 0.995 && A.lamp > 0.6;
  const inWindow = () => F && (F.kind === 'youtube' || F.mode === 'dom');
  function localTime() {
    if (F && F.kind === 'youtube' && Y && Y.ready) return Y.time + (Y.state === 1 ? (now() - Y.timeAt) / 1000 : 0);
    if (F && F.kind === 'file' && video && video.readyState >= 1 && (F.mode === 'tex' || F.mode === 'dom' || F.mode === 'over')) return video.currentTime;
    return Math.max(0, expected());
  }

  // main.js relayout: the room may have changed
  function sync(room) {
    let s = room && room.screen || null;
    if (!built) return;
    if (!syncs && s && s.playing && !shared()) {        // your own room, reopened: the film waits where you left it
      s.playing = false; s.pos = Math.max(0, mem.at[s.src] || 0);
    }
    syncs++;
    const key = s ? JSON.stringify(s) : '';
    if (key === curKey) return;
    const prev = cur; cur = s ? Object.assign({}, s) : null; curKey = key;
    changed(prev, cur);
    if (syncs === 1) { A.k = A.lift = A.lid = A.lamp = want.down ? 1 : 0; pose(); }   // a room you open is as it was left
  }
  function changed(prev, s) {
    want.down = !!(s && s.down);
    const film = s && s.src ? s.kind + '|' + s.src : '', was = prev && prev.src ? prev.kind + '|' + prev.src : '';
    const mine = !!(pending && pending.film === film && now() < pending.until);
    if (film !== was) {
      if (F && prev && (F.mode === 'tex' || F.mode === 'over' || F.mode === 'dom' || (Y && Y.ready))) notePlace(prev.src, localTime(), F.dur);
      unload();
      if (film) {
        F = { kind: s.kind, src: s.src, list: (FILM_OF.get(s.src) || { files: [s.src] }).files.slice(), i: 0, cors: true, mode: 'idle', dur: 0, frame: false, ended: false, mine };
        if (F.list[0] !== s.src) F.list.unshift(s.src);
        F.list = [...new Set(F.list)];
        watching = mine;
        if (!mine && syncs > 1) ctx.toast((s.kind === 'youtube' ? 'On the screen, from YouTube: ' : 'On the screen: ') + s.title + (s.kind === 'youtube' ? '. Click the screen to watch.' : '.'), 3600);
      }
      pending = null;
    }
    if (F && s && s.playing) F.ended = false;
    if (F && mine && s && s.playing && F.kind === 'youtube' && !viewOpen) openView();
    drive(true);
    paint();
    wake();
  }
  function unload() {
    if (fullVid) { exitFull(); restoreVideo(); }
    if (viewOpen) closeView(true);
    if (video) { video.pause(); video.removeAttribute('src'); try { video.load(); } catch (e) {} sysAt = now(); video.muted = muted; }
    if (vtex) { vtex.dispose(); vtex = null; }
    if (O.picMat) O.picMat.map = cardTex;
    F = null; watching = false;
  }

  /* --- the <video>: made on first use, copied onto the screen when its server allows (CORS), else laid over it --- */
  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.playsInline = true; video.setAttribute('playsinline', ''); video.preload = 'auto';
    $('#cineHold').appendChild(video);
    const mineEv = (fn) => (e) => { if (F && F.kind === 'file' && F.url && video.src === F.url) fn(e); };
    video.addEventListener('loadedmetadata', mineEv(onMeta));
    video.addEventListener('error', mineEv(onErr));
    video.addEventListener('playing', mineEv(() => { F.frame = true; paint(); wake(); }));   // the loop may have slept while it loaded
    video.addEventListener('seeked', mineEv(() => { F.frame = true; relayFrame(); wake(); }));
    video.addEventListener('resize', mineEv(() => { if (F.mode === 'over') { if (video.parentNode === $('#cineOver')) sizeOver(); paint(); return; } if (F.mode === 'tex' && relayC && (relayC.width < 3 || Math.abs(relayC.width / relayC.height - video.videoWidth / Math.max(1, video.videoHeight)) > 0.01)) { makeRelay(); relayFrame(); paint(); } }));
    video.addEventListener('waiting', mineEv(() => paint()));
    video.addEventListener('ended', mineEv(onEnded));
    // in the window or full screen, the player's own buttons work for the whole room; its sound is yours alone
    video.addEventListener('pause', mineEv(() => { if (steering() && now() - own.pause > 900 && cur && cur.playing && !video.ended) setScreen({ playing: false, pos: video.currentTime }); }));
    video.addEventListener('play', mineEv(() => { if (steering() && now() - own.play > 900 && cur && !cur.playing) setScreen({ down: true, playing: true, pos: video.currentTime }); }));
    video.addEventListener('seeking', mineEv(() => { if (steering() && now() - own.seek > 900 && cur && Math.abs(video.currentTime - expected()) > 2) setScreen({ pos: video.currentTime }); }));
    video.addEventListener('volumechange', mineEv(() => {
      if (now() - sysAt < 400 || !steering()) return;
      if (Math.abs(video.volume - vol) > 0.005) { vol = video.volume; mem.vol = vol; }
      if (video.muted !== effMuted()) { muted = video.muted; F.muted = false; mem.mute = muted; }
      remember(); paint();
    }));
    video.addEventListener('webkitbeginfullscreen', () => { sysFull = true; });                // an iPhone's own player
    video.addEventListener('webkitendfullscreen', () => { sysFull = false; if (fullVid) restoreVideo(); });
    return video;
  }
  function loadSrc() {
    const v = ensureVideo(), url = F.list[F.i];
    F.mode = 'loading'; F.url = new URL(url, location.href).href; F.frame = false;
    if (F.cors) v.crossOrigin = 'anonymous'; else v.removeAttribute('crossorigin');
    sysAt = now(); v.volume = vol; v.muted = muted; v.src = url;
    try { v.load(); } catch (e) {}
    paint();
  }
  function onMeta() {
    F.dur = isFinite(video.duration) ? video.duration : 0;
    if (F.cors && !blindBrowser && !APPLE) {
      F.mode = 'tex'; probeT = -1; blank = 0; dark = 0; darkSig = '';
      if (!fullVid && !viewOpen && video.parentNode !== $('#cineHold')) { video.style.cssText = ''; $('#cineHold').appendChild(video); }
      makeRelay();
    } else toOver();                                     // Safari, or a server that won't share its pixels: the overlay
    drive(true); paint();
  }
  function onErr() {
    if (F.i + 1 < F.list.length) { F.i++; loadSrc(); return; }
    if (F.cors) { F.cors = false; F.i = 0; loadSrc(); return; }   // perhaps only CORS is missing: try without, for the overlay
    F.mode = 'error';
    if (viewOpen) closeView(true);
    if (F.mine) ctx.toast(FILM_OF.get(F.src) ? 'That film could not be loaded from Wikimedia Commons. Check the connection and try again.' : 'That film could not be loaded. For a link, use a direct .mp4 or .webm file.', 4200);
    if ((F.mine || !shared()) && cur && cur.playing) setScreen({ playing: false, pos: 0 });   // friends may still load it
    paint();
  }
  function onEnded() {
    if (F.ended) return;
    F.ended = true; notePlace(F.src, 0, F.dur);
    if (video && !video.paused) { mark('pause'); video.pause(); }
    if (isHost() && cur && cur.playing) setScreen({ playing: false, pos: 0 });
    paint();
  }
  /* --- the 3D screen shows each frame copied through a canvas. Safari (iPhone, iPad and Mac) plays these films and
         draws them onto a canvas, but its direct video-to-WebGL path can leave the screen black. --- */
  function makeRelay() {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480, k = Math.min(1, 1024 / Math.max(vw, vh));
    relayC = relayC || document.createElement('canvas');
    relayC.width = Math.max(2, Math.round(vw * k)); relayC.height = Math.max(2, Math.round(vh * k));
    relayG = relayC.getContext('2d', { alpha: false });
    relayG.fillStyle = '#000'; relayG.fillRect(0, 0, relayC.width, relayC.height);
    if (vtex) vtex.dispose();
    vtex = new T.CanvasTexture(relayC); vtex.colorSpace = T.SRGBColorSpace; vtex.minFilter = T.LinearFilter; vtex.generateMipmaps = false;
    texAt = -1;
  }
  function relayFrame() {
    if (!vtex || !relayG || !video || video.readyState < 2) return;
    try { relayG.drawImage(video, 0, 0, relayC.width, relayC.height); vtex.needsUpdate = true; texAt = video.currentTime; } catch (e) {}
  }
  /* --- the overlay: the <video> itself over the canvas, warped onto the screen's picture each frame --- */
  function toOver() {
    F.mode = 'over';
    if (vtex) { vtex.dispose(); vtex = null; }
    if (O.picMat) O.picMat.map = cardTex;
    if (fullVid || viewOpen) return;                   // it goes onto the screen when the window or full screen closes
    video.controls = false;
    $('#cineOver').appendChild(video);
    sizeOver();
  }
  function sizeOver() {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    overW = 640; overH = Math.max(2, Math.round(640 * vh / vw));
    video.style.width = overW + 'px'; video.style.height = overH + 'px';
    hideOver();
  }
  // out of sight: tiny and clear rather than visibility:hidden, which an iPhone may take as "don't play"
  function hideOver() { if (video.style.opacity !== '0') { video.style.opacity = '0'; video.style.transform = 'scale(0.004)'; } }
  // the 3x3 projective map taking the video's corners (0,0) (w,0) (0,h) (w,h) to four points on the page, as CSS
  function warp(w, h, q) {
    const adj = (m) => [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
    const mm = (a, b) => { const c = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c.push(a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]); return c; };
    const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    const basis = (p) => { const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1], v = mv(adj(m), [p[3][0], p[3][1], 1]); return mm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); };
    const t = mm(basis(q), adj(basis([[0, 0], [w, 0], [0, h], [w, h]])));
    for (let i = 0; i < 9; i++) t[i] /= t[8];
    return 'matrix3d(' + [t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]].join(',') + ')';
  }
  const _oc = [0, 1, 2, 3].map(() => new T.Vector3());
  // main.js calls this right after it draws the room, so the video sits exactly on that frame's screen
  function afterRender() {
    if (!F || F.mode !== 'over' || !video || video.parentNode !== $('#cineOver')) return;
    const cam = ctx.camera;
    let show = !!O.overOn && screenReady() && cam.position.z < 8.3, q = null;   // not from the Great Hall, through its wall
    if (show) {
      q = [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]].map(([x, y], i) => { const v = _oc[i].set(x, y, 0); O.picture.localToWorld(v); v.project(cam); return v; });
      if (q.some(v => v.z < -1 || v.z > 1)) show = false;                       // a corner behind you: no warp can draw it
    }
    if (!show) { hideOver(); return; }
    const el = ctx.renderer.domElement, w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;   // where the frame is shown
    video.style.transform = warp(overW, overH, q.map(v => [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h]));
    video.style.opacity = String(Math.max(0.01, Math.min(1, A.lamp)));
  }
  function seekVideo(t) { if (!video || !isFinite(t)) return; mark('seek'); try { video.currentTime = Math.max(0, F.dur ? Math.min(t, F.dur - 0.05) : t); } catch (e) {} }
  function playVideo() {
    mark('play');
    const p = video.play();
    if (p && p.catch) p.catch((err) => {
      if (err && err.name === 'NotAllowedError' && !video.muted) { sysAt = now(); video.muted = true; F.muted = true; paint(); mark('play'); video.play().catch(() => {}); }
    });
  }

  /* --- your own sound and your own full screen: neither changes anything for anyone else --- */
  const effMuted = () => (F && F.kind === 'youtube' && Y && typeof Y.muted === 'boolean') ? Y.muted : (muted || !!(F && F.muted));
  function setMuted(m) {
    muted = !!m; mem.mute = muted; remember();
    if (F) F.muted = false;
    if (video) { sysAt = now(); video.muted = muted; }
    if (Y) { Y.muted = muted; ytCmd(muted ? 'mute' : 'unMute'); }
    if (!muted && cur && cur.playing && F && F.kind === 'file' && video && video.paused) drive(true);   // held back until a click
    paint();
  }
  function toggleMute() {
    if (!cur || !cur.src) return false;
    setMuted(!effMuted());
    ctx.toast(effMuted() ? 'Muted for you. Everyone else still hears the film.' : 'Sound on.', 1800);
    return true;
  }
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  // in the window or full screen the player's own controls are working (otherwise this page drives it)
  const steering = () => !!(F && video && F.kind === 'file' && (viewOpen || (fullVid && (fsEl() === video || sysFull))));
  function askFull(el) {
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!f) return Promise.reject(new Error('no fullscreen'));
    try { const p = f.call(el); return p && typeof p.then === 'function' ? p : Promise.resolve(); } catch (e) { return Promise.reject(e); }
  }
  function exitFull() {
    const f = document.exitFullscreen || document.webkitExitFullscreen;
    if (fsEl() && f) { try { const p = f.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    if (sysFull && video && video.webkitExitFullscreen) { try { video.webkitExitFullscreen(); } catch (e) {} }
  }
  // an iPhone lets only its own player fill the screen
  function systemFull(v) { if (!v || !v.webkitEnterFullscreen) return false; try { v.webkitEnterFullscreen(); return true; } catch (e) { return false; } }
  function restoreVideo() {
    fullVid = false;
    if (video && video.parentNode === $('#cineFull')) { video.controls = false; $(F && F.mode === 'over' ? '#cineOver' : '#cineHold').appendChild(video); if (F && F.mode === 'over') hideOver(); }   // until the next frame places it
    paint(); wake();
  }
  function fullscreen() {
    if (!cur || !cur.src || !F) { ctx.toast('Choose a film first.'); return; }
    if (F.mode === 'error') { ctx.toast('This film could not be loaded.'); return; }
    if (fsEl() || fullVid) { exitFull(); return; }
    if (inWindow() || viewOpen) {                         // YouTube, or a film in the window: the window's picture fills the screen
      if (!viewOpen) openView();
      if (!viewOpen) return;
      askFull($('#cvStage')).catch(() => {
        if (F && F.kind === 'file' && systemFull(video)) return;
        ctx.toast(F && F.kind === 'youtube' ? 'Use the full-screen button inside the YouTube player.' : 'This browser won’t go full screen here.', 3600);
      });
      return;
    }
    // a film on the 3D screen: its own picture fills your screen, with its own play, seek and volume controls
    if (F.mode === 'idle') loadSrc();
    const v = ensureVideo();
    $('#cineFull').appendChild(v); v.controls = true; v.style.transform = ''; v.style.opacity = '';
    sysAt = now(); v.volume = vol;
    fullVid = true;
    askFull(v).then(() => { drive(true); paint(); wake(); }, () => {
      if (systemFull(v)) { drive(true); return; }
      restoreVideo(); ctx.toast('This browser won’t go full screen here.', 3200);
    });
    paint();
  }
  function onFullChange() { if (fullVid && fsEl() !== video && !sysFull) restoreVideo(); else paint(); }
  document.addEventListener('fullscreenchange', onFullChange);
  document.addEventListener('webkitfullscreenchange', onFullChange);

  /* --- some browsers play a film yet can't paint its pictures onto the 3D screen, which stays black while the
         sound runs. Look at a frame now and then; if nothing ever comes through, use the overlay. --- */
  function probeFrames(tn) {
    if (!F || F.mode !== 'tex' || F.seen || !video || video.paused || video.readyState < 2 || fullVid || viewOpen || tn - probeAt < 1500) return;
    probeAt = tn;
    const t = video.currentTime;
    if (probeT >= 0 && Math.abs(t - probeT) < 0.4) return;   // not moving: nothing to judge yet
    probeT = t;
    let ok = null;
    try {
      probeC = probeC || cv(8, 8);
      const g = probeC.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, 8, 8); g.drawImage(video, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data; ok = false;
      for (let i = 3; i < d.length; i += 4) if (d[i]) { ok = true; break; }   // even a black frame comes through opaque
    } catch (e) { ok = e && e.name === 'SecurityError' ? false : null; }
    if (ok) {
      blank = 0;
      const d = probeC.getContext('2d').getImageData(0, 0, 8, 8).data; let mx = 0, sig = '';
      for (let i = 0; i < d.length; i += 4) { mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); sig += d[i] + ','; }
      if (mx >= 6 || (dark && sig !== darkSig)) { F.seen = true; dark = 0; return; }   // real pictures (even film grain in the dark moves)
      darkSig = sig; if (++dark >= 8) blind();                                         // a browser handing over only black (~12 s)
    }
    else if (ok === false && ++blank >= 2) blind();
  }
  function blind() {
    blindBrowser = true; F.blind = true;
    toOver(); drive(true); paint();
  }

  /* --- YouTube, in a frame, steered with the player's postMessage commands --- */
  function ytCmd(func, args) { if (Y && Y.frame.contentWindow) { try { Y.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [], id: 1, channel: 'widget' }), '*'); } catch (e) {} } if (func !== 'setVolume') ours = now(); }
  function ytOpen(stage) {
    const start = Math.max(0, Math.floor(expected()));
    const q = new URLSearchParams({ autoplay: cur.playing ? '1' : '0', start: String(start), enablejsapi: '1', playsinline: '1', rel: '0' });
    if (muted) q.set('mute', '1');
    if (location.origin && location.origin !== 'null') q.set('origin', location.origin);
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + F.src + '?' + q.toString();
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.referrerPolicy = 'strict-origin-when-cross-origin'; f.title = cur.title;
    Y = { frame: f, ready: false, heard: false, time: start, timeAt: now(), state: -1, dur: 0, tries: 0, timer: 0, muted };
    f.addEventListener('load', () => {
      if (!Y || Y.frame !== f) return;
      clearInterval(Y.timer);
      Y.timer = setInterval(() => {
        if (!Y || Y.heard || ++Y.tries > 40) { if (Y) clearInterval(Y.timer); return; }
        try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) {}
      }, 250);
    });
    stage.appendChild(f);
    ours = now();
  }
  addEventListener('message', (e) => {
    if (!Y || e.source !== Y.frame.contentWindow) return;
    let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
    if (!d || typeof d !== 'object') return;
    Y.heard = true;
    if (d.event === 'onReady') { Y.ready = true; ytCmd('setVolume', [Math.round(vol * 100)]); if (muted) ytCmd('mute'); drive(true); }
    const info = d.event === 'infoDelivery' && d.info && typeof d.info === 'object' ? d.info : null;
    if (info) {
      Y.ready = true;
      if (typeof info.currentTime === 'number') {
        const t = now(), predicted = Y.time + (Y.state === 1 ? (t - Y.timeAt) / 1000 : 0);
        if (Y.state >= 1 && Math.abs(info.currentTime - predicted) > 2.5 && t - ours > 1500 && cur && cur.src === F.src) setScreen({ pos: info.currentTime, playing: Y.state === 1 });   // someone used the player's own bar
        Y.time = info.currentTime; Y.timeAt = t;
      }
      if (typeof info.duration === 'number' && info.duration > 0) { Y.dur = info.duration; F.dur = info.duration; }
      if (typeof info.muted === 'boolean' && info.muted !== Y.muted) { Y.muted = info.muted; paint(); }
      if (info.videoData && info.videoData.title && F.mine && cur && cur.title === 'A YouTube video') setScreen({ title: clip(info.videoData.title, 120) });
      if (typeof info.playerState === 'number') ytState(info.playerState);
    }
    if (d.event === 'onStateChange' && typeof d.info === 'number') ytState(d.info);
  });
  function ytState(stt) {
    if (!Y || stt === Y.state) return;
    Y.state = stt;
    if (!cur || !F || F.kind !== 'youtube') return;
    const fresh = now() - ours > 1500;
    if (stt === 0) { F.ended = true; if (isHost() && cur.playing) setScreen({ playing: false, pos: 0 }); }
    else if (stt === 2 && cur.playing && fresh) setScreen({ playing: false, pos: Y.time });
    else if (stt === 1 && !cur.playing && fresh) setScreen({ playing: true, pos: Y.time });
    paint();
  }

  /* --- the big-screen window: a film up close, a step short of full screen; and YouTube, which plays only here --- */
  function openView() {
    if (!F || !cur || F.mode === 'error') return;
    watching = true;
    const stage = $('#cvStage'); stage.innerHTML = '';
    $('#cvT').textContent = cur.title;
    if (F.kind === 'youtube') ytOpen(stage);
    else {
      if (F.mode === 'idle') loadSrc();
      ensureVideo(); video.style.cssText = ''; video.controls = true; stage.appendChild(video); sysAt = now(); video.volume = vol;
    }
    viewOpen = true;
    ctx.openSheet('cineView');
    drive(true); paint(); wake();
  }
  // closed by Esc, the ✕, a click outside, or another sheet opening. A film from the 3D screen goes back
  // there and plays on; one that shows only here stops (for you alone, if others are here)
  function closeView(quiet) {
    if (!viewOpen) return;
    if (fsEl() && $('#cineView').contains(fsEl())) exitFull();
    viewOpen = false;
    const t = localTime(), back = !!(F && F.kind === 'file' && (F.mode === 'tex' || F.mode === 'over'));
    if (Y) { clearInterval(Y.timer); Y.frame.remove(); Y = null; }
    if (video && video.parentNode === $('#cvStage')) {
      video.controls = false; video.style.cssText = '';
      if (back && F.mode === 'over') { $('#cineOver').appendChild(video); sizeOver(); }
      else { if (!back) { mark('pause'); video.pause(); } $('#cineHold').appendChild(video); }
    }
    watching = false;
    if (!$('#cineView').hidden) ctx.closeSheets();
    if (F && cur) notePlace(cur.src, t, F.dur);
    if (!quiet && !back && !shared() && cur && cur.playing) setScreen({ playing: false, pos: t });
    paint(); wake();
  }
  new MutationObserver(() => { if ($('#cineView').hidden && viewOpen) closeView(); }).observe($('#cineView'), { attributes: true, attributeFilter: ['hidden'] });

  /* --- keep this copy's player where the room says the film is --- */
  function drive(force) {
    if (!cur || !F || !cur.src) return;
    const s = cur, exp = expected(), t = now();
    if (F.kind === 'file') {
      if (F.mode === 'idle') { if (s.playing) loadSrc(); else return; }
      if ((F.mode !== 'tex' && F.mode !== 'dom' && F.mode !== 'over') || !video || video.readyState < 1) return;
      if (s.playing && F.dur && exp >= F.dur - 0.2 && !F.ended) { onEnded(); return; }    // the room's clock ran past the end
      const show = F.mode === 'tex' || F.mode === 'over' || (viewOpen && watching) || fullVid;
      const go = s.playing && show && exp >= 0 && (F.mode === 'dom' || fullVid || viewOpen || screenReady()) && !(F.dur && exp >= F.dur - 0.2);
      if (go) {
        if (video.paused) { if (Math.abs(video.currentTime - exp) > 0.75) seekVideo(exp); playVideo(); lastDrift = t; }
        else if ((force || (shared() && t - lastDrift > 3000)) && !video.seeking) {   // allow ~2 s of drift between friends
          lastDrift = t; if (Math.abs(video.currentTime - exp) > (force ? 0.75 : 2)) seekVideo(exp);
        }
      } else {
        if (!video.paused) { mark('pause'); video.pause(); }
        const park = Math.max(0, s.playing ? exp : s.pos);
        if (force && !(F.dur && park >= F.dur - 0.2) && Math.abs(video.currentTime - park) > 1) seekVideo(park);
      }
    } else if (F.kind === 'youtube') {
      if (!Y || !Y.ready || !watching) return;
      const yt = localTime();
      if (s.playing && exp >= 0) {
        if (Y.state !== 1 && Y.state !== 3 && (force || t - ours > 1500)) { if (Math.abs(yt - exp) > 2) ytCmd('seekTo', [exp, true]); ytCmd('playVideo'); }
        else if (Y.state === 1 && shared() && t - lastDrift > 4000) { lastDrift = t; if (Math.abs(yt - exp) > 3) ytCmd('seekTo', [exp, true]); }
      } else if (Y.state === 1 && (force || t - ours > 1500)) {
        ytCmd('pauseVideo'); if (Math.abs(yt - Math.max(0, s.pos)) > 2) ytCmd('seekTo', [Math.max(0, s.pos), true]);
      }
    }
  }

  /* ---------------- asking the room to change ---------------- */
  function setScreen(patch) {
    const base = cur || { down: false, src: '', kind: 'file', title: '', playing: false, pos: 0 };
    const s = Object.assign({}, base, patch); delete s.at;
    if (!('pos' in patch) && base.playing) s.pos = expected();   // `at` is stamped afresh, so carry the film's place with it
    if (patch.src !== undefined) pending = { film: s.src ? s.kind + '|' + s.src : '', until: now() + 20000 };
    return ctx.doOp(Object.assign({ t: 'screen' }, s));
  }
  // the lead-in: time for the screen to come down, the projector to rise and the film to load (none if it is all ready)
  const lead = (src) => (screenReady() && F && F.src === src && (F.mode === 'tex' || F.mode === 'over') && video && video.readyState >= 3 ? 0 : A.k > 0.99 && A.lamp > 0.9 ? 1.2 : 3.6);
  function start(item) {
    const at = mem.at[item.src] || 0;
    ctx.closeSheets();                                   // first: a YouTube film opens its own window as the op lands
    const ok = setScreen({ down: true, src: item.src, kind: item.kind, title: item.title, playing: true, pos: (item.start || at) - (item.kind === 'youtube' ? 0 : lead(item.src)) });
    if (ok !== true) return;
    if (at && !item.start) ctx.toast('Carrying on from ' + fmt(at) + '. “From the start” is in the cinema panel.', 3200);
    prime(item.src);
  }
  // on a phone the first play() must come from the tap itself; start the element now and let drive() pause it
  function prime(src) {
    if (!F || F.kind !== 'file' || F.src !== src) return;
    if (F.mode === 'idle') loadSrc();
    if (video && video.paused) { mark('play'); const p = video.play(); if (p && p.then) p.then(() => { if (!(cur && cur.playing && screenReady() && expected() >= 0)) { mark('pause'); video.pause(); } }, () => {}); }
  }
  function playFilm(f) { start({ kind: 'file', src: f.files[0], title: filmTitle(f) }); }
  function pause() { if (cur && cur.src) setScreen({ playing: false, pos: Math.max(0, localTime()) }); }
  function retry() { if (F && F.mode === 'error') { F.mode = 'idle'; F.i = 0; F.cors = true; } }
  function resume() {
    if (!cur || !cur.src) return;
    retry();
    const src = cur.src, from = F && F.ended ? 0 : Math.max(0, cur.pos);
    if (setScreen({ down: true, playing: true, pos: from - (cur.kind === 'youtube' ? 0 : lead(src)) }) === true) prime(src);
    if (cur && cur.kind === 'youtube' && !viewOpen) openView();
  }
  function restart() {
    if (!cur || !cur.src) return;
    retry();
    const src = cur.src; if (F) F.ended = false;
    if (setScreen({ down: true, playing: true, pos: -(cur.kind === 'youtube' ? 0 : lead(src)) }) === true) prime(src);
    if (cur && cur.kind === 'youtube' && !viewOpen) openView();
  }
  function stopFilm() { if (cur && cur.src) { notePlace(cur.src, localTime(), F && F.dur); setScreen({ src: '', title: '', kind: 'file', playing: false, pos: 0 }); } }
  function toggleScreen() {
    if (cur && cur.down) setScreen({ down: false, playing: false, pos: cur.src ? Math.max(0, localTime()) : 0 });
    else setScreen({ down: true });
  }
  function seekTo(t) { if (cur && cur.src) setScreen({ pos: t - (cur.playing && cur.kind === 'file' ? 0.4 : 0) }); }

  /* --- a pasted link --- */
  function ytId(text) {
    const s = String(text || '').trim();
    if (YT_ID.test(s)) return s;
    let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.split('/')[1];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[2]; }
    }
    return id && YT_ID.test(id) ? id : null;
  }
  function ytStart(text) {
    let u; try { u = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'https://' + text); } catch (e) { return 0; }
    const t = u.searchParams.get('t') || u.searchParams.get('start') || ''; if (!t) return 0;
    if (/^\d+$/.test(t)) return +t;
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }
  function playLink() {
    const text = $('#cinUrl').value.trim(); if (!text) { $('#cinUrl').focus(); return; }
    const id = ytId(text);
    if (id) { start({ kind: 'youtube', src: id, title: 'A YouTube video', start: ytStart(text) }); return; }
    const url = httpUrl(/^[a-z]+:\/\//i.test(text) ? text : 'https://' + text);
    if (!url) { ctx.toast('That doesn’t look like a web link.'); return; }
    const u = new URL(url);
    if (/(^|\.)archive\.org$/.test(u.hostname) && /^\/details\//.test(u.pathname)) { ctx.toast('That is the film’s page. Use a file from its “Download options”, the link ending .mp4.', 5000); return; }
    if (u.hostname === 'commons.wikimedia.org') { ctx.toast('That is the file’s page. Open the file itself (the link on upload.wikimedia.org) and paste that.', 5000); return; }
    const name = decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ').trim();
    start({ kind: 'file', src: url, title: clip(name, 80) || hostOf(url) });
  }

  /* ---------------- painting the panel, the chip and the screen ---------------- */
  function status() {
    const s = cur;
    if (!s || !s.src) return s && s.down ? 'The screen is down. Choose a film below.' : 'The screen is rolled up in its case over the fire.';
    if (F && F.mode === 'error') return 'This film could not be loaded.';
    if (F && F.kind === 'youtube') return (s.playing ? 'Playing' : 'Paused') + ' in a window over the room' + (viewOpen ? '.' : ' — Watch to see it.');
    if (F && F.mode === 'dom') return (s.playing ? 'Playing' : 'Paused') + ' in a window (this file’s server does not let it be painted on the screen)' + (viewOpen ? '.' : ' — Watch to see it.');
    if (!s.down) return 'Paused at ' + fmt(Math.max(0, s.pos)) + '. The screen is rolled up.';
    if (s.playing && expected() < 0) return 'The projectionist is threading the film…';
    if (s.playing && F && (F.mode === 'loading' || (video && video.readyState < 3 && (F.mode === 'tex' || F.mode === 'over')))) return 'Loading…';
    if (F && F.ended && !s.playing) return 'The end.';
    return s.playing ? 'Playing on the screen.' : 'Paused at ' + fmt(Math.max(0, s.pos)) + '.';
  }
  function paint() {
    const s = cur, film = !!(s && s.src);
    // the chip
    const hud = $('#cineHud');
    hud.hidden = !film || viewOpen;
    if (film) {
      $('#chT').textContent = s.title;
      const pp = $('#chPlay'); pp.textContent = s.playing ? '❚❚' : '▶'; pp.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    }
    // the panel
    $('#cinK').textContent = film ? 'Now showing' : 'The screen';
    $('#cinT').textContent = film ? s.title : (s && s.down ? 'Down, and waiting for a film' : 'Rolled up');
    $('#cinSt').textContent = status();
    $('#cinPlay').hidden = !film; $('#cinPlay').textContent = s && s.playing ? 'Pause' : 'Play';
    $('#cinWatch').hidden = !(film && F && F.mode !== 'error' && !viewOpen);
    $('#cinStart').hidden = !film; $('#cinStop').hidden = !film;
    $('#cinRoll').textContent = s && s.down ? 'Roll the screen up' : 'Pull the screen down';
    const mOn = effMuted(), canFull = film && !(F && F.mode === 'error');
    ['chMute', 'cvMute'].forEach(id => {
      const b = $('#' + id);
      if (b.dataset.m !== String(mOn)) { b.innerHTML = mOn ? ICO.off : ICO.on; b.dataset.m = String(mOn); }
      b.setAttribute('aria-pressed', String(mOn)); b.setAttribute('aria-label', mOn ? 'Unmute, just for you' : 'Mute, just for you'); b.title = (mOn ? 'Unmute' : 'Mute') + ' — only for you (M)';
    });
    const cm = $('#cinMute'); cm.hidden = !film; cm.textContent = mOn ? 'Unmute' : 'Mute for me'; cm.setAttribute('aria-pressed', String(mOn));
    $('#chFull').hidden = !canFull; $('#cinFull').hidden = !canFull;
    $('#cinSeekRow').hidden = !film;
    $('#cinVol').value = Math.round(vol * 100);
    document.querySelectorAll('#cinList .bk').forEach(row => {
      const f = FILMS[+row.dataset.i], on = film && FILM_OF.get(s.src) === f;
      row.classList.toggle('on', on);
      const b = row.querySelector('button'); b.textContent = on ? (s.playing ? 'Showing' : 'Play') : (mem.at[f.files[0]] ? 'Carry on' : 'Play');
      b.disabled = on && s.playing;
    });
    paintTime();
    paintCard();
  }
  function paintTime() {
    if (!cur || !cur.src) return;
    const t = localTime(), d = (F && F.dur) || 0;
    $('#chTime').textContent = fmt(t) + (d ? ' / ' + fmt(d) : '');
    if (!$('#cinema').hidden) {
      $('#cinPos').textContent = fmt(t); $('#cinDur').textContent = d ? fmt(d) : '–:––';
      const sk = $('#cinSeek'); sk.disabled = !d; if (!seeking && d) sk.value = Math.round(1000 * Math.min(1, t / d));
      $('#cinSt').textContent = status();
    }
  }
  // what the lamp throws: the moving picture, or a card
  function paintCard() {
    if (!built) return;
    const s = cur;
    let kind = 'house', extra = '', tex = false, over = false;
    if (s && s.src) {
      if (F && F.mode === 'error') kind = 'error';
      else if (F && F.kind === 'youtube') { kind = 'window'; extra = viewOpen ? 'on the big screen, in its window' : 'Click the screen to watch'; }
      else if (F && F.mode === 'dom') { kind = 'window'; extra = viewOpen ? 'showing in a window' : 'Click the screen to watch, in a window'; }
      else if (F && F.ended && !s.playing) kind = 'end';
      else if (F && F.mode === 'tex' && F.frame && vtex && !(s.playing && expected() < 0)) tex = true;
      else if (F && F.mode === 'over' && F.frame && !(s.playing && expected() < 0)) over = true;
      else if (s.playing) { kind = 'intro'; extra = F && F.mode === 'loading' && expected() > 1 ? 'Loading…' : ''; }
      else kind = 'paused';
    }
    O.overOn = over;
    if (tex || over) {
      if (tex) { if (O.picMat.map !== vtex) O.picMat.map = vtex; }
      else { drawCard('blank', s); if (O.picMat.map !== cardTex) O.picMat.map = cardTex; }   // the overlaid video sits on this
      const vw = video.videoWidth || 4, vh = video.videoHeight || 3, a = vw / vh;
      const w = a >= SCR.pw / SCR.ph ? SCR.pw : SCR.ph * a, h = a >= SCR.pw / SCR.ph ? SCR.pw / a : SCR.ph;
      O.picture.scale.set(w, h, 1); beamTo(w, h);
    } else {
      drawCard(kind, s, extra);
      if (O.picMat.map !== cardTex) O.picMat.map = cardTex;
      O.picture.scale.set(SCR.pw, SCR.ph, 1); beamTo(SCR.pw, SCR.ph);
    }
  }

  /* ---------------- the loop: only while something moves or plays ---------------- */
  let running = false, lastT = 0, timeT = 0;
  function wake() { if (!running && built) { running = true; lastT = now(); requestAnimationFrame(loop); } }
  function loop(t) {
    const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000)); lastT = t;
    if (step(dt)) requestAnimationFrame(loop); else running = false;
  }
  const toward = (v, to, rate) => (v < to ? Math.min(to, v + rate) : Math.max(to, v - rate));
  function step(dt) {
    const down = want.down, before = A.k + A.lift + A.lid + A.lamp;
    // lamp out before anything goes back up; the lid opens before the projector rises
    const lampWant = down && A.k > 0.999 && A.lift > 0.999 ? 1 : 0;
    A.lamp = toward(A.lamp, lampWant, dt / (lampWant ? 0.7 : 0.35));
    const goUp = !down && A.lamp < 0.001;
    A.k = toward(A.k, down ? 1 : goUp ? 0 : A.k, dt / 2.6);
    A.lid = toward(A.lid, down || A.lift > 0.001 ? 1 : 0, dt / 0.5);
    A.lift = toward(A.lift, down && A.lid > 0.9 ? 1 : goUp ? 0 : A.lift, dt / 1.7);
    const moving = Math.abs(A.k + A.lift + A.lid + A.lamp - before) > 1e-6;
    const film = !!(cur && cur.src && F);
    const rolling = film && cur.playing && (F.kind !== 'file' || (video && !video.paused));
    if (rolling && A.lamp > 0.5) A.reel += dt * 2.2;
    // the lights go down while a film plays on the screen, in this room
    const cam = ctx.camera.position, inRoom = cam.z < 8.3;
    const dimWant = film && (F.mode === 'tex' || F.mode === 'over') && cur.playing && F.frame && inRoom && A.lamp > 0.5 ? 1 : 0;
    const dim0 = A.dim; A.dim = toward(A.dim, dimWant, dt / 1.6);
    if (A.dim !== dim0) ctx.renderer.toneMappingExposure = baseExposure * (1 - 0.3 * A.dim);
    if (film && F.kind === 'file' && video && (F.mode === 'tex' || F.mode === 'over') && !fullVid) {
      // the sound comes from the screen: softer across the room, faint in the hall (in the window or full screen, the player's own volume rules)
      if (!viewOpen) {
        const d = Math.hypot(cam.x, cam.y - PIC_Y, cam.z - SCR.z);
        const v = vol / (1 + Math.max(0, d - 6) * 0.15);
        if (Math.abs(video.volume - v) > 0.01) { sysAt = now(); video.volume = Math.max(0, Math.min(1, v)); }
      }
      // copy each new frame to the screen ourselves (no waiting on requestVideoFrameCallback, which browsers may
      // never call for a video they think nobody sees: ours is hidden, the 3D screen shows it)
      if (F.mode === 'tex' && video.currentTime !== texAt) relayFrame();
    }
    if (A.lamp > 0.003) O.beamMat.uniforms.uT.value += dt;
    drive(false);
    if (moving || film) paintCardIfNeeded();
    const tn = now();
    probeFrames(tn);
    if (tn - timeT > 500) { timeT = tn; paintTime(); }
    if (rolling && tn - lastNote > 6000) { lastNote = tn; notePlace(cur.src, localTime(), F.dur); }
    pose();
    if (A.lamp > 0.003) O.beamMat.uniforms.uO.value = A.lamp * (rolling ? 0.94 + Math.random() * 0.06 : 0.8);
    return moving || rolling || viewOpen || A.dim > 0.001 || (film && (F.mode === 'loading' || (cur.playing && expected() < 0.5)));
  }
  let lastCard = '';
  function paintCardIfNeeded() {
    const s = cur, k = [s && s.src, F && F.mode, F && F.frame, s && s.playing && expected() < 0, F && F.ended, viewOpen, A.k > 0.99].join('|');
    if (k !== lastCard) { lastCard = k; paint(); }
  }

  /* ---------------- what the room's pick-and-act system asks ---------------- */
  const partOf = (t) => ((t && t.object && t.object.userData.pick) || {}).part || 'stand';
  function label(t) {
    const part = partOf(t), s = cur;
    if (part === 'cord') return s && s.down ? 'The screen’s pull-cord' : 'A pull-cord: the screen is rolled up in its case';
    if (part === 'screen') return s && s.src ? 'Now showing: <i>' + esc(s.title) + '</i>' : 'The screen';
    return s && s.src ? 'The projector — <i>' + esc(s.title) + '</i>' : 'The projector, and the programme of films';
  }
  function acts(t) {
    const part = partOf(t), s = cur, out = [];
    if (t) t.point = null;                // these work from anywhere you can see them, like a remote: no walking over
    const choose = (key) => ({ label: 'Choose a film', key, fn: open });
    const roll = (key) => ({ label: s && s.down ? 'Roll the screen up' : 'Pull the screen down', key, fn: toggleScreen });
    if (part === 'cord') return [roll('E'), choose('F')];
    if (part === 'screen' && s && s.src) {
      // a click watches up close, in the window; pausing is the window's (or the chip's), never a stray click
      if (F && F.mode !== 'error' && !viewOpen) out.push({ label: 'Watch', key: 'E', fn: () => { if (inWindow() && cur && !cur.playing) resume(); else openView(); } });
      if (F && F.mode !== 'error') out.push({ label: 'Full screen', key: 'G', fn: fullscreen });
      out.push(choose(out.length ? 'F' : 'E'));
      return out;
    }
    return [choose('E'), roll('F')];
  }
  function open() { paint(); ctx.openSheet('cinema'); }

  /* ---------------- wiring ---------------- */
  let seeking = false;
  $('#cinPlay').onclick = () => { if (cur && cur.playing) pause(); else resume(); };
  $('#cinWatch').onclick = () => { if (inWindow() && cur && !cur.playing) resume(); else openView(); };
  $('#cinStart').onclick = restart;
  $('#cinStop').onclick = stopFilm;
  $('#cinRoll').onclick = toggleScreen;
  ['cinMute', 'chMute', 'cvMute'].forEach(id => { $('#' + id).onclick = () => { toggleMute(); }; });
  ['cinFull', 'chFull', 'cvFull'].forEach(id => { $('#' + id).onclick = () => { fullscreen(); }; });
  $('#cinGo').onclick = playLink;
  $('#cinUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); playLink(); } else if (e.key === 'Escape') ctx.closeSheets(); });
  const sk = $('#cinSeek');
  sk.addEventListener('input', () => { seeking = true; if (F && F.dur) $('#cinPos').textContent = fmt(sk.value / 1000 * F.dur); });
  sk.addEventListener('change', () => { seeking = false; if (F && F.dur) seekTo(sk.value / 1000 * F.dur); });
  $('#cinVol').addEventListener('input', (e) => {
    vol = Math.max(0, Math.min(1, e.target.value / 100)); mem.vol = vol; remember();
    if (video && F && (F.mode === 'dom' || fullVid || viewOpen)) { sysAt = now(); video.volume = vol; }
    if (Y) ytCmd('setVolume', [Math.round(vol * 100)]);
    wake();
  });
  $('#chPlay').onclick = () => { if (cur && cur.playing) pause(); else resume(); };
  $('#chOpen').onclick = () => { if (inWindow() && !viewOpen && cur && cur.playing) openView(); else open(); };

  // main.js boot: { scene, camera, renderer, W, doOp, openSheet, closeSheets, toast, shared(), host() }
  function init(c) {
    ctx = c; W = c.W; G = W.G; M = W.M;
    baseExposure = c.renderer.toneMappingExposure || 1;
    build(); built = true;
    paint();
  }
  // for tests: run the animations to their ends now
  function settle(n) { for (let i = 0; i < (n || 160); i++) step(0.05); pose(); return { k: A.k, lift: A.lift, lid: A.lid, lamp: A.lamp }; }
  function state() { return { beam: O.beam && { on: O.beam.visible, verts: O.beam.geometry.attributes.position ? O.beam.geometry.attributes.position.count : 0, uO: O.beamMat.uniforms.uO.value }, cur, mode: F && F.mode, kind: F && F.kind, frame: F && F.frame, dur: F && F.dur, watching, viewOpen, url: F && F.url, time: localTime(), k: A.k, lift: A.lift, lamp: A.lamp, dim: A.dim, exposure: ctx && ctx.renderer.toneMappingExposure, video: !!video, paused: video ? video.paused : null, muted: effMuted(), elMuted: video ? video.muted : null, full: fullVid, blind: !!(F && F.blind), texAt, relay: relayC ? relayC.width + 'x' + relayC.height : null, over: !!O.overOn, overVisible: !!(video && video.parentNode && video.parentNode.id === 'cineOver' && +video.style.opacity > 0.05), overTransform: video && video.parentNode && video.parentNode.id === 'cineOver' ? video.style.transform.slice(0, 40) : null, apple: APPLE }; }

  const hasFilm = () => !!(cur && cur.src);
  return { FILMS, init, sanitize, applyOp, sync, acts, label, open, settle, state, ytId, pickables, fullscreen, toggleMute, hasFilm, afterRender };
})();
