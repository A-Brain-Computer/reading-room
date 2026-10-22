/* THE READING ROOM — world.js: the room, its furniture and the books, as three.js objects.

   The room is 24 m x 16 m with a 7 m coffered ceiling. North wall (z = -8): the fireplace with the
   Sankofa over the mantel, between built-in bookcases. South (z = +8): the double doors. West
   (x = -12): three arched windows with window seats, moonlight on the floor. East (x = +12): a full
   wall of built-ins; the narratives start on its middle units at eye level.

   Everything movable is "furniture" ({id, type, x, z, r}) built from CATALOG; built-ins, the fireplace
   and the window seats are fixed. Books live in rows (a bookcase shelf, left to right), in piles (on
   a table's spots, bottom to top) or in a reader's hand. main.js owns that state; world.js only draws
   it (layoutBooks) and answers what a ray hits (pick).

   API: init(renderer) -> scene;  CATALOG;  spawn(f) / place(f) / despawn(id);  layoutBooks(room, handIds);
        pick(raycaster, mode);  highlight(target);  colliders();  seatList();  tick(dt, t, camPos);
        bookMesh(id);  rowInfo(id);  furnInfo(id);  ROOM;  bookDims(meta)
   Every piece of furniture is a Group (one mesh per material); books are separate meshes parented to
   the shelf or table they sit on, so moving a table carries its pile. */
'use strict';
const RR_WORLD = (() => {
  if (!window.THREE) return null;
  const T = THREE;
  const TAU = Math.PI * 2;
  const ROOM = { x0: -12, x1: 12, z0: -8, z1: 8, h: 7 };

  /* ---------------- helpers ---------------- */
  function rng(seed) { let s = (seed >>> 0) || 0x9e3779b9; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, o) {
    o = o || {};
    const t = new T.CanvasTexture(c);
    if (o.srgb !== false) t.colorSpace = T.SRGBColorSpace;
    if (o.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.anisotropy = o.aniso || 4;
    return t;
  }
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  /* merge [geometry, matrix][] into one non-indexed geometry. uvScale: box-projected UVs (metres per
     texture repeat) so wood and plaster keep one texel density whatever the part's size. */
  const _v = new T.Vector3(), _n = new T.Vector3(), _nm = new T.Matrix3();
  function merge(list, uvScale) {
    let count = 0;
    const prep = list.map(([g, m]) => { const ng = g.index ? g.toNonIndexed() : g; count += ng.attributes.position.count; return [ng, m]; });
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let o = 0;
    for (const [g, m] of prep) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      _nm.getNormalMatrix(m);
      for (let i = 0; i < P.count; i++, o++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(m);
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        pos[o * 3] = _v.x; pos[o * 3 + 1] = _v.y; pos[o * 3 + 2] = _v.z;
        nor[o * 3] = _n.x; nor[o * 3 + 1] = _n.y; nor[o * 3 + 2] = _n.z;
        if (uvScale) {
          const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
          let u, w;
          if (ax >= ay && ax >= az) { u = _v.z; w = _v.y; } else if (ay >= az) { u = _v.x; w = _v.z; } else { u = _v.x; w = _v.y; }
          uv[o * 2] = u / uvScale; uv[o * 2 + 1] = w / uvScale;
        } else if (U) { uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i); }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  const _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  function mtx(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    _p.set(x || 0, y || 0, z || 0); _s.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz);
    return new T.Matrix4().compose(_p, _q, _s);
  }
  // a kit collects parts per material, then builds one mesh per material
  function Kit() { this.parts = new Map(); }
  Kit.prototype.add = function (geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) {
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push([geo, mtx(x, y, z, rx, ry, rz, sx, sy, sz)]);
    return this;
  };
  Kit.prototype.addM = function (geo, mat, m) {
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push([geo, m]);
    return this;
  };
  Kit.prototype.box = function (mat, w, h, d, x, y, z, rx, ry, rz) { return this.add(G.box, mat, x, y, z, rx, ry, rz, w, h, d); };
  Kit.prototype.build = function (into) {
    const g = into || new T.Group();
    for (const [mat, list] of this.parts) {
      const mesh = new T.Mesh(merge(list, mat.userData.boxUV || 0), mat);
      g.add(mesh);
    }
    return g;
  };

  /* ---------------- shared geometry ---------------- */
  const G = {};
  function initGeo() {
    G.box = new T.BoxGeometry(1, 1, 1);
    G.cyl = new T.CylinderGeometry(0.5, 0.5, 1, 20);
    G.cyl8 = new T.CylinderGeometry(0.5, 0.5, 1, 8);
    G.sph = new T.SphereGeometry(0.5, 20, 14);
    G.sphLo = new T.SphereGeometry(0.5, 10, 7);
    G.cap = new T.CapsuleGeometry(0.5, 1, 6, 16);
    G.cone = new T.CylinderGeometry(0.3, 0.5, 1, 24, 1, true);
    G.torus = new T.TorusGeometry(0.5, 0.06, 8, 32);
    G.halfCyl = new T.CylinderGeometry(0.5, 0.5, 1, 16, 1, true, 0, Math.PI);
    G.plane = new T.PlaneGeometry(1, 1);
    // a turned table leg (lathe), unit height
    const leg = [[0, 0], [0.42, 0], [0.5, 0.04], [0.36, 0.1], [0.3, 0.3], [0.42, 0.42], [0.3, 0.5], [0.26, 0.82], [0.4, 0.9], [0.44, 0.96], [0.44, 1], [0, 1]];
    G.leg = new T.LatheGeometry(leg.map(([r, y]) => new T.Vector2(r, y)), 16);
    const ped = [[0, 0], [0.5, 0], [0.5, 0.03], [0.2, 0.06], [0.14, 0.2], [0.22, 0.32], [0.12, 0.45], [0.1, 0.9], [0.18, 0.96], [0.18, 1], [0, 1]];
    G.pedestal = new T.LatheGeometry(ped.map(([r, y]) => new T.Vector2(r, y)), 20);
    const pot = [[0, 0], [0.34, 0], [0.38, 0.06], [0.46, 0.7], [0.5, 0.86], [0.5, 1], [0.44, 1], [0.44, 0.9], [0, 0.9]];
    G.pot = new T.LatheGeometry(pot.map(([r, y]) => new T.Vector2(r, y)), 22);
    const candle = [[0, 0], [0.5, 0], [0.46, 0.06], [0.16, 0.12], [0.1, 0.3], [0.18, 0.36], [0.08, 0.42], [0.08, 0.9], [0.22, 0.94], [0.22, 1], [0, 1]];
    G.candlestick = new T.LatheGeometry(candle.map(([r, y]) => new T.Vector2(r, y)), 14);
  }

  /* ---------------- textures ---------------- */
  function woodCanvas(base, dark, seed, w, h, plank) {
    const c = cv(w, h), g = c.getContext('2d'), R = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const rows = plank ? Math.round(h / plank) : 1;
    for (let r = 0; r < rows; r++) {
      const y0 = plank ? r * plank : 0, ph = plank || h;
      if (plank) {                                                      // per-plank tone, staggered joints
        g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,230,190'},${0.03 + R() * 0.07})`;
        let x = -R() * w;
        while (x < w) { const L = w * (0.35 + R() * 0.5); g.fillStyle = `rgba(${R() < 0.5 ? '20,10,0' : '255,225,180'},${0.02 + R() * 0.08})`; g.fillRect(x, y0, L, ph); g.fillStyle = 'rgba(20,10,4,.55)'; g.fillRect(x, y0, 1.5, ph); x += L; }
        g.fillStyle = 'rgba(15,8,3,.6)'; g.fillRect(0, y0, w, 1.5);
      }
      const lines = Math.round(ph / 2.2);
      for (let i = 0; i < lines; i++) {
        const y = y0 + R() * ph, amp = 0.5 + R() * 2.5, f = 0.004 + R() * 0.01, ph2 = R() * 6;
        g.strokeStyle = R() < 0.6 ? dark : 'rgba(255,235,200,.10)';
        g.globalAlpha = 0.05 + R() * 0.22; g.lineWidth = 0.6 + R() * 1.4;
        g.beginPath();
        for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin(x * f + ph2) * amp + Math.sin(x * f * 3.1 + ph2) * amp * 0.3; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    return c;
  }
  function noiseCanvas(base, spots, seed, w, h, alpha) {
    const c = cv(w, h), g = c.getContext('2d'), R = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 40; i++) { g.fillStyle = spots[(R() * spots.length) | 0]; g.globalAlpha = R() * alpha; const s = 1 + R() * 3; g.fillRect(R() * w, R() * h, s, s); }
    g.globalAlpha = 1; return c;
  }
  function marbleCanvas() {
    const c = cv(512, 512), g = c.getContext('2d'), R = rng(77);
    g.fillStyle = '#e9e2d6'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = R() < 0.7 ? 'rgba(120,110,100,.35)' : 'rgba(170,140,110,.4)'; g.lineWidth = 0.5 + R() * 2.5;
      g.beginPath(); let x = R() * 512, y = R() * 512; g.moveTo(x, y);
      for (let k = 0; k < 14; k++) { x += (R() - 0.3) * 60; y += (R() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    return c;
  }
  // a Kuba-cloth-inspired rug: borders of zigzag and stepped diamonds around a lattice field
  function rugCanvas(seed, pal) {
    const W = 1024, H = 720, c = cv(W, H), g = c.getContext('2d'), R = rng(seed);
    const [bg, a, b, d, e] = pal;
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const bw = 64;
    g.fillStyle = d; g.fillRect(0, 0, W, H);
    g.fillStyle = bg; g.fillRect(14, 14, W - 28, H - 28);
    g.fillStyle = d; g.fillRect(bw, bw, W - 2 * bw, H - 2 * bw);
    // zigzag border
    g.fillStyle = a;
    const zig = (x0, y0, x1, y1, n, hgt) => {
      const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux, step = len / n;
      g.beginPath(); g.moveTo(x0, y0);
      for (let i = 0; i < n; i++) { const mx = x0 + ux * (i + 0.5) * step + nx * hgt, my = y0 + uy * (i + 0.5) * step + ny * hgt; g.lineTo(mx, my); g.lineTo(x0 + ux * (i + 1) * step, y0 + uy * (i + 1) * step); }
      g.closePath(); g.fill();
    };
    zig(22, 40, W - 22, 40, 26, -16); zig(W - 22, H - 40, 22, H - 40, 26, -16);
    zig(40, H - 22, 40, 22, 18, -16); zig(W - 40, 22, W - 40, H - 22, 18, -16);
    // field: lattice of stepped diamonds
    const fx = bw + 10, fy = bw + 10, fw = W - 2 * fx, fh = H - 2 * fy;
    g.fillStyle = bg; g.fillRect(fx, fy, fw, fh);
    const cols = 9, rows = 6, cw = fw / cols, ch = fh / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const cx = fx + (i + 0.5) * cw, cy = fy + (j + 0.5) * ch, alt = (i + j) % 2;
      for (let k = 3; k >= 0; k--) {
        const s = (k + 1) / 4;
        g.fillStyle = k % 2 ? (alt ? a : b) : (k === 0 ? e : d);
        g.beginPath(); g.moveTo(cx, cy - ch * 0.5 * s); g.lineTo(cx + cw * 0.5 * s, cy); g.lineTo(cx, cy + ch * 0.5 * s); g.lineTo(cx - cw * 0.5 * s, cy); g.closePath(); g.fill();
      }
    }
    // wear and weave
    for (let i = 0; i < 9000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,240,220,.06)'; g.fillRect(R() * W, R() * H, 2, 1); }
    return c;
  }
  function skyCanvas() {
    const W = 1024, H = 1024, c = cv(W, H), g = c.getContext('2d'), R = rng(5);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#060a1c'); gr.addColorStop(0.55, '#13204a'); gr.addColorStop(0.82, '#2b3466'); gr.addColorStop(1, '#3a3a5e');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) { const y = R() * H * 0.8; g.fillStyle = `rgba(255,255,255,${0.2 + R() * 0.8 * (1 - y / H)})`; const s = R() < 0.05 ? 2.2 : 1.1; g.fillRect(R() * W, y, s, s); }
    // moon
    const mx = W * 0.62, my = H * 0.22;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 160); halo.addColorStop(0, 'rgba(220,230,255,.45)'); halo.addColorStop(1, 'rgba(220,230,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f4f1e2'; g.beginPath(); g.arc(mx, my, 34, 0, TAU); g.fill();
    g.fillStyle = 'rgba(180,175,160,.35)'; g.beginPath(); g.arc(mx - 9, my - 6, 9, 0, TAU); g.arc(mx + 10, my + 9, 6, 0, TAU); g.fill();
    // tree line
    g.fillStyle = '#05070f';
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) { const y = H * 0.83 - (Math.sin(x * 0.02) * 0.5 + 0.5) * 50 - R() * 40 - (Math.sin(x * 0.005 + 1) * 0.5 + 0.5) * 70; g.lineTo(x, y); }
    g.lineTo(W, H); g.closePath(); g.fill();
    return c;
  }
  function moonPatchCanvas() {
    const W = 256, H = 512, c = cv(W, H), g = c.getContext('2d');
    // the arched window falls on the floor as a long soft shape with its mullion cross
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.filter = 'blur(10px)';
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(160,185,255,.9)'); grd.addColorStop(1, 'rgba(160,185,255,.35)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(40, H - 20); g.lineTo(40, 140); g.ellipse(128, 140, 88, 120, 0, Math.PI, 0); g.lineTo(216, H - 20); g.closePath(); g.fill();
    g.fillStyle = '#000'; g.fillRect(122, 30, 12, H); g.fillRect(30, 300, 200, 12);
    g.filter = 'none';
    return c;
  }
  function friezeCanvas(names, aspect) {
    const W = Math.min(4096, Math.round(128 * aspect)), H = Math.round(W / aspect), c = cv(W, H), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3a2414'); gr.addColorStop(0.5, '#4a2e19'); gr.addColorStop(1, '#2c1a0e');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(232,190,110,.7)'; g.fillRect(0, H * 0.08, W, 3); g.fillRect(0, H * 0.9 - 3, W, 3);
    const fs = Math.round(H * 0.48);
    g.font = `600 ${fs}px Georgia, "Times New Roman", serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
    const gold = g.createLinearGradient(0, H * 0.25, 0, H * 0.75); gold.addColorStop(0, '#f7dc8f'); gold.addColorStop(0.5, '#c99a3a'); gold.addColorStop(1, '#f0cf78');
    g.fillStyle = gold; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowOffsetY = 2; g.shadowBlur = 2;
    const step = W / names.length;                 // names spaced evenly, a diamond between each
    names.forEach((n, i) => { g.fillText(n, step * (i + 0.5), H / 2 + 2, step - fs * 1.2); if (i) { const x = step * i; g.beginPath(); g.moveTo(x, H / 2 - 7); g.lineTo(x + 7, H / 2); g.lineTo(x, H / 2 + 7); g.lineTo(x - 7, H / 2); g.closePath(); g.fill(); } });
    return c;
  }
  function sankofaCanvas() {
    const S = 512, c = cv(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S * 0.7); gr.addColorStop(0, '#7a1f19'); gr.addColorStop(1, '#3c0c0a');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
    // the arcade's vetted Sankofa (adinkra/index.html, see adinkra/SOURCES.md), drawn in gold leaf
    g.save(); g.translate(S * 0.14, S * 0.12); g.scale(S * 0.0072, S * 0.0072);
    const gold = g.createLinearGradient(0, 0, 0, 100); gold.addColorStop(0, '#f8de92'); gold.addColorStop(0.5, '#c8962f'); gold.addColorStop(1, '#efca6c');
    g.strokeStyle = gold; g.fillStyle = gold; g.lineWidth = 6.5; g.lineCap = 'round'; g.lineJoin = 'round';
    const skl = new Path2D('M50 86 C34 74 12 58 10 40 C8 24 20 14 30 16 C40 18 46 26 44 32 C42 38 34 40 30 34 C27 30 30 24 34 26');
    const ski = new Path2D('M50 42 C50 52 42 57 37 53 C33 50 36 43 41 45');
    const skf = new Path2D('M50 86 C46 92 40 96 35 92 C31 89 34 84 38 86');
    const both = (p) => { g.stroke(p); g.save(); g.transform(-1, 0, 0, 1, 100, 0); g.stroke(p); g.restore(); };
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 3; g.shadowOffsetY = 1.5;
    both(skl); g.stroke(new Path2D('M50 24 V42')); both(ski); both(skf);
    g.fill(new Path2D('M50 84 L45 96 L50 100 L55 96 Z'));
    g.restore();
    return c;
  }
  // celestial globe: faint stars, and the Big Dipper pointing to Polaris, the North Star, in gold.
  // RA/Dec (J2000, rounded): Dubhe 11h03.7 +61.75, Merak 11h01.8 +56.38, Phecda 11h53.8 +53.69,
  // Megrez 12h15.4 +57.03, Alioth 12h54.0 +55.96, Mizar 13h23.9 +54.93, Alkaid 13h47.5 +49.31, Polaris 2h31.8 +89.26
  function celestialCanvas() {
    const W = 1024, H = 512, c = cv(W, H), g = c.getContext('2d'), R = rng(11);
    g.fillStyle = '#0d1a3a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(200,170,100,.25)'; g.lineWidth = 1;
    for (let i = 1; i < 12; i++) { g.beginPath(); g.moveTo(i * W / 12, 0); g.lineTo(i * W / 12, H); g.stroke(); }
    for (let j = 1; j < 6; j++) { g.beginPath(); g.moveTo(0, j * H / 6); g.lineTo(W, j * H / 6); g.stroke(); }
    g.strokeStyle = 'rgba(220,190,120,.5)'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(240,230,200,${R() * 0.6})`; g.fillRect(R() * W, R() * H, 1.4, 1.4); }
    const P = (raH, dec) => [W * (1 - raH / 24), H * (90 - dec) / 180];   // seen from outside: RA runs the other way
    const dip = [[11.06, 61.75], [11.03, 56.38], [11.9, 53.69], [12.26, 57.03], [12.9, 55.96], [13.4, 54.93], [13.79, 49.31]].map(([a, d]) => P(a, d));
    const pol = P(2.53, 89.26);
    g.strokeStyle = '#e8c06a'; g.lineWidth = 2.5; g.beginPath();
    [0, 1, 2, 3, 0].forEach((k, i) => (i ? g.lineTo(...dip[k]) : g.moveTo(...dip[k])));
    g.moveTo(...dip[3]); [4, 5, 6].forEach(k => g.lineTo(...dip[k])); g.stroke();
    g.setLineDash([5, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(...dip[1]); g.lineTo(dip[0][0] + (dip[0][0] - dip[1][0]) * 1.2, dip[0][1] + (dip[0][1] - dip[1][1]) * 1.2); g.lineTo(pol[0], pol[1] + 4); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffe9a8'; dip.forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4.5, 0, TAU); g.fill(); });
    g.fillRect(0, pol[1] - 2, W, 4);   // Polaris sits at the pole: a ring of light along the top row
    g.font = 'italic 600 20px Georgia, serif'; g.fillStyle = '#f0d58a'; g.textAlign = 'center';
    g.fillText('THE BIG DIPPER', (dip[2][0] + dip[5][0]) / 2, dip[2][1] + 46);
    g.fillText('POLARIS — NORTH', W * 0.5, 30);
    return c;
  }
  function clockCanvas() {
    const S = 256, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, TAU); g.fill();
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#2a1e12'; g.font = '600 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    R.forEach((r, i) => { const a = i / 12 * TAU; g.save(); g.translate(S / 2 + Math.sin(a) * 96, S / 2 - Math.cos(a) * 96); g.rotate(a); g.fillText(r, 0, 0); g.restore(); });
    return c;
  }

  /* ---------------- materials ---------------- */
  const M = {};
  function std(o) { const m = new T.MeshStandardMaterial(o); return m; }
  function initMats() {
    const wood = (base, dark, seed, scale, rough) => {
      const t = tex(woodCanvas(base, dark, seed, 512, 512, 0), { repeat: true });
      const m = std({ map: t, roughness: rough, metalness: 0, envMapIntensity: 0.6 });
      m.userData.boxUV = scale; return m;
    };
    M.walnut = wood('#4a2b18', 'rgba(25,12,5,.9)', 3, 1.4, 0.5);
    M.walnutDark = wood('#2e1a0e', 'rgba(10,5,2,.9)', 4, 1.4, 0.55);
    M.oak = wood('#7a5230', 'rgba(50,28,12,.8)', 6, 1.2, 0.45);
    M.mahogany = wood('#5a2416', 'rgba(25,8,4,.85)', 9, 1.2, 0.4);
    const ft = tex(woodCanvas('#5e3a20', 'rgba(30,15,6,.85)', 21, 1024, 1024, 64), { repeat: true });
    M.floor = std({ map: ft, roughness: 0.42, metalness: 0, envMapIntensity: 0.9 }); M.floor.userData.boxUV = 3.2;
    const pt = tex(noiseCanvas('#33473a', ['#2a3b30', '#3d5545', '#22302a'], 8, 256, 256, 0.5), { repeat: true });
    M.plaster = std({ map: pt, roughness: 0.92, envMapIntensity: 0.3 }); M.plaster.userData.boxUV = 2.0;
    const ct = tex(noiseCanvas('#d8ccb4', ['#cdbfa4', '#e2d8c4'], 12, 256, 256, 0.4), { repeat: true });
    M.ceiling = std({ map: ct, roughness: 0.95, envMapIntensity: 0.3 }); M.ceiling.userData.boxUV = 2.0;
    M.marble = std({ map: tex(marbleCanvas(), { repeat: true }), roughness: 0.25, envMapIntensity: 0.8 }); M.marble.userData.boxUV = 1.2;
    M.stone = std({ color: 0x2a2522, roughness: 0.9 });
    M.soot = std({ color: 0x0c0a09, roughness: 1 });
    M.brass = std({ color: 0xc8a050, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 });
    M.damask = std({ map: tex(damaskCanvas(), { repeat: true }), roughness: 0.8, envMapIntensity: 0.5 }); M.damask.userData.boxUV = 0.42;
    M.gilt = std({ color: 0xe0b45a, metalness: 1, roughness: 0.22, envMapIntensity: 1.5, emissive: 0x3a2508, emissiveIntensity: 0.6 });
    M.iron = std({ color: 0x1c1a19, metalness: 0.7, roughness: 0.5 });
    M.leather = std({ color: 0x6b1e16, roughness: 0.55, envMapIntensity: 0.7 });
    M.leatherBrown = std({ color: 0x5a3418, roughness: 0.55, envMapIntensity: 0.7 });
    M.velvetGreen = std({ color: 0x1f4a36, roughness: 0.95, envMapIntensity: 0.4 });
    M.velvetOchre = std({ color: 0xa8742a, roughness: 0.95, envMapIntensity: 0.4 });
    M.velvetPlum = std({ color: 0x4a2340, roughness: 0.95, envMapIntensity: 0.4 });
    M.cushion = std({ color: 0x8a3a24, roughness: 0.9 });
    M.linen = std({ color: 0xe8dcc0, roughness: 0.9, emissive: 0x000000 });
    M.shadeLit = std({ color: 0xf0d9a8, roughness: 0.9, emissive: 0xffb86a, emissiveIntensity: 0.9, side: T.DoubleSide });
    M.greenGlass = std({ color: 0x1d6b3e, roughness: 0.15, metalness: 0.1, emissive: 0x2a8a4a, emissiveIntensity: 0.35, side: T.DoubleSide });
    M.bulb = new T.MeshBasicMaterial({ color: 0xffe2a8 });
    M.flameTip = new T.MeshBasicMaterial({ color: 0xffd27a });
    M.glass = std({ color: 0x9fb2d8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.5, depthWrite: false });
    M.terracotta = std({ color: 0x9a4f2e, roughness: 0.8 });
    M.leaf = std({ color: 0x2f5a2a, roughness: 0.6, side: T.DoubleSide });
    M.leafLight = std({ color: 0x4c7a34, roughness: 0.6, side: T.DoubleSide });
    M.pages = std({ map: tex(pagesCanvas()), roughness: 0.9 });
    M.paper = std({ color: 0xe9dfc8, roughness: 0.95 });
    M.black = std({ color: 0x111111, roughness: 0.6 });
    M.hit = new T.MeshBasicMaterial({ visible: false });
    M.glow = new T.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending });
    M.glowEdge = new T.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });
    M.bad = new T.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.22, depthWrite: false });
    M.shadow = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, alphaMap: tex(shadowCanvas(), { srgb: false }), depthWrite: false });
  }
  function damaskCanvas() {
    const S = 256, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = '#4a1410'; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(214,160,80,.16)';
    const motif = (x, y, s) => {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.beginPath(); g.moveTo(0, -40); g.bezierCurveTo(22, -30, 26, -6, 0, 0); g.bezierCurveTo(-26, -6, -22, -30, 0, -40); g.fill();
      g.beginPath(); g.moveTo(0, 40); g.bezierCurveTo(22, 30, 26, 6, 0, 0); g.bezierCurveTo(-26, 6, -22, 30, 0, 40); g.fill();
      g.beginPath(); g.arc(-24, 0, 7, 0, TAU); g.arc(24, 0, 7, 0, TAU); g.fill();
      g.restore();
    };
    motif(S / 2, S / 2, 1.3); motif(0, 0, 1.3); motif(S, 0, 1.3); motif(0, S, 1.3); motif(S, S, 1.3);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * S, Math.random() * S, 1, 2); }
    return c;
  }
  function pagesCanvas() {
    const c = cv(64, 64), g = c.getContext('2d');
    g.fillStyle = '#e9dcbc'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 2) { g.fillStyle = i % 4 ? 'rgba(120,90,50,.10)' : 'rgba(120,90,50,.18)'; g.fillRect(0, i, 64, 1); }
    return c;
  }
  function shadowCanvas() {
    const c = cv(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;                       // used as an alpha map under black: white = shadow

  }

  /* ---------------- the books ---------------- */
  const SPINE_CLOTH = ['#6d1f1a', '#1f3557', '#22452f', '#8a5a1e', '#2a2a2a', '#4d2445', '#1f5250', '#7a3a1c', '#3b3f55', '#5a1830', '#2f4a23', '#8c6a2a', '#283a5e', '#6a2c2c', '#3d2a18', '#1a4440'];
  const SPINE_LEATHER = ['#5a2a17', '#3d2414', '#6b3a1f', '#2e3b2a', '#1f2b3d', '#5c1f22', '#3a2a3c', '#704b25', '#26332f', '#4a1c1c', '#2b2420', '#61401f'];
  const SPINE_LABEL = ['#15100c', '#5a1416', '#1d3324', '#142338', '#15100c'];
  // the sections of the room. gold: the east wall, the Black canon and the narratives at its heart.
  // rows: shelves in the order a section fills them (eye level first).
  const SECTIONS = (() => {
    const E = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push('E' + i); return o; };
    const N = (list) => list.map(i => 'N' + i);
    const S = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push('S' + i); return o; };
    const H = (a, b) => { const o = []; for (let i = a; i <= b; i++) if (![35, 36, 47, 0].includes(i)) o.push('H' + i); return o; };
    const rowsOf = (units, levels) => levels.flatMap(r => units.map(u => u + '.' + r));
    // The reading room is the Black canon: the golden wall (east) runs from Africa and the diaspora through
    // the radical tradition to the narratives at its heart, then the speeches and the historians; the
    // north wall beside the fire holds the fiction, the poets and the witnesses, and scripture; the south
    // wall, useful knowledge and natural history. The great books of the world fill the Great Hall.
    const list = [
      { key: 'africa', name: 'Africa & the Diaspora', sub: 'Black history the world over', units: E(0, 1), gold: true },
      { key: 'radical', name: 'The Radical Tradition', sub: 'rebellion, resistance, self-rule', units: E(2, 3), gold: true },
      { key: 'narr', name: 'The Narratives', sub: 'begin here · told by those who lived them', units: E(4, 7), gold: true, rows: ['E5.2', 'E6.2', 'E4.2', 'E7.2', 'E5.1', 'E6.1', 'E4.1', 'E7.1'] },
      { key: 'wpa', name: 'The Voices', sub: 'the WPA interviews, 1936–38', units: E(4, 7), gold: true, plaque: false, rows: ['E5.3', 'E6.3', 'E4.3', 'E7.3', 'E5.4', 'E6.4'] },
      { key: 'speech', name: 'Speeches & Essays', sub: 'the case, made out loud', units: E(8, 9), gold: true },
      { key: 'hist', name: 'The Historians', sub: 'the record, kept', units: E(10, 11), gold: true },
      { key: 'fict', name: 'Fiction', sub: 'novels and stories of the color line', units: N([7, 8, 9]), gold: true },
      { key: 'poet', name: 'The Poets', sub: 'Wheatley to McKay', units: N([10, 11]), gold: true },
      { key: 'abol', name: 'Witnesses', sub: 'allies against slavery', units: N([12, 13]), gold: true },
      { key: 'sacred', name: 'Scripture & the Spirit', sub: 'the sacred books, the spirituals', units: N([0, 1, 2, 3, 4, 5, 6]) },
      { key: 'useful', name: 'Useful Knowledge', sub: 'hands, kitchen, garden, mind', units: S(0, 6) },
      { key: 'sci', name: 'Natural History', sub: 'Darwin and after', units: S(7, 13) },
      { key: 'novel', name: 'The Novel', sub: 'Dumas to Joyce', units: H(1, 17) },
      { key: 'epic', name: 'Epic & Drama', sub: 'Homer · Dante · Shakespeare', units: H(18, 27) },
      { key: 'thought', name: 'Philosophy & Politics', sub: 'from Plato to Thoreau', units: H(28, 46) }
    ];
    list.forEach(sc => { if (!sc.rows) sc.rows = rowsOf(sc.units, [2, 3, 1, 4]); });
    return list;
  })();
  const SEC = Object.fromEntries(SECTIONS.map(sc => [sc.key, sc]));
  const UNIT_SEC = {};
  SECTIONS.forEach(sc => sc.units.forEach(u => { if (!UNIT_SEC[u]) UNIT_SEC[u] = sc.key; }));
  const isGold = (b) => !b.sec || !!(SEC[b.sec] && SEC[b.sec].gold);
  let BOOKS = [];            // catalog entries (books/index.json)
  const bookObj = new Map(); // id -> { mesh, meta, dims, color }
  const spineTex = [];
  function bookDims(meta) {
    const h0 = hash(meta.id);
    const words = meta.words || 60000;
    const tall = meta.sec && !isGold(meta) ? 0.014 : 0;
    return {                                       // a little larger than life, so a spine reads from across the room
      t: Math.min(0.068, 0.015 + words * 2.9e-7),
      h: 0.232 + tall + (h0 % 1000) / 1000 * 0.056,
      d: 0.165 + ((h0 >>> 10) % 1000) / 1000 * 0.034
    };
  }
  // the name on the foot of a spine: a surname, kept short
  const SPINE_NAME = { "Federal Writers' Project": 'W.P.A.', 'Dante Alighieri': 'Dante', 'Marcus Aurelius': 'Aurelius', 'Sun Tzu': 'Sun Tzu', 'Karl Marx and Friedrich Engels': 'Marx & Engels', 'William and Ellen Craft': 'Craft', 'Venture Smith': 'Venture' };
  function spineName(b) {
    const a = (b.about || b.author || '').replace(/\s*\((ed|eds|trans)\.\)/g, '');
    if (SPINE_NAME[a]) return SPINE_NAME[a];
    const first = a.split(/,| and /)[0].trim();
    const w = first.split(/\s+/);
    let n = w.pop() || '';
    if (/^(Jr\.?|Sr\.?|II|III)$/.test(n) && w.length) n = w.pop();
    const pre = w[w.length - 1];
    if (pre && /^(Du|De|Van|Von|La|Le)$/.test(pre)) n = pre + ' ' + n;
    return n;
  }
  // split text into at most `max` lines no wider than `wmax` at the current font; null if it can't
  function wrap(g, text, wmax, max) {
    const words = text.split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= wmax) cur = t;
      else { if (!cur || g.measureText(w).width > wmax) return null; lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length <= max ? lines : null;
  }
  const SERIF = 'Georgia, "Times New Roman", serif';
  function goldText(g, k) { g.fillStyle = '#f2d283'; g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 1.5 * k; g.shadowOffsetX = 0; g.shadowOffsetY = 1 * k; }
  // title (and author) set across a wide spine; returns the y below the block
  function hTitle(g, title, cx, top, wmax, k, maxF, lines) {
    for (let f = maxF; f >= 9 * k; f -= 1) {
      g.font = `700 ${f}px ${SERIF}`;
      const L = wrap(g, title, wmax, lines);
      if (L) { const lh = f * 1.12; L.forEach((l, i) => g.fillText(l, cx, top + lh * (i + 0.5))); return top + lh * L.length; }
    }
    g.font = `700 ${9 * k}px ${SERIF}`; g.fillText(title, cx, top + 6 * k, wmax); return top + 12 * k;
  }
  // title running down a narrow spine (one or two lines), in the box [y0, y0+len] across width w
  function vTitle(g, title, cx, y0, len, w, k) {
    g.save(); g.translate(cx, y0); g.rotate(Math.PI / 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let f = Math.min(w * 0.56, 40 * k);
    g.font = `700 ${f}px ${SERIF}`;
    while (g.measureText(title).width > len && f > 11 * k) { f -= 1; g.font = `700 ${f}px ${SERIF}`; }
    if (g.measureText(title).width > len && w > 46 * k) {                 // two lines across a wider spine
      let f2 = Math.min(w * 0.36, 30 * k);
      for (; f2 >= 9 * k; f2 -= 1) { g.font = `700 ${f2}px ${SERIF}`; const L = wrap(g, title, len, 2); if (L) { L.forEach((l, i) => g.fillText(l, len / 2, (i - (L.length - 1) / 2) * f2 * 1.08)); g.restore(); return; } }
    }
    g.fillText(title, len / 2, 0, len);
    g.restore();
  }
  function vName(g, name, cx, yEnd, w, k) {
    g.save(); g.translate(cx, yEnd); g.rotate(Math.PI / 2);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = `600 ${Math.min(w * 0.42, 19 * k)}px ${SERIF}`;
    g.fillText(name.toUpperCase(), 0, 0, 120 * k);
    g.restore();
  }
  function drawSpine(g, b, x0, y0, w, H) {
    const k = H / 512, gold = isGold(b), h0 = hash(b.id);
    const col = gold ? SPINE_CLOTH[h0 % SPINE_CLOTH.length] : SPINE_LEATHER[h0 % SPINE_LEATHER.length];
    g.save();
    g.beginPath(); g.rect(x0, y0, w, H); g.clip();
    g.fillStyle = col; g.fillRect(x0, y0, w, H);
    const sh = g.createLinearGradient(x0, 0, x0 + w, 0);
    sh.addColorStop(0, 'rgba(0,0,0,.42)'); sh.addColorStop(0.28, 'rgba(255,255,255,.09)'); sh.addColorStop(0.62, 'rgba(255,255,255,.03)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = sh; g.fillRect(x0, y0, w, H);
    const R = rng(h0);
    for (let i = 0; i < w * H / 90; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${gold ? 0.05 : 0.07})`; g.fillRect(x0 + R() * w, y0 + R() * H, 1 + (gold ? 0 : R() * 2), 1 + R() * 2); }
    const G1 = '#e8c26c';
    const name = spineName(b), title = b.short || b.title;
    const wide = w >= 0.16 * H;
    if (gold) {
      // gilt cloth: double rules at head and foot, a fleuron above the author
      g.fillStyle = G1;
      [[16 * k, 3.2], [24 * k, 1.4], [H - 26 * k, 1.4], [H - 18 * k, 3.2]].forEach(([y, hh]) => g.fillRect(x0 + 3 * k, y0 + y, w - 6 * k, hh * k));
      g.font = `600 ${Math.min(w * 0.42, 19 * k)}px ${SERIF}`;
      const nameW = Math.min(120 * k, g.measureText(name.toUpperCase()).width);
      const orn = wide ? y0 + H - 104 * k : y0 + H - 38 * k - nameW - 16 * k;
      g.beginPath(); g.moveTo(x0 + w / 2, orn - 7 * k); g.lineTo(x0 + w / 2 + 6 * k, orn); g.lineTo(x0 + w / 2, orn + 7 * k); g.lineTo(x0 + w / 2 - 6 * k, orn); g.closePath(); g.fill();
      goldText(g, k);
      if (wide) {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillRect(x0 + 8 * k, y0 + 50 * k, w - 16 * k, 1.4 * k);
        const yb = hTitle(g, title, x0 + w / 2, y0 + 62 * k, w - 18 * k, k, Math.min(w * 0.2, 34 * k), 6);
        g.fillRect(x0 + 8 * k, yb + 8 * k, w - 16 * k, 1.4 * k);
        g.font = `600 ${Math.min(w * 0.14, 18 * k)}px ${SERIF}`;
        g.fillText(name.toUpperCase(), x0 + w / 2, y0 + H - 70 * k, w - 12 * k);
      } else {
        vTitle(g, title, x0 + w / 2, y0 + 40 * k, H - 40 * k - (38 * k + nameW + 32 * k), w, k);   // ends above the fleuron
        vName(g, name, x0 + w / 2, y0 + H - 38 * k, w, k);
      }
    } else {
      // leather: raised bands, a dark title label, gilt rules
      const bands = [0.13, 0.31, 0.49, 0.67, 0.85].map(f => y0 + f * H);
      bands.forEach(y => {
        const gr = g.createLinearGradient(0, y - 7 * k, 0, y + 7 * k);
        gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(0.45, 'rgba(255,240,210,.22)'); gr.addColorStop(1, 'rgba(0,0,0,.45)');
        g.fillStyle = gr; g.fillRect(x0, y - 7 * k, w, 14 * k);
        g.fillStyle = G1; g.fillRect(x0 + 2 * k, y - 9 * k, w - 4 * k, 1.2 * k); g.fillRect(x0 + 2 * k, y + 8 * k, w - 4 * k, 1.2 * k);
      });
      const lab = SPINE_LABEL[(h0 >>> 5) % SPINE_LABEL.length];
      const ly0 = bands[0] + 12 * k, ly1 = bands[2] - 12 * k;          // the label spans two panels
      g.fillStyle = lab; g.fillRect(x0 + 4 * k, ly0, w - 8 * k, ly1 - ly0);
      g.strokeStyle = G1; g.lineWidth = 1.2 * k; g.strokeRect(x0 + 7 * k, ly0 + 3 * k, w - 14 * k, ly1 - ly0 - 6 * k);
      goldText(g, k);
      if (wide) {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const lines = 5, maxF = Math.min(w * 0.19, 32 * k);
        let f = maxF, L = null;
        for (; f >= 9 * k; f -= 1) { g.font = `700 ${f}px ${SERIF}`; L = wrap(g, title, w - 20 * k, lines); if (L && L.length * f * 1.12 <= ly1 - ly0 - 12 * k) break; L = null; }
        if (!L) { g.font = `700 ${9 * k}px ${SERIF}`; L = [title]; f = 9 * k; }
        const lh = f * 1.12, top = (ly0 + ly1) / 2 - lh * L.length / 2;
        L.forEach((l, i) => g.fillText(l, x0 + w / 2, top + lh * (i + 0.5), w - 14 * k));
        g.font = `600 ${Math.min(w * 0.13, 17 * k)}px ${SERIF}`;
        g.fillText(name.toUpperCase(), x0 + w / 2, (bands[2] + bands[3]) / 2, w - 12 * k);
      } else {
        vTitle(g, title, x0 + w / 2, ly0 + 6 * k, ly1 - ly0 - 12 * k, w - 8 * k, k);
        g.save(); g.translate(x0 + w / 2, (bands[2] + bands[3]) / 2); g.rotate(Math.PI / 2);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `600 ${Math.min(w * 0.4, 18 * k)}px ${SERIF}`;
        g.fillText(name.toUpperCase(), 0, 0, bands[3] - bands[2] - 20 * k);
        g.restore();
      }
    }
    g.restore();
    return col;
  }
  // every spine packed edge to edge into as many 2048-square atlases as it takes. Spine height in texels:
  // 682 (three rows to an atlas) on a desktop, 512 on a phone. Close up, the zoom shows them at about this size.
  function buildSpines() {
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const AW = Math.min(2048, renderer.capabilities.maxTextureSize || 2048);
    const CH = Math.floor(AW / (coarse ? 4 : 3)), ROWS = Math.floor(AW / CH);
    const pages = [];
    let page = null, x = 0, row = 0;
    // each page also carries a swatch of page edges (for the book's top, bottom and fore-edge) and, after
    // every spine, a strip of its plain cloth or leather (for the boards): one material draws a whole book
    const PE = 48, STRIP = 8, pe = pagesCanvas();
    const open = () => { const c = cv(AW, AW); page = { c, g: c.getContext('2d') }; pages.push(page); page.g.drawImage(pe, 0, 0, PE, CH); x = PE + 2; row = 0; };
    open();
    BOOKS.forEach((b) => {
      const dims = bookDims(b);
      const w = Math.max(22, Math.min(AW - PE - STRIP - 8, Math.round(CH * dims.t / dims.h)));
      if (x + w + STRIP + 4 > AW) { x = 0; row++; if (row >= ROWS) open(); }
      const x0 = x + 1, y0 = row * CH;
      const col = drawSpine(page.g, b, x0, y0, w, CH);
      const sx = x0 + w + 2;
      page.g.fillStyle = col; page.g.fillRect(sx - 1, y0, STRIP + 2, CH);
      const R = rng(hash(b.id) + 7);
      for (let i = 0; i < CH * 2; i++) { page.g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},.06)`; page.g.fillRect(sx + R() * STRIP, y0 + R() * CH, 1, 2); }
      const v0 = 1 - (y0 + CH) / AW, v1 = 1 - y0 / AW;
      b._spine = { page: pages.length - 1, u0: x0 / AW, u1: (x0 + w) / AW, v0, v1, c0: (sx + 1) / AW, c1: (sx + STRIP - 1) / AW,
        p0: 2 / AW, p1: (PE - 2) / AW, pv0: 1 - (CH - 2) / AW, pv1: 1 - 2 / AW, color: col };
      x = sx + STRIP + 3;
    });
    const maxA = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
    pages.forEach(pg => { const t = tex(pg.c); t.anisotropy = Math.min(16, maxA); spineTex.push(t); });
  }
  function makeBook(b) {
    const dims = bookDims(b);
    const geo = new T.BoxGeometry(dims.t, dims.h, dims.d);
    const uv = geo.attributes.uv, s = b._spine;
    // box faces, 4 vertices each: +x -x (boards), +y -y (page edges top and bottom), +z (spine), -z (fore-edge)
    const face = (f, a0, a1, b0, b1) => { const i = f * 4; uv.setXY(i, a0, b1); uv.setXY(i + 1, a1, b1); uv.setXY(i + 2, a0, b0); uv.setXY(i + 3, a1, b0); };
    face(0, s.c0, s.c1, s.v0, s.v1); face(1, s.c0, s.c1, s.v0, s.v1);
    face(2, s.p0, s.p1, s.pv0, s.pv1); face(3, s.p0, s.p1, s.pv0, s.pv1); face(5, s.p0, s.p1, s.pv0, s.pv1);
    face(4, s.u0, s.u1, s.v0, s.v1);
    uv.needsUpdate = true;
    geo.clearGroups();                                   // one material, one draw call per book
    const mesh = new T.Mesh(geo, M.spines[s.page]);
    mesh.userData.pick = { kind: 'book', id: b.id };
    // a silk ribbon that shows once the book has been started
    const rib = new T.Mesh(G.box, std({ color: 0xc8342a, roughness: 0.6 }));
    rib.scale.set(0.006, 0.07, 0.002); rib.position.set(0, -dims.h / 2 - 0.03, dims.d / 2 - 0.02); rib.visible = false;
    mesh.add(rib);
    bookObj.set(b.id, { mesh, meta: b, dims, color: s.color, ribbon: rib });
    return mesh;
  }


  /* ---------------- your own books ---------------- */
  // The books of the person you are reading as glow for you alone: their cloth lit from within, and a
  // warm spill of light on the shelf around each one, wherever it is (shelf, pile or hand).
  const own = new Set(), ownMats = [];
  let ownHalo = null, ownPlane = null;
  function setOwn(ids) {
    for (const id of own) {
      const o = bookObj.get(id); if (!o) continue;
      own.delete(id); o.mesh.material = baseMat(o);
      if (o.halo) { o.mesh.remove(o.halo); o.halo = null; }
    }
    own.clear();
    for (const id of ids || []) {
      const o = bookObj.get(id); if (!o || !o.meta._spine) continue;
      const pg = o.meta._spine.page;
      if (!ownMats[pg]) { const m = M.spines[pg].clone(); m.emissive = new T.Color(0xffc46a); m.emissiveMap = m.map; m.emissiveIntensity = 0.6; ownMats[pg] = m; }
      o.mesh.material = ownMats[pg];
      if (!ownHalo) { ownHalo = new T.MeshBasicMaterial({ map: tex(haloCanvas()), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.6 }); ownPlane = new T.PlaneGeometry(1, 1); }
      const h = new T.Mesh(ownPlane, ownHalo);
      h.scale.set(o.dims.t + 0.2, o.dims.h * 1.4, 1); h.position.z = o.dims.d / 2 + 0.006; h.renderOrder = 4;
      o.mesh.add(h); o.halo = h;
      own.add(id);
    }
  }

  /* ---------------- rows (shelves) and their filler volumes ---------------- */
  const rows = new Map();     // rowId -> { id, parent, x0, x1, y, z, depth, hit, fill, seed, fixed, fillers: [] }
  const furn = new Map();     // furniture id -> { f, def, obj, rows: [], seats: [], spots: [], lamp, hit }
  const fixedSeats = [];      // window seats
  const caseHits = [];        // pickable meshes
  let fillerMesh = null, fillerMax = 0, hallFillers = null, hallFillerMax = 0;
  const FILLER_LEATHER = ['#3b1a12', '#4a2a16', '#23301f', '#1d2738', '#2b1c14', '#5a3a1e', '#191513', '#40301c', '#352217', '#2c1f2a', '#4d3b26', '#3a3a30'];

  function addRow(id, parent, x0, x1, y, z, depth, height, fill, fixed, area) {
    const hit = new T.Mesh(G.box, M.hit);
    hit.scale.set(x1 - x0, height - 0.02, depth - 0.03); hit.position.set((x0 + x1) / 2, y + height / 2, z - 0.03 - (depth - 0.03) / 2);
    hit.userData.pick = { kind: 'row', row: id };
    parent.add(hit);
    const r = { id, parent, x0, x1, y, z, depth, height, hit, fill, seed: hash(id), fixed, fillers: [], area: area || 'room' };
    rows.set(id, r);
    return r;
  }
  // filler volumes packed from the right end of a row, leaving `used` metres for real books on the left
  function genFillers(r, used) {
    const out = [];
    if (r.fill <= 0) return out;
    const R = rng(r.seed);
    const width = r.x1 - r.x0;
    const want = width * r.fill;
    let x = r.x1 - 0.01;
    const stop = Math.max(r.x0 + used + 0.05, r.x1 - want);
    while (x > stop + 0.03) {
      const n = 3 + ((R() * 9) | 0);
      const baseH = Math.min(r.height - 0.08, 0.22 + R() * 0.13);
      const leather = FILLER_LEATHER[(R() * FILLER_LEATHER.length) | 0];
      for (let i = 0; i < n && x > stop + 0.03; i++) {
        const t = 0.02 + R() * 0.044, h = Math.min(r.height - 0.06, baseH * (0.86 + R() * 0.2)), d = Math.min(r.depth - 0.06, 0.17 + R() * 0.07);
        const tone = R() < 0.35 ? FILLER_LEATHER[(R() * FILLER_LEATHER.length) | 0] : leather;
        out.push({ x: x - t / 2, y: r.y + h / 2 + 0.002, z: r.z - d / 2 - 0.02, t, h, d, lean: 0, color: tone });
        x -= t + 0.0015;
      }
      if (R() < 0.3 && x > stop + 0.12) {                           // a leaning volume at the end of a run
        const t = 0.03, h = baseH, d = 0.18, a = 0.32;
        out.push({ x: x - Math.sin(a) * h / 2 - t / 2, y: r.y + Math.cos(a) * h / 2 + 0.01, z: r.z - d / 2 - 0.02, t, h, d, lean: a, color: leather });
        x -= Math.sin(a) * h + 0.06;
      } else if (R() < 0.25 && x > stop + 0.3) {                     // a short stack lying flat
        const k = 2 + ((R() * 3) | 0), w = 0.2 + R() * 0.06; let yy = r.y;
        for (let i = 0; i < k; i++) { const t = 0.03 + R() * 0.02; out.push({ x: x - w / 2 - 0.01, y: yy + t / 2, z: r.z - 0.1, t: w, h: t, d: 0.16, lean: 0, flat: true, color: FILLER_LEATHER[(R() * FILLER_LEATHER.length) | 0] }); yy += t; }
        x -= w + 0.05;
      } else x -= 0.02 + R() * 0.12;
    }
    return out;
  }
  const _m4 = new T.Matrix4(), _col = new T.Color();
  // the old volumes: one instanced mesh for the reading room, one (hidden with it) for the great hall
  function refreshFillers() {
    if (!fillerMesh) return;
    const fill = (mesh, max, list) => {
      let i = 0;
      for (const r of list) {
        r.parent.updateMatrixWorld(true);
        for (const f of r.fillers) {
          if (i >= max) break;
          _m4.copy(mtx(f.x, f.y, f.z, 0, 0, f.lean, f.t, f.h, f.d)).premultiply(r.parent.matrixWorld);
          mesh.setMatrixAt(i, _m4); _col.set(f.color); mesh.setColorAt(i, _col); i++;
        }
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const all = [...rows.values()];
    fill(fillerMesh, fillerMax, all.filter(r => r.area !== 'hall'));
    if (hallFillers) fill(hallFillers, hallFillerMax, all.filter(r => r.area === 'hall').concat(decoRows));
  }

  /* ---------------- fixed architecture ---------------- */
  let scene, renderer;
  const fixedColliders = [];
  const lampSources = [];    // {obj, local: Vector3, k} for the light pool
  const anim = { fire: [], clock: null, flames: [], motes: null, lights: {} };
  const UNIT = { w: 1.2, d: 0.42, h: 3.4, n: 6, plinth: 0.12, top: 0.2 };
  const DOOR = { w: 2.2, h: 3.0 };     // the doorways to the great hall and to the gallery
  const decoRows = [];                 // the great hall's balcony shelves: old volumes only, out of reach

  function bookcaseKit(kit, w, d, h, n, plinth, top, mat, opts) {
    const side = 0.04, board = 0.03;
    kit.box(mat, side, h, d, -w / 2 + side / 2, h / 2, 0);
    kit.box(mat, side, h, d, w / 2 - side / 2, h / 2, 0);
    kit.box((opts && opts.back) || M.walnutDark, w - side * 2, h - plinth, 0.02, 0, plinth + (h - plinth) / 2, -d / 2 + 0.01);
    kit.box(mat, w, plinth, d, 0, plinth / 2, 0.005);
    const rowH = (h - plinth - top) / n;
    for (let i = 0; i <= n; i++) kit.box(mat, w - side * 2, board, d - 0.03, 0, plinth + i * rowH, -0.01);
    kit.box(mat, w + 0.04, top - 0.03, d + 0.03, 0, h - top / 2 + 0.02, 0.01);                 // cornice
    kit.box(mat, w + 0.08, 0.04, d + 0.07, 0, h + 0.01, 0.03);
    if (opts && opts.face) kit.box(mat, 0.06, h - plinth - top, 0.02, -w / 2 + 0.03, plinth + (h - plinth - top) / 2, d / 2 + 0.005);
    return rowH;
  }

  function buildRoom(names) {
    const { x0, x1, z0, z1, h } = ROOM;
    const W = x1 - x0, D = z1 - z0;
    // floor
    const floor = new T.Mesh(new T.PlaneGeometry(W, D), M.floor);
    floor.rotation.x = -Math.PI / 2; floor.userData.pick = { kind: 'floor' };
    const fuv = floor.geometry.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * W / 3.2, fuv.getY(i) * D / 3.2);
    scene.add(floor); caseHits.push(floor);
    // ceiling + coffers
    const ck = new Kit();
    ck.box(M.ceiling, W, 0.1, D, 0, h + 0.05, 0);
    for (let x = x0 + 2; x < x1; x += 2) ck.box(M.walnutDark, 0.26, 0.34, D, x, h - 0.17, 0);
    for (let z = z0 + 2; z < z1; z += 2) ck.box(M.walnutDark, W, 0.34, 0.26, 0, h - 0.17, z);
    ck.build(scene);
    // walls (west wall has arched windows: an extruded shape with holes)
    const wk = new Kit();
    wk.box(M.plaster, W, h, 0.3, 0, h / 2, z0 - 0.15);
    // the south wall has a real doorway (x within ±DOOR.w/2), into the passage to the great hall
    const dw = DOOR.w / 2, sw = (x1 - x0) / 2 - dw;
    wk.box(M.plaster, sw, h, 0.3, x0 + sw / 2, h / 2, z1 + 0.15); wk.box(M.plaster, sw, h, 0.3, x1 - sw / 2, h / 2, z1 + 0.15);
    wk.box(M.plaster, DOOR.w, h - DOOR.h, 0.3, 0, DOOR.h + (h - DOOR.h) / 2, z1 + 0.15);
    wk.box(M.plaster, 0.3, h, D, x1 + 0.15, h / 2, 0);
    const shape = new T.Shape(); shape.moveTo(z0, 0); shape.lineTo(z1, 0); shape.lineTo(z1, h); shape.lineTo(z0, h); shape.lineTo(z0, 0);
    const WIN = [-4.6, 0, 4.6], WW = 2.0, SILL = 0.95, SPR = 4.6;
    WIN.forEach(zc => {
      const hole = new T.Path();
      hole.moveTo(zc - WW / 2, SILL); hole.lineTo(zc + WW / 2, SILL); hole.lineTo(zc + WW / 2, SPR);
      hole.absarc(zc, SPR, WW / 2, 0, Math.PI, false); hole.lineTo(zc - WW / 2, SILL);
      shape.holes.push(hole);
    });
    const wgeo = new T.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false, curveSegments: 20 });
    // shape is in (z, y); extrude along +local z -> turn so the wall faces +x at x = x0
    wk.add(wgeo, M.plaster, x0, 0, 0, 0, -Math.PI / 2, 0);
    // wainscot and chair rail all round
    wk.box(M.walnut, W, 1.0, 0.04, 0, 0.5, z0 + 0.02);
    wk.box(M.walnut, sw - 0.2, 1.0, 0.04, x0 + (sw - 0.2) / 2, 0.5, z1 - 0.02); wk.box(M.walnut, sw - 0.2, 1.0, 0.04, x1 - (sw - 0.2) / 2, 0.5, z1 - 0.02);
    wk.box(M.walnut, 0.04, 1.0, D, x1 - 0.02, 0.5, 0);
    [[z0, -5.7], [-3.5, -1.1], [1.1, 3.5], [5.7, z1]].forEach(([a, b]) => wk.box(M.walnut, 0.04, SILL, b - a, x0 + 0.02, SILL / 2, (a + b) / 2));
    wk.box(M.walnut, 0.06, 0.06, D, x1 - 0.03, 1.02, 0);
    // frieze band with the narrators' names, and crown moulding
    wk.box(M.walnutDark, W, 0.08, 0.12, 0, h - 0.04, z0 + 0.06); wk.box(M.walnutDark, W, 0.08, 0.12, 0, h - 0.04, z1 - 0.06);
    wk.box(M.walnutDark, 0.12, 0.08, D, x0 + 0.06, h - 0.04, 0); wk.box(M.walnutDark, 0.12, 0.08, D, x1 - 0.06, h - 0.04, 0);
    wk.build(scene);
    // frieze: the narrators' names carved round the room, the way old reading rooms carry their authors
    const fz = (list, w, x, z, ry) => {
      const t = tex(friezeCanvas(list, w / 0.42)); t.anisotropy = 8;
      const p = new T.Mesh(new T.PlaneGeometry(w, 0.42), std({ map: t, roughness: 0.5, metalness: 0.1 }));
      p.position.set(x, 3.78, z); p.rotation.y = ry; scene.add(p);
    };
    fz(names.slice(0, 4), 9.7, -7.05, z0 + 0.01, 0); fz(names.slice(4, 8), 9.7, 7.05, z0 + 0.01, 0);
    fz(names.slice(8, 16), D - 0.3, x1 - 0.01, 0, -Math.PI / 2); fz(names.slice(16), W - 0.3, 0, z1 - 0.01, Math.PI);

    // windows: reveals, mullions, glass, sky, seats, moonlight on the floor
    const sky = new T.Mesh(new T.PlaneGeometry(26, 12), new T.MeshBasicMaterial({ map: tex(skyCanvas()), fog: false }));
    sky.position.set(x0 - 3, 4.2, 0); sky.rotation.y = Math.PI / 2; scene.add(sky);
    const winK = new Kit();
    const moonTex = tex(moonPatchCanvas(), { srgb: false });
    const moonMat = new T.MeshBasicMaterial({ map: moonTex, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false, color: 0x8fa8ff });
    WIN.forEach(zc => {
      const xg = x0 - 0.25;
      const glass = new T.Mesh(new T.PlaneGeometry(WW, SPR - SILL + WW / 2), M.glass);
      glass.position.set(xg, SILL + (SPR - SILL + WW / 2) / 2, zc); glass.rotation.y = Math.PI / 2; scene.add(glass);
      winK.box(M.walnut, 0.08, SPR - SILL + WW / 2, 0.07, xg, SILL + (SPR - SILL + WW / 2) / 2, zc);
      [SILL + 1.2, SILL + 2.4, SPR].forEach(y => winK.box(M.walnut, 0.08, 0.07, WW, xg, y, zc));
      winK.box(M.walnut, 0.5, 0.06, WW + 0.1, x0 + 0.02, SILL - 0.03, zc);                     // sill
      // window seat with a cushion
      winK.box(M.walnut, 0.62, 0.42, WW + 0.2, x0 + 0.31, 0.21, zc);
      winK.box(M.velvetGreen, 0.58, 0.1, WW, x0 + 0.31, 0.47, zc);
      winK.box(M.cushion, 0.16, 0.42, 0.5, x0 + 0.1, 0.72, zc - 0.55, 0, 0, -0.25);
      winK.box(M.velvetOchre, 0.16, 0.42, 0.5, x0 + 0.1, 0.72, zc + 0.6, 0, 0.1, -0.25);
      [-0.45, 0.45].forEach(dz => {
        const i = fixedSeats.length;
        fixedSeats.push({ x: x0 + 0.4, z: zc + dz, ry: Math.PI / 2, y: 0.52, name: 'window seat' });
        const hit = new T.Mesh(G.box, M.hit); hit.scale.set(0.62, 0.55, 0.9); hit.position.set(x0 + 0.31, 0.3, zc + dz);
        hit.userData.pick = { kind: 'fseat', key: 'w' + i }; scene.add(hit); caseHits.push(hit);
      });
      fixedColliders.push({ x: x0 + 0.31, z: zc, hw: 0.31, hd: WW / 2 + 0.1, r: 0 });
      const patch = new T.Mesh(G.plane, moonMat);
      patch.rotation.x = -Math.PI / 2; patch.rotation.z = -Math.PI / 2;
      patch.scale.set(2.2, 5.4, 1); patch.position.set(x0 + 3.6, 0.012, zc); scene.add(patch);
    });
    winK.build(scene);

    // pilasters between windows
    const pk = new Kit();
    [z0 + 0.6, -2.3, 2.3, z1 - 0.6].forEach(z => { pk.box(M.walnut, 0.14, h - 0.3, 0.5, x0 + 0.07, (h - 0.3) / 2, z); });
    pk.build(scene);

    // the fireplace
    const fk = new Kit();
    const fzB = z0;                                     // back wall plane
    fk.box(M.plaster, 1.3, h, 0.62, -1.45, h / 2, fzB + 0.31);                         // chimney breast, open for the firebox
    fk.box(M.plaster, 1.3, h, 0.62, 1.45, h / 2, fzB + 0.31);
    fk.box(M.plaster, 1.6, h - 1.07, 0.62, 0, 1.07 + (h - 1.07) / 2, fzB + 0.31);
    fk.box(M.marble, 0.5, 1.45, 0.3, -1.05, 0.725, fzB + 0.77);                      // jambs
    fk.box(M.marble, 0.5, 1.45, 0.3, 1.05, 0.725, fzB + 0.77);
    fk.box(M.marble, 2.6, 0.38, 0.3, 0, 1.26, fzB + 0.77);                           // lintel
    fk.box(M.marble, 3.1, 0.09, 0.46, 0, 1.5, fzB + 0.82);                           // mantel shelf
    fk.box(M.marble, 3.0, 0.06, 1.0, 0, 0.03, fzB + 1.12);                           // hearth
    fk.box(M.soot, 1.6, 1.07, 0.04, 0, 0.535, fzB + 0.06);                           // firebox: back, sides, top, floor
    fk.box(M.soot, 0.04, 1.07, 0.6, -0.78, 0.535, fzB + 0.34, 0, 0.12); fk.box(M.soot, 0.04, 1.07, 0.6, 0.78, 0.535, fzB + 0.34, 0, -0.12);
    fk.box(M.soot, 1.6, 0.04, 0.6, 0, 1.05, fzB + 0.34);
    fk.box(M.stone, 1.6, 0.02, 0.62, 0, 0.01, fzB + 0.34);
    fk.box(M.iron, 1.3, 0.05, 0.4, 0, 0.12, fzB + 0.42);                             // grate
    [-0.5, -0.2, 0.15, 0.45].forEach(x => fk.box(M.iron, 0.03, 0.12, 0.4, x, 0.06, fzB + 0.42));
    // logs
    fk.add(G.cyl8, M.walnutDark, 0, 0.2, fzB + 0.42, 0, 0.3, Math.PI / 2, 0.14, 0.95, 0.14);
    fk.add(G.cyl8, M.walnutDark, 0.05, 0.31, fzB + 0.36, 0, -0.4, Math.PI / 2, 0.12, 0.8, 0.12);
    // frame for the Sankofa
    fk.box(M.brass, 1.6, 1.6, 0.06, 0, 3.0, fzB + 0.64);
    fk.box(M.walnutDark, 1.44, 1.44, 0.07, 0, 3.0, fzB + 0.645);
    // candlesticks
    [-1.2, 1.2].forEach(x => { fk.add(G.candlestick, M.brass, x, 1.545, fzB + 0.82, 0, 0, 0, 0.12, 0.34, 0.12); fk.add(G.cyl, M.linen, x, 1.97, fzB + 0.82, 0, 0, 0, 0.035, 0.18, 0.035); });
    // mantel clock body
    fk.box(M.mahogany, 0.42, 0.36, 0.16, 0, 1.725, fzB + 0.82);
    fk.add(G.cyl, M.mahogany, 0, 1.9, fzB + 0.82, Math.PI / 2, 0, 0, 0.42, 0.16, 0.3);
    fk.build(scene);
    fixedColliders.push({ x: 0, z: fzB + 0.31, hw: 2.1, hd: 0.31, r: 0 }, { x: 0, z: fzB + 0.85, hw: 1.55, hd: 0.25, r: 0 });
    const sank = new T.Mesh(new T.PlaneGeometry(1.36, 1.36), std({ map: tex(sankofaCanvas()), roughness: 0.6, metalness: 0.15 }));
    sank.position.set(0, 3.0, fzB + 0.685); scene.add(sank);
    // fire: emissive embers + flame cards
    const embers = new T.Mesh(G.box, new T.MeshBasicMaterial({ color: 0xff5a14 }));
    embers.scale.set(1.0, 0.03, 0.3); embers.position.set(0, 0.15, fzB + 0.42); scene.add(embers);
    anim.embers = embers;
    const flameMat = new T.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uT; uniform float uSeed; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1.,0.)), f.x), mix(h(i+vec2(0.,1.)), h(i+vec2(1.,1.)), f.x), f.y); }
        void main(){
          vec2 uv = vUv; float t = uT + uSeed * 7.0; float y = uv.y; float x = (uv.x - 0.5) * 2.0;
          float q = n(vec2(uv.x * 4.0 + uSeed, y * 3.0 - t * 2.4)) * 0.6 + n(vec2(uv.x * 9.0, y * 7.0 - t * 4.1)) * 0.4;
          float w = (1.0 - y) * 0.8 + 0.06;
          float shape = 1.0 - smoothstep(w * 0.45, w, abs(x + (q - 0.5) * 0.6 * y));
          float fade = smoothstep(1.0, 0.2, y + (q - 0.5) * 0.4) * smoothstep(0.0, 0.1, y);
          float a = shape * fade;
          vec3 col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.82, 0.42), smoothstep(0.25, 0.95, a * (1.0 - y * 0.6)));
          gl_FragColor = vec4(col * a * 1.5, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide
    });
    [[-0.28, 0.0, 0.9, 0.95], [0.05, 0.5, 1.1, 1.05], [0.32, -0.5, 0.8, 0.85], [-0.05, 1.3, 0.7, 0.7]].forEach(([x, ry, w, hh], i) => {
      const m = flameMat.clone(); m.uniforms.uSeed.value = i * 1.7 + 0.3;
      const p = new T.Mesh(G.plane, m); p.scale.set(w, hh, 1); p.position.set(x, 0.18 + hh / 2, fzB + 0.42); p.rotation.y = ry;
      scene.add(p); anim.flames.push(m);
    });
    // clock face and hands
    const face = new T.Mesh(new T.CircleGeometry(0.11, 32), std({ map: tex(clockCanvas()), roughness: 0.4 }));
    face.position.set(0, 1.86, fzB + 0.9 + 0.001); scene.add(face);
    const hand = (len, w) => { const g = new T.Group(); const m = new T.Mesh(G.box, M.black); m.scale.set(w, len, 0.004); m.position.y = len / 2 - 0.01; g.add(m); g.position.set(0, 1.86, fzB + 0.905); scene.add(g); return g; };
    anim.clock = { hr: hand(0.055, 0.008), mn: hand(0.085, 0.005) };

    // double doors on the south wall
    const dk = new Kit(), dz = z1;
    [-1, 1].forEach(sx => dk.box(M.walnutDark, 0.22, DOOR.h + 0.2, 0.46, sx * (dw + 0.11), (DOOR.h + 0.2) / 2, dz + 0.1));
    dk.box(M.walnut, 3.0, 0.3, 0.3, 0, 3.55, dz - 0.15);
    dk.box(M.walnutDark, DOOR.w + 0.44, 0.22, 0.46, 0, DOOR.h + 0.11, dz + 0.1);
    dk.box(M.marble, DOOR.w, 0.02, 0.5, 0, 0.01, dz + 0.1);                                        // threshold
    dk.build(scene);
    makeDoor('hall', [0, dz + 0.06], 0, ['THE GREAT HALL', 'opens when you have read', 'your first chapter']);

    // built-in bookcases: north (beside the chimney), south (beside the door), east (the long wall)
    const bk = new Kit();
    const units = [];
    const unit = (id, x, z, ry, fillFn) => units.push({ id, x, z, ry, fillFn });
    for (let i = 0; i < 7; i++) { unit('N' + i, -2.7 - 0.6 - i * 1.2, z0 + UNIT.d / 2, 0); unit('N' + (13 - i), 2.7 + 0.6 + i * 1.2, z0 + UNIT.d / 2, 0); }
    for (let i = 0; i < 7; i++) { unit('S' + i, -1.8 - 0.6 - i * 1.2, z1 - UNIT.d / 2, Math.PI); unit('S' + (13 - i), 1.8 + 0.6 + i * 1.2, z1 - UNIT.d / 2, Math.PI); }
    for (let i = 0; i < 12; i++) unit('E' + i, x1 - UNIT.d / 2, -6.6 + i * 1.2, -Math.PI / 2);
    const tmpl = new Kit();
    const rowH = bookcaseKit(tmpl, UNIT.w, UNIT.d, UNIT.h, UNIT.n, UNIT.plinth, UNIT.top, M.walnut, { face: true });
    const tmplGold = new Kit();                         // the golden wall is backed in oxblood damask
    bookcaseKit(tmplGold, UNIT.w, UNIT.d, UNIT.h, UNIT.n, UNIT.plinth, UNIT.top, M.walnut, { face: true, back: M.damask });
    // the golden wall: gilt on every shelf edge, the posts and the cornice
    const gilt = new Kit();
    for (let i = 0; i <= UNIT.n; i++) gilt.box(M.gilt, UNIT.w - 0.08, 0.012, 0.006, 0, UNIT.plinth + i * rowH + 0.009, UNIT.d / 2 - 0.022);
    [-1, 1].forEach(sx => gilt.box(M.gilt, 0.012, UNIT.h - UNIT.plinth - UNIT.top, 0.006, sx * (UNIT.w / 2 - 0.02), UNIT.plinth + (UNIT.h - UNIT.plinth - UNIT.top) / 2, UNIT.d / 2 + 0.004));
    gilt.box(M.gilt, UNIT.w + 0.05, 0.022, 0.006, 0, UNIT.h - UNIT.top + 0.04, UNIT.d / 2 + 0.03);
    gilt.box(M.gilt, UNIT.w + 0.09, 0.012, 0.006, 0, UNIT.h + 0.01, UNIT.d / 2 + 0.068);
    const gk = new Kit();
    units.forEach(u => {
      const g = new T.Group(); g.position.set(u.x, 0, u.z); g.rotation.y = u.ry; scene.add(g); g.updateMatrixWorld(true);
      const sec = SEC[UNIT_SEC[u.id]];
      for (const [mat, list] of (sec && sec.gold ? tmplGold : tmpl).parts) for (const [geo, m] of list) bk.addM(geo, mat, m.clone().premultiply(g.matrixWorld));
      if (sec && sec.gold) for (const [mat, list] of gilt.parts) for (const [geo, m] of list) gk.addM(geo, mat, m.clone().premultiply(g.matrixWorld));
      for (let r = 0; r < UNIT.n; r++) {
        const fill = r === UNIT.n - 1 ? 0.7 : 0.88;
        addRow(u.id + '.' + r, g, -UNIT.w / 2 + 0.05, UNIT.w / 2 - 0.05, UNIT.plinth + r * rowH + 0.015, UNIT.d / 2 - 0.02, UNIT.d - 0.05, rowH - 0.03, fill, true);
      }
      const c = Math.cos(u.ry), s = Math.sin(u.ry);
      fixedColliders.push({ x: u.x, z: u.z, hw: UNIT.w / 2, hd: UNIT.d / 2, r: u.ry, c, s });
    });
    bk.build(scene); gk.build(scene);
    // a plaque over each section: gilt on the golden wall, bronze over the great books
    const uById = Object.fromEntries(units.map(u => [u.id, u]));
    SECTIONS.forEach(sc => {
      if (sc.plaque === false) return;
      const us = sc.units.map(id => uById[id]).filter(Boolean); if (!us.length) return;
      const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cz = us.reduce((a, u) => a + u.z, 0) / us.length;
      const w = Math.min(2.2, us.length * 1.2 - 0.14), hh = w < 1.2 ? 0.2 : 0.186;
      const pq = new T.Mesh(new T.PlaneGeometry(w, hh), std({ map: tex(plaqueCanvas(sc.name, sc.sub, sc.gold, w / hh)), roughness: 0.3, metalness: sc.gold ? 0.6 : 0.4 }));
      const u = us[0], nx = Math.sin(u.ry), nz = Math.cos(u.ry), off = UNIT.d / 2 + 0.028;
      pq.position.set(cx + nx * off, UNIT.h - 0.1, cz + nz * off); pq.rotation.y = u.ry; scene.add(pq);
    });
    // brass picture lights along the whole golden wall, so each section glows when you come near
    const pl = new Kit();
    const lightAt = (x, y, z, k) => { const src = new T.Object3D(); src.position.set(x, y, z); scene.add(src); src.updateMatrixWorld(true); lampSources.push({ obj: src, info: { lamp: { local: V3(0, 0, 0), k } } }); };
    [-6.0, -3.6, -1.2, 1.2, 3.6, 6.0].forEach(z => {
      pl.add(G.cyl, M.brass, x1 - 0.56, 2.86, z, Math.PI / 2, 0, 0, 0.07, 1.0, 0.07);
      pl.add(G.box, M.bulb, x1 - 0.56, 2.83, z, 0, 0, 0, 0.03, 0.01, 0.9);
      pl.add(G.box, M.brass, x1 - 0.5, 2.92, z, 0, 0, 0, 0.12, 0.02, 0.02);
      lightAt(x1 - 0.9, 2.5, z, 1.5);
    });
    // and over the great books on the north wall, either side of the fire
    [-3.9, -6.3, -8.7, -10.5, 3.9, 6.3, 8.7, 10.5].forEach(x => {
      pl.add(G.cyl, M.brass, x, 2.86, z0 + 0.56, 0, 0, Math.PI / 2, 0.07, 1.0, 0.07);
      pl.add(G.box, M.bulb, x, 2.83, z0 + 0.56, 0, 0, 0, 0.9, 0.01, 0.03);
      pl.add(G.box, M.brass, x, 2.92, z0 + 0.5, 0, 0, 0, 0.02, 0.02, 0.12);
      lightAt(x, 2.5, z0 + 0.9, 1.3);
    });
    pl.build(scene);
    const lk = new Kit();
    lk.add(G.cyl, M.brass, x1 - UNIT.d - 0.14, 3.1, 0, Math.PI / 2, 0, 0, 0.035, 14.4, 0.035);
    const lx = x1 - 1.26, lz = 4.55;                  // between the speeches and the historians, over old volumes
    [-0.24, 0.24].forEach(dz2 => lk.add(G.box, M.oak, lx + 0.24, 1.6, lz + dz2, 0, 0, -0.28, 0.06, 3.3, 0.06));
    for (let i = 0; i < 9; i++) { const y = 0.3 + i * 0.34; lk.add(G.cyl8, M.oak, lx - 0.22 + y * 0.288, y, lz, Math.PI / 2, 0, 0, 0.03, 0.5, 0.03); }
    lk.build(scene);
    fixedColliders.push({ x: x1 - 1.25, z: lz, hw: 0.3, hd: 0.3, r: 0 });

    // chandeliers
    [-5, 5].forEach(x => {
      const k = new Kit();
      k.add(G.cyl, M.brass, x, 5.9, 0, 0, 0, 0, 0.03, 2.2, 0.03);
      k.add(G.torus, M.brass, x, 4.75, 0, Math.PI / 2, 0, 0, 1.6, 1.6, 1.6);
      k.add(G.torus, M.brass, x, 4.6, 0, Math.PI / 2, 0, 0, 0.9, 0.9, 1.2);
      k.add(G.sph, M.brass, x, 4.55, 0, 0, 0, 0, 0.22);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * TAU, rr = 0.8;
        k.add(G.cyl, M.linen, x + Math.cos(a) * rr, 4.86, Math.sin(a) * rr, 0, 0, 0, 0.035, 0.16, 0.035);
        k.add(G.sph, M.bulb, x + Math.cos(a) * rr, 4.98, Math.sin(a) * rr, 0, 0, 0, 0.045, 0.07, 0.045);
      }
      k.build(scene);
    });
  }
  function plaqueCanvas(name, sub, gold, aspect) {
    const H = 140, W = Math.round(H * aspect);
    const c = cv(W, H), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, H);
    if (gold) { gr.addColorStop(0, '#e9c87a'); gr.addColorStop(0.5, '#b88a35'); gr.addColorStop(1, '#e0bd6c'); } else { gr.addColorStop(0, '#6b4a2a'); gr.addColorStop(0.5, '#3e2914'); gr.addColorStop(1, '#5c3f22'); }
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = gold ? '#6a4a18' : '#c8a050'; g.lineWidth = 4; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = gold ? '#3a2508' : '#e6c98a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let f = 64; g.font = `700 ${f}px Georgia, serif`;
    while (g.measureText(name.toUpperCase()).width > W - 50 && f > 30) { f -= 2; g.font = `700 ${f}px Georgia, serif`; }
    g.fillText(name.toUpperCase(), W / 2, 58);
    let f2 = 30; g.font = `italic 600 ${f2}px Georgia, serif`;
    while (g.measureText(sub).width > W - 50 && f2 > 16) { f2 -= 1; g.font = `italic 600 ${f2}px Georgia, serif`; }
    g.fillText(sub, W / 2, 108);
    return c;
  }

  /* ---------------- begin here: the narratives, lit ---------------- */
  // A gilt runner leads from the middle of the room to the narratives' shelves, a warm light falls on them,
  // and their books glow softly where they stand, so the first thing anyone is drawn to is the testimony
  // of those who lived through slavery.
  let beginGlow = null, beginBeam = null;
  function haloCanvas() {
    const c = cv(256, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 64, 0, 128, 64, 128);
    gr.addColorStop(0, 'rgba(255,214,140,0.95)'); gr.addColorStop(0.4, 'rgba(255,186,90,0.32)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128); return c;
  }
  function beamCanvas() {
    const c = cv(128, 256), g = c.getContext('2d');
    const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(255,220,150,0.55)'); v.addColorStop(0.7, 'rgba(255,200,120,0.12)'); v.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = v; g.fillRect(0, 0, 128, 256);
    g.globalCompositeOperation = 'destination-in';
    const h = g.createLinearGradient(0, 0, 128, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.25, 'rgba(0,0,0,1)'); h.addColorStop(0.75, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = h; g.fillRect(0, 0, 128, 256); return c;
  }
  function runnerCanvas() {
    const c = cv(128, 1024), g = c.getContext('2d');
    g.fillStyle = '#5a1712'; g.fillRect(0, 0, 128, 1024);
    g.fillStyle = '#c9952e'; g.fillRect(0, 0, 10, 1024); g.fillRect(118, 0, 10, 1024);
    g.fillStyle = '#2a0b08'; g.fillRect(12, 0, 4, 1024); g.fillRect(112, 0, 4, 1024);
    g.fillStyle = 'rgba(214,166,70,0.55)';
    for (let y = 32; y < 1024; y += 64) { g.beginPath(); g.moveTo(64, y - 18); g.lineTo(84, y); g.lineTo(64, y + 18); g.lineTo(44, y); g.closePath(); g.fill(); }
    return c;
  }
  function buildBegin() {
    const x1 = ROOM.x1;
    // a warm halo over "The Narratives" (units E4-E7, centred on z 0) and a soft fall of light onto them
    beginGlow = new T.Mesh(new T.PlaneGeometry(4.2, 1.4), new T.MeshBasicMaterial({ map: tex(haloCanvas()), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.5 }));
    beginGlow.position.set(x1 - 0.62, UNIT.h - 0.1, 0); beginGlow.rotation.y = -Math.PI / 2; beginGlow.renderOrder = 3; scene.add(beginGlow);
    beginBeam = new T.Mesh(new T.PlaneGeometry(4.8, ROOM.h - 0.4), new T.MeshBasicMaterial({ map: tex(beamCanvas()), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.3, side: T.DoubleSide }));
    beginBeam.position.set(x1 - 0.95, (ROOM.h - 0.4) / 2 + 0.2, 0); beginBeam.rotation.y = -Math.PI / 2; beginBeam.renderOrder = 3; scene.add(beginBeam);
    // the gilt runner from the middle of the room to the narratives' shelves
    const rt = tex(runnerCanvas()); rt.wrapT = T.RepeatWrapping; rt.repeat.set(1, 2.7);
    const len = x1 - UNIT.d - 0.2 - 1.2;
    const run = new T.Mesh(new T.PlaneGeometry(0.95, len), std({ map: rt, roughness: 0.92 }));
    run.rotation.x = -Math.PI / 2; run.rotation.z = Math.PI / 2; run.position.set(1.2 + len / 2, 0.006, 0); scene.add(run);
  }
  // the narratives glow softly on the shelves for everyone; a book of your own glows brighter still (setOwn)
  const lit = new Set(), litMats = [];
  function baseMat(o) {
    const pg = o.meta._spine.page;
    if (!lit.has(o.meta.id)) return M.spines[pg];
    if (!litMats[pg]) { const m = M.spines[pg].clone(); m.emissive = new T.Color(0xffc46a); m.emissiveMap = m.map; m.emissiveIntensity = 0.22; litMats[pg] = m; }
    return litMats[pg];
  }
  function setLit(ids) {
    lit.clear(); (ids || []).forEach(id => lit.add(id));
    for (const [id, o] of bookObj) if (o.meta._spine && !own.has(id)) o.mesh.material = baseMat(o);
  }

  /* ---------------- the great hall, and the gallery off it ----------------
     South of the reading room, through its double doors and a short passage: a domed rotunda with a ring
     of oak bookcases (shelves H0.0 … H47.5, as usable as any in the room), a balcony tier of the library's
     own old volumes, a drum of night windows, a glass dome, and a round card catalog at the centre. East of
     it, behind another pair of doors, the Banned Books gallery. Doors open as you read (main.js decides when;
     setDoors() shows it). The floor you can walk on is a union of AREAS, open ones only. */
  const HALL = { cx: 0, cz: 21, r: 11.2, h: 9, slots: 48 };
  const GAL = { x0: 11.25, x1: 26.9, z0: 17.6, z1: 24.4, h: 5 };
  const AREAS = [
    { id: 'room', rect: [ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1], h: ROOM.h },
    { id: 'passage', rect: [-1.0, 1.0, 7.2, 11.4], door: 'hall', h: 3.2, pass: true },
    { id: 'hall', circle: [HALL.cx, HALL.cz, HALL.r - 0.22 - UNIT.d - 0.08], door: 'hall', h: 18 },
    { id: 'arch', rect: [9.6, 12.8, 20.0, 22.0], door: 'banned', h: 3.2, pass: true },
    { id: 'gallery', rect: [GAL.x0, GAL.x1, GAL.z0, GAL.z1], door: 'banned', h: GAL.h }
  ];
  const doorsOpen = { hall: false, banned: false };
  const DOORS = {};                 // id -> { leaves: [{hinge, side}], cur, want, hit }
  let hallGroup = null, galleryGroup = null;
  const openAreas = () => AREAS.filter(a => !a.door || doorsOpen[a.door]);
  function inArea(a, x, z, m) {
    if (a.rect) { const [x0, x1, z0, z1] = a.rect; return x >= x0 + m && x <= x1 - m && z >= z0 + m && z <= z1 - m; }
    const [cx, cz, r] = a.circle; return Math.hypot(x - cx, z - cz) <= r - m;
  }
  function clampArea(a, x, z, m) {
    if (a.rect) { const [x0, x1, z0, z1] = a.rect; return { x: Math.max(x0 + m, Math.min(x1 - m, x)), z: Math.max(z0 + m, Math.min(z1 - m, z)) }; }
    const [cx, cz, r] = a.circle, dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1, R = r - m;
    return d <= R ? { x, z } : { x: cx + dx / d * R, z: cz + dz / d * R };
  }
  // keep a point (with this radius) on open floor: where it is, or the nearest open place
  function walk(x, z, m) {
    const as = openAreas();
    for (const a of as) if (inArea(a, x, z, m)) return { x, z };
    let best = { x, z }, bd = Infinity;
    for (const a of as) { const p = clampArea(a, x, z, m), d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // a piece of furniture fits if its whole footprint is inside one open area (not a doorway)
  function footprintOK(x, z, ex, ez) {
    for (const a of openAreas()) {
      if (a.pass) continue;
      if (a.rect) { const [x0, x1, z0, z1] = a.rect; if (x - ex >= x0 + 0.02 && x + ex <= x1 - 0.02 && z - ez >= z0 + 0.02 && z + ez <= z1 - 0.02) return true; }
      else { const [cx, cz, r] = a.circle; if ([[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([sx, sz]) => Math.hypot(x + sx * ex - cx, z + sz * ez - cz) <= r - 0.02)) return true; }
    }
    return false;
  }
  const areaOf = (x, z) => (z <= ROOM.z1 + 0.2 ? 'room' : x >= 11 && Math.abs(z - HALL.cz) < 4 ? 'gallery' : 'hall');
  // waypoints through the doorways between where you are and where you're going
  const GATES = { 'room>hall': [[0, 7.0], [0, 11.8]], 'hall>gallery': [[9.4, 21], [12.6, 21]] };
  function route(x0, z0, x1, z1) {
    const a = areaOf(x0, z0), b = areaOf(x1, z1);
    if (a === b) return [];
    const seq = { room: 0, hall: 1, gallery: 2 }, names = ['room', 'hall', 'gallery'];
    const out = [];
    for (let i = seq[a]; i !== seq[b]; i += seq[b] > seq[a] ? 1 : -1) {
      const j = i + (seq[b] > seq[a] ? 1 : -1), lo = Math.min(i, j);
      const g = GATES[names[lo] + '>' + names[lo + 1]];
      (j > i ? g : g.slice().reverse()).forEach(([x, z]) => out.push({ x, z }));
    }
    return out;
  }
  function clampCam(x, y, z) {
    const p = walk(x, z, 0.25);
    const a = openAreas().find(ar => inArea(ar, p.x, p.z, 0.2)) || AREAS[0];
    return { x: p.x, y: Math.max(0.4, Math.min(a.h - 0.3, y)), z: p.z };
  }
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

  function setDoors(d, instant) {
    doorsOpen.hall = !!(d && d.hall);
    doorsOpen.banned = doorsOpen.hall && !!(d && d.banned);
    for (const id in DOORS) {
      const D = DOORS[id]; D.want = doorsOpen[id] ? 1 : 0;
      if (instant) D.cur = D.want;
      D.hit.visible = !doorsOpen[id];
      poseDoor(D);
    }
    if (hallGroup) hallGroup.visible = doorsOpen.hall;
    if (galleryGroup) galleryGroup.visible = doorsOpen.banned;
  }
  function poseDoor(D) {
    const e = D.cur * D.cur * (3 - 2 * D.cur);
    D.leaves.forEach(L => { L.hinge.rotation.y = L.side * Math.PI / 2 * 0.95 * e; });
  }
  function noticeCanvas(lines) {
    const c = cv(640, 240), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 240); gr.addColorStop(0, '#e9c87a'); gr.addColorStop(0.5, '#b88a35'); gr.addColorStop(1, '#e0bd6c');
    g.fillStyle = gr; g.fillRect(0, 0, 640, 240);
    g.strokeStyle = '#6a4a18'; g.lineWidth = 5; g.strokeRect(10, 10, 620, 220);
    g.fillStyle = '#3a2508'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 54px Georgia, serif'; g.fillText(lines[0], 320, 72, 580);
    g.font = 'italic 600 34px Georgia, serif'; lines.slice(1).forEach((l, i) => g.fillText(l, 320, 138 + i * 44, 580));
    return c;
  }
  // a pair of doors centred at `at`, across the local x axis; they swing out toward local +z, and the
  // notice faces local -z (the side you stand on while they're shut)
  function makeDoor(id, at, ry, lines, parent) {
    const g = new T.Group(); g.position.set(at[0], 0, at[1]); g.rotation.y = ry; (parent || scene).add(g);
    const leaves = [], lw = DOOR.w / 2 - 0.01;
    [-1, 1].forEach(side => {
      const hinge = new T.Group(); hinge.position.set(side * DOOR.w / 2, 0, 0); g.add(hinge);
      const k = new Kit(), cx = -side * lw / 2;
      k.box(M.mahogany, lw, DOOR.h - 0.02, 0.08, cx, DOOR.h / 2, 0);
      [-1, 1].forEach(face => {
        [0.75, 1.95].forEach(y => k.box(M.walnutDark, lw - 0.26, y > 1 ? 1.5 : 0.85, 0.02, cx, y + (y > 1 ? 0.1 : 0), face * 0.05));
        k.add(G.sph, M.brass, -side * (lw - 0.12), 1.1, face * 0.075, 0, 0, 0, 0.07);
      });
      k.build(hinge);
      if (side === -1) {
        const plate = new T.Mesh(new T.PlaneGeometry(0.86, 0.32), std({ map: tex(noticeCanvas(lines)), roughness: 0.35, metalness: 0.55 }));
        plate.position.set(cx, 1.62, -0.064); plate.rotation.y = Math.PI; hinge.add(plate);
      }
      leaves.push({ hinge, side });
    });
    const hit = new T.Mesh(G.box, M.hit); hit.scale.set(DOOR.w, DOOR.h, 0.3); hit.position.set(0, DOOR.h / 2, -0.1);
    hit.userData.pick = { kind: 'door', door: id }; g.add(hit); caseHits.push(hit);
    DOORS[id] = { leaves, cur: 0, want: 0, hit };
    return g;
  }

  // a stone-coloured ashlar texture for the rotunda
  function ashlarCanvas() {
    const S = 512, c = cv(S, S), g = c.getContext('2d'), R = rng(77);
    g.fillStyle = '#d8cbb2'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '90,70,40' : '255,250,235'},${R() * 0.08})`; g.fillRect(R() * S, R() * S, 2, 2); }
    g.strokeStyle = 'rgba(120,100,70,.35)'; g.lineWidth = 3;
    for (let r = 0; r < 4; r++) { const y = r * S / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); for (let k = 0; k < 2; k++) { const x = (k + (r % 2) * 0.5) * S / 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + S / 4); g.stroke(); } }
    return c;
  }
  // the hall floor: marble rings round a compass rose whose north points back to the reading room
  function hallFloorCanvas() {
    const S = 2048, c = cv(S, S), g = c.getContext('2d'), C = S / 2;
    g.fillStyle = '#ddd2bd'; g.fillRect(0, 0, S, S);
    const R = rng(91);
    for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '120,105,80' : '255,252,240'},${R() * 0.07})`; g.fillRect(R() * S, R() * S, 2 + R() * 3, 1 + R() * 2); }
    const ring = (r0, r1, col) => { g.beginPath(); g.arc(C, C, r1 * C, 0, TAU); g.arc(C, C, r0 * C, 0, TAU, true); g.fillStyle = col; g.fill(); };
    ring(0.93, 1.0, '#24382e'); ring(0.905, 0.915, '#b88a35'); ring(0.885, 0.895, '#b88a35');
    for (let i = 0; i < 32; i++) {                                  // alternating marble wedges
      const a0 = i / 32 * TAU, a1 = (i + 1) / 32 * TAU;
      g.beginPath(); g.arc(C, C, 0.86 * C, a0, a1); g.arc(C, C, 0.58 * C, a1, a0, true); g.closePath();
      g.fillStyle = i % 2 ? 'rgba(60,45,30,.55)' : 'rgba(250,244,230,.6)'; g.fill();
    }
    ring(0.56, 0.58, '#b88a35'); ring(0.5, 0.515, '#24382e');
    // the compass rose: eight points, the long ones dark and gold
    const star = (n, rOut, rIn, rot, colA, colB) => {
      for (let i = 0; i < n; i++) {
        const a = rot + i / n * TAU, l = a - Math.PI / n, r = a + Math.PI / n;
        const tip = [C + Math.sin(a) * rOut * C, C - Math.cos(a) * rOut * C];
        const pl = [C + Math.sin(l) * rIn * C, C - Math.cos(l) * rIn * C], pr = [C + Math.sin(r) * rIn * C, C - Math.cos(r) * rIn * C];
        g.beginPath(); g.moveTo(C, C); g.lineTo(...pl); g.lineTo(...tip); g.closePath(); g.fillStyle = colA; g.fill();
        g.beginPath(); g.moveTo(C, C); g.lineTo(...pr); g.lineTo(...tip); g.closePath(); g.fillStyle = colB; g.fill();
      }
    };
    star(8, 0.24, 0.07, Math.PI / 8, '#3a2a1a', '#7a5a2e');
    star(4, 0.4, 0.09, 0, '#2a1d10', '#c99a45');
    g.fillStyle = '#b88a35'; g.beginPath(); g.arc(C, C, 0.04 * C, 0, TAU); g.fill();
    g.fillStyle = '#3a2508'; g.font = `700 ${0.07 * C}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', C, C - 0.46 * C);
    g.font = `italic 600 ${0.026 * C}px Georgia, serif`; g.fillText('to the Reading Room', C, C - 0.535 * C);
    return c;
  }
  // the dome seen from below: stone ribs and rings over panes of night sky, a moonlit oculus at the top.
  // (a hemisphere uses the canvas's top half: y 0 = the crown, y = H/2 = the springing line)
  function domeCanvas() {
    const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d'), R = rng(5);
    const sky = g.createLinearGradient(0, 0, 0, H / 2); sky.addColorStop(0, '#5a6c9c'); sky.addColorStop(0.18, '#1d2c55'); sky.addColorStop(1, '#0a1230');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) { const y = R() * H / 2; g.fillStyle = `rgba(255,255,240,${0.25 + R() * 0.7})`; g.fillRect(R() * W, y, R() < 0.06 ? 2.4 : 1.2, R() < 0.06 ? 2.4 : 1.2); }
    g.fillStyle = 'rgba(30,40,70,.9)';                                   // lead lines between panes
    for (let i = 0; i < 96; i++) g.fillRect(i * W / 96 - 1, 0, 2, H / 2);
    [0.13, 0.19, 0.25, 0.31, 0.37, 0.43].forEach(f => g.fillRect(0, f * H, W, 2));
    g.fillStyle = '#e4d7bd';                                             // stone ribs and rings
    for (let i = 0; i < 24; i++) g.fillRect(i * W / 24 - 7, H * 0.04, 14, H / 2);
    [0.1, 0.22, 0.34, 0.46].forEach(f => g.fillRect(0, f * H - 6, W, 12));
    const oc = g.createLinearGradient(0, 0, 0, H * 0.06); oc.addColorStop(0, '#f2f0e0'); oc.addColorStop(1, '#8fa0c8');
    g.fillStyle = oc; g.fillRect(0, 0, W, H * 0.04);
    g.fillStyle = '#c8a050'; g.fillRect(0, H * 0.04 - 4, W, 8);
    g.fillStyle = '#e4d7bd'; g.fillRect(0, H / 2 - 18, W, 18);
    return c;
  }
  function nightWindowCanvas() {
    const W = 256, H = 384, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#d8cbb2'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#26386a'); gr.addColorStop(1, '#0b1330');
    g.fillStyle = gr; g.beginPath(); g.moveTo(28, H - 12); g.lineTo(28, 110); g.arc(W / 2, 110, W / 2 - 28, Math.PI, 0); g.lineTo(W - 28, H - 12); g.closePath(); g.fill();
    g.strokeStyle = '#3a2f22'; g.lineWidth = 6; g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, 20); g.lineTo(W / 2, H - 12); [160, 240, 320].forEach(y => { g.moveTo(28, y); g.lineTo(W - 28, y); }); g.stroke();
    const R = rng(3); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,235,${0.3 + R() * 0.6})`; g.fillRect(40 + R() * (W - 80), 40 + R() * (H - 80), 1.5, 1.5); }
    return c;
  }
  function drawersCanvas() {
    const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#7a5230'; g.fillRect(0, 0, W, H);
    for (let r = 0; r < 6; r++) for (let k = 0; k < 24; k++) {
      const x = k * W / 24 + 4, y = r * H / 6 + 4, w = W / 24 - 8, h = H / 6 - 8;
      g.fillStyle = '#8c6038'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(30,15,5,.6)'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
      g.fillStyle = '#efe6cf'; g.fillRect(x + w / 2 - 9, y + 6, 18, 10);
      g.fillStyle = '#c8a050'; g.fillRect(x + w / 2 - 7, y + h - 14, 14, 5);
    }
    return c;
  }
  const scaleUV = (geo, su, sv) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); uv.needsUpdate = true; return geo; };

  function buildHall() {
    const { cx, cz, r } = HALL, z1 = ROOM.z1;
    hallGroup = new T.Group(); scene.add(hallGroup);
    const ashTex = tex(ashlarCanvas(), { repeat: true });
    M.ashlar = std({ map: ashTex, roughness: 0.85, envMapIntensity: 0.4, side: T.DoubleSide });
    M.ashlarBox = std({ map: ashTex, roughness: 0.85, envMapIntensity: 0.4 }); M.ashlarBox.userData.boxUV = 1.6;
    const pk = new Kit();
    // the passage: stone walls, a coffered ceiling, a marble floor
    [-1, 1].forEach(sx => pk.box(M.ashlarBox, 0.4, 3.4, 1.9, sx * 1.45, 1.7, z1 + 1.25));
    pk.box(M.walnutDark, 2.9, 0.2, 1.9, 0, 3.3, z1 + 1.25);
    pk.box(M.walnut, 2.5, 0.06, 0.12, 0, 3.17, z1 + 0.6); pk.box(M.walnut, 2.5, 0.06, 0.12, 0, 3.17, z1 + 1.6);
    pk.build(hallGroup);
    const pf = new T.Mesh(new T.PlaneGeometry(2.5, 2.2), M.marble);
    pf.rotation.x = -Math.PI / 2; pf.position.set(0, 0.0015, z1 + 1.1); pf.userData.pick = { kind: 'floor' }; hallGroup.add(pf); caseHits.push(pf);
    // the rotunda floor
    const ft = tex(hallFloorCanvas()); ft.anisotropy = 8;
    const floor = new T.Mesh(new T.CircleGeometry(r, 96), std({ map: ft, roughness: 0.3, envMapIntensity: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.0025, cz); floor.userData.pick = { kind: 'floor' }; hallGroup.add(floor); caseHits.push(floor);
    // walls: below the doors' height the cylinder has gaps for the passage (north) and the gallery (east)
    const del = Math.PI / HALL.slots * 2 * 0.98, door = DOOR.h + 0.15;
    const segA = new T.CylinderGeometry(r, r, door, 24, 1, true, Math.PI / 2 + del, Math.PI / 2 - 2 * del);
    const segB = new T.CylinderGeometry(r, r, door, 64, 1, true, Math.PI + del, Math.PI * 1.5 - 2 * del);
    const upper = new T.CylinderGeometry(r, r, HALL.h - door, 96, 1, true);
    [[segA, (Math.PI / 2 - 2 * del) * r / 1.6], [segB, (Math.PI * 1.5 - 2 * del) * r / 1.6], [upper, TAU * r / 1.6]].forEach(([geo, su], i) => {
      scaleUV(geo, su, (i < 2 ? door : HALL.h - door) / 1.6);
      const m = new T.Mesh(geo, M.ashlar); m.position.set(cx, i < 2 ? door / 2 : door + (HALL.h - door) / 2, cz); hallGroup.add(m);
    });
    // jambs to close the gaps beside each pair of doors
    const jk = new Kit();
    [-1, 1].forEach(s => jk.box(M.ashlarBox, 0.5, door, 0.6, cx + r - 0.1, door / 2, cz + s * (DOOR.w / 2 + 0.3)));
    jk.box(M.walnutDark, 0.5, 0.22, DOOR.w + 0.4, cx + r - 0.12, DOOR.h + 0.11, cz);
    [-1, 1].forEach(s => jk.box(M.walnutDark, 0.5, DOOR.h + 0.2, 0.2, cx + r - 0.12, (DOOR.h + 0.2) / 2, cz + s * (DOOR.w / 2 + 0.1)));
    jk.build(hallGroup);

    // the ring of bookcases (oak), with marble pilasters between them; the passage and gallery slots stay open
    const slotA = (k) => (k + 0.5) / HALL.slots * TAU;                 // angle of slot k, from +x toward +z
    const isGap = (k) => [35, 36, 47, 0].includes(k);
    const tmpl = new Kit();
    const rowH = bookcaseKit(tmpl, UNIT.w, UNIT.d, UNIT.h, UNIT.n, UNIT.plinth, UNIT.top, M.oak, { face: true, back: M.walnut });
    const tmplUp = new Kit();
    const UP = { h: 2.8, n: 4, plinth: 0.08, top: 0.16 };
    const rowUp = bookcaseKit(tmplUp, UNIT.w, UNIT.d, UP.h, UP.n, UP.plinth, UP.top, M.oak, { face: true, back: M.walnut });
    const bk = new Kit(), lips = new Kit();
    const rU = r - 0.22 - UNIT.d / 2, rUp = r - 0.02 - UNIT.d / 2, BAL = 3.62;
    const place = (ang, rad, y) => { const g = new T.Group(); g.position.set(cx + Math.cos(ang) * rad, y, cz + Math.sin(ang) * rad); g.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang)); hallGroup.add(g); g.updateMatrixWorld(true); return g; };
    const hallU = {};
    for (let k = 0; k < HALL.slots; k++) {
      const a = slotA(k);
      if (!isGap(k)) {
        const g = place(a, rU, 0); hallU['H' + k] = g;
        for (const [mat, list] of tmpl.parts) for (const [geo, m] of list) bk.addM(geo, mat, m.clone().premultiply(g.matrixWorld));
        for (let i = 0; i <= UNIT.n; i++) lips.addM(G.box, M.brass, mtx(0, UNIT.plinth + i * rowH + 0.009, UNIT.d / 2 - 0.022, 0, 0, 0, UNIT.w - 0.08, 0.01, 0.006).premultiply(g.matrixWorld));
        for (let rr = 0; rr < UNIT.n; rr++) addRow('H' + k + '.' + rr, g, -UNIT.w / 2 + 0.05, UNIT.w / 2 - 0.05, UNIT.plinth + rr * rowH + 0.015, UNIT.d / 2 - 0.02, UNIT.d - 0.05, rowH - 0.03, rr === UNIT.n - 1 ? 0.7 : 0.85, true, 'hall');
        fixedColliders.push({ x: g.position.x, z: g.position.z, hw: UNIT.w / 2, hd: UNIT.d / 2, r: g.rotation.y, c: Math.cos(g.rotation.y), s: Math.sin(g.rotation.y) });
      }
      // upper tier, all the way round
      const gu = place(a, rUp, BAL);
      for (const [mat, list] of tmplUp.parts) for (const [geo, m] of list) bk.addM(geo, mat, m.clone().premultiply(gu.matrixWorld));
      for (let rr = 0; rr < UP.n; rr++) decoRows.push({ id: 'U' + k + '.' + rr, parent: gu, x0: -UNIT.w / 2 + 0.05, x1: UNIT.w / 2 - 0.05, y: UP.plinth + rr * rowUp + 0.015, z: UNIT.d / 2 - 0.02, depth: UNIT.d - 0.05, height: rowUp - 0.03, fill: 0.9, seed: hash('U' + k + '.' + rr), area: 'hall' });
      // a marble pilaster between ground-tier slots (not inside the openings)
      const b = k / HALL.slots * TAU;
      if (!(isGap(k) && isGap((k + HALL.slots - 1) % HALL.slots))) bk.add(G.box, M.marble, cx + Math.cos(b) * (rU + 0.04), 1.75, cz + Math.sin(b) * (rU + 0.04), 0, Math.atan2(-Math.cos(b), -Math.sin(b)), 0, 0.2, 3.5, 0.5);
    }
    // a bronze plaque over each section of the great books, on its middle bookcase
    SECTIONS.forEach(sc => {
      const us = sc.units.filter(id => hallU[id]); if (!us.length || sc.plaque === false) return;
      const w = 2.2, hh = 0.186;
      const pq = new T.Mesh(new T.PlaneGeometry(w, hh), std({ map: tex(plaqueCanvas(sc.name, sc.sub, sc.gold, w / hh)), roughness: 0.3, metalness: sc.gold ? 0.6 : 0.4 }));
      pq.position.set(0, UNIT.h - 0.1, UNIT.d / 2 + 0.028); hallU[us[(us.length - 1) >> 1]].add(pq);
    });
    bk.build(hallGroup); lips.build(hallGroup);
    decoRows.forEach(dr => { dr.fillers = genFillers(dr, 0); });
    // the balcony: a ring floor, its edge, a balustrade
    const balTop = new T.Mesh(new T.RingGeometry(r - 1.62, r, 96, 1), std({ color: 0x8a6440, roughness: 0.6 }));
    balTop.rotation.x = -Math.PI / 2; balTop.position.set(cx, BAL, cz); hallGroup.add(balTop);
    const balUnder = new T.Mesh(new T.RingGeometry(r - 1.62, r, 96, 1), M.walnutDark);
    balUnder.rotation.x = Math.PI / 2; balUnder.position.set(cx, BAL - 0.14, cz); hallGroup.add(balUnder);
    const balEdge = new T.Mesh(new T.CylinderGeometry(r - 1.62, r - 1.62, 0.16, 96, 1, true), std({ color: 0x5a3a20, roughness: 0.5, side: T.DoubleSide }));
    balEdge.position.set(cx, BAL - 0.07, cz); hallGroup.add(balEdge);
    const rk = new Kit(), rr0 = r - 1.58;
    for (let i = 0; i < 120; i++) { const a = i / 120 * TAU; rk.add(G.cyl8, M.walnutDark, cx + Math.cos(a) * rr0, BAL + 0.43, cz + Math.sin(a) * rr0, 0, 0, 0, 0.045, 0.86, 0.045); }
    rk.build(hallGroup);
    [BAL + 0.88, BAL + 0.08].forEach((y, i) => { const t = new T.Mesh(new T.TorusGeometry(rr0, i ? 0.03 : 0.05, 6, 160), i ? M.walnutDark : M.brass); t.rotation.x = Math.PI / 2; t.position.set(cx, y, cz); hallGroup.add(t); });
    // cornice, the drum of night windows, the dome
    const cor = new T.Mesh(new T.CylinderGeometry(r - 0.1, r - 0.1, 0.22, 96, 1, true), std({ color: 0xcfc2a6, roughness: 0.7, side: T.DoubleSide }));
    cor.position.set(cx, BAL + UP.h + 0.12, cz); hallGroup.add(cor);
    const winMat = std({ map: tex(nightWindowCanvas()), emissive: 0x9fb4ff, emissiveIntensity: 0.25, roughness: 0.4 });
    winMat.emissiveMap = winMat.map;
    const wk = new Kit();
    for (let j = 0; j < 16; j++) {
      const a = (j + 0.5) / 16 * TAU, w = new T.Mesh(G.plane, winMat);
      w.scale.set(1.5, 2.25, 1); w.position.set(cx + Math.cos(a) * (r - 0.06), 7.75, cz + Math.sin(a) * (r - 0.06)); w.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); hallGroup.add(w);
      const b = j / 16 * TAU;
      wk.add(G.box, M.marble, cx + Math.cos(b) * (r - 0.15), 7.75, cz + Math.sin(b) * (r - 0.15), 0, Math.atan2(-Math.cos(b), -Math.sin(b)), 0, 0.4, 2.5, 0.25);
    }
    wk.build(hallGroup);
    const domeTex = tex(domeCanvas()); domeTex.anisotropy = 8;
    const dome = new T.Mesh(new T.SphereGeometry(r, 96, 32, 0, TAU, 0, Math.PI / 2), std({ map: domeTex, emissiveMap: domeTex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.55, side: T.BackSide }));
    dome.position.set(cx, HALL.h, cz); hallGroup.add(dome);
    [0, 0.42, 0.85, 1.2].forEach(el => { const t = new T.Mesh(new T.TorusGeometry(r * Math.cos(el) - 0.06, el ? 0.07 : 0.16, 8, 128), M.brass); t.rotation.x = Math.PI / 2; t.position.set(cx, HALL.h + r * Math.sin(el), cz); hallGroup.add(t); });
    // a great chandelier on a long chain
    const ck = new Kit();
    ck.add(G.cyl, M.brass, cx, 13.4, cz, 0, 0, 0, 0.035, 11.4, 0.035);
    ck.add(G.torus, M.brass, cx, 7.4, cz, Math.PI / 2, 0, 0, 4.8, 4.8, 3.0);
    ck.add(G.torus, M.brass, cx, 7.0, cz, Math.PI / 2, 0, 0, 2.6, 2.6, 2.0);
    ck.add(G.sph, M.brass, cx, 6.8, cz, 0, 0, 0, 0.4);
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; ck.add(G.cyl, M.linen, cx + Math.cos(a) * 2.4, 7.52, cz + Math.sin(a) * 2.4, 0, 0, 0, 0.04, 0.18, 0.04); ck.add(G.sph, M.bulb, cx + Math.cos(a) * 2.4, 7.66, cz + Math.sin(a) * 2.4, 0, 0, 0, 0.05, 0.08, 0.05); }
    for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * TAU; ck.add(G.sph, M.bulb, cx + Math.cos(a) * 1.3, 7.18, cz + Math.sin(a) * 1.3, 0, 0, 0, 0.05, 0.08, 0.05); }
    ck.build(hallGroup);
    const hl = new T.PointLight(0xffd6a0, 46, 30, 1.3); hl.position.set(cx, 6.6, cz); hallGroup.add(hl);
    // the card catalog at the centre, with four green lamps
    const cat = new T.Group(); cat.position.set(cx, 0, cz); hallGroup.add(cat);
    const dt = tex(drawersCanvas(), { repeat: true }); dt.repeat.set(3, 1);
    const body = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, 0.96, 48, 1, true), std({ map: dt, roughness: 0.6 })); body.position.y = 0.56; cat.add(body);
    const kk = new Kit();
    kk.add(G.cyl, M.walnutDark, 0, 0.04, 0, 0, 0, 0, 2.4, 0.08, 2.4);
    kk.add(G.cyl, M.marble, 0, 1.07, 0, 0, 0, 0, 2.5, 0.06, 2.5);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; kk.add(G.cyl, M.brass, Math.cos(a) * 0.85, 1.22, Math.sin(a) * 0.85, 0, 0, 0, 0.03, 0.26, 0.03); kk.add(G.halfCyl, M.greenGlass, Math.cos(a) * 0.85, 1.38, Math.sin(a) * 0.85, 0, a, Math.PI / 2, 0.16, 0.36, 0.16); }
    kk.build(cat);
    const catHit = new T.Mesh(G.cyl, M.hit); catHit.scale.set(2.5, 1.3, 2.5); catHit.position.y = 0.65; catHit.userData.pick = { kind: 'catalog' }; cat.add(catHit); caseHits.push(catHit);
    fixedColliders.push({ x: cx, z: cz, hw: 1.25, hd: 1.25, r: 0 });
    { const src = new T.Object3D(); src.position.set(cx, 1.8, cz); hallGroup.add(src); lampSources.push({ obj: src, info: { lamp: { local: V3(0, 0, 0), k: 1.6 } } }); }
    { const src = new T.Object3D(); src.position.set(cx, 3.2, z1 + 1.4); hallGroup.add(src); lampSources.push({ obj: src, info: { lamp: { local: V3(0, 0, 0), k: 1.0 } } }); }
    // benches round the catalog, facing it
    const bkB = new Kit();
    [45, 90, 135, 180, 225, 315].forEach(deg => {
      const a = deg / 180 * Math.PI, x = cx + Math.cos(a) * 4.3, z = cz + Math.sin(a) * 4.3, ry = Math.atan2(-Math.cos(a), -Math.sin(a));
      const m = (lx, y, lz, w, h, d) => bkB.addM(G.box, M.oak, mtx(lx, y, lz, 0, 0, 0, w, h, d).premultiply(mtx(x, 0, z, 0, ry, 0)));
      m(0, 0.42, 0, 1.8, 0.07, 0.5); m(0, 0.2, 0, 1.6, 0.06, 0.06);
      [-0.8, 0.8].forEach(lx => m(lx, 0.2, 0, 0.08, 0.4, 0.44));
      [-0.45, 0.45].forEach(t => {
        const i = fixedSeats.length, sx = x + Math.cos(ry) * t, sz = z - Math.sin(ry) * t;
        fixedSeats.push({ x: sx, z: sz, ry, y: 0.48, name: 'bench in the great hall' });
        const hit = new T.Mesh(G.box, M.hit); hit.scale.set(0.85, 0.5, 0.55); hit.position.set(sx, 0.3, sz); hit.rotation.y = ry;
        hit.userData.pick = { kind: 'fseat', key: 'w' + i }; hallGroup.add(hit); caseHits.push(hit);
      });
      fixedColliders.push({ x, z, hw: 0.92, hd: 0.27, r: ry, c: Math.cos(ry), s: Math.sin(ry) });
    });
    bkB.build(hallGroup);
    // the doors to the gallery, in the east of the ring
    makeDoor('banned', [cx + r - 0.1, cz], Math.PI / 2, ['BANNED BOOKS', 'opens when you have finished', 'your first whole book'], hallGroup);
    buildGallery();
  }

  /* the Banned Books gallery: ten books from the collection that were banned, burned, seized or pulled
     from shelves somewhere. Each plaque's facts, with sources, are in SOURCES.md. */
  const EXHIBITS = [
    { id: 'walker-appeal', head: 'Banned in the South, 1829–30', text: "Georgia's legislature made it a capital crime in December 1829 to circulate writing meant to stir up the enslaved. In 1830 North Carolina made bringing in or passing on such writing a felony, in the same session that it outlawed teaching enslaved people to read. Copies that were found were seized and destroyed." },
    { id: 'stowe-uncle-tom', head: 'Ten years for owning it, 1857', text: 'In April 1857 a Maryland court sentenced Samuel Green, a free Black man of Dorchester County, to ten years in the penitentiary for having a copy, under an 1841 law against abolition writings. He was pardoned in 1862 on condition that he leave the state.' },
    { id: 'wells-southern-horrors', head: 'Her press destroyed, 1892', text: 'In May 1892, after Ida B. Wells denounced lynching in her Memphis paper, the Free Speech, a white mob wrecked its office and press while she was away and threatened her life if she came back. She never returned. Southern Horrors grew out of the account she published that June in the New York Age.' },
    { id: 'twain-huck-finn', head: 'Pulled from a library, 1885', text: 'In March 1885 the library committee of Concord, Massachusetts, took the new novel off its shelves. Twain wrote that they had expelled Huck "as trash and suitable only for the slums."' },
    { id: 'whitman-leaves', head: 'Called obscene in Boston, 1882', text: "In 1882 Boston's district attorney told the publisher, James R. Osgood, that the book fell under the state's laws against obscene literature. Whitman would not cut the poems. Osgood gave the book up, and a Philadelphia publisher took it on." },
    { id: 'joyce-ulysses', head: 'Kept out of the United States, 1921–33', text: 'In 1921 a New York court found an episode printed in The Little Review obscene and fined its editors, and the book was barred from the country. In December 1933 Judge John M. Woolsey ruled that Ulysses could be admitted.' },
    { id: 'machiavelli-prince', head: 'On the Index of Forbidden Books, 1559', text: "The first papal Index of Forbidden Books, issued under Pope Paul IV in 1559, listed Machiavelli's works. The Index was abolished in 1966." },
    { id: 'montaigne-essays', head: 'On the Index of Forbidden Books, 1676', text: "The Catholic Church put Montaigne's Essays on its Index of Forbidden Books in 1676, close to a century after they first appeared. The Index was abolished in 1966." },
    { id: 'hugo-miserables', head: 'On the Index of Forbidden Books, 1864', text: "The Index of Forbidden Books listed Les Misérables by a decree of 20 June 1864, two years after it appeared; Hugo's Notre-Dame de Paris had been listed in 1834. The Index was abolished in 1966." },
    { id: 'marx-manifesto', head: 'Burned in Germany, 1933', text: 'On 10 May 1933 students burned books by Marx, with tens of thousands of others, on the Opernplatz in Berlin and in university towns across Germany.' }
  ];
  function wrapText(g, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function plaqueLabelCanvas(b, ex) {
    const W = 1024, H = 560, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#efe6cf'; g.fillRect(0, 0, W, H);   // (drawn at 1024×560: the plane is 0.92 × 0.503 m)
    g.strokeStyle = '#8a6a2e'; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
    g.fillStyle = '#7a1e18'; g.font = '700 30px Georgia, serif'; g.textBaseline = 'top';
    g.fillText(ex.head.toUpperCase(), 44, 40, W - 88);
    g.fillStyle = '#20160c'; let f = 50;
    g.font = `700 ${f}px Georgia, serif`;
    while (g.measureText(b.short).width > W - 88 && f > 30) { f -= 2; g.font = `700 ${f}px Georgia, serif`; }
    g.fillText(b.short, 44, 84);
    g.font = 'italic 30px Georgia, serif'; g.fillStyle = '#4a3a24';
    g.fillText(b.author + ', ' + b.year, 44, 92 + f, W - 88);
    let fs = 40, lines;
    for (;;) { g.font = `${fs}px Georgia, serif`; lines = wrapText(g, ex.text, W - 88); if (lines.length * fs * 1.3 <= H - 190 - f || fs <= 18) break; fs -= 1; }
    g.fillStyle = '#20160c';
    lines.forEach((l, i) => g.fillText(l, 44, 148 + f + i * fs * 1.3));
    return c;
  }
  function galleryWallCanvas() {
    const W = 2048, H = 1024, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#2a120e'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c8a050'; g.lineWidth = 8; g.strokeRect(30, 30, W - 60, H - 60);
    g.fillStyle = '#e8c26c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 150px Georgia, serif'; g.fillText('BANNED BOOKS', W / 2, 260);
    g.fillRect(W / 2 - 320, 370, 640, 4);
    g.font = 'italic 54px Georgia, serif'; g.fillStyle = '#f2e3c2';
    const lines = wrapText(g, 'Every book in this gallery was banned, burned, seized or pulled from the shelves somewhere — by a state, a court, a church, a library committee or a mob. Each one is on the shelves of this library, free to read.', W - 400);
    lines.forEach((l, i) => g.fillText(l, W / 2, 480 + i * 80));
    return c;
  }
  function buildGallery() {
    galleryGroup = new T.Group(); hallGroup.add(galleryGroup);
    const { x0, x1, z0, z1, h } = GAL, len = x1 - x0 + 0.8, cxg = (x0 - 0.5 + x1 + 0.25) / 2, czg = (z0 + z1) / 2, wid = z1 - z0 + 0.2;
    const f = new T.Mesh(new T.PlaneGeometry(len, wid), M.floor);
    const fuv = f.geometry.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * len / 3.2, fuv.getY(i) * wid / 3.2);
    f.rotation.x = -Math.PI / 2; f.position.set(cxg, 0.0015, czg); f.userData.pick = { kind: 'floor' }; galleryGroup.add(f); caseHits.push(f);
    const run = new T.Mesh(G.plane, std({ color: 0x7a2418, roughness: 0.95 })); run.scale.set(len - 1.4, 1.5, 1); run.rotation.x = -Math.PI / 2; run.position.set(cxg + 0.4, 0.004, czg); galleryGroup.add(run);
    const k = new Kit();
    [z0 - 0.15, z1 + 0.15].forEach(z => { k.box(M.plaster, len, h, 0.3, cxg, h / 2, z); k.box(M.walnut, len, 1.0, 0.04, cxg, 0.5, z + (z < czg ? 0.16 : -0.16)); k.box(M.brass, len, 0.03, 0.03, cxg, 2.9, z + (z < czg ? 0.16 : -0.16)); });
    k.box(M.plaster, 0.3, h, wid + 0.4, x1 + 0.4, h / 2, czg);
    k.build(galleryGroup);
    const vault = new T.Mesh(G.halfCyl, std({ map: M.ceiling.map, roughness: 0.95, side: T.DoubleSide }));
    vault.scale.set(wid, len, wid); vault.rotation.z = Math.PI / 2; vault.position.set(cxg, h, czg); galleryGroup.add(vault);
    const endCap = new T.Mesh(new T.CircleGeometry(wid / 2, 32, 0, Math.PI), M.plaster); endCap.position.set(x1 + 0.25, h, czg); endCap.rotation.y = -Math.PI / 2; galleryGroup.add(endCap);
    const vk = new Kit();
    for (let x = x0 + 1; x < x1; x += 2.6) vk.add(G.halfCyl, M.walnutDark, x, h, czg, 0, 0, Math.PI / 2, wid - 0.1, 0.12, wid - 0.1);
    vk.build(galleryGroup);
    const wall = new T.Mesh(new T.PlaneGeometry(5.6, 2.8), std({ map: tex(galleryWallCanvas()), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.12 }));
    wall.material.emissiveMap = wall.material.map;
    wall.position.set(x1 + 0.23, 2.5, czg); wall.rotation.y = -Math.PI / 2; galleryGroup.add(wall);
    // the vitrines: five down each side, facing the aisle
    const xs = [13.6, 16.3, 19.0, 21.7, 24.4];
    const ek = new Kit(), lk = new Kit();
    let n = 0;
    EXHIBITS.forEach((ex, i) => {
      const b = BOOKS.find(bb => bb.id === ex.id); if (!b) return;
      const north = n % 2 === 0, x = xs[Math.floor(n / 2) % xs.length], z = north ? z0 + 0.9 : z1 - 0.9, ry = north ? 0 : Math.PI;
      n++;
      const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; galleryGroup.add(g); g.updateMatrixWorld(true);
      const add = (geo, mat, lx, y, lz, rx, rYaw, rz, sx, sy, sz) => ek.addM(geo, mat, mtx(lx, y, lz, rx, rYaw, rz, sx, sy, sz).premultiply(g.matrixWorld));
      add(G.box, M.mahogany, 0, 0.45, 0, 0, 0, 0, 1.5, 0.9, 0.72);
      add(G.box, M.walnutDark, 0, 0.92, 0, 0, 0, 0, 1.56, 0.05, 0.78);
      [[-0.76, -0.37], [0.76, -0.37], [-0.76, 0.37], [0.76, 0.37]].forEach(([lx, lz]) => add(G.box, M.brass, lx, 1.19, lz, 0, 0, 0, 0.025, 0.5, 0.025));
      add(G.box, M.brass, 0, 1.44, 0, 0, 0, 0, 1.54, 0.025, 0.76);
      const glass = new T.Mesh(G.box, M.glass); glass.scale.set(1.5, 0.5, 0.72); glass.position.set(0, 1.19, 0); g.add(glass);
      // an open book on a slanted stand, in its own cloth
      const col = (bookObj.get(b.id) || {}).color || '#6d1f1a';
      const cover = std({ color: new T.Color(col), roughness: 0.7 });
      const stand = new T.Group(); stand.position.set(0, 1.0, -0.02); stand.rotation.x = -0.45; g.add(stand);
      [-1, 1].forEach(sd => {
        const c = new T.Mesh(G.box, cover); c.scale.set(0.3, 0.012, 0.42); c.position.set(sd * 0.155, 0, 0); c.rotation.z = -sd * 0.08; stand.add(c);
        const pg = new T.Mesh(G.box, M.paper); pg.scale.set(0.28, 0.03, 0.4); pg.position.set(sd * 0.145, 0.02, 0); pg.rotation.z = -sd * 0.08; stand.add(pg);
      });
      add(G.box, M.brass, 0, 0.96, -0.02, -0.45, 0, 0, 0.5, 0.02, 0.36);
      // the label, on a slanted brass lectern in front of the case
      add(G.cyl, M.brass, 0, 0.44, 0.74, 0, 0, 0, 0.05, 0.88, 0.05);
      add(G.cyl, M.brass, 0, 0.012, 0.74, 0, 0, 0, 0.36, 0.024, 0.36);
      add(G.box, M.walnutDark, 0, 0.93, 0.74, -0.96, 0, 0, 0.98, 0.56, 0.03);
      const lab = new T.Mesh(new T.PlaneGeometry(0.92, 0.503), std({ map: tex(plaqueLabelCanvas(b, ex)), roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.18 }));
      lab.material.emissiveMap = lab.material.map; lab.material.map.anisotropy = 8;
      lab.position.set(0, 0.93 + 0.018 * Math.cos(0.96), 0.74 + 0.018 * Math.sin(0.96)); lab.rotation.x = -0.96; g.add(lab);
      lk.addM(G.box, M.bulb, mtx(0, 1.41, 0, 0, 0, 0, 1.3, 0.01, 0.03).premultiply(g.matrixWorld));
      const hit = new T.Mesh(G.box, M.hit); hit.scale.set(1.6, 1.5, 1.45); hit.position.set(0, 0.75, 0.3); hit.userData.pick = { kind: 'exhibit', id: b.id, head: ex.head }; g.add(hit); caseHits.push(hit);
      fixedColliders.push({ x, z, hw: 0.8, hd: 0.42, r: ry, c: Math.cos(ry), s: Math.sin(ry) });
      fixedColliders.push({ x, z: z + Math.cos(ry) * 0.74, hw: 0.5, hd: 0.2, r: ry, c: Math.cos(ry), s: Math.sin(ry) });
      if (n % 2 === 0) { const src = new T.Object3D(); src.position.set(x, 2.6, czg); galleryGroup.add(src); lampSources.push({ obj: src, info: { lamp: { local: V3(0, 0, 0), k: 1.7 } } }); }
    });
    ek.build(galleryGroup); lk.build(galleryGroup);
    // pendant lamps down the aisle
    const pk2 = new Kit();
    xs.forEach(x => { pk2.add(G.cyl, M.brass, x, h + 0.9, czg, 0, 0, 0, 0.02, 3.2, 0.02); pk2.add(G.cone, M.brass, x, 3.3, czg, Math.PI, 0, 0, 0.5, 0.3, 0.5); pk2.add(G.sph, M.bulb, x, 3.2, czg, 0, 0, 0, 0.12); });
    pk2.build(galleryGroup);
    { const src = new T.Object3D(); src.position.set(x1 - 0.8, 2.8, czg); galleryGroup.add(src); lampSources.push({ obj: src, info: { lamp: { local: V3(0, 0, 0), k: 1.5 } } }); }
  }

  /* ---------------- furniture catalog ---------------- */
  // each def: name, w, d (footprint, metres), build(kit) in local space (front = +z), optional seats [{x,z,y,ry}],
  // spots (pile places on a top) [{x,z,y}], rows (bookcase), lamp {x,y,z}, flat (no collision), plural
  const CATALOG = {
    armchair: {
      name: 'Wingback armchair', w: 0.9, d: 0.9,
      build(k, v) {
        const cl = v === 1 ? M.velvetGreen : v === 2 ? M.velvetOchre : M.leather;
        k.box(cl, 0.82, 0.3, 0.8, 0, 0.3, 0);
        k.box(cl, 0.6, 0.13, 0.62, 0, 0.5, 0.06);
        k.box(cl, 0.82, 0.78, 0.18, 0, 0.84, -0.33, -0.1);
        k.box(cl, 0.12, 0.42, 0.34, -0.37, 0.98, -0.18, 0, 0.25); k.box(cl, 0.12, 0.42, 0.34, 0.37, 0.98, -0.18, 0, -0.25);
        k.add(G.cap, cl, -0.35, 0.62, 0.02, Math.PI / 2, 0, 0, 0.18, 0.38, 0.18); k.add(G.cap, cl, 0.35, 0.62, 0.02, Math.PI / 2, 0, 0, 0.18, 0.38, 0.18);
        k.box(cl, 0.12, 0.2, 0.62, -0.35, 0.5, 0.0); k.box(cl, 0.12, 0.2, 0.62, 0.35, 0.5, 0.0);
        [[-0.34, -0.32], [0.34, -0.32], [-0.34, 0.32], [0.34, 0.32]].forEach(([x, z]) => k.add(G.leg, M.walnutDark, x, 0, z, 0, 0, 0, 0.07, 0.16, 0.07));
      },
      seats: [{ x: 0, z: 0.08, y: 0.55, ry: 0 }], variants: 3
    },
    sofa: {
      name: 'Chesterfield sofa', w: 2.2, d: 0.95,
      build(k, v) {
        const cl = v === 1 ? M.velvetGreen : M.leatherBrown;
        k.box(cl, 2.0, 0.3, 0.86, 0, 0.3, 0);
        [-0.64, 0, 0.64].forEach(x => k.box(cl, 0.62, 0.13, 0.64, x, 0.5, 0.07));
        k.box(cl, 2.12, 0.5, 0.22, 0, 0.72, -0.33, -0.08);
        k.add(G.cap, cl, -1.0, 0.62, 0.0, Math.PI / 2, 0, 0, 0.26, 0.42, 0.26); k.add(G.cap, cl, 1.0, 0.62, 0.0, Math.PI / 2, 0, 0, 0.26, 0.42, 0.26);
        k.box(cl, 0.24, 0.4, 0.78, -1.0, 0.4, 0); k.box(cl, 0.24, 0.4, 0.78, 1.0, 0.4, 0);
        for (let i = -4; i <= 4; i++) k.add(G.sphLo, M.brass, i * 0.22, 0.85, -0.22, 0, 0, 0, 0.025);
        [[-0.95, -0.36], [0.95, -0.36], [-0.95, 0.36], [0.95, 0.36]].forEach(([x, z]) => k.add(G.leg, M.walnutDark, x, 0, z, 0, 0, 0, 0.07, 0.16, 0.07));
      },
      seats: [{ x: -0.62, z: 0.1, y: 0.56, ry: 0 }, { x: 0, z: 0.1, y: 0.56, ry: 0 }, { x: 0.62, z: 0.1, y: 0.56, ry: 0 }], variants: 2
    },
    chair: {
      name: 'Reading chair', w: 0.55, d: 0.55,
      build(k) {
        k.box(M.oak, 0.48, 0.04, 0.46, 0, 0.46, 0);
        k.box(M.velvetGreen, 0.42, 0.05, 0.4, 0, 0.5, 0.01);
        [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]].forEach(([x, z]) => k.add(G.leg, M.oak, x, 0, z, 0, 0, 0, 0.05, 0.45, 0.05));
        [-0.21, 0.21].forEach(x => k.box(M.oak, 0.04, 0.5, 0.04, x, 0.72, -0.21, -0.08));
        k.box(M.oak, 0.46, 0.09, 0.04, 0, 0.95, -0.235, -0.08);
        [-0.1, 0, 0.1].forEach(x => k.box(M.oak, 0.025, 0.38, 0.02, x, 0.72, -0.22, -0.08));
      },
      seats: [{ x: 0, z: 0.04, y: 0.52, ry: 0 }]
    },
    table: {
      name: 'Reading table', w: 2.4, d: 1.1,
      build(k) {
        k.box(M.walnut, 2.4, 0.05, 1.1, 0, 0.755, 0);
        k.box(M.walnutDark, 2.2, 0.1, 0.9, 0, 0.68, 0);
        [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]].forEach(([x, z]) => k.add(G.leg, M.walnut, x, 0, z, 0, 0, 0, 0.1, 0.66, 0.1));
        k.box(M.velvetGreen, 2.0, 0.006, 0.7, 0, 0.782, 0);
        // two banker's lamps
        [-0.6, 0.6].forEach(x => {
          k.add(G.cyl, M.brass, x, 0.8, -0.3, 0, 0, 0, 0.16, 0.025, 0.16);
          k.add(G.cyl, M.brass, x, 0.94, -0.3, 0, 0, 0, 0.018, 0.28, 0.018);
          k.add(G.halfCyl, M.greenGlass, x, 1.1, -0.27, 0, 0, Math.PI / 2, 0.17, 0.36, 0.17);
          k.add(G.sph, M.bulb, x, 1.06, -0.27, 0, 0, 0, 0.05);
        });
      },
      spots: [{ x: -0.85, z: 0.15, y: 0.785 }, { x: -0.25, z: 0.2, y: 0.785 }, { x: 0.3, z: 0.2, y: 0.785 }, { x: 0.85, z: 0.15, y: 0.785 }],
      lamp: { x: 0, y: 1.1, z: -0.2, k: 1.4 }
    },
    roundtable: {
      name: 'Side table', w: 0.64, d: 0.64,
      build(k) {
        k.add(G.cyl, M.mahogany, 0, 0.6, 0, 0, 0, 0, 0.64, 0.035, 0.64);
        k.add(G.pedestal, M.mahogany, 0, 0, 0, 0, 0, 0, 0.36, 0.59, 0.36);
      },
      spots: [{ x: 0, z: 0, y: 0.62 }]
    },
    desk: {
      name: 'Writing desk', w: 1.5, d: 0.75,
      build(k) {
        k.box(M.mahogany, 1.5, 0.045, 0.75, 0, 0.765, 0);
        k.box(M.leather, 1.2, 0.006, 0.5, 0, 0.79, 0.03);
        k.box(M.mahogany, 0.42, 0.72, 0.68, -0.52, 0.37, 0); k.box(M.mahogany, 0.42, 0.72, 0.68, 0.52, 0.37, 0);
        [0.15, 0.37, 0.59].forEach(y => { [-0.52, 0.52].forEach(x => { k.box(M.walnutDark, 0.36, 0.17, 0.02, x, y, 0.34); k.add(G.sphLo, M.brass, x, y, 0.36, 0, 0, 0, 0.03); }); });
        k.box(M.mahogany, 0.62, 0.1, 0.02, 0, 0.7, 0.34);
        // table lamp with a cream shade
        k.add(G.cyl, M.brass, 0.5, 0.8, -0.22, 0, 0, 0, 0.14, 0.03, 0.14);
        k.add(G.cyl, M.brass, 0.5, 0.98, -0.22, 0, 0, 0, 0.022, 0.36, 0.022);
        k.add(G.cone, M.shadeLit, 0.5, 1.2, -0.22, 0, 0, 0, 0.42, 0.2, 0.42);
        k.add(G.sph, M.bulb, 0.5, 1.15, -0.22, 0, 0, 0, 0.05);
        // an inkwell and a quill
        k.add(G.cyl, M.glass, -0.45, 0.82, -0.2, 0, 0, 0, 0.07, 0.06, 0.07);
        k.add(G.cyl, M.black, -0.45, 0.81, -0.2, 0, 0, 0, 0.06, 0.04, 0.06);
        k.box(M.linen, 0.008, 0.26, 0.03, -0.43, 0.92, -0.2, 0, 0, -0.35);
      },
      spots: [{ x: -0.15, z: 0.12, y: 0.795 }, { x: 0.2, z: 0.12, y: 0.795 }],
      lamp: { x: 0.5, y: 1.15, z: -0.22, k: 1 }
    },
    coffeetable: {
      name: 'Low table', w: 1.2, d: 0.62,
      build(k) {
        k.box(M.walnut, 1.2, 0.05, 0.62, 0, 0.44, 0);
        k.box(M.walnut, 1.08, 0.03, 0.5, 0, 0.12, 0);
        [[-0.54, -0.25], [0.54, -0.25], [-0.54, 0.25], [0.54, 0.25]].forEach(([x, z]) => k.add(G.leg, M.walnutDark, x, 0, z, 0, 0, 0, 0.06, 0.42, 0.06));
      },
      spots: [{ x: -0.3, z: 0, y: 0.465 }, { x: 0.3, z: 0, y: 0.465 }]
    },
    lamp: {
      name: 'Floor lamp', w: 0.45, d: 0.45,
      build(k) {
        k.add(G.cyl, M.brass, 0, 0.02, 0, 0, 0, 0, 0.38, 0.04, 0.38);
        k.add(G.cyl, M.brass, 0, 0.8, 0, 0, 0, 0, 0.03, 1.56, 0.03);
        k.add(G.cone, M.shadeLit, 0, 1.62, 0, 0, 0, 0, 0.55, 0.32, 0.55);
        k.add(G.sph, M.bulb, 0, 1.55, 0, 0, 0, 0, 0.07);
      },
      lamp: { x: 0, y: 1.5, z: 0, k: 1.3 }
    },
    bookcase: {
      name: 'Bookcase', w: 1.2, d: 0.42,
      build(k) { bookcaseKit(k, 1.2, 0.42, 2.1, 4, 0.1, 0.16, M.oak); },
      rows: { n: 4, h: 2.1, plinth: 0.1, top: 0.16, w: 1.2, d: 0.42, fill: 0 }
    },
    rug: {
      name: 'Rug', w: 4.2, d: 3.0, flat: true,
      build(k, v) {
        const pals = [['#8c6a3a', '#6a2412', '#1d1410', '#3a2216', '#b8822f'], ['#6e6248', '#244a3a', '#16120e', '#4a301a', '#9a4422'], ['#94662c', '#2a1810', '#b8a47c', '#4c1e10', '#1f3a4a']];
        const p = pals[v % pals.length];
        const key = 'rug' + v;
        if (!M[key]) M[key] = std({ map: tex(rugCanvas(31 + v * 7, p)), roughness: 0.95, envMapIntensity: 0.2 });
        k.add(G.box, M[key], 0, 0.008, 0, 0, 0, 0, 4.2, 0.016, 3.0);
      },
      variants: 3
    },
    plant: {
      name: 'Potted plant', w: 0.6, d: 0.6,
      build(k) {
        k.add(G.pot, M.terracotta, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5);
        k.add(G.cyl, M.walnutDark, 0, 0.44, 0, 0, 0, 0, 0.42, 0.02, 0.42);
        const R = rng(99);
        for (let i = 0; i < 22; i++) {
          const a = R() * TAU, up = 0.55 + R() * 0.9, len = 0.18 + R() * 0.16, tilt = 0.4 + R() * 0.7;
          k.add(G.cyl8, M.leaf, Math.cos(a) * 0.05, 0.45 + up / 2, Math.sin(a) * 0.05, 0, 0, 0, 0.012, up, 0.012);
          k.add(G.sphLo, R() < 0.5 ? M.leaf : M.leafLight, Math.cos(a) * len * 0.8, 0.45 + up + 0.02, Math.sin(a) * len * 0.8, 0, -a, tilt, len * 1.3, 0.02, len * 0.6);
        }
      }
    },
    ottoman: {
      name: 'Footstool', w: 0.6, d: 0.6,
      build(k, v) {
        const cl = v === 1 ? M.velvetPlum : M.velvetOchre;
        k.add(G.cyl, cl, 0, 0.27, 0, 0, 0, 0, 0.56, 0.3, 0.56);
        k.add(G.cyl, M.brass, 0, 0.115, 0, 0, 0, 0, 0.57, 0.02, 0.57);
        [0, 1, 2, 3].forEach(i => { const a = i / 4 * TAU + 0.78; k.add(G.leg, M.walnutDark, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0, 0, 0, 0.05, 0.12, 0.05); });
      },
      seats: [{ x: 0, z: 0, y: 0.44, ry: 0 }], variants: 2
    },
    globe: {
      name: 'Celestial globe', w: 0.7, d: 0.7,
      build(k) {
        if (!M.celestial) M.celestial = std({ map: tex(celestialCanvas()), roughness: 0.35, envMapIntensity: 0.6 });
        [0, 1, 2].forEach(i => { const a = i / 3 * TAU; k.add(G.box, M.walnut, Math.cos(a) * 0.16, 0.32, Math.sin(a) * 0.16, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25, 0.04, 0.64, 0.04); });
        k.add(G.torus, M.walnut, 0, 0.62, 0, Math.PI / 2, 0, 0, 0.7, 0.7, 1.4);
        k.add(G.torus, M.brass, 0, 0.98, 0, 0, 0, 0.41, 0.82, 0.82, 0.6);
        k.add(G.sph, M.celestial, 0, 0.98, 0, 0, 0, 0.41, 0.72);
      }
    }
  };
  Object.keys(CATALOG).forEach(k => { CATALOG[k].type = k; });

  // fixed fallback geometry per type, built once, cloned per instance
  const protoCache = new Map();
  function proto(type, variant) {
    const key = type + ':' + (variant || 0);
    if (protoCache.has(key)) return protoCache.get(key);
    const k = new Kit(); CATALOG[type].build(k, variant || 0);
    const g = k.build(); protoCache.set(key, g); return g;
  }

  function spawn(f) {
    const def = CATALOG[f.type]; if (!def) return null;
    const obj = new T.Group();
    proto(f.type, f.v).children.forEach(m => obj.add(new T.Mesh(m.geometry, m.material)));
    obj.children.forEach(m => { m.userData.pick = { kind: 'furn', id: f.id }; });
    // soft contact shadow
    if (!def.flat) {
      const sh = new T.Mesh(G.plane, M.shadow);
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.004; sh.scale.set(def.w * 1.25, def.d * 1.25, 1); sh.renderOrder = -1;
      obj.add(sh);
    }
    const info = { f, def, obj, rows: [], seats: def.seats || [], spots: [], lamp: null, filler: null };
    if (def.rows) {
      const R = def.rows, rowH = (R.h - R.plinth - R.top) / R.n;
      for (let r = 0; r < R.n; r++) info.rows.push(addRow(f.id + '.' + r, obj, -R.w / 2 + 0.05, R.w / 2 - 0.05, R.plinth + r * rowH + 0.015, R.d / 2 - 0.02, R.d - 0.05, rowH - 0.03, R.fill, false).id);
    }
    if (def.spots) {
      def.spots.forEach((s, i) => {
        const hit = new T.Mesh(G.box, M.hit);
        hit.scale.set(0.42, 0.06, 0.42); hit.position.set(s.x, s.y + 0.03, s.z);
        hit.userData.pick = { kind: 'spot', id: f.id, s: i };
        obj.add(hit);
        const holder = new T.Group(); holder.position.set(s.x, s.y, s.z); obj.add(holder);
        info.spots.push({ hit, holder });
      });
    }
    if (def.lamp) { info.lamp = { local: V3(def.lamp.x, def.lamp.y, def.lamp.z), k: def.lamp.k || 1 }; lampSources.push({ obj, info }); }
    furn.set(f.id, info);
    scene.add(obj);
    place(f);
    return info;
  }
  function place(f) {
    const info = furn.get(f.id); if (!info) return;
    info.f = f;
    info.obj.position.set(f.x, 0, f.z); info.obj.rotation.y = f.r || 0;
    info.obj.updateMatrixWorld(true);
  }
  function despawn(id) {
    const info = furn.get(id); if (!info) return;
    info.rows.forEach(r => rows.delete(r));
    const li = lampSources.findIndex(l => l.info === info); if (li >= 0) lampSources.splice(li, 1);
    scene.remove(info.obj);
    furn.delete(id);
  }

  /* ---------------- laying out books ---------------- */
  // room: { rows: {rowId: [bookIds]}, piles: {furnId: {spot: [bookIds]}} };  hands: Map bookId -> Object3D (a hand to hold it)
  function layoutBooks(room, hands) {
    const placed = new Set();
    for (const r of rows.values()) {
      const ids = (room.rows[r.id] || []).filter(id => bookObj.has(id) && !placed.has(id));
      let x = r.x0 + 0.015;
      ids.forEach(id => {
        const b = bookObj.get(id); placed.add(id);
        const { t, h, d } = b.dims;
        if (b.mesh.parent !== r.parent) r.parent.add(b.mesh);
        b.mesh.position.set(x + t / 2, r.y + h / 2 + 0.002, r.z - d / 2 - 0.004);
        b.mesh.rotation.set(0, 0, 0);
        b.mesh.visible = true;
        x += t + 0.002;
      });
      // a brass bookend after real books when the row also holds old volumes
      r.used = x - r.x0;
      r.fillers = genFillers(r, r.used);
    }
    for (const [fid, info] of furn) {
      const piles = (room.piles && room.piles[fid]) || {};
      info.spots.forEach((sp, si) => {
        let y = 0;
        (piles[si] || []).forEach((id, k) => {
          if (!bookObj.has(id) || placed.has(id)) return;
          const b = bookObj.get(id); placed.add(id);
          const { t, h, d } = b.dims;
          if (b.mesh.parent !== sp.holder) sp.holder.add(b.mesh);
          const tw = ((hash(id) % 100) / 100 - 0.5) * 0.5;
          b.mesh.position.set(0, y + t / 2, 0);
          b.mesh.rotation.set(0, tw + (k % 2 ? 0.08 : -0.05), -Math.PI / 2);
          b.mesh.visible = true;
          y += t + 0.001;
        });
      });
    }
    if (hands) for (const [id, holder] of hands) {
      const b = bookObj.get(id); if (!b || placed.has(id)) continue;
      placed.add(id);
      holder.add(b.mesh); b.mesh.position.set(0, 0, 0); b.mesh.rotation.set(0, 0, 0); b.mesh.visible = true;
    }
    for (const [id, b] of bookObj) if (!placed.has(id)) { if (b.mesh.parent) b.mesh.parent.remove(b.mesh); }
    refreshFillers();
  }
  function setRibbons(progress) { for (const [id, b] of bookObj) b.ribbon.visible = !!(progress && progress[id]); }

  /* ---------------- picking, highlight ---------------- */
  // mode: 'play' (books, furniture, rows, spots, floor) | 'arrange' (movable furniture, floor)
  function pick(ray, mode, maxDist) {
    const list = [];
    for (const b of bookObj.values()) if (b.mesh.parent && b.mesh.visible && !b.mesh.parent.userData.hand && shown(b.mesh)) list.push(b.mesh);
    for (const info of furn.values()) for (const ch of info.obj.children) if (ch.userData.pick) list.push(ch);
    for (const r of rows.values()) if (r.area !== 'hall' || doorsOpen.hall) list.push(r.hit);
    for (const o of caseHits) if (shown(o)) list.push(o);
    const hits = ray.intersectObjects(list, false);
    const HELPER = { row: 1, spot: 1, fseat: 1 };
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (maxDist && h.distance > maxDist) return null;
      const p = h.object.userData.pick; if (!p) continue;
      if (mode !== 'arrange' && HELPER[p.kind]) {
        const b = hits.find((o, j) => j > i && o.distance < h.distance + 0.3 && o.object.userData.pick && o.object.userData.pick.kind === 'book');
        if (b) return Object.assign({ point: b.point, dist: b.distance, object: b.object }, b.object.userData.pick);
      }
      if (mode === 'arrange' && !(p.kind === 'furn' || p.kind === 'floor' || p.kind === 'spot')) continue;
      if (mode === 'arrange' && p.kind === 'spot') return { kind: 'furn', id: p.id, point: h.point, dist: h.distance, object: h.object };
      return Object.assign({ point: h.point, dist: h.distance, object: h.object }, p);
    }
    return null;
  }
  let hl = null, hlTarget = null;
  const _box = new T.Box3();
  function highlight(target, bad) {
    if (!hl) {
      hl = new T.Mesh(G.box, M.glow); hl.renderOrder = 5; scene.add(hl);
      hl.edges = new T.LineSegments(new T.EdgesGeometry(G.box), M.glowEdge); hl.add(hl.edges);
    }
    hlTarget = target || null;
    if (!target) { hl.visible = false; return; }
    hl.material = bad ? M.bad : M.glow;
    hl.edges.visible = !bad;
    _box.makeEmpty();
    if (target.isObject3D) _box.setFromObject(target);
    else if (target.box) _box.copy(target.box);
    if (_box.isEmpty()) { hl.visible = false; return; }
    _box.getCenter(hl.position); _box.getSize(hl.scale); hl.scale.addScalar(0.03);
    hl.visible = true;
  }
  function rowBox(rowId, slot) {
    const r = rows.get(rowId); if (!r) return null;
    r.parent.updateMatrixWorld(true);
    const x = Math.min(r.x1 - 0.03, r.x0 + (r.used || 0) + 0.03);
    const b = new T.Box3(V3(x - 0.02, r.y, r.z - 0.2), V3(x + 0.02, r.y + Math.min(0.26, r.height - 0.05), r.z));
    return { box: b.applyMatrix4(r.parent.matrixWorld) };
  }
  function spotBox(fid, s) {
    const info = furn.get(fid); if (!info || !info.spots[s]) return null;
    info.obj.updateMatrixWorld(true);
    return { box: new T.Box3().setFromObject(info.spots[s].hit) };
  }

  /* ---------------- collisions ---------------- */
  // oriented rectangles in the floor plane: {x, z, hw, hd, r}
  function colliders(skipId) {
    const out = fixedColliders.slice();
    for (const [id, info] of furn) {
      if (id === skipId || info.def.flat) continue;
      out.push({ x: info.f.x, z: info.f.z, hw: info.def.w / 2, hd: info.def.d / 2, r: info.f.r || 0, id });
    }
    return out;
  }
  function seatList() {
    const out = fixedSeats.map((s, i) => Object.assign({ key: 'w' + i }, s));
    for (const [id, info] of furn) {
      (info.def.seats || []).forEach((s, i) => {
        const c = Math.cos(info.f.r || 0), sn = Math.sin(info.f.r || 0);
        out.push({ key: id + ':' + i, f: id, x: info.f.x + s.x * c + s.z * sn, z: info.f.z - s.x * sn + s.z * c, y: s.y, ry: (info.f.r || 0) + s.ry, name: info.def.name.toLowerCase() });
      });
    }
    return out;
  }

  /* ---------------- lights ---------------- */
  const pool = [];
  function initLights() {
    scene.add(new T.HemisphereLight(0x8090b8, 0x3a2414, 0.55));
    const moon = new T.DirectionalLight(0xa8bcff, 0.7); moon.position.set(-20, 14, 3); scene.add(moon); scene.add(moon.target);
    const fire = new T.PointLight(0xff7a2e, 22, 16, 1.7); fire.position.set(0, 0.7, ROOM.z0 + 1.2); scene.add(fire); anim.lights.fire = fire;
    [-5, 5].forEach(x => { const l = new T.PointLight(0xffcf96, 26, 18, 1.6); l.position.set(x, 4.5, 0); scene.add(l); });
    for (let i = 0; i < 4; i++) { const l = new T.PointLight(0xffc27a, 0, 6.5, 1.8); scene.add(l); pool.push({ l, cur: 0, want: 0 }); }
  }
  let poolT = 0;
  const _lp = new T.Vector3();
  function assignLamps(cam) {
    const cand = lampSources.filter(ls => shown(ls.obj)).map(ls => { ls.obj.updateMatrixWorld(); _lp.copy(ls.info.lamp.local).applyMatrix4(ls.obj.matrixWorld); return { p: _lp.clone(), k: ls.info.lamp.k, d: _lp.distanceToSquared(cam) }; })
      .sort((a, b) => a.d - b.d).slice(0, pool.length);
    pool.forEach((s, i) => { const c = cand[i]; if (c) { s.l.position.copy(c.p); s.want = 6 * c.k; } else s.want = 0; });
  }
  function environment() {
    const pm = new T.PMREMGenerator(renderer);
    const es = new T.Scene();
    const geo = new T.SphereGeometry(20, 32, 16);
    const col = []; const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i) / 20;
      const c = y > 0.3 ? new T.Color(0x2a2a30) : y > -0.2 ? new T.Color(0x5a3c24) : new T.Color(0x24160c);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    es.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const em = (c, x, y, z, w, h, ry) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry || 0; es.add(m); };
    em(0x6070b0, -10, 3, 0, 14, 5, Math.PI / 2);   // windows
    em(0xff8a3c, 0, 0.5, -10, 3, 1.4);             // fire
    em(0xffd29a, -5, 9, 0, 3, 3, 0); em(0xffd29a, 5, 9, 0, 3, 3, 0);
    const rt = pm.fromScene(es, 0.04);
    pm.dispose();
    return rt.texture;
  }

  /* ---------------- dust in the light ---------------- */
  function motes() {
    // only in the moonlight: a slanting slab in front of each window
    const N = 160, pos = new Float32Array(N * 3), R = rng(42), WZ = [-4.6, 0, 4.6];
    for (let i = 0; i < N; i++) { const y = 0.3 + R() * 3.6; pos[i * 3] = ROOM.x0 + 0.6 + R() * 1.2 + (4.2 - y) * 0.7; pos[i * 3 + 1] = y; pos[i * 3 + 2] = WZ[i % 3] + (R() - 0.5) * 1.6; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const p = new T.Points(g, new T.PointsMaterial({ color: 0xcfd8ff, size: 0.011, transparent: true, opacity: 0.32, depthWrite: false, blending: T.AdditiveBlending }));
    scene.add(p); anim.motes = p;
  }

  /* ---------------- per frame ---------------- */
  function tick(dt, t, cam) {
    anim.flames.forEach(m => { m.uniforms.uT.value = t; });
    if (own.size) { const k = Math.sin(t * 2.1); ownMats.forEach(m => { if (m) m.emissiveIntensity = 0.62 + 0.3 * k; }); ownHalo.opacity = 0.5 + 0.25 * k; }
    if (beginGlow) { beginGlow.material.opacity = 0.62 + 0.14 * Math.sin(t * 1.1); beginBeam.material.opacity = 0.42 + 0.08 * Math.sin(t * 0.7 + 1); }
    for (const id in DOORS) { const D = DOORS[id]; if (D.cur !== D.want) { D.cur += Math.sign(D.want - D.cur) * Math.min(Math.abs(D.want - D.cur), dt * 0.7); poseDoor(D); } }
    if (cam && scene.fog) {                           // the great hall is big: let the haze fall back when you're in it
      const far = cam.z > ROOM.z1 + 0.5 ? 70 : 34, near = far > 40 ? 24 : 14;
      scene.fog.far += (far - scene.fog.far) * Math.min(1, dt * 2); scene.fog.near += (near - scene.fog.near) * Math.min(1, dt * 2);
    }
    const fl = 0.85 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1 + 1) * 0.05 + Math.sin(t * 23.7) * 0.03;
    if (anim.lights.fire) anim.lights.fire.intensity = 22 * fl;
    if (anim.embers) anim.embers.material.color.setRGB(1, 0.3 + fl * 0.08, 0.06);
    if (anim.clock) {
      const d = new Date(), hr = (d.getHours() % 12 + d.getMinutes() / 60), mn = d.getMinutes() + d.getSeconds() / 60;
      anim.clock.hr.rotation.z = -hr / 12 * TAU; anim.clock.mn.rotation.z = -mn / 60 * TAU;
    }
    if (anim.motes) anim.motes.rotation.y = Math.sin(t * 0.03) * 0.01, anim.motes.position.y = Math.sin(t * 0.2) * 0.05;
    poolT -= dt;
    if (poolT <= 0 && cam) { poolT = 0.4; assignLamps(cam); }
    pool.forEach(s => { s.cur += (s.want - s.cur) * Math.min(1, dt * 3); s.l.intensity = s.cur; });
  }

  /* ---------------- init ---------------- */
  function init(r, books) {
    renderer = r;
    BOOKS = books || [];
    initGeo(); initMats();
    scene = new T.Scene();
    scene.background = new T.Color(0x0b0806);
    scene.fog = new T.Fog(0x1a120c, 14, 34);
    try { scene.environment = environment(); } catch (e) { /* no PMREM: plain lights still work */ }
    buildSpines();
    M.spines = spineTex.map(t => std({ map: t, roughness: 0.7, envMapIntensity: 0.5 }));
    BOOKS.forEach(makeBook);
    const names = ['DOUGLASS', 'JACOBS', 'NORTHUP', 'EQUIANO', 'CRAFT', 'PRINCE', 'TRUTH', 'TUBMAN', 'WASHINGTON', 'BROWN', 'BIBB', 'PENNINGTON', 'KECKLEY', 'VENTURE SMITH', 'GRANDY', 'LANE', 'STEWARD', 'HUGHES', 'DRUMGOOLD', 'BURTON', 'DELANEY', 'JACKSON', 'ELIZABETH', 'DAVIS', 'GREEN'];
    buildRoom(names);
    buildBegin();
    buildHall();
    initLights();
    motes();
    // filler volumes: one instanced mesh for every shelf in the room
    const fGeo = new T.BoxGeometry(1, 1, 1);
    fillerMax = 9000;
    const fSpine = tex(fillerSpineCanvas());
    const fm = [std({ color: 0xffffff, roughness: 0.75, envMapIntensity: 0.4 }), null, std({ color: 0xe8dcc0, roughness: 0.9 }), null, std({ map: fSpine, roughness: 0.65, envMapIntensity: 0.5 }), null];
    fm[1] = fm[0]; fm[3] = fm[2]; fm[5] = fm[2];
    fillerMesh = new T.InstancedMesh(fGeo, fm, fillerMax);
    fillerMesh.count = 0; fillerMesh.frustumCulled = false;
    scene.add(fillerMesh);
    hallFillerMax = 9000;
    hallFillers = new T.InstancedMesh(fGeo, fm, hallFillerMax);
    hallFillers.count = 0; hallFillers.frustumCulled = false;
    hallGroup.add(hallFillers);
    setDoors(null, true);
    return scene;
  }
  function fillerSpineCanvas() {
    const c = cv(32, 256), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 256);
    const sh = g.createLinearGradient(0, 0, 32, 0); sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(0.4, 'rgba(255,255,255,.1)'); sh.addColorStop(1, 'rgba(0,0,0,.4)');
    g.fillStyle = sh; g.fillRect(0, 0, 32, 256);
    g.fillStyle = '#c9a85a';
    [[20, 4], [30, 2], [70, 2], [100, 14], [226, 2], [234, 4]].forEach(([y, h]) => g.fillRect(2, y, 28, h));
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(4, 102, 24, 10);
    return c;
  }

  return {
    setOwn, setLit,
    init, ROOM, CATALOG, SECTIONS, SEC, EXHIBITS, walk, footprintOK, route, clampCam, areaOf, setDoors, doorsOpen, spawn, place, despawn, layoutBooks, setRibbons, pick, highlight, rowBox, spotBox, colliders, seatList, tick, bookDims,
    bookMesh: (id) => (bookObj.get(id) || {}).mesh, bookInfo: (id) => bookObj.get(id), rowInfo: (id) => rows.get(id), furnInfo: (id) => furn.get(id),
    rows, furn, M, G, get scene() { return scene; },
    caseHits, fixedColliders   // fixtures other scripts add (cinema.js): pickable meshes, and footprints you walk round
  };
})();
