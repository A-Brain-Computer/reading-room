/* THE READING ROOM — avatars.js: who you read as.

   Eight readers, each a figure carved from soft shapes and painted like a good wooden doll: a sculpted head
   (brow, cheekbones, nose, lips and chin pushed out of one surface), set-in eyes that look about, lids that
   blink and drop toward the page, a painted face (brows, the colour of the lips, lines of age) and hair that
   is the person's own. Each is carried by what people know from photographs and engravings, or from words:
     Frederick Douglass: the swept-back white mane and full beard of his later portraits, frock coat, bow tie.
     Phillis Wheatley, as in the 1773 frontispiece of her Poems: white mob cap with its frill, dark gown, white collar,
       ruffled elbow sleeves. Young and slight.
     Harriet Bailey, Douglass's mother: no likeness survives, so from his words in My Bondage and My Freedom, "tall,
       and finely proportioned; of deep black, glossy complexion; had regular features", "remarkably sedate in
       her manners" (she looks about less). A Maryland field hand of the 1820s: tow linen, apron, checked headwrap.
     Harriet Jacobs, as in her 1894 photograph: grey hair parted in the middle and drawn back to a knot, a dark
       high-collared dress and brooch.
     Ida B. Wells: upswept hair with a curled fringe, high collar, brooch, puffed sleeves, gold earrings.
     Booker T. Washington: close crop parted on the left, clean-shaven, dark three-piece suit, high stiff collar.
     W. E. B. Du Bois: goatee and upturned moustache, receding hair, three-piece suit worn open, watch chain.
     Malcolm X: browline glasses, close crop, moustache, white shirt and narrow tie with a clip.
   Heights follow the people where known (Douglass about six feet, Du Bois five foot six, Malcolm X six foot
   three); the others are estimates. Skin tones are each person's own, warm under the lamps.

   build(id) -> av: { root, hand, head, setState({ speed, sit, read, listen }), update(dt), info, height }
     root: feet at y = 0, facing +z. hand: the Object3D main.js parents the carried book to. It follows the
     right hand; while reading it holds the book open in front of the chest in both hands, and the open
     pages, the covers and a leaf that the right hand turns now and then are drawn here round the book
     world.js put in it. Idle: breath, weight shifting, the head and eyes looking about, blinks. Walking: stride,
     arm swing, the skirt or coat skirts following the knees. Sitting: feet on the floor, hands on the thighs.
   portrait(renderer, id) -> data URL of a head-and-shoulders picture for the menu.
   LIST: [{ id, name, years, line, listens }] — listens: the reader never learned to read, so books are read
     aloud to them and the figure listens with its head up. None of these readers needs it (the reader's own
     read-aloud button works for anyone).
   ALIAS: readers who used to be here: a saved or remote 'tubman' builds as Wheatley, 'truth' as Bailey.
     resolve(id) -> an id in LIST.
   Cost: 28 to 40 meshes and about 26 to 32 thousand triangles a figure (four of the meshes are the open book,
   drawn only while reading); materials, textures and the static geometry are built once per reader and shared
   by every figure of them; only the skirt or coat skirts and the turning leaf are reshaped, and only as they move. */
'use strict';
const RR_AVATARS = (() => {
  if (!window.THREE) return null;
  const T = THREE;
  // One entry here and one look in LOOKS make a reader. Wheatley stands where Harriet Tubman was and Harriet
  // Bailey where Sojourner Truth was (ALIAS turns a saved or remote 'tubman' or 'truth' into them).
  const LIST = [
    { id: 'douglass', name: 'Frederick Douglass', years: '1818–1895', line: 'Learned to read in Baltimore against his enslaver\'s orders; wrote three autobiographies.' },
    { id: 'wheatley', name: 'Phillis Wheatley', years: 'c. 1753–1784', line: 'Brought to Boston from West Africa as a child, she could read the Bible within sixteen months; published Poems on Various Subjects in 1773.' },
    { id: 'bailey', name: 'Harriet Bailey', years: 'c. 1792–1825', line: 'Frederick Douglass\'s mother, a Maryland field hand who walked twelve miles at night to see him; he learned after her death that she could read.' },
    { id: 'jacobs', name: 'Harriet Jacobs', years: 'c. 1813–1897', line: 'Taught to read as a girl; hid nearly seven years in a crawlspace in her grandmother\'s house, then wrote Incidents in the Life of a Slave Girl.' },
    { id: 'wells', name: 'Ida B. Wells', years: '1862–1931', line: 'Born enslaved in Mississippi; journalist who documented lynching.' },
    { id: 'washington', name: 'Booker T. Washington', years: '1856–1915', line: 'Born enslaved in Virginia; learned to read while working in salt furnaces and a coal mine, walked much of the way to Hampton, and founded Tuskegee.' },
    { id: 'dubois', name: 'W. E. B. Du Bois', years: '1868–1963', line: 'Historian and sociologist; wrote The Souls of Black Folk.' },
    { id: 'malcolm', name: 'Malcolm X', years: '1925–1965', line: 'Rebuilt himself through reading in a prison library.' }
  ];
  const ALIAS = { tubman: 'wheatley', truth: 'bailey' };      // readers who used to be here -> who stands in their place

  /* ---------------- a small kit: maths, surfaces, merging ---------------- */
  const D = Math.PI / 180, TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bump = (x, y, x0, y0, sx, sy) => { const u = (x - x0) / sx, v = (y - y0) / sy; return Math.exp(-u * u - v * v); };
  const bump2 = (x, y, x0, y0, sx, sy) => bump(x, y, x0, y0, sx, sy) + bump(x, y, -x0, y0, sx, sy);
  // a table [[x, y], ...] read smoothly (eased between rows) or straight
  function tab(rows, x) {
    if (x <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) if (x <= rows[i][0]) { const a = rows[i - 1], b = rows[i], t = (x - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], t * t * (3 - 2 * t)); }
    return rows[rows.length - 1][1];
  }
  function lin(rows, x) {
    if (x <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) if (x <= rows[i][0]) { const a = rows[i - 1], b = rows[i]; return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0])); }
    return rows[rows.length - 1][1];
  }
  function rng(s) { s = (s % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const M4 = (x, y, z, sx, sy, sz, rx, ry, rz) => new T.Matrix4().compose(new T.Vector3(x || 0, y || 0, z || 0),
    new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
  // n+1 samples from lo to hi, closer together where dens(x) is high
  function warp(n, lo, hi, dens) {
    const S = 600, cum = [0];
    for (let i = 1; i <= S; i++) cum.push(cum[i - 1] + dens(lo + (hi - lo) * (i - 0.5) / S));
    const out = []; let k = 0;
    for (let j = 0; j <= n; j++) { const want = cum[S] * j / n; while (k < S - 1 && cum[k + 1] < want) k++; const f = (want - cum[k]) / ((cum[k + 1] - cum[k]) || 1); out.push(lo + (hi - lo) * clamp((k + f) / S, 0, 1)); }
    return out;
  }
  const steps = (n) => { const a = []; for (let i = 0; i <= n; i++) a.push(i / n); return a; };
  // a surface over samples us x vs: fn(u, v, out, i, j) places each vertex; o.uv, o.seam (u wraps), o.poles,
  // o.ref(p) -> the outward direction at p (the winding is turned so the normals face it)
  function surface(us, vs, fn, o) {
    o = o || {};
    const nu = us.length - 1, nv = vs.length - 1, n = (nu + 1) * (nv + 1);
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    const p = new T.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      fn(us[i], vs[j], p, i, j);
      pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
      const t = o.uv ? o.uv(us[i], vs[j]) : null;
      uv[k * 2] = t ? t[0] : i / nu; uv[k * 2 + 1] = t ? t[1] : j / nv;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.userData.grid = { nu, nv, seam: !!o.seam, poles: o.poles };
    normals(g);
    if (o.ref) {
      const N = g.attributes.normal, q = new T.Vector3(); let sum = 0;
      for (let k = 0; k < n; k += 3) { p.fromBufferAttribute(g.attributes.position, k); q.fromBufferAttribute(N, k); sum += q.dot(o.ref(p)); }
      if (sum < 0) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.index.needsUpdate = true; normals(g); }
    }
    return g;
  }
  const grid = (nu, nv, fn, o) => surface(steps(nu), steps(nv), fn, o);
  // vertex normals, with the wrapped seam and the poles of a grid made whole again
  function normals(g) {
    g.computeVertexNormals();
    const gd = g.userData.grid; if (!gd) return;
    const N = g.attributes.normal, a = N.array, w = gd.nu + 1;
    const avg = (list) => { let x = 0, y = 0, z = 0; for (const k of list) { x += a[k * 3]; y += a[k * 3 + 1]; z += a[k * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; for (const k of list) { a[k * 3] = x / l; a[k * 3 + 1] = y / l; a[k * 3 + 2] = z / l; } };
    if (gd.seam) for (let j = 0; j <= gd.nv; j++) avg([j * w, j * w + gd.nu]);
    if (gd.poles) { const r0 = [], r1 = []; for (let i = 0; i <= gd.nu; i++) { r0.push(i); r1.push(gd.nv * w + i); } if (gd.poles !== 'top') avg(r0); if (gd.poles !== 'bottom') avg(r1); }
    N.needsUpdate = true;
  }
  // rings [y, half-width, front, back, z, power]: superellipse sections, the seam at the back
  function loft(rings, seg, o) {
    o = o || {};
    const a0 = o.a0 == null ? -Math.PI : o.a0, a1 = o.a1 == null ? Math.PI : o.a1, cx = o.cx || 0;
    const full = a1 - a0 > 6.28;
    return surface(steps(seg), rings.map((r, j) => j), (u, j, p) => {
      const r = rings[j], a = lerp(a0, a1, u), e = 2 / (r[5] || 2.3), s = Math.sin(a), c = Math.cos(a);
      p.set(cx + Math.sign(s) * Math.pow(Math.abs(s), e) * r[1], r[0], (r[4] || 0) + Math.sign(c) * Math.pow(Math.abs(c), e) * (c >= 0 ? r[2] : r[3]));
    }, { seam: full, ref: (p) => _ref.set(p.x - cx, 0, p.z) });
  }
  const _ref = new T.Vector3();
  const limb = (rows, kz) => rows.map(([y, r, z]) => [y, r, r * (kz || 1), r * (kz || 1), z || 0, 2]);
  // the front of a loft at (x, y): where a piece laid on the cloth sits
  function surfZ(rings, x, y) {
    let a = rings[0], b = rings[rings.length - 1];
    for (let i = 0; i < rings.length - 1; i++) if ((y - rings[i][0]) * (y - rings[i + 1][0]) <= 0) { a = rings[i]; b = rings[i + 1]; break; }
    const t = a[0] === b[0] ? 0 : clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    const rx = lerp(a[1], b[1], t), f = lerp(a[2], b[2], t), z0 = lerp(a[4] || 0, b[4] || 0, t), pw = lerp(a[5] || 2.3, b[5] || 2.3, t);
    const q = clamp(Math.abs(x) / Math.max(1e-4, rx), 0, 1);
    return z0 + f * Math.pow(Math.max(0, 1 - Math.pow(q, pw)), 1 / pw);
  }
  // a piece of cloth laid on the front of a loft: P(u, v) -> [x, y]; off above the cloth, th thick (with edges)
  function decal(rings, P, nu, nv, off, th) {
    const at = (u, v, lift, p) => { const [x, y] = P(u, v); return p.set(x, y, surfZ(rings, x, y) + off + lift); };
    let cx = 0, cy = 0; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const [x, y] = P(i / 4, j / 4); cx += x / 25; cy += y / 25; }
    const items = [{ g: grid(nu, nv, (u, v, p) => at(u, v, th, p), { ref: () => _ref.set(0, 0, 1) }), m: new T.Matrix4() }];
    if (th > 0) {
      const wall = (f, n) => grid(n, 1, (s, v, p) => { const [u, w] = f(s); return at(u, w, th * (1 - v), p); }, { ref: (p) => _ref.set(p.x - cx, p.y - cy, 0) });
      items.push({ g: wall(s => [s, 0], nu), m: new T.Matrix4() }, { g: wall(s => [s, 1], nu), m: new T.Matrix4() }, { g: wall(s => [0, s], nv), m: new T.Matrix4() }, { g: wall(s => [1, s], nv), m: new T.Matrix4() });
    }
    return merge(items);
  }
  // many geometries (each with its matrix) as one: one draw call
  function merge(items) {
    let nv = 0, ni = 0;
    for (const it of items) { const n = it.g.attributes.position.count; nv += n; ni += it.g.index ? it.g.index.count : n; }
    const hasC = items.some(it => it.g.attributes.color);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = hasC ? new Float32Array(nv * 3) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const v = new T.Vector3(), nm = new T.Matrix3();
    let ov = 0, oi = 0;
    for (const { g, m } of items) {
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
      nm.getNormalMatrix(m);
      for (let i = 0; i < P.count; i++) {
        const k = ov + i;
        v.fromBufferAttribute(P, i).applyMatrix4(m); pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z;
        if (U) { uv[k * 2] = U.getX(i); uv[k * 2 + 1] = U.getY(i); }
        if (col) { col[k * 3] = C ? C.getX(i) : 1; col[k * 3 + 1] = C ? C.getY(i) : 1; col[k * 3 + 2] = C ? C.getZ(i) : 1; }
      }
      const flip = m.determinant() < 0;
      const tri = (a, b, c) => { idx[oi++] = ov + a; idx[oi++] = ov + (flip ? c : b); idx[oi++] = ov + (flip ? b : c); };
      if (g.index) for (let i = 0; i < g.index.count; i += 3) tri(g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2));
      else for (let i = 0; i < P.count; i += 3) tri(i, i + 1, i + 2);
      ov += P.count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  const one = (g, m) => ({ g, m: m || new T.Matrix4() });
  // a soft tube along points (a chain, a rim of spectacles)
  function tube(pts, r, seg) { return new T.TubeGeometry(new T.CatmullRomCurve3(pts), seg || Math.max(8, pts.length * 4), r, 6, false); }

  const matCache = new Map();
  function mat(hex, rough, metal, extra) {
    const k = hex + ':' + rough + ':' + (metal || 0) + ':' + (extra ? Object.keys(extra).map(n => n + '=' + (extra[n] && extra[n].isTexture ? extra[n].uuid : extra[n])).join(',') : '');
    if (!matCache.has(k)) {
      const o = Object.assign({ color: hex, roughness: rough == null ? 0.7 : rough, metalness: metal || 0 }, extra || {});
      if (o.weave) { o.bumpMap = weaveTile(); o.bumpScale = o.weave; }            // cloth: the threads catch the light up close
      delete o.weave;
      matCache.set(k, new T.MeshStandardMaterial(o));
    }
    return matCache.get(k);
  }

  /* ---------------- painted textures (small canvases, shared) ---------------- */
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const _rgb = {}, css = (c, a) => { c.getRGB(_rgb, T.SRGBColorSpace); return `rgba(${Math.round(_rgb.r * 255)},${Math.round(_rgb.g * 255)},${Math.round(_rgb.b * 255)},${a == null ? 1 : a})`; };
  const texOf = (c, srgb, repeat) => {
    const t = new T.CanvasTexture(c);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const TEX = {};
  // the eye: warm white, a dark brown iris with its fibres and ring, the pupil
  function irisTex() {
    if (TEX.iris) return TEX.iris;
    const c = canvas(256, 128), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, '#c9a898'); gr.addColorStop(0.3, '#e9dccb'); gr.addColorStop(0.5, '#f0e6d6'); gr.addColorStop(0.7, '#e9dccb'); gr.addColorStop(1, '#c9a898');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    const cx = 128, cy = 64, R = 27;
    const ir = g.createRadialGradient(cx, cy, 4, cx, cy, R);
    ir.addColorStop(0, '#1a0c06'); ir.addColorStop(0.45, '#3a1e0e'); ir.addColorStop(0.85, '#4b2a14'); ir.addColorStop(1, '#160b06');
    g.fillStyle = ir; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    const r = rng(11);
    for (let i = 0; i < 90; i++) { const a = r() * TAU, r0 = 8 + r() * 6, r1 = R - 2 - r() * 6; g.strokeStyle = r() < 0.5 ? 'rgba(110,64,30,.45)' : 'rgba(12,6,3,.4)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke(); }
    g.strokeStyle = 'rgba(8,4,2,.8)'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, R - 1, 0, TAU); g.stroke();
    g.fillStyle = '#050303'; g.beginPath(); g.arc(cx, cy, 9.5, 0, TAU); g.fill();
    return (TEX.iris = texOf(c, true));
  }
  // hair: tight curls drawn as arcs, tiling; used as colour variation and as a bump map
  function hairTile() {
    if (TEX.hair) return TEX.hair;
    const S = 256, c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, S, S);
    const r = rng(5);
    for (let i = 0; i < 3400; i++) {
      const x = r() * S, y = r() * S, rad = 1.6 + r() * 3.6, a0 = r() * TAU, dark = r() < 0.55;
      g.strokeStyle = dark ? `rgba(30,30,30,${0.28 + r() * 0.3})` : `rgba(255,255,255,${0.25 + r() * 0.3})`; g.lineWidth = 0.7 + r() * 1.1;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (x + ox < -8 || x + ox > S + 8 || y + oy < -8 || y + oy > S + 8) continue;
        g.beginPath(); g.arc(x + ox, y + oy, rad, a0, a0 + 2.2 + r() * 2.6); g.stroke();
      }
    }
    return (TEX.hair = texOf(c, true, true));
  }
  // hair that lies in strands (combed back, or a beard): fine wavy lines along v, tiling
  function strandTile() {
    if (TEX.strand) return TEX.strand;
    const S = 256, c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, S, S);
    const r = rng(9);
    for (let i = 0; i < 1100; i++) {
      const x0 = r() * S, ph = r() * TAU, amp = 1 + r() * 2.5, n = 1 + ((r() * 3) | 0), dark = r() < 0.5;
      g.strokeStyle = dark ? `rgba(25,25,25,${0.2 + r() * 0.35})` : `rgba(255,255,255,${0.2 + r() * 0.4})`; g.lineWidth = 0.6 + r() * 1.2;
      for (const ox of [-S, 0, S]) {
        g.beginPath();
        for (let y = 0; y <= S; y += 4) { const x = x0 + ox + Math.sin(y / S * TAU * n + ph) * amp; y ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
    }
    return (TEX.strand = texOf(c, true, true));
  }
  // coarse cloth: threads one way and the other, slubbed; a bump map
  function weaveTile() {
    if (TEX.weave) return TEX.weave;
    const S = 128, c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    const r = rng(21);
    for (let i = 0; i < S; i += 2) {
      g.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`; g.fillRect(0, i, S, 1);
      g.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.2})`; g.fillRect(i, 0, 1, S);
    }
    for (let i = 0; i < 90; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)'; g.fillRect(r() * S, r() * S, 3 + r() * 10, 1.4); }
    const t = texOf(c, false, true); t.repeat.set(16, 16);
    return (TEX.weave = t);
  }
  // checked cotton (a headwrap): the ground colour crossed by darker and lighter bands
  function checkTile(hex) {
    const k = 'check' + hex;
    if (TEX[k]) return TEX[k];
    const S = 128, c = canvas(S, S), g = c.getContext('2d'), base = new T.Color(hex);
    g.fillStyle = css(base); g.fillRect(0, 0, S, S);
    const dk = base.clone().multiplyScalar(0.45), lt = base.clone().lerp(new T.Color(0xe8d9b8), 0.55), ind = new T.Color(0x2a3350);
    [[0, 18, dk, 0.55], [40, 6, lt, 0.7], [64, 18, dk, 0.55], [100, 4, ind, 0.6], [112, 6, lt, 0.7]].forEach(([o, w, col, a]) => {
      g.fillStyle = css(col, a); g.fillRect(o, 0, w, S); g.fillRect(0, o, S, w);
    });
    return (TEX[k] = texOf(c, true, true));
  }
  // the open pages: two columns of type either side of a shaded gutter
  function pageTex() {
    if (TEX.page) return TEX.page;
    const S = 256, c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#efe5cf'; g.fillRect(0, 0, S, S);
    const r = rng(3);
    [[14, 116], [140, 242]].forEach(([x0, x1], pi) => {
      for (let y = 22; y < 236; y += 7.2) {
        if (pi === 1 && y < 40) continue;
        let x = x0 + (y === 22 || r() < 0.08 ? 8 : 0);
        const end = r() < 0.1 ? x0 + (x1 - x0) * (0.3 + r() * 0.5) : x1;
        while (x < end) { const w = 3 + r() * 13; g.fillStyle = 'rgba(58,44,30,.62)'; g.fillRect(x, y, Math.min(w, end - x), 2.2); x += w + 2.6; }
      }
    });
    g.fillStyle = 'rgba(58,44,30,.7)'; g.fillRect(168, 26, 46, 3);
    const gr = g.createLinearGradient(104, 0, 152, 0);
    gr.addColorStop(0, 'rgba(90,60,30,0)'); gr.addColorStop(0.5, 'rgba(90,60,30,.38)'); gr.addColorStop(1, 'rgba(90,60,30,0)');
    g.fillStyle = gr; g.fillRect(104, 0, 48, S);
    return (TEX.page = texOf(c, true));
  }

  /* ---------------- the readers' looks ---------------- */
  // face: w width, long length, jaw narrowing, deep-set eyes, brow ridge, cheek(bones), full (soft cheeks),
  // age, nw/nl nose width/length, lips fullness, mw mouth width, chin, muzzle
  const LOOKS = {
    douglass: { h: 1.85, sex: 'm', b: 1.06, skin: 0x75503a, hair: 0xf2eee6, brow: 0xd9d2c6, browK: 1.5,
      face: { w: 1.05, jaw: 0.14, deep: 1.4, brow: 1.5, cheek: 1, age: 0.9, nw: 1.2, nl: 1.06, lips: 1.05, mw: 1.05, chin: 1.1 },
      hairStyle: 'mane', beard: 'full', top: 'frock', coat: 0x23242b, lapel: 0x17171b, vest: 0x2d2c31, trousers: 0x3a3a41, shirt: 0xf0ebe0, tie: 0x0d0d0f, tieStyle: 'bow',
      shoes: 0x0d0a08, collarH: 0.064, lapW: 0.066, yBtn: 1.2 },
    jacobs: { h: 1.6, sex: 'f', b: 0.97, skin: 0x6c4733, hair: 0x8a857c, brow: 0x3c322b, browK: 0.8,
      face: { w: 0.96, long: 1.03, jaw: 0.26, deep: 1.2, brow: 0.8, cheek: 1.25, full: 0.6, age: 1, nw: 1.05, nl: 1.02, lips: 0.85, mw: 0.95, chin: 0.95 },
      hairStyle: 'parted', dress: 0x19171a, collar: 'high', lace: 0xe9e3d6, brooch: 0xc9a050, cuffs: 0xe9e3d6, buttons: 0x0c0b0d, shoes: 0x110d0b,
      sleeve: 'fitted', skirt: { hem: 0.29, hip: 0.19 } },
    wheatley: { h: 1.54, sex: 'f', b: 0.92, skin: 0x482d20, hair: 0x120d0a, brow: 0x140e0b, browK: 0.85,
      face: { w: 0.98, long: 0.96, jaw: 0.25, deep: 0.95, brow: 0.75, cheek: 1, full: 1.5, age: 0, nw: 1.28, nl: 0.9, lips: 1.4, mw: 1.08, chin: 0.9, eyeSize: 1.04 },
      hairStyle: 'cap', cap: 0xf1ece2, dress: 0x2a2023, fichu: 0xf3eee4, sleeve: 'elbow', shoes: 0x1a120c, stays: true,
      skirt: { hem: 0.34, hip: 0.215 } },
    bailey: { h: 1.75, sex: 'f', b: 0.96, skin: 0x38251c, skinRough: 0.5, hair: 0x120d0a, brow: 0x0f0b09, browK: 0.95, calm: 0.55,
      face: { w: 0.98, long: 1, jaw: 0.3, deep: 1, brow: 0.85, cheek: 1.25, full: 0.8, age: 0.12, nw: 1.18, nl: 0.98, lips: 1.15, mw: 1.03, chin: 0.85 },
      hairStyle: 'wrap', wrap: 0x8a3324, dress: 0x7a6d5a, apron: 0xb8ad95, sleeve: 'rolled', shoes: 0x3a2a1e, shoeRough: 0.85, weave: 0.7,
      skirt: { hem: 0.255, hip: 0.19, len: 0.99 } },
    wells: { h: 1.55, sex: 'f', b: 0.96, skin: 0x684330, hair: 0x120d0b, brow: 0x140e0b, browK: 1.1,
      face: { w: 1.03, long: 0.97, jaw: 0.2, deep: 1, brow: 1.1, cheek: 1.2, full: 1.4, age: 0.1, nw: 1.16, nl: 0.98, lips: 1.2, mw: 1, chin: 1 },
      hairStyle: 'updo', dress: 0x1b2033, collar: 'high', brooch: 0xd8b25a, buttons: 0x0b0b0e, sleeve: 'mutton', earrings: 0xd8b25a, shoes: 0x0f0c0a,
      skirt: { hem: 0.31, hip: 0.195 } },
    washington: { h: 1.75, sex: 'm', b: 1.01, skin: 0x8c6249, hair: 0x1f1815, brow: 0x1f1815, browK: 1.15,
      face: { w: 1.03, long: 1.02, jaw: 0.15, deep: 1.1, brow: 1.2, cheek: 0.95, full: 0.7, age: 0.35, nw: 1.06, nl: 1.0, lips: 1.0, mw: 1.0, chin: 1.12 },
      hairStyle: 'crop', top: 'suit', coat: 0x1e1e23, vest: 0x25252a, trousers: 0x2a2a30, shirt: 0xf2eee5, tie: 0x121215, tieStyle: 'four',
      shoes: 0x0b0908, collarH: 0.06, lapW: 0.05, yBtn: 1.22 },
    dubois: { h: 1.68, sex: 'm', b: 0.93, skin: 0x8a6048, hair: 0x2f2a27, brow: 0x2a2421, browK: 1.05,
      face: { w: 0.95, long: 1.05, jaw: 0.3, deep: 1.15, brow: 1.1, cheek: 0.8, full: 0.6, age: 0.5, nw: 0.9, nl: 1.1, lips: 0.85, mw: 0.95, chin: 1.05 },
      hairStyle: 'receding', beard: 'goatee', top: 'suit', open: true, coat: 0x46454b, vest: 0x3b3a40, trousers: 0x46454b, shirt: 0xf2eee5, tie: 0x3a1621, tieStyle: 'four',
      chain: 0xd6b25a, shoes: 0x0d0a08, collarH: 0.052, lapW: 0.056, yBtn: 1.1 },
    malcolm: { h: 1.91, sex: 'm', b: 0.97, skin: 0x9a6a4d, hair: 0x5a3020, brow: 0x46281a, browK: 1.15,
      face: { w: 0.96, long: 1.07, jaw: 0.2, deep: 1.05, brow: 1.15, cheek: 0.9, full: 0.5, age: 0.25, nw: 0.95, nl: 1.06, lips: 0.95, mw: 1, chin: 1.2 },
      hairStyle: 'crop', beard: 'mustache', specs: 'browline', freckles: true, top: 'suit', coat: 0x3a3733, trousers: 0x3a3733, shirt: 0xf5f2ea, tie: 0x141416, tieStyle: 'narrow',
      clip: 0xd6c08a, shoes: 0x0b0908, collarH: 0.04, lapW: 0.044, yBtn: 1.1 }
  };

  /* ---------------- the head: one sculpted surface, read in degrees (az from the front, el up) ---------------- */
  // how far forward the front of the face stands, against a plain egg, from the crown down to under the chin
  const FACE_Q = [[-90, 1.55], [-75, 1.5], [-60, 1.32], [-50, 1.19], [-35, 1.07], [-20, 1.01], [0, 1], [20, 1.03], [40, 1.05], [90, 1]];
  function headKit(F) {
    const W = 0.077 * F.w, TOP = 0.112, BOT = 0.123 * F.long, FR = 0.09, BK = 0.103;
    function nose(az, el) {
      const nw = F.nw;
      const bridge = 0.012 * bump(az, el, 0, -7, 4.6 * nw * (1 + Math.max(0, -el - 4) / 16), 9);
      const tip = 0.0135 * bump(az, el, 0, -15.5, 7.4 * nw, 4.8);
      const alae = 0.0072 * nw * bump2(az, el, 11.5 * nw, -18.6, 4.8, 3.6);
      return F.nl * (bridge + tip) + alae;
    }
    function surf(az, el, p, noSocket) {
      const a = az * D, e = el * D, ce = Math.cos(e);
      const dx = ce * Math.sin(a), dy = Math.sin(e), dz = ce * Math.cos(a);
      const dn = Math.max(0, -dy), up = Math.max(0, dy), fw = Math.max(0, dz);
      let x = dx * W, y = dy * (dy > 0 ? TOP : BOT), z = dz * (dz > 0 ? FR : BK);
      x *= 1 - F.jaw * smooth(0.25, 0.98, dn) * (0.3 + 0.7 * fw);            // the jaw narrows to the chin
      if (dz > 0) { const q = tab(FACE_Q, el); z *= el < -40 ? 1 + (q - 1) * lerp(1, F.chin, smooth(-40, -60, el)) : q; }   // the face stays upright down to the chin
      else z *= 1 - 0.42 * smooth(0.05, 0.85, dn);                              // the skull tucks in to the neck
      y += 0.014 * smooth(0.55, 1, dn) * (1 - fw);                              // the underside of the jaw rises to the neck
      let r = 0;
      if (!noSocket) r -= 0.0058 * F.deep * bump2(az, el, 23, 2, 10, 7);     // eye sockets
      r += 0.0034 * F.brow * bump2(az, el, 21, 12.5, 14, 4.6);                 // brow ridge
      r += 0.0044 * F.cheek * bump2(az, el, 42, -8, 12, 8);                    // cheekbones
      r += 0.003 * F.full * bump2(az, el, 30, -27, 13, 11);                    // soft cheeks
      r -= 0.003 * bump2(az, el, 63, 17, 12, 12);                              // temples
      r -= 0.0022 * F.age * bump2(az, el, 19, -28, 3.6, 8);                    // the folds from nose to mouth
      let f = nose(az, el);
      f += 0.004 * F.muzzle * bump(az, el, 0, -34, 24, 13);                    // the mouth
      f += 0.0034 * F.lips * bump(az, el, 0, -30.8, 15.5 * F.mw, 2.7);         // upper lip
      f += 0.0044 * F.lips * bump(az, el, 0, -39.2, 13.5 * F.mw, 3.1);         // lower lip
      f -= 0.0011 * bump(az, el, 0, -35.1, 15 * F.mw, 0.8);                    // between the lips
      f -= 0.0011 * bump2(az, el, 19 * F.mw, -35.8, 2.8, 2.8);                 // the corners of the mouth
      f -= 0.0018 * bump(az, el, 0, -46.5, 10, 2.6);                           // the hollow under the lower lip
      f += 0.0125 * F.chin * bump(az, el, 0, -63, 15, 9) * (1 - 0.35 * smooth(-66, -84, el));   // chin
      const len = Math.hypot(x, y, z) || 1;
      return p.set(x + x / len * r, y + y / len * r, z + z / len * r + f);
    }
    const AZ = warp(64, -180, 180, x => 1 + 2.6 * Math.exp(-((x / 55) ** 2))), EL = warp(50, -90, 90, x => 1 + 2.4 * Math.exp(-(((x + 18) / 38) ** 2)));
    const geo = surface(AZ, EL, (az, el, p) => surf(az, el, p), { uv: (az, el) => [clamp(0.5 + az / 160, 0.004, 0.996), clamp(0.5 + el / 160, 0.004, 0.996)], seam: true, poles: true, ref: (p) => p });
    // a shell over the head: fn(az, el, dir) -> how far out (negative: hidden just under the skin)
    const _p = new T.Vector3(), _d = new T.Vector3();
    function shell(fn, o) {
      o = o || {};
      const ru = o.ru || 10, rv = o.rv || 5;
      // uv: around and up (az, el) for curls and beards, or (flow) along lines from the face back over the
      // head to the nape, the way hair combed back lies; its break falls on the seam at the back
      const uvOf = o.flow ? (az, el) => { const a = az * D, e = el * D, ce = Math.cos(e); return [(Math.atan2(ce * Math.sin(a), Math.sin(e)) / TAU + 0.5) * ru, Math.acos(clamp(ce * Math.cos(a), -1, 1)) / Math.PI * rv]; }
        : (az, el) => [(az + 180) / 360 * ru, (el + 90) / 180 * rv];
      const az0 = o.az0 == null ? -180 : o.az0, az1 = o.az1 == null ? 180 : o.az1;
      return surface(warp(o.na || 58, az0, az1, x => 1 + (o.front || 1) * Math.exp(-((x / 60) ** 2))), warp(o.ne || 46, o.el0 == null ? -90 : o.el0, o.el1 == null ? 90 : o.el1, () => 1), (az, el, out) => {
        surf(az, el, _p);
        const a = az * D, e = el * D, ce = Math.cos(e);
        _d.set(ce * Math.sin(a), Math.sin(e), ce * Math.cos(a));
        out.copy(_p).addScaledVector(_d, fn(az, el, _d));
      }, { uv: uvOf, seam: az1 - az0 > 359, poles: o.el0 == null ? (o.el1 == null ? true : 'bottom') : o.el1 == null ? 'top' : false, ref: (p) => p });
    }
    return { surf, geo, shell, W };
  }
  // covering: thickness h where m is 1, tucked under the skin where it is 0
  const cover = (m, h) => h * m - 0.0034 * (1 - m);

  /* ---------------- the hands: palm, four fingers and a thumb, relaxed and gripping (a morph) ---------------- */
  function handGeo(s, hk) {
    const caps = {};
    const cap = (r, l) => caps[r + ':' + l] || (caps[r + ':' + l] = new T.CapsuleGeometry(r, l, 2, 7));
    const make = (curl, thumbIn) => {
      const items = [];
      items.push(one(new T.SphereGeometry(1, 10, 7), M4(0, -0.004, 0, 0.02, 0.028, 0.027)));                   // the wrist
      items.push(one(new T.SphereGeometry(1, 14, 9), M4(-s * 0.001, -0.052, 0.002, 0.0155, 0.047, 0.041)));   // the palm
      items.push(one(new T.SphereGeometry(1, 9, 6), M4(-s * 0.006, -0.03, 0.026, 0.013, 0.024, 0.016, 0.4)));  // the ball of the thumb
      const F = [[0.0265, 0.0089, 0.044, 0.034], [0.0088, 0.0093, 0.049, 0.037], [-0.0092, 0.0089, 0.046, 0.034], [-0.026, 0.0078, 0.036, 0.028]];
      F.forEach(([z, r, l1, l2], i) => {
        const c1 = curl * (0.85 + i * 0.08), c2 = curl * 1.15 + 0.1;
        const g1 = -s * c1, g2 = -s * (c1 + c2);
        const x0 = 0, y0 = -0.09 + Math.abs(z) * 0.18;
        const m1x = x0 + Math.sin(g1) * l1 / 2, m1y = y0 - Math.cos(g1) * l1 / 2;
        const ex = x0 + Math.sin(g1) * l1, ey = y0 - Math.cos(g1) * l1;
        items.push(one(cap(r, l1 - r), M4(m1x, m1y, z, 1, 1, 1, 0, 0, g1)));
        items.push(one(cap(r * 0.88, l2 - r), M4(ex + Math.sin(g2) * l2 / 2, ey - Math.cos(g2) * l2 / 2, z * 0.97, 1, 1, 1, 0, 0, g2)));
      });
      // the thumb: out toward the front, curling in over the palm when it grips
      const tq = new T.Quaternion().setFromEuler(new T.Euler(-0.9 + thumbIn * 0.3, 0, -s * (0.35 + thumbIn * 0.55)));
      const d1 = new T.Vector3(0, -1, 0).applyQuaternion(tq), b = new T.Vector3(-s * 0.008, -0.03, 0.03);
      items.push(one(cap(0.0105, 0.028), new T.Matrix4().compose(b.clone().addScaledVector(d1, 0.02), tq, new T.Vector3(1, 1, 1))));
      const tq2 = tq.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(0, 0, -s * (0.3 + thumbIn * 0.7))));
      const d2 = new T.Vector3(0, -1, 0).applyQuaternion(tq2), e = b.clone().addScaledVector(d1, 0.04);
      items.push(one(cap(0.0092, 0.022), new T.Matrix4().compose(e.addScaledVector(d2, 0.016), tq2, new T.Vector3(1, 1, 1))));
      const g = merge(items);
      g.applyMatrix4(M4(0, 0, 0, hk));
      return g;
    };
    const rel = make(0.32, 0), grip = make(1.12, 1);
    rel.morphAttributes.position = [grip.attributes.position];
    rel.morphAttributes.normal = [grip.attributes.normal];
    return rel;
  }
  // a shoe: rounded toe, flat sole, a low heel
  function shoeGeo(fem) {
    const g = new T.SphereGeometry(1, 22, 12), P = g.attributes.position;
    const L = fem ? 0.112 : 0.13, zc = fem ? 0.058 : 0.07, Wd = fem ? 0.039 : 0.047;
    for (let i = 0; i < P.count; i++) {
      const ux = P.getX(i), uy = P.getY(i), uz = P.getZ(i);
      const w = Wd * (uz < -0.4 ? lerp(0.8, 0.93, (uz + 1) / 0.6) : uz < 0.45 ? lerp(0.93, 1, (uz + 0.4) / 0.85) : lerp(1, 0.62, smooth(0.45, 1, uz)));
      const top = uz < -0.15 ? 0.004 : lerp(0.004, fem ? -0.042 : -0.036, smooth(-0.15, 0.95, uz));
      const bot = -0.07 + (fem ? 0.008 * smooth(0.2, -0.6, uz) : 0);
      P.setXYZ(i, ux * w, bot + (top - bot) * Math.pow((uy + 1) / 2, 0.85), zc + L * uz);
    }
    g.computeVertexNormals();
    return merge([one(g), one(new T.BoxGeometry(1, 1, 1), M4(0, -0.062, fem ? -0.03 : -0.035, Wd * 1.5, fem ? 0.022 : 0.018, 0.045))]);
  }

  /* ---------------- painting the face ---------------- */
  function faceTex(L, F) {
    const S = 512, c = canvas(S, S), g = c.getContext('2d');
    const X = az => (0.5 + az / 160) * S, Y = el => (0.5 - el / 160) * S, R = d => d / 160 * S;
    const sk = new T.Color(L.skin), warm = sk.clone().lerp(new T.Color(0xa0402c), 0.4), dark = sk.clone().multiplyScalar(0.55), deep = sk.clone().multiplyScalar(0.28);
    const lipU = sk.clone().lerp(new T.Color(0x4a1c1e), 0.32).multiplyScalar(0.84), lipL = sk.clone().lerp(new T.Color(0x6a2c2c), 0.26).multiplyScalar(0.96);
    g.fillStyle = css(sk); g.fillRect(0, 0, S, S);
    const r = rng(L.skin);
    for (let i = 0; i < 5000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,240,225,.035)' : 'rgba(30,10,0,.04)'; g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5); }
    g.fillStyle = css(sk); g.fillRect(0, 0, S, 6); g.fillRect(0, S - 6, S, 6); g.fillRect(0, 0, 6, S); g.fillRect(S - 6, 0, 6, S);
    const blob = (az, el, rx, ry, col, a) => {
      g.save(); g.translate(X(az), Y(el)); g.scale(R(rx), R(ry));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    };
    const both = (fn) => [-1, 1].forEach(fn);
    both(s => blob(s * 31, -19, 16, 12, warm, 0.24));                    // cheeks
    blob(0, -14, 8, 7, warm, 0.2);                                       // nose
    blob(0, -58, 11, 7, warm, 0.1);                                      // chin
    both(s => blob(s * 23, 3, 13, 8, dark, 0.2));                        // round the eyes
    both(s => blob(s * 24, -6, 10, 3.5, dark, 0.14 + 0.12 * F.age));     // under the eyes
    both(s => blob(s * 8 * F.nw, -11, 3.5, 8, dark, 0.12));              // the sides of the nose
    // the crease of the upper lid
    g.lineCap = 'round';
    both(s => { g.strokeStyle = css(deep, 0.35); g.lineWidth = R(1); g.beginPath(); g.moveTo(X(s * 14), Y(5.5)); g.quadraticCurveTo(X(s * 23), Y(10.2), X(s * 32), Y(5)); g.stroke(); });
    // lower lashes, faint
    both(s => { g.strokeStyle = css(deep, 0.25); g.lineWidth = R(0.6); g.beginPath(); g.moveTo(X(s * 15), Y(-2.5)); g.quadraticCurveTo(X(s * 23), Y(-5.2), X(s * 31), Y(-1.5)); g.stroke(); });
    // nostrils
    both(s => { g.save(); g.filter = 'blur(0.8px)'; g.translate(X(s * 5.6 * F.nw), Y(-20.6)); g.rotate(s * 0.3); g.scale(R(2.5 * F.nw), R(1.25)); g.fillStyle = css(deep, 0.9); g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore(); });
    // lips: the upper lip with its bow, the fuller lower lip, the line of the mouth; soft-edged, close to the skin
    const mw = 18.5 * F.mw, ml = -35.2;
    g.save(); g.filter = 'blur(' + (S / 512 * 1.3).toFixed(1) + 'px)';
    g.fillStyle = css(lipU, 0.85);
    g.beginPath(); g.moveTo(X(-mw), Y(ml - 0.3));
    g.bezierCurveTo(X(-mw * 0.7), Y(ml + 3.2), X(-mw * 0.42), Y(-28.3), X(-mw * 0.24), Y(-28.2));
    g.quadraticCurveTo(X(-mw * 0.1), Y(-28.2), X(0), Y(-28.9));
    g.quadraticCurveTo(X(mw * 0.1), Y(-28.2), X(mw * 0.24), Y(-28.2));
    g.bezierCurveTo(X(mw * 0.42), Y(-28.3), X(mw * 0.7), Y(ml + 3.2), X(mw), Y(ml - 0.3));
    g.quadraticCurveTo(X(0), Y(ml + 0.5), X(-mw), Y(ml - 0.3)); g.fill();
    g.fillStyle = css(lipL, 0.8);
    g.beginPath(); g.moveTo(X(-mw * 0.95), Y(ml - 0.4)); g.quadraticCurveTo(X(0), Y(ml + 0.4), X(mw * 0.95), Y(ml - 0.4));
    g.bezierCurveTo(X(mw * 0.75), Y(-41.5), X(mw * 0.35), Y(-43.4), X(0), Y(-43.4));
    g.bezierCurveTo(X(-mw * 0.35), Y(-43.4), X(-mw * 0.75), Y(-41.5), X(-mw * 0.95), Y(ml - 0.4)); g.fill();
    g.restore();
    blob(0, -39.4, 5.5, 1.8, sk.clone().lerp(new T.Color(0xffe8d8), 0.35), 0.14);       // light on the lower lip
    g.save(); g.filter = 'blur(0.6px)';
    g.strokeStyle = css(deep, 0.8); g.lineWidth = R(0.5);
    g.beginPath(); g.moveTo(X(-mw * 1.02), Y(ml - 0.6)); g.quadraticCurveTo(X(-mw * 0.45), Y(ml + 0.5), X(0), Y(ml + 0.1)); g.quadraticCurveTo(X(mw * 0.45), Y(ml + 0.5), X(mw * 1.02), Y(ml - 0.6)); g.stroke();
    g.restore();
    both(s => blob(s * mw * 1.0, ml - 0.5, 1.8, 1.4, deep, 0.2));         // the corners of the mouth
    blob(0, ml - 1.2, 9, 1.4, deep, 0.12);                                 // under the upper lip
    blob(0, -46, 8, 2.2, dark, 0.14);                                    // under the lower lip
    // brows: a soft band and then hairs, thicker inside, tapering out
    const bc = new T.Color(L.brow), bk = L.browK || 1;
    both(s => {
      const P0 = [s * 8.5, 10.6], P1 = [s * 24, 15.4 + 0.4 * bk], P2 = [s * 37.5, 11.2];
      const at = (t) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
      const th = (t) => (2.7 - 1.8 * t) * bk;
      g.fillStyle = css(bc, 0.32); g.beginPath();
      for (let i = 0; i <= 20; i++) { const [a, e] = at(i / 20); g.lineTo(X(a), Y(e + th(i / 20) * 0.5)); }
      for (let i = 20; i >= 0; i--) { const [a, e] = at(i / 20); g.lineTo(X(a), Y(e - th(i / 20) * 0.5)); }
      g.fill();
      for (let i = 0; i < 150 * bk; i++) {
        const t = Math.pow(r(), 0.85), [a, e] = at(t), off = (r() - 0.5) * th(t);
        const ang = lerp(1.25, 0.18, t) * (r() * 0.4 + 0.8), len = R(1.6 + r() * 1.6);
        const x0 = X(a), y0 = Y(e + off);
        g.strokeStyle = css(bc, 0.5 + r() * 0.4); g.lineWidth = 0.9 + r() * 0.6;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + s * Math.cos(ang) * len, y0 - Math.sin(ang) * len); g.stroke();
      }
    });
    // the lines that come with years
    if (F.age > 0.3) {
      g.strokeStyle = css(deep, 0.1 * F.age); g.lineWidth = R(0.7);
      [24, 29, 34].forEach((e, i) => { g.beginPath(); g.moveTo(X(-20 + i * 2), Y(e)); g.quadraticCurveTo(X(0), Y(e + 1.4), X(20 - i * 2), Y(e)); g.stroke(); });
      both(s => { g.strokeStyle = css(deep, 0.16 * F.age); g.lineWidth = R(1.1); g.beginPath(); g.moveTo(X(s * 13 * F.nw), Y(-19)); g.quadraticCurveTo(X(s * 20), Y(-27), X(s * 21), Y(-37)); g.stroke(); });
      both(s => { for (let k = 0; k < 3; k++) { g.strokeStyle = css(deep, 0.08 * F.age); g.lineWidth = R(0.45); g.beginPath(); g.moveTo(X(s * 34), Y(1 - k * 2)); g.lineTo(X(s * 40), Y(2 - k * 3)); g.stroke(); } });
    }
    if (L.sex === 'm') { blob(0, -55, 22, 12, dark, 0.1); both(s => blob(s * 38, -40, 14, 14, dark, 0.07)); blob(0, -27.5, 10, 1.8, dark, 0.12); }
    if (L.freckles) for (let i = 0; i < 46; i++) { const az = (r() - 0.5) * 56, el = -6 - r() * 16; if (Math.abs(az) < 4 && el < -14) continue; g.fillStyle = css(dark, 0.32 + r() * 0.2); g.beginPath(); g.arc(X(az), Y(el), R(0.28 + r() * 0.3), 0, TAU); g.fill(); }
    return texOf(c, true);
  }

  /* ---------------- each reader's figure, built once and shared ---------------- */
  const RECIPES = new Map();
  const TORSO_M = [[0.95, 0.166, 0.106, 0.116], [1.02, 0.158, 0.1, 0.106], [1.11, 0.164, 0.108, 0.106], [1.21, 0.174, 0.118, 0.11], [1.3, 0.181, 0.118, 0.108], [1.36, 0.184, 0.106, 0.1],
    [1.405, 0.186, 0.09, 0.092], [1.44, 0.15, 0.072, 0.08], [1.465, 0.092, 0.06, 0.07], [1.482, 0.062, 0.052, 0.06], [1.49, 0.001, 0.001, 0.001]];
  const TORSO_F = [[0.985, 0.126, 0.086, 0.092], [1.02, 0.123, 0.084, 0.09], [1.1, 0.134, 0.096, 0.092], [1.19, 0.15, 0.124, 0.097], [1.27, 0.158, 0.127, 0.097], [1.33, 0.162, 0.106, 0.094],
    [1.38, 0.163, 0.086, 0.084], [1.415, 0.134, 0.068, 0.074], [1.445, 0.084, 0.054, 0.064], [1.468, 0.056, 0.047, 0.055], [1.476, 0.001, 0.001, 0.001]];
  function recipe(id, L) {
    if (RECIPES.has(id)) return RECIPES.get(id);
    const F = Object.assign({ w: 1, long: 1, jaw: 0.25, chin: 1, deep: 1, brow: 1, cheek: 1, full: 1, age: 0, muzzle: 1, lips: 1, mw: 1, nw: 1, nl: 1, eyeSize: 1 }, L.face);
    const fem = L.sex === 'f', H = headKit(F), b = L.b, WV = { weave: L.weave || 0.3 }, WV2 = { weave: L.weave || 0.3, side: T.DoubleSide };
    const parts = new Map();
    const add = (bone, m, g, mx, tag) => { const key = bone + '|' + m.uuid + (tag ? '|' + tag : ''); let p = parts.get(key); if (!p) parts.set(key, p = { bone, mat: m, items: [], tag }); p.items.push(one(g, mx)); };
    const sr = L.skinRough || 0.58, skinM = mat(L.skin, sr), faceM = new T.MeshStandardMaterial({ map: faceTex(L, F), roughness: sr - 0.03 });
    const shirtM = mat(L.shirt || 0xf0ebe0, 0.78), shirt2 = mat(L.shirt || 0xf0ebe0, 0.78, 0, { side: T.DoubleSide });
    const R = { headK: Math.pow(1.75 / L.h, 0.35), SH: (fem ? 0.14 : 0.157) * b, fem, drapes: [], L };

    /* --- the head --- */
    add('skull', faceM, H.geo);
    const ER = 0.0122 * F.eyeSize, eyeAz = 23, s0 = H.surf(eyeAz, 2, new T.Vector3(), true);
    const C = s0.clone().addScaledVector(new T.Vector3(0.05, 0.02, 1).normalize(), -(ER + 0.0012));
    R.eye = { C, geo: new T.SphereGeometry(ER, 20, 14, -Math.PI / 2), mat: mat(0xffffff, 0.12, 0, { map: irisTex() }) };
    // lids: the upper ones blink and follow the eyes down; the lash line is darker (vertex colour)
    const lidItems = [];
    [-1, 1].forEach(s => {
      const g = new T.SphereGeometry(ER + 0.00085, 24, 10, 0, TAU, 0, 74 * D), P = g.attributes.position, col = [];
      for (let i = 0; i < P.count; i++) { const th = Math.acos(clamp(P.getY(i) / (ER + 0.00085), -1, 1)) / D; const k = smooth(56, 73, th); col.push(lerp(1, 0.14, k), lerp(1, 0.11, k), lerp(1, 0.1, k)); }
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      lidItems.push(one(g, M4(s * C.x, 0, 0, 1, 1, 1, 0, s * 0.04, -s * 0.05)));
      add('skull', skinM, new T.SphereGeometry(ER + 0.0007, 24, 6, 0, TAU, 117 * D, 63 * D), M4(s * C.x, C.y, C.z, 1, 1, 1, 0, s * 0.04, s * 0.05));
    });
    R.lids = { geo: merge(lidItems), mat: new T.MeshStandardMaterial({ color: L.skin, roughness: 0.6, vertexColors: true }), y: C.y, z: C.z };
    // ears: the bowl of the ear, the rim (helix) curling round its top and back, the lobe
    const ear = new T.SphereGeometry(1, 14, 11), EP = ear.attributes.position;
    for (let i = 0; i < EP.count; i++) {
      const x = EP.getX(i), y = EP.getY(i), z = EP.getZ(i), rr = y * y + z * z;
      let X = x * 0.0062, Z = z * 0.0158 * (y < 0 ? 1 - 0.4 * Math.pow(-y, 1.6) : 1);
      if (x > 0) X -= 0.0052 * Math.pow(Math.max(0, 1 - rr * 1.25), 0.6);
      EP.setXYZ(i, X, y * (y > 0 ? 0.022 : 0.027), Z);
    }
    ear.computeVertexNormals();
    const helix = new T.TorusGeometry(1, 0.2, 6, 18, Math.PI * 1.15);
    const earG = merge([one(ear), one(helix, M4(0.0012, 0.002, -0.001, 0.016, 0.0195, 0.016, 0, Math.PI / 2, -0.25))]);
    [-1, 1].forEach(s => { const p = H.surf(s * 87, -5, new T.Vector3()); add('skull', skinM, earG, M4(p.x + s * 0.0005, p.y + 0.002, p.z - 0.005, s, 1, 1, -0.08, -s * 0.2, s * 0.04)); });
    // hair, beard, cap: each a shell over the head, thin at the hairline and filling out behind it
    const hl = (rows, az) => tab(rows, Math.abs(az));
    const st = L.hairStyle, flowing = st === 'mane' || st === 'parted' || st === 'updo';
    const hairM = flowing ? new T.MeshStandardMaterial({ color: L.hair, map: strandTile(), bumpMap: strandTile(), bumpScale: 1.3, roughness: st === 'mane' ? 0.7 : 0.58 })
      : new T.MeshStandardMaterial({ color: L.hair, map: hairTile(), bumpMap: hairTile(), bumpScale: 2, roughness: 0.82 });
    const phiZ = (d) => Math.atan2(d.x, d.y) / D;          // round the face-to-nape axis, for combed grooves
    if (st === 'mane') {
      // swept up off the brow and back, full over the crown and behind, lifting over the ears
      const line = [[0, 35], [22, 32], [42, 23], [58, 12], [70, 0], [78, -12], [86, -8], [94, 6], [104, -2], [130, -24], [180, -34]];
      add('skull', hairM, H.shell((az, el, d) => {
        const dh = el - hl(line, az), g = smooth(0, 26, dh);
        let m = smooth(-1, 2, dh) * (1 - 0.8 * bump(Math.abs(az), el, 89, -8, 8, 9));
        if (el < -20 && Math.abs(az) > 110) m *= smooth(-46, -30, el);
        const back = Math.max(0, -d.z), top = Math.max(0, d.y);
        const full = 0.01 + 0.026 * Math.pow(back, 0.8) + 0.013 * top + 0.012 * d.x * d.x;
        return cover(m, lerp(0.0025, full, g) + 0.0035 * Math.sin(phiZ(d) * D * 15) * g + 0.002 * Math.sin(el * D * 13 + az * D * 2) * g);
      }, { flow: true, ru: 22, rv: 6, el0: -62, ne: 56 }));
    } else if (st === 'parted') {
      // parted in the middle and drawn back to a knot behind
      const line = [[0, 40], [25, 37], [45, 26], [62, 12], [75, 0], [86, -6], [100, -10], [140, -24], [180, -30]];
      add('skull', hairM, H.shell((az, el, d) => {
        const dh = el - hl(line, az), m = smooth(-1, 2, dh), g = smooth(0, 14, dh);
        const part = 1 - 0.9 * Math.exp(-((az / 1.6) ** 2)) * smooth(38, 44, el) * smooth(92, 72, el);
        const h = lerp(0.002, 0.0068 + 0.004 * Math.max(0, -d.z) + 0.0025 * d.x * d.x, g) * part + 0.0009 * Math.sin(phiZ(d) * D * 46) * g;
        return cover(m, Math.max(0.0005, h));
      }, { flow: true, ru: 26, rv: 6, el0: -45, ne: 50 }));
      add('skull', hairM, new T.SphereGeometry(1, 18, 12), M4(0, -0.014, -0.11, 0.04, 0.033, 0.03));   // the knot at the back
      add('skull', hairM, new T.TorusGeometry(0.028, 0.009, 6, 18), M4(0, -0.014, -0.122, 1, 0.85, 0.7));
    } else if (st === 'cap') {
      const line = [[0, 35], [30, 31], [50, 20], [70, 6], [86, -2], [100, -6], [140, -24], [180, -30]];
      add('skull', hairM, H.shell((az, el) => { const dh = el - hl(line, az); return cover(smooth(-1, 2, dh), lerp(0.002, 0.0075, smooth(0, 8, dh))); }, { ru: 14, rv: 7, el0: -40, el1: 60, ne: 40 }));
    } else if (st === 'updo') {
      // drawn up from the face over a roll, a curled fringe on the brow, a knot on top
      const line = [[0, 31], [14, 30], [26, 32], [45, 22], [62, 10], [74, 0], [88, 8], [100, -4], [140, -22], [180, -28]];
      add('skull', hairM, H.shell((az, el, d) => {
        const dh = el - hl(line, az), m = smooth(-1, 2, dh), g = smooth(0, 10, dh);
        const roll = 0.019 * smooth(30, 46, el) * smooth(80, 50, el) * (0.35 + 0.65 * Math.max(0, d.z) + 0.3 * d.x * d.x);
        const fringe = 0.0055 * smooth(44, 33, el) * smooth(32, 16, Math.abs(az)) * (0.55 + 0.45 * Math.sin(az * D * 34) * Math.sin(el * D * 40));
        return cover(m, lerp(0.002, 0.009 + 0.004 * Math.max(0, -d.z), g) + roll + fringe + 0.0012 * Math.sin(phiZ(d) * D * 36) * g);
      }, { flow: true, ru: 24, rv: 6, el0: -45, ne: 50 }));
      add('skull', hairM, new T.SphereGeometry(1, 20, 14), M4(0, 0.112, -0.03, 0.046, 0.034, 0.045, -0.25));      // the knot on top
      add('skull', hairM, new T.TorusGeometry(0.034, 0.011, 8, 20), M4(0, 0.117, -0.032, 1, 1, 0.8, Math.PI / 2 - 0.25));
    } else if (st === 'receding') {
      // close-cut, the hairline gone far back over a high forehead
      const line = [[0, 62], [15, 60], [28, 52], [38, 41], [48, 29], [60, 15], [72, 2], [80, -8], [88, 3], [100, -5], [140, -26], [180, -32]];
      add('skull', hairM, H.shell((az, el, d) => {
        const dh = el - hl(line, az), m = smooth(-1.5, 2.5, dh);
        return cover(m, lerp(0.001, 0.0036 + 0.003 * Math.max(0, -d.z) + 0.0015 * d.x * d.x - 0.0012 * smooth(55, 80, el), smooth(0, 9, dh)));
      }, { el0: -50, ne: 52, ru: 18, rv: 7 }));
    } else if (st === 'crop') {
      // cropped close, the hairline squared at the temples, a part on the left
      const line = [[0, 40], [12, 40], [24, 37.5], [34, 31], [44, 27], [56, 20], [68, 10], [76, -2], [81, -9], [88, 2], [100, -4], [140, -26], [180, -31]];
      add('skull', hairM, H.shell((az, el, d) => {
        const dh = el - hl(line, az), m = smooth(-2.5, 2.5, dh);
        const part = 1 - 0.85 * Math.exp(-(((az - 33) / 1.8) ** 2)) * smooth(37, 44, el) * smooth(78, 64, el);
        return cover(m, lerp(0.001, 0.0032 + 0.0042 * Math.max(0, d.y) + 0.0012 * Math.max(0, -d.z), smooth(0, 7, dh)) * part);
      }, { el0: -50, ne: 52, ru: 18, rv: 7 }));
    }
    const beardM = L.beard ? new T.MeshStandardMaterial({ color: L.hair, map: strandTile(), bumpMap: strandTile(), bumpScale: 1.6, roughness: 0.75 }) : null;
    if (L.beard === 'full') {
      // a full beard, the moustache over the upper lip; the lower lip shows
      const top = [[0, -26], [10, -26.5], [19, -30], [27, -26], [40, -19], [56, -13], [70, -11], [80, -13], [96, -20]];
      add('skull', beardM, H.shell((az, el, d) => {
        const A = Math.abs(az), dh = tab(top, A) - el;
        let m = smooth(-2, 2.5, dh) * smooth(102, 92, A);
        m *= 1 - bump(az, el, 0, -39.6, 17, 4.6);
        const g = smooth(0, 14, dh);
        const h = lerp(0.0025, 0.006 + 0.016 * smooth(-40, -72, el) + 0.006 * smooth(-62, -88, el) * (1 - 0.5 * smooth(60, 100, A)), g)
          + 0.002 * Math.sin(az * D * 23 + el * D * 9) * g - 0.002 * bump(az, el, 0, -29.5, 14, 3);
        return cover(m, h);
      }, { az0: -110, az1: 110, na: 60, el1: 0, ne: 40, ru: 14, rv: 4, front: 1.5 }));
    } else if (L.beard === 'goatee') {
      // a trimmed point on the chin (a Van Dyke) and a moustache turned up at the ends
      add('skull', beardM, H.shell((az, el) => {
        const A = Math.abs(az);
        const goat = smooth(17, 11.5, A + Math.max(0, -62 - el) * 0.2) * smooth(-44.5, -48, el);
        const must = smooth(19.5, 16.5, A) * smooth(-31.2, -30, el + A * 0.04) * smooth(-27.4, -28.6, el + A * 0.04) * (1 - 0.55 * bump(az, el, 0, -27.8, 2.2, 1.6))
          + smooth(16, 18.5, A) * smooth(24, 21.5, A) * smooth(-29.8, -28.6, el - (A - 17) * 0.45) * smooth(-25.5, -26.8, el - (A - 17) * 0.45);
        const m = Math.min(1, goat + must);
        const h = goat > must ? lerp(0.0018, 0.0048 + 0.0085 * smooth(-56, -78, el) * smooth(13, 0, A), smooth(-45, -52, el)) : 0.0027 - 0.0012 * smooth(16, 23, A);
        return cover(m, h);
      }, { az0: -40, az1: 40, na: 36, el0: -90, el1: -18, ne: 36, ru: 6, rv: 4, front: 0.5 }));
    } else if (L.beard === 'mustache') {
      add('skull', beardM, H.shell((az, el) => {
        const A = Math.abs(az);
        return cover(smooth(17.5, 14.5, A) * smooth(-31.6, -30.2, el) * smooth(-26.8, -28.2, el + A * 0.06) * (1 - 0.6 * bump(az, el, 0, -27.6, 2, 1.5)), 0.0026 - 0.0012 * smooth(4, 16, A));
      }, { az0: -32, az1: 32, na: 30, el0: -40, el1: -20, ne: 16, ru: 5, rv: 2, front: 0.5 }));
    }
    if (st === 'wrap') {
      // a headwrap of checked cotton wound over all the hair: a rolled edge across the brow, folds running
      // round and up, the ends knotted at the front
      const edge = [[0, 30], [26, 27], [48, 19], [70, 9], [86, 4], [100, 0], [130, -14], [180, -26]];
      const wm = new T.MeshStandardMaterial({ map: checkTile(L.wrap), roughness: 0.84, bumpMap: weaveTile(), bumpScale: 0.45 });
      const wh = (az, el, d) => {
        const dh = el - tab(edge, Math.abs(az)), g = smooth(0, 12, dh);
        return lerp(0.007, 0.011 + 0.017 * smooth(-0.3, 0.9, d.y * 0.6 - d.z * 0.8), g) + 0.0035 * Math.sin(az * D * 5 + el * D * 12) * g + 0.0045 * bump(dh, 0, 3, 0, 3, 1);
      };
      add('skull', wm, H.shell((az, el, d) => cover(smooth(-1.2, 1.2, el - tab(edge, Math.abs(az))), wh(az, el, d)), { ru: 10, rv: 5, el0: -40, ne: 60 }));
      const kn = new T.Vector3(), kp = H.surf(0, 52, new T.Vector3());
      kn.copy(kp).normalize(); kp.addScaledVector(kn, wh(0, 52, kn) + 0.002);
      add('skull', wm, new T.SphereGeometry(1, 14, 10), M4(kp.x, kp.y, kp.z, 0.016, 0.013, 0.012, -0.9));
      [-1, 1].forEach(s => add('skull', wm, new T.SphereGeometry(1, 12, 10), M4(kp.x + s * 0.019, kp.y + 0.007, kp.z - 0.008, 0.021, 0.009, 0.013, -0.9, s * 0.4, s * 0.55)));
    }
    if (st === 'cap') {
      // a mob cap: a puffed linen crown over the back of the head, a soft frill falling round the face, a band
      const edge = [[0, 43], [40, 39], [70, 26], [90, 12], [110, -2], [140, -18], [180, -26]];
      const dirOf = (az, el, out) => { const a = az * D, e = el * D; return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); };
      const capH = (az, el, d) => 0.017 + 0.024 * smooth(-0.3, 0.9, d.y * 0.6 - d.z * 0.8) + 0.002 * Math.sin(az * D * 15) * smooth(5, 25, el - tab(edge, Math.abs(az)));
      const capM = new T.MeshStandardMaterial({ color: L.cap, roughness: 0.88, bumpMap: weaveTile(), bumpScale: 0.35 });
      add('skull', capM, H.shell((az, el, d) => cover(smooth(-0.5, 1.5, el - tab(edge, Math.abs(az))), capH(az, el, d)), { ru: 8, rv: 4, el0: -45, ne: 56 }));
      const frillM = mat(L.cap, 0.85, 0, { side: T.DoubleSide });
      const p = new T.Vector3(), q = new T.Vector3(), dir = new T.Vector3();
      const at = (az, el, h, out) => H.surf(az, el, out).addScaledVector(dirOf(az, el, dir), h);
      add('skull', frillM, grid(96, 3, (u, v, out) => {
        const az = lerp(-116, 116, u), el = tab(edge, Math.abs(az));
        at(az, el + 2, capH(az, el + 2, dirOf(az, el + 2, dir)) * 0.6, p);
        at(az, el - 6, 0.005, q);
        const wav = Math.sin(u * 96 * 1.65) * 0.0028 * (0.35 + v);
        out.copy(p).lerp(q, v).addScaledVector(dir, wav + 0.003 * v);
      }, { ref: (pp) => pp }));
      add('skull', mat(0xe6decf, 0.82), grid(96, 1, (u, v, out) => {
        const az = lerp(-112, 112, u), el = tab(edge, Math.abs(az)) + 5 + v * 4.5;
        return at(az, el, capH(az, el, dirOf(az, el, dir)) + 0.0022, out);
      }, { ref: (pp) => pp }));
    }
    if (L.specs === 'browline') {
      // browline spectacles: heavy dark tops over the brows, fine gold rims below, gold bridge and arms
      const top = mat(0x15100c, 0.35), wire = mat(0xc9b07a, 0.3, 0.9), glass = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false });
      const z0 = Math.max(C.z + ER + 0.011, H.surf(eyeAz, 13, new T.Vector3()).z + 0.0075), tops = [], rims = [], lens = [];
      [-1, 1].forEach(s => {
        const cx = s * (C.x + 0.003), cy = C.y + 0.001, w = 0.025, hh = 0.017;
        const pt = (a) => new T.Vector3(cx + Math.cos(a) * w * s, cy + Math.sin(a) * hh * (Math.sin(a) > 0 ? 1.05 : 1), z0 - 0.006 * Math.pow(Math.max(0, Math.cos(a) * s * s), 2) - (s * Math.cos(a) * s > 0 ? 0.003 : 0));
        const upper = [], lower = [];
        for (let i = 0; i <= 14; i++) upper.push(pt(-0.2 + i / 14 * (Math.PI + 0.4)));
        for (let i = 0; i <= 14; i++) lower.push(pt(Math.PI + 0.2 + i / 14 * (Math.PI - 0.4)));
        tops.push(one(tube(upper, 0.0027, 30)));
        rims.push(one(tube(lower, 0.0007, 30)));
        const sh = new T.Shape(); for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU; sh.lineTo(Math.cos(a) * w * 0.98, Math.sin(a) * hh * 0.98); }
        lens.push(one(new T.ShapeGeometry(sh), M4(cx, cy, z0 - 0.002)));
        const hinge = pt(s > 0 ? 0.05 : Math.PI - 0.05);
        rims.push(one(tube([hinge, new T.Vector3(s * (H.W * 0.95), cy + 0.004, z0 - 0.03), new T.Vector3(s * (H.W + 0.004), cy + 0.002, -0.02), new T.Vector3(s * (H.W + 0.002), cy - 0.02, -0.045)], 0.0011, 20)));
      });
      rims.push(one(tube([new T.Vector3(-0.012, C.y + 0.009, z0 + 0.001), new T.Vector3(0, C.y + 0.012, z0 + 0.003), new T.Vector3(0.012, C.y + 0.009, z0 + 0.001)], 0.0011, 10)));
      add('skull', top, merge(tops)); add('skull', wire, merge(rims)); add('skull', glass, merge(lens));
    }
    if (L.earrings) [-1, 1].forEach(s => { const p = H.surf(s * 88, -22, new T.Vector3()); add('skull', mat(L.earrings, 0.3, 0.9), new T.SphereGeometry(0.0042, 10, 8), M4(p.x + s * 0.008, p.y - 0.004, p.z - 0.006)); add('skull', mat(L.earrings, 0.3, 0.9), new T.SphereGeometry(0.0048, 10, 8), M4(p.x + s * 0.008, p.y - 0.014, p.z - 0.006, 1, 1.3, 1)); });

    /* --- neck and collars --- */
    const nk = fem ? 0.95 : 1.04;
    add('neck', skinM, loft([[-0.04, 0.058 * nk, 0.056 * nk, 0.055 * nk], [0.02, 0.054 * nk, 0.054 * nk, 0.052 * nk, 0.002], [0.08, 0.05 * nk, 0.052 * nk, 0.048 * nk, 0.006], [0.13, 0.048 * nk, 0.05 * nk, 0.045 * nk, 0.01], [0.17, 0.032, 0.03, 0.03, 0.012], [0.18, 0.001, 0.001, 0.001, 0.012]], 22));
    if (!fem) {
      const ch = L.collarH;
      add('neck', shirt2, loft([[-0.008, 0.0625, 0.066, 0.061, 0.002, 2], [ch * 0.5, 0.061, 0.064, 0.0595, 0.004, 2], [ch, 0.0595, 0.062, 0.058, 0.006, 2]], 26, { a0: 14 * D, a1: 346 * D }));
      if (L.tieStyle === 'bow') {
        const tm = mat(L.tie, 0.45);
        [-1, 1].forEach(s => add('neck', tm, new T.SphereGeometry(1, 12, 8), M4(s * 0.017, ch * 0.4, 0.068, 0.017, 0.0105, 0.0055, 0, 0, s * 0.18)));
        add('neck', tm, new T.SphereGeometry(1, 10, 8), M4(0, ch * 0.4, 0.071, 0.0065, 0.0075, 0.005));
        [-1, 1].forEach(s => add('neck', shirt2, new T.SphereGeometry(1, 10, 6), M4(s * 0.021, ch * 0.66, 0.064, 0.013, 0.009, 0.0025, 0.25, s * 0.35, s * 0.6)));   // wing tips
      } else {
        const tm = mat(L.tie, 0.5);
        add('neck', tm, new T.CylinderGeometry(0.011, 0.007, 0.024, 10), M4(0, ch * 0.32, 0.066, 1, 1, 0.7, -0.15));
        [-1, 1].forEach(s => add('neck', shirt2, new T.SphereGeometry(1, 12, 8), M4(s * 0.019, ch * 0.42, 0.064, 0.016, ch * 0.4, 0.0028, -0.2, s * 0.35, s * (L.tieStyle === 'narrow' ? 0.85 : 0.5))));   // the collar's points
      }
    } else if (L.collar === 'high') {
      const dm = mat(L.dress, 0.75, 0, WV);
      add('neck', dm, loft([[-0.012, 0.062, 0.064, 0.06, 0.002, 2], [0.03, 0.0575, 0.059, 0.056, 0.005, 2], [0.072, 0.0545, 0.0565, 0.053, 0.008, 2], [0.078, 0.05, 0.052, 0.049, 0.008, 2]], 28));
      if (L.lace) add('neck', mat(L.lace, 0.85), loft([[0.066, 0.0565, 0.0585, 0.055, 0.008, 2], [0.083, 0.0575, 0.0595, 0.056, 0.009, 2], [0.086, 0.054, 0.056, 0.052, 0.009, 2]], 28));
      add('neck', mat(L.brooch, 0.3, 0.9), new T.SphereGeometry(1, 14, 10), M4(0, 0.028, 0.067, 0.012, 0.0095, 0.004));
      add('neck', mat(0x2a0f12, 0.2, 0.2), new T.SphereGeometry(1, 10, 8), M4(0, 0.028, 0.07, 0.006, 0.005, 0.0025));
    }

    /* --- the torso --- */
    const TR = (fem ? TORSO_F : TORSO_M).map(r => [r[0] - 1.02, r[1] * (r[0] > 1.25 ? b : lerp(1, b, 0.5)), r[2], r[3], 0, 2.3]);
    if (L.stays) TR.forEach(r => { if (r[0] > 0.12 && r[0] < 0.3) r[2] *= 0.9; if (r[0] < 0.05) r[1] *= 1.06; });
    const topM = mat(L.coat || L.dress, fem ? 0.78 : 0.8, 0, WV);
    add('chest', topM, loft(TR, 32));
    const yl = (y) => y - 1.02;
    if (!fem) {
      const yB = yl(L.yBtn), lw = L.lapW, open = !!L.open;
      const xi = (v) => -lerp(0.034, open ? 0.06 : 0.004, Math.pow(v, 0.8));
      const yv = (v) => lerp(yl(1.448), yB, v);
      // the V of shirt (and waistcoat) between the lapels
      const vBot = open ? yl(0.97) : yB;
      const xOpen = (y) => (y >= yB - 1e-6 ? -xi(clamp((y - yl(1.448)) / (yB - yl(1.448)), 0, 1)) : open ? 0.06 : 0.004);
      add('chest', shirtM, decal(TR, (u, v) => { const y = lerp(yl(1.45), open ? yl(1.28) : yB, v); const x = xOpen(y) + 0.004; return [lerp(-x, x, u), y]; }, 6, 10, 0.0012, 0));
      if (L.vest) {
        const vm = mat(L.vest, 0.72, 0, WV), vTop = yl(open ? 1.355 : 1.33);
        [-1, 1].forEach(s => add('chest', vm, decal(TR, (u, v) => {
          const y = lerp(vTop, vBot, v), xo = xOpen(y) + 0.006, xin = Math.max(0, 0.062 * (y - yl(1.27)) / (vTop - yl(1.27)));
          return [s * lerp(xin, xo, u), y];
        }, 4, 14, 0.0045, 0.0015)));
        for (let i = 0; i < (open ? 6 : 2); i++) { const y = yl(1.25) - i * 0.048; if (y < vBot + 0.02) break; add('chest', mat(0x1a1714, 0.4), new T.SphereGeometry(1, 8, 6), M4(0, y, surfZ(TR, 0, y) + 0.008, 0.0055, 0.0055, 0.003)); }
      }
      // the tie: four-in-hand or narrow; under the waistcoat
      if (L.tieStyle !== 'bow') {
        const narrow = L.tieStyle === 'narrow', yEnd = yl(narrow ? 1.05 : 1.22);
        add('chest', mat(L.tie, 0.5), decal(TR, (u, v) => { const y = lerp(yl(1.445), yEnd, v); const w = narrow ? lerp(0.012, 0.016, v) : lerp(0.014, 0.03, v); const tip = v > 0.9 ? (1 - v) / 0.1 : 1; return [lerp(-w, w, u) * lerp(0.15, 1, tip), y - (Math.abs(u - 0.5) * 2) * 0 ]; }, 4, 16, 0.0028, 0.0016));
        if (L.clip) add('chest', mat(L.clip, 0.25, 0.9), new T.BoxGeometry(1, 1, 1), M4(0, yl(1.24), surfZ(TR, 0, yl(1.24)) + 0.006, 0.04, 0.0035, 0.003));
      }
      // lapels and the coat collar behind the neck
      const lapM = L.lapel ? mat(L.lapel, 0.5) : mat(L.coat, 0.78, 0, WV);
      [-1, 1].forEach(s => add('chest', lapM, decal(TR, (u, v) => {
        const w = lw * (v < 0.22 ? lerp(0.55, 1, smooth(0, 0.22, v)) : lerp(1, open ? 0.5 : 0.08, smooth(0.22, 1, v)));
        const notch = v > 0.17 && v < 0.24 ? 0.35 : 1;
        const x0 = xi(v);
        return [s * -(x0 - w * u * (u > 0.7 ? notch : 1)), yv(v)];
      }, 5, 18, 0.0035, 0.0028)));
      add('chest', mat(L.lapel || L.coat, 0.75, 0, WV2), loft([[yl(1.44), 0.084, 0.074, 0.08, -0.004, 2], [yl(1.472), 0.075, 0.066, 0.073, -0.006, 2], [yl(1.492), 0.07, 0.062, 0.068, -0.008, 2]], 24, { a0: 62 * D, a1: 298 * D }));
      if (!open) [L.yBtn - 0.02, L.yBtn - 0.105].forEach(y => add('chest', mat(0x16130f, 0.35), new T.CylinderGeometry(0.0085, 0.0085, 0.004, 12), M4(0.004, yl(y), surfZ(TR, 0, yl(y)) + 0.003, 1, 1, 1, Math.PI / 2)));
      else [1.06, 1.13].forEach(y => add('chest', mat(0x16130f, 0.35), new T.CylinderGeometry(0.008, 0.008, 0.004, 12), M4(0.072, yl(y), surfZ(TR, 0.072, yl(y)) + 0.003, 1, 1, 1, Math.PI / 2)));
      if (L.chain) {
        const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10, x = lerp(0, 0.085, t), y = yl(1.115) - Math.sin(t * Math.PI) * 0.028 + t * 0.012; pts.push(new T.Vector3(x, y, surfZ(TR, x, y) + 0.0075)); }
        add('chest', mat(L.chain, 0.3, 0.95), tube(pts, 0.0017, 40));
        add('chest', mat(L.chain, 0.3, 0.95), tube(pts.map(p => new T.Vector3(-p.x * 0.6, p.y + (p.y - yl(1.115)) * 0.2, surfZ(TR, -p.x * 0.6, p.y) + 0.0075)), 0.0015, 30));
      }
      // pockets: a flap low on each side, a welt on the left breast
      [-1, 1].forEach(s => add('chest', topM, decal(TR, (u, v) => [s * lerp(0.07, 0.135, u), lerp(yl(1.035), yl(1.015), v) + (u - 0.5) * 0.004], 4, 1, 0.0015, 0.003)));
      add('chest', topM, decal(TR, (u, v) => [lerp(0.075, 0.125, u), lerp(yl(1.315), yl(1.305), v) + u * 0.006], 4, 1, 0.0015, 0.0025));
    } else {
      const dm = mat(L.dress, 0.75, 0, WV);
      if (L.buttons) for (let i = 0; i < 9; i++) { const y = yl(1.43) - i * 0.046; add('chest', mat(L.buttons, 0.25, 0.3), new T.SphereGeometry(1, 8, 6), M4(0, y, surfZ(TR, 0, y) + 0.003, 0.0048, 0.0048, 0.0035)); }
      add('chest', dm, decal(TR, (u, v) => [lerp(-0.011, 0.011, u), lerp(yl(1.445), yl(1.0), v)], 2, 12, 0.0008, 0.0018));        // the front placket
      add('chest', dm, decal(TR, (u, v) => [lerp(-0.125, 0.125, u), lerp(yl(1.03), yl(1.005), v)], 14, 1, 0.0012, 0.003));          // a waistband
      if (L.apron) {
        const am = mat(L.apron, 0.88, 0, { weave: 0.6 });
        add('chest', am, loft([[yl(1.034), 0.127, 0.089, 0.095, 0, 2.3], [yl(1.008), 0.129, 0.09, 0.097, 0, 2.3]].map(r => [r[0], r[1] + 0.004, r[2] + 0.004, r[3] + 0.004, 0, 2.3]), 28));
        [-1, 1].forEach(s => add('chest', am, new T.SphereGeometry(1, 10, 8), M4(s * 0.022, yl(1.02), -0.1, 0.022, 0.012, 0.01, 0, s * 0.3, s * 0.4)));
        add('chest', am, new T.BoxGeometry(1, 1, 1), M4(0.012, yl(0.96), -0.1, 0.012, 0.09, 0.004, 0.15, 0, 0.1));
      }
      if (L.fichu) {
        // a white collar lying round the neckline, scalloped at the edge
        const fm = mat(L.fichu, 0.85, 0, { side: T.DoubleSide });
        add('chest', fm, surface(steps(48), [0, 1, 2, 3, 4], (u, j, p) => {
          const a = -Math.PI + u * TAU, rings = [[0.433, 0.07, 0.06, 0.062], [0.424, 0.092, 0.073, 0.073], [0.405, 0.132, 0.095, 0.088], [0.381, 0.155, 0.115, 0.098], [0.362, 0.163, 0.128, 0.102]];
          const r = rings[j], s = Math.sin(a), c = Math.cos(a), sc = j === 4 ? 0.006 * Math.cos(u * TAU * 9) : 0;
          p.set(s * r[1], r[0] + sc - (j === 4 ? 0.022 * Math.max(0, c) : 0), c * (c > 0 ? r[2] : r[3]) + 0.004);
        }, { seam: true, ref: (p) => p }));
        add('chest', mat(0x6a2230, 0.6), new T.SphereGeometry(1, 10, 8), M4(0, yl(1.405), surfZ(TR, 0, yl(1.405)) + 0.012, 0.012, 0.008, 0.005));   // a ribbon at the throat
      }
    }

    /* --- hips: trousers' seat, or nothing under a skirt --- */
    if (!fem) add('hips', mat(L.trousers, 0.82, 0, WV), loft([[0.15, 0.154, 0.094, 0.106, 0, 2.6], [0.06, 0.16, 0.088, 0.112, 0, 2.6], [-0.02, 0.153, 0.078, 0.104, 0, 2.6], [-0.058, 0.115, 0.055, 0.08, 0, 2.4], [-0.072, 0.001, 0.001, 0.001]], 26));
    // skirt or coat skirts: reshaped every frame (see drape below)
    if (fem) {
      const sk = L.skirt;
      const srx = [[0, 0.118], [0.05, 0.15], [0.12, sk.hip], [0.3, sk.hip + 0.02], [0.6, lerp(sk.hip, sk.hem, 0.55)], [1, sk.hem]], slen = sk.len || 1.04;
      R.drapes.push({ mat: mat(L.dress, 0.8, 0, WV2), top: 0.135, len: slen, gap: [0, 0], na: 36, nt: 14, rx: srx, f: 0.88, b: 1.1, z0: -0.025, fall: 1 });
      if (L.apron) {
        // a work apron over the front of the skirt, tied at the waist
        const top = 0.1, len = 0.8;
        R.drapes.push({ mat: mat(L.apron, 0.88, 0, { weave: 0.6, side: T.DoubleSide }), top, len, span: [-68, 68], na: 20, nt: 10, lift: 0.007,
          rx: steps(8).map(t => [t, lin(srx, clamp((0.135 - (top - t * len)) / slen, 0, 1)) + 0.007 + 0.004 * t]), f: 0.88, b: 1.1, z0: -0.025, fall: 1 });
      }
    } else if (L.top === 'frock') {
      R.drapes.push({ mat: mat(L.coat, 0.8, 0, WV2), top: 0.13, len: 0.55, gap: [17, 9], na: 28, nt: 10,
        rx: [[0, 0.15], [0.12, 0.172], [0.5, 0.196], [1, 0.216]], f: 0.78, b: 0.88, z0: -0.01, fall: 1 });
    } else {
      R.drapes.push({ mat: mat(L.coat, 0.8, 0, WV2), top: 0.13, len: 0.26, gap: L.open ? [20, 14] : [5, 26], na: 28, nt: 6,
        rx: [[0, 0.152], [0.3, 0.172], [1, 0.18]], f: 0.8, b: 0.9, z0: -0.008, fall: 0.3 });
    }

    /* --- arms --- */
    const sleeveM = fem ? mat(L.dress, 0.75, 0, WV) : topM, cuffM = fem ? mat(L.cuffs || L.fichu || L.dress, 0.8) : shirtM;
    let upper, fore, cuff = null, ruffle = null;
    if (L.sleeve === 'mutton') {
      upper = limb([[0.05, 0.001], [0.044, 0.046], [0.026, 0.07], [-0.005, 0.08], [-0.06, 0.075], [-0.13, 0.058], [-0.2, 0.046], [-0.29, 0.041], [-0.315, 0.03], [-0.325, 0.001]], 0.94);
      fore = limb([[0.04, 0.001], [0.028, 0.03], [0, 0.04], [-0.12, 0.036], [-0.23, 0.032], [-0.248, 0.034], [-0.253, 0.02], [-0.256, 0.001]]);
    } else if (L.sleeve === 'fitted') {
      upper = limb([[0.018, 0.001], [0.012, 0.032], [0, 0.044], [-0.02, 0.05], [-0.1, 0.047], [-0.22, 0.042], [-0.29, 0.04], [-0.315, 0.028], [-0.325, 0.001]]);
      fore = limb([[0.04, 0.001], [0.028, 0.03], [0, 0.039], [-0.12, 0.035], [-0.23, 0.032], [-0.243, 0.033], [-0.248, 0.02], [-0.25, 0.001]]);
      cuff = limb([[-0.232, 0.0305], [-0.256, 0.0295], [-0.259, 0.018], [-0.26, 0.001]]);
    } else if (L.sleeve === 'rolled') {
      upper = limb([[0.018, 0.001], [0.012, 0.032], [0, 0.044], [-0.02, 0.05], [-0.1, 0.048], [-0.2, 0.046], [-0.245, 0.046], [-0.258, 0.053], [-0.278, 0.054], [-0.292, 0.048], [-0.298, 0.001]], 0.95);
      fore = limb([[0.035, 0.001], [0.02, 0.031], [0, 0.036], [-0.1, 0.034], [-0.2, 0.028], [-0.24, 0.026], [-0.252, 0.02], [-0.256, 0.001]]);
    } else if (L.sleeve === 'elbow') {
      upper = limb([[0.018, 0.001], [0.012, 0.032], [0, 0.044], [-0.02, 0.05], [-0.1, 0.049], [-0.2, 0.046], [-0.27, 0.046], [-0.295, 0.044], [-0.305, 0.03], [-0.315, 0.001]]);
      fore = limb([[0.035, 0.001], [0.02, 0.031], [0, 0.036], [-0.1, 0.033], [-0.2, 0.027], [-0.24, 0.025], [-0.252, 0.02], [-0.256, 0.001]]);
      ruffle = [[-0.262, 0.044], [-0.28, 0.05], [-0.305, 0.058], [-0.33, 0.065], [-0.345, 0.068]];
    } else {
      upper = limb([[0.02, 0.001], [0.014, 0.034], [0.002, 0.048], [-0.02, 0.055], [-0.06, 0.055], [-0.15, 0.051], [-0.25, 0.046], [-0.295, 0.045], [-0.318, 0.03], [-0.328, 0.001]]);
      fore = limb([[0.045, 0.001], [0.03, 0.034], [0, 0.045], [-0.1, 0.043], [-0.2, 0.04], [-0.232, 0.041], [-0.238, 0.03], [-0.242, 0.001]]);
      cuff = limb([[-0.222, 0.0335], [-0.262, 0.0322], [-0.265, 0.02], [-0.266, 0.001]]);
    }
    const ug = loft(upper, 18), fg = loft(fore, 18);
    [-1, 1].forEach(s => {
      add('sh' + s, sleeveM, ug);
      add('el' + s, L.sleeve === 'elbow' || L.sleeve === 'rolled' ? skinM : sleeveM, fg);
      if (cuff) add('el' + s, cuffM, loft(cuff, 16));
      if (ruffle) {
        const rf = surface(steps(40), ruffle.map((r, j) => j), (u, j, p) => { const a = -Math.PI + u * TAU, r = ruffle[j], w = j > 1 ? 0.0045 * Math.sin(u * 40 * Math.PI) * j / 4 : 0; p.set(Math.sin(a) * (r[1] + w), r[0], Math.cos(a) * (r[1] + w)); }, { seam: true, ref: (p) => _ref.set(p.x, 0, p.z) });
        add('sh' + s, mat(L.fichu, 0.85, 0, { side: T.DoubleSide }), rf, M4(0, 0, 0));
      }
      add('wr' + s, skinM, handGeo(s, fem ? 0.9 : 1), null, 'hand' + s);
    });

    /* --- legs and shoes --- */
    const legM = fem ? (L.apron ? skinM : mat(0x1c1715, 0.6)) : mat(L.trousers, 0.82, 0, WV), shoeM = mat(L.shoes, L.shoeRough || (fem ? 0.45 : 0.32));
    const thigh = loft(fem ? limb([[0.07, 0.001], [0.05, 0.058], [0.02, 0.072], [0, 0.074], [-0.2, 0.063], [-0.4, 0.049], [-0.45, 0.04], [-0.465, 0.001]])
      : limb([[0.08, 0.001], [0.06, 0.06], [0.03, 0.08], [0, 0.085], [-0.1, 0.082], [-0.25, 0.072], [-0.38, 0.062], [-0.43, 0.058], [-0.46, 0.04], [-0.472, 0.001]]), 18);
    const shin = loft(fem ? limb([[0.04, 0.001], [0.022, 0.042], [0, 0.048], [-0.1, 0.05], [-0.3, 0.035], [-0.38, 0.03], [-0.41, 0.03], [-0.42, 0.001]])
      : limb([[0.05, 0.001], [0.035, 0.046], [0, 0.058], [-0.12, 0.057], [-0.3, 0.051], [-0.37, 0.05], [-0.398, 0.053], [-0.402, 0.035], [-0.405, 0.001]]), 18);
    const shoe = shoeGeo(fem);
    [-1, 1].forEach(s => { add('hip' + s, legM, thigh); add('knee' + s, legM, shin); add('ankle' + s, shoeM, shoe); });

    R.parts = [...parts.values()].map(p => ({ bone: p.bone, mat: p.mat, tag: p.tag, geo: p.items.length === 1 && p.tag ? p.items[0].g : merge(p.items) }));
    RECIPES.set(id, R);
    return R;
  }

  /* ---------------- skirts and coat skirts: a ring of cloth reshaped for standing, walking and sitting ---------------- */
  function drape(cfg) {
    const span = cfg.span, g0 = span ? 0 : cfg.gap[0] * D, g1 = span ? 0 : cfg.gap[1] * D, closed = !span && g0 === 0 && g1 === 0, lift = cfg.lift || 0;
    const P = new T.Vector3();
    function at(u, t, sk, zk, floor, out) {
      const gap = g0 + g1 * t, a = span ? lerp(span[0], span[1], u) * D : closed ? -Math.PI + u * TAU : gap + u * (TAU - 2 * gap);
      const sa = Math.sin(a), ca = Math.cos(a);
      const rx = lin(cfg.rx, t), y = cfg.top - t * cfg.len;
      let x = sa * rx, z = cfg.z0 * t + ca * rx * (ca > 0 ? cfg.f : cfg.b);
      // walking: each side follows its knee
      const wR = smooth(-0.4, 0.9, -sa), wL = smooth(-0.4, 0.9, sa), tt = Math.pow(t, 1.15);
      z += (zk[0] * wR + zk[1] * wL) * tt * 0.85;
      x += (zk[0] - zk[1]) * 0.08 * tt * ca;
      if (sk <= 0.001) return out.set(x, y, z);
      // seated: over the thighs to the knees, then falling; behind, it lies on the seat
      const W = 0.205, Ff = 0.5, B = 0.15, zc = 0.17;
      const q = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
      const rimX = W * q(sa), rimZ = zc + (ca >= 0 ? Ff - zc : zc + B) * q(ca), rimY = ca >= 0 ? lerp(0.02, 0.09, ca) : lerp(0.02, -0.075, -ca);
      const x0 = Math.sin(a) * cfg.rx[0][1], z0 = Math.cos(a) * cfg.rx[0][1] * (ca > 0 ? cfg.f : cfg.b), y0 = cfg.top;
      const L1 = Math.hypot(rimX - x0, rimY - y0, rimZ - z0), s = t * cfg.len;
      let X, Y, Z;
      if (s <= L1) { const k = s / L1; X = lerp(x0, rimX, k); Y = lerp(y0, rimY, k) + 0.014 * Math.sin(Math.PI * k) + lift * smooth(0, 0.3, k); Z = lerp(z0, rimZ, k); }
      else {
        // behind, the cloth is sat on: it goes only a little way down the back of the seat
        const back = smooth(0.1, -0.7, ca), fall = cfg.fall, e = lerp(s - L1, Math.min(s - L1, 0.06), back);
        X = rimX + sa * e * lerp(0.13, 0.05, back) + sa * lift;
        Z = rimZ + ca * e * lerp(0.13, 0.05, back) + ca * lift;
        Y = rimY - e * fall - (1 - fall) * Math.min(e, 0.02) + lift;
      }
      if (Y < floor + 0.012) { const over = floor + 0.012 - Y; Y = floor + 0.012; X += sa * over * 0.4; Z += ca * over * 0.4; }
      return out.set(lerp(x, X, sk), lerp(y, Y, sk), lerp(z, Z, sk));
    }
    const zero = [0, 0];
    const geo = grid(cfg.na, cfg.nt, (u, t, p) => at(u, t, 0, zero, -0.92, p), { seam: closed, ref: (p) => _ref.set(p.x, 0, p.z + 0.02) });
    const mesh = new T.Mesh(geo, cfg.mat);
    const pos = geo.attributes.position, nu = cfg.na;
    let last = '';
    function update(sk, zk, floor) {
      const key = sk.toFixed(3) + ':' + zk[0].toFixed(3) + ':' + zk[1].toFixed(3) + ':' + floor.toFixed(2);
      if (key === last) return;
      last = key;
      for (let j = 0; j <= cfg.nt; j++) for (let i = 0; i <= nu; i++) { at(i / nu, j / cfg.nt, sk, zk, floor, P); pos.setXYZ(j * (nu + 1) + i, P.x, P.y, P.z); }
      pos.needsUpdate = true;
      normals(geo);
      geo.computeBoundingSphere();
    }
    return { mesh, update };
  }

  /* ---------------- the open book: pages and boards round the held book, and a leaf that turns ---------------- */
  function openBook() {
    const grp = new T.Group(); grp.visible = false;
    const pm = mat(0xffffff, 0.9, 0, { map: pageTex() }), pm2 = mat(0xffffff, 0.9, 0, { map: pageTex(), side: T.DoubleSide });
    const spreadGeo = TEX.spread || (TEX.spread = grid(24, 2, (u, v, p) => { const z = 1 - 2 * u, a = Math.abs(z); p.set(0.0008 + 0.0065 * Math.pow(Math.sin(Math.PI * Math.min(1, a * 1.15)), 0.7) * (a < 0.85 ? 1 : 1 - (a - 0.85) * 3), v - 0.5, z); }, { ref: () => _ref.set(1, 0, 0) }));
    const spread = new T.Mesh(spreadGeo, pm); grp.add(spread);
    const leafGeo = grid(12, 1, (u, v, p) => p.set(0, v - 0.5, -u), {});
    const uvs = leafGeo.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setX(i, 0.5 + uvs.getX(i) * 0.5);
    const leaf = new T.Mesh(leafGeo, pm2); leaf.visible = false; grp.add(leaf);
    let boards = null, block = null, key = '';
    const lp = leafGeo.attributes.position;
    return {
      grp, leaf,
      fit(book) {             // the held book's size, its own cover for the boards
        const pr = book.geometry.parameters || {}, t = pr.width || 0.03, h = pr.height || 0.22, d = pr.depth || 0.15;
        const k = book.uuid + ':' + t + ':' + h + ':' + d;
        if (k === key) return { t, h, d };
        key = k;
        spread.position.x = t / 2; spread.scale.set(1, h, d);
        if (boards) { grp.remove(boards); boards.geometry.dispose(); grp.remove(block); block.geometry.dispose(); }
        // the covers, opened out flat under the pages, in the book's own cloth; the leaves between, cream at the edges
        const bg = new T.BoxGeometry(0.005, h + 0.008, 2 * d + 0.01), buv = bg.attributes.uv, src = book.geometry.attributes.uv;
        if (src) { const u0 = Math.min(src.getX(0), src.getX(1)), u1 = Math.max(src.getX(0), src.getX(1)), v0 = Math.min(src.getY(0), src.getY(2)), v1 = Math.max(src.getY(0), src.getY(2)); for (let i = 0; i < buv.count; i++) buv.setXY(i, lerp(u0, u1, buv.getX(i)), lerp(v0, v1, buv.getY(i))); }
        boards = new T.Mesh(bg, book.material); boards.position.x = -t / 2; grp.add(boards);
        block = new T.Mesh(TEX.block || (TEX.block = new T.BoxGeometry(1, 1, 1)), mat(0xe6dcc4, 0.9));
        block.scale.set(t - 0.004, h - 0.004, 2 * d - 0.002); block.position.x = 0.0015; grp.add(block);
        return { t, h, d };
      },
      turn(f, dims) {         // f: 0..1 through one turn of the leaf, right to left
        leaf.visible = f > 0 && f < 1;
        if (!leaf.visible) return;
        const d = dims.d, psi = Math.PI * smooth(0, 1, f), N = 12;
        let x = dims.t / 2 + 0.002, z = 0;
        for (let i = 0; i <= N; i++) {
          if (i > 0) { const th = psi + 0.7 * Math.sin(psi) * (i / N) - 0.15 * Math.sin(psi * 2) * (i / N); x += Math.sin(th) * d / N; z += -Math.cos(th) * d / N; }
          lp.setXYZ(i, x, -0.5 * dims.h * 0.98, z); lp.setXYZ(N + 1 + i, x, 0.5 * dims.h * 0.98, z);
        }
        lp.needsUpdate = true; leafGeo.computeVertexNormals(); leafGeo.computeBoundingSphere();
      },
      edge(f, dims, out) {    // where the turning corner is (for the hand that turns it)
        const psi = Math.PI * smooth(0, 1, f), th = psi + 0.35 * Math.sin(psi);
        return out.set(dims.t / 2 + 0.003 + Math.sin(th) * dims.d * 0.92, -dims.h * 0.3, -Math.cos(th) * dims.d * 0.92);
      }
    };
  }

  /* ---------------- building one figure ---------------- */
  const grp = (parent, x, y, z) => { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; };
  function build(id) {
    id = ALIAS[id] || id;
    if (!LOOKS[id]) id = 'douglass';
    const L = LOOKS[id], R = recipe(id, L);
    const k = L.h / 1.75;
    const root = new T.Group();
    const body = grp(root); body.scale.setScalar(k);
    const hips = grp(body, 0, 0.92, 0), torso = grp(hips, 0, 0.1, 0), chest = grp(torso);
    const neck = grp(torso, 0, 0.42, -0.008), head = grp(neck, 0, 0.11, 0.006), skull = grp(head, 0, 0.075, 0.012);
    skull.scale.setScalar(R.headK);
    const bones = { hips, torso, chest, neck, head, skull };
    const arms = [-1, 1].map(s => { const sh = grp(torso, s * R.SH, 0.38, -0.012), el = grp(sh, 0, -0.29, 0), wr = grp(el, 0, -0.255, 0); bones['sh' + s] = sh; bones['el' + s] = el; bones['wr' + s] = wr; return { s, sh, el, wr }; });
    const legs = [-1, 1].map(s => { const hip = grp(hips, s * 0.09, 0, 0), knee = grp(hip, 0, -0.43, 0), ankle = grp(knee, 0, -0.42, 0); bones['hip' + s] = hip; bones['knee' + s] = knee; bones['ankle' + s] = ankle; return { s, hip, knee, ankle }; });
    const tagged = {};
    for (const p of R.parts) { const m = new T.Mesh(p.geo, p.mat); bones[p.bone].add(m); if (p.tag) tagged[p.tag] = m; }
    arms.forEach(a => { a.handMesh = tagged['hand' + a.s]; });
    // eyes that look about, and the lids over them
    const eyes = [-1, 1].map(s => { const m = new T.Mesh(R.eye.geo, R.eye.mat); m.position.set(s * R.eye.C.x, R.eye.C.y, R.eye.C.z); skull.add(m); return m; });
    const lidG = grp(skull, 0, R.lids.y, R.lids.z); lidG.add(new T.Mesh(R.lids.geo, R.lids.mat));
    // skirts, coat skirts
    const drapes = R.drapes.map(c => { const d = drape(c); hips.add(d.mesh); return d; });
    // the hand main.js gives the book to: carried in the right hand, opened in both to read
    const holder = new T.Group(); holder.userData.hand = true; torso.add(holder);
    const ob = openBook(); holder.add(ob.grp);
    const av = {
      id, root, head, hand: holder, info: LIST.find(x => x.id === id), height: L.h,
      st: { speed: 0, sit: false, read: false, listen: false }, t: Math.random() * 20, seed: Math.random() * 10,
      phase: 0, sitK: 0, readK: 0, walkK: 0, blinkT: 1 + Math.random() * 3, lookT: 0, look: [0, 0], lookTo: [0, 0], gaze: [0, 0],
      pageT: 4 + Math.random() * 6, flip: -1,
      setState(s) { Object.assign(this.st, s); },
      update(dt) { pose(this, dt); }
    };
    av._r = { body, hips, torso, chest, neck, head, skull, arms, legs, eyes, lidG, drapes, holder, ob, k, L, R, fem: R.fem };
    av.update(0);
    return av;
  }

  /* ---------------- moving: walk, stand, sit, read, breathe, look about ---------------- */
  const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion(), _e = new T.Euler(), _m = new T.Matrix4(), _m2 = new T.Matrix4();
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _u = new T.Vector3(), _f = new T.Vector3(), _w = new T.Vector3(), _x = new T.Vector3(), _y = new T.Vector3(), _z = new T.Vector3();
  const _tg = [new T.Vector3(), new T.Vector3()], _N = new T.Vector3(), _Fd = new T.Vector3(), _hp = new T.Vector3(), _hq = new T.Quaternion(), _one = new T.Vector3(1, 1, 1);
  const _bx = new T.Vector3(), _by = new T.Vector3(), _bz = new T.Vector3(), _ed = new T.Vector3(), _inv = new T.Matrix4(), _pole = new T.Vector3(), _rq = new T.Quaternion();
  const UA = 0.29, FA = 0.255;
  // two-bone reach from the shoulder (torso space) to a wrist target: the upper arm's turn and the elbow's bend
  function reach(arm, target, pole, qOut) {
    const S = arm.sh.position;
    _a.subVectors(target, S); let d = _a.length();
    d = clamp(d, 0.06, UA + FA - 0.002); _a.normalize();
    const A = Math.acos(clamp((UA * UA + d * d - FA * FA) / (2 * UA * d), -1, 1));
    _b.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
    _u.copy(_a).multiplyScalar(Math.cos(A)).addScaledVector(_b, Math.sin(A));
    _c.copy(S).addScaledVector(_u, UA);
    _f.copy(S).addScaledVector(_a, d).sub(_c).normalize();
    _w.copy(_f).addScaledVector(_u, -_f.dot(_u));
    if (_w.lengthSq() < 1e-8) _w.set(0, 0, 1); _w.normalize();
    _y.copy(_u).negate(); _x.crossVectors(_y, _w);
    _m.makeBasis(_x, _y, _w); qOut.setFromRotationMatrix(_m);
    return Math.acos(clamp(_u.dot(_f), -1, 1));
  }
  // the wrist's turn that puts the palm toward N with the fingers along Fd (both torso space)
  function wristTo(arm, qSh, elx, N, Fd, qOut) {
    _y.copy(Fd).negate().normalize();
    _x.copy(N).multiplyScalar(-arm.s); _x.addScaledVector(_y, -_x.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z); _hq.setFromRotationMatrix(_m);
    _q3.copy(qSh).multiply(_q2.setFromEuler(_e.set(elx, 0, 0)));
    return qOut.copy(_q3.invert()).multiply(_hq);
  }
  function pose(av, dt) {
    const r = av._r, st = av.st, L = r.L, k = r.k, fem = r.fem;
    dt = Math.min(dt, 0.1);
    av.t += dt;
    const t = av.t, still = av._still;
    const ease = (cur, want, rate) => cur + (want - cur) * Math.min(1, dt * rate);
    av.sitK = still ? (st.sit ? 1 : 0) : ease(av.sitK, st.sit ? 1 : 0, 4.5);
    av.readK = still ? (st.read ? 1 : 0) : ease(av.readK, st.read ? 1 : 0, 3.5);
    const sp = Math.min(3.5, st.speed || 0);
    av.walkK = ease(av.walkK, sp > 0.08 ? Math.min(1, sp / 1.1) : 0, 6);
    const sk = smooth(0, 1, av.sitK), rk = smooth(0, 1, av.readK), w = av.walkK * (1 - sk);
    const stepLen = (fem && r.drapes.length ? 0.58 : 0.72) * k;
    av.phase += dt * (sp > 0.05 ? Math.PI * sp / stepLen : 0);
    const ph = av.phase, s1 = Math.sin(ph), c1 = Math.cos(ph);
    const br = Math.sin(t * 1.5 + av.seed), sway = Math.sin(t * 0.41 + av.seed * 3);
    const book = r.holder.children.find(c => c.userData.pick && c.userData.pick.kind === 'book');
    const listen = !!st.listen;

    /* body: hips, legs */
    const amp = (fem ? 0.3 : 0.42) * Math.pow(Math.min(1.6, sp / 1.3), 0.7);
    const hipsUp = 0.92 + (Math.abs(c1) * 0.022 - 0.012) * w - 0.004 * (1 - w) * Math.abs(sway);
    const seatY = 0.54 / k;
    r.hips.position.set(0.012 * sway * (1 - w) * (1 - sk), lerp(hipsUp, seatY, sk), lerp(0, -0.07, sk));
    r.hips.rotation.set(0, s1 * 0.07 * w, (0.026 * sway * (1 - w) + s1 * 0.035 * w) * (1 - sk));
    const zk = [0, 0];
    r.legs.forEach((lg, i) => {
      const fwd = (i === 0 ? s1 : -s1);                      // the right leg leads on the up-swing
      const swingUp = Math.max(0, i === 0 ? c1 : -c1);
      let hx = -fwd * amp * w, kx = (swingUp * 1.05 * amp / 0.42 + 0.05) * w + (1 - w) * 0.03 * Math.max(0, (i ? -1 : 1) * sway) * 2;
      let ax = -(hx + kx) * 0.85 + (w * Math.max(0, -fwd) * 0.25 * amp);
      // seated: thighs forward to the seat's edge, feet on the floor
      if (sk > 0) {
        const H = seatY, tz = 0.4 + 0.02 * i, ty = 0.07 - H;
        const dd = Math.min(Math.hypot(tz, ty), 0.849);
        const g = Math.atan2(tz, -ty), A = Math.acos(clamp((0.43 * 0.43 + dd * dd - 0.42 * 0.42) / (2 * 0.43 * dd), -1, 1));
        const Bk = Math.acos(clamp((0.43 * 0.43 + 0.42 * 0.42 - dd * dd) / (2 * 0.43 * 0.42), -1, 1));
        const shx = -(g + A), skx = Math.PI - Bk;
        hx = lerp(hx, shx, sk); kx = lerp(kx, skx, sk); ax = lerp(ax, -(shx + skx), sk);
      }
      lg.hip.rotation.set(hx, 0, -r.hips.rotation.z + lg.s * lerp(0.015, 0.05, sk));
      lg.knee.rotation.x = kx; lg.ankle.rotation.x = ax;
      zk[i] = -Math.sin(hx) * 0.43 * (1 - sk);
    });
    r.drapes.forEach(d => d.update(sk, zk, -r.hips.position.y));

    /* torso: lean, counter-turn, breath */
    r.torso.rotation.set(0.05 * w * Math.min(1, sp / 1.6) + lerp(0, -0.07, sk) + rk * lerp(0.05, 0.1, sk) - 0.01 * br, -s1 * 0.11 * w, -r.hips.rotation.z * 0.85);
    r.chest.scale.set(1 + 0.004 * br, 1 + 0.003 * br, 1 + 0.009 * br);
    r.chest.position.y = 0.0015 * br;
    r.torso.updateMatrix();

    /* where the hands go: hanging and swinging, on the thighs, or holding the book open */
    const readNow = rk > 0.001 && book;
    let dims = null;
    if (book) { dims = r.ob.fit(book); }
    const bt = dims ? dims : { t: 0.03, h: 0.22, d: 0.15 };
    // the open book's place in front of the chest (torso space, body units)
    const tilt = lerp(0.95, 0.85, sk) - (listen ? 0.5 : 0);
    _bx.set(0, Math.sin(tilt), -Math.cos(tilt));                 // the page faces the eyes
    _by.set(0, Math.cos(tilt), Math.sin(tilt));
    _bz.crossVectors(_bx, _by);
    const bookPos = _c.set(0, lerp(0.22, 0.2, sk) - (listen ? 0.12 : 0), lerp(0.3, 0.29, sk));
    const readPos = _hp.copy(bookPos), readQ = _rq.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
    // a page turns now and then (the right hand takes the corner over)
    let flipF = -1;
    if (readNow && rk > 0.9 && !listen) {
      av.pageT -= dt;
      if (av.pageT <= 0 && av.flip < 0) { av.flip = 0; av.pageT = 8 + Math.random() * 9; }
    }
    if (av.flip >= 0) { av.flip += dt / 1.5; if (av.flip >= 1 || !readNow) av.flip = -1; else flipF = av.flip; }
    const turnF = flipF >= 0 ? clamp((flipF - 0.12) / 0.7, 0, 1) : 0, reachK = flipF >= 0 ? smooth(0, 0.14, flipF) * smooth(1, 0.82, flipF) : 0;
    r.ob.grp.visible = !!(readNow && rk > 0.55 && !listen);
    if (dims && r.ob.grp.visible) r.ob.turn(flipF >= 0 ? turnF : 0, dims);
    const toTorso = (pLocal, out) => out.copy(pLocal).divideScalar(k).applyQuaternion(readQ).add(readPos);
    r.arms.forEach((arm, i) => {
      const s = arm.s, opp = i === 0 ? -s1 : s1;      // each arm swings with the other leg
      // the hanging arm
      const carry = i === 0 && book && rk < 0.999;
      let fx = opp * -0.38 * w * Math.min(1.4, 0.6 + sp * 0.4) + 0.025 * br * (1 - w) - (carry ? 0.08 : 0);
      let fz = s * (0.075 + 0.02 * w + (carry ? 0.09 : 0)) + s * 0.01 * br;
      let fe = -0.16 - 0.32 * w * Math.max(0, -opp) - (carry ? 0.12 : 0) - 0.03 * Math.abs(sway);
      arm.sh.quaternion.setFromEuler(_e.set(fx, 0, fz));
      const qFK = _q2.copy(arm.sh.quaternion);
      let ex = fe, ikw = 0;
      const tgt = _tg[i];
      // seated: hands rest on the thighs, near the knees
      if (sk > 0) {
        const lg = r.legs[i];
        _a.set(0, -1, 0).applyEuler(lg.hip.rotation).multiplyScalar(0.27);
        tgt.set(lg.hip.position.x * 0.8 - s * 0.01, 0.085, 0).add(_a).add(r.hips.position).sub(r.hips.position);
        _inv.copy(r.torso.matrix).invert(); tgt.applyMatrix4(_inv);
        tgt.y += 0.03;
        ikw = sk;
      }
      if (readNow) {
        // behind the book near its outer edge, the thumb hooked round onto the page
        _ed.set(-bt.t / 2 - 0.014, -bt.h * 0.12, s * (bt.d - 0.03));
        if (i === 0 && reachK > 0) { r.ob.edge(turnF, bt, _b); _ed.lerp(_b.add(_a.set(0.012, 0, 0)), reachK); }
        toTorso(_ed, _b);
        _N.set(1, 0, 0).applyQuaternion(readQ);
        _Fd.set(-0.15, 0.95, -s * 0.25).applyQuaternion(readQ).normalize();
        _b.addScaledVector(_Fd, -0.058).addScaledVector(_N, -0.012);
        if (sk > 0) tgt.lerp(_b, rk); else tgt.copy(_b);
        ikw = Math.max(ikw, rk);
      }
      if (ikw > 0) {
        _pole.set(s * 0.6, -1, -0.25).normalize();
        const bend = reach(arm, tgt, _pole, _q3);
        arm.sh.quaternion.slerpQuaternions(qFK, _q3, ikw);
        ex = lerp(fe, -bend, ikw);
      }
      arm.el.rotation.set(ex, 0, 0);
      // the wrist
      arm.wr.quaternion.setFromEuler(_e.set(0.06 + 0.04 * w, 0, -s * 0.05));
      if (ikw > 0) {
        if (readNow && rk > 0) { _N.set(1, 0, 0).applyQuaternion(readQ); _Fd.set(-0.15, 0.95, -s * 0.25).applyQuaternion(readQ).normalize(); }
        else { const lg = r.legs[i]; _Fd.set(0, -1, 0).applyEuler(lg.hip.rotation).applyQuaternion(_q.copy(r.torso.quaternion).invert()); _Fd.y -= 0.35; _N.set(0, -1, 0.15).applyQuaternion(_q); }
        if (!(readNow && rk > 0) && sk <= 0) {} else {
          wristTo(arm, arm.sh.quaternion, ex, _N, _Fd, _q3);
          arm.wr.quaternion.slerp(_q3, ikw);
        }
      }
      if (arm.handMesh) arm.handMesh.morphTargetInfluences[0] = readNow ? lerp(carry ? 1 : 0.2, 0.75, rk) : carry ? 1 : lerp(0.12, 0.3, sk) + 0.05 * br;
    });

    /* the book: in the right hand, or open in both */
    const hd = r.holder;
    if (book) {
      const arm = r.arms[0];
      arm.sh.updateMatrix(); arm.el.updateMatrix(); arm.wr.updateMatrix();
      _m.copy(arm.sh.matrix).multiply(arm.el.matrix).multiply(arm.wr.matrix);
      _m2.compose(_a.set(-arm.s * (0.018 + bt.t / 2 / k), -0.07 - bt.d * 0.32 / k, 0.012), _q2.setFromEuler(_e.set(Math.PI / 2, 0, 0)), _one);
      _m.multiply(_m2);
      _m.decompose(_a, _q2, _b);
      hd.position.lerpVectors(_a, readPos, rk);
      hd.quaternion.slerpQuaternions(_q2, readQ, rk);
    } else { hd.position.set(0, 0, 0.1); hd.quaternion.identity(); }
    hd.scale.setScalar(1 / k);

    /* head and eyes: look about; down to the page; blink */
    av.lookT -= dt;
    if (av.lookT <= 0 && !still) {
      const far = Math.random() < 0.3, calm = L.calm || 1;            // Harriet Bailey 'remarkably sedate in her manners'
      av.lookT = (1.6 + Math.random() * (far ? 2.5 : 4.5)) / calm;
      av.lookTo[0] = (Math.random() * 2 - 1) * (far ? 0.62 : 0.24) * (1 - 0.6 * w) * (0.5 + 0.5 * calm);
      av.lookTo[1] = (Math.random() * 2 - 1) * 0.1 - 0.02;
      if (far && av.blinkT > 0.3) av.blinkT = 0.02;
    }
    const reading = readNow && !listen ? rk : 0;
    const wantYaw = still ? 0 : lerp(av.lookTo[0], 0, reading), wantPitch = still ? 0 : lerp(av.lookTo[1], 0.12, reading);
    av.gaze[0] = ease(av.gaze[0], wantYaw, 16); av.gaze[1] = ease(av.gaze[1], wantPitch, 16);
    av.look[0] = ease(av.look[0], wantYaw, 2.6); av.look[1] = ease(av.look[1], wantPitch, 2.6);
    const line = (t * 0.38) % 1, scan = reading * (line < 0.88 ? lerp(0.13, -0.13, line / 0.88) : lerp(-0.13, 0.13, (line - 0.88) / 0.12));
    r.neck.rotation.set(0.1 + reading * 0.16 + (listen ? -0.03 : 0) * rk, av.look[0] * 0.25, 0);
    r.head.rotation.set(-0.1 + av.look[1] + reading * 0.24 + 0.008 * br, av.look[0] * 0.75 + scan * 0.18 - s1 * 0.09 * w, sway * 0.02 * (1 - w));
    const ey = clamp((av.gaze[0] - av.look[0]) * 1.3 + scan, -0.42, 0.42), epx = clamp((av.gaze[1] - av.look[1]) * 1.2 + reading * 0.3, -0.3, 0.45);
    r.eyes.forEach(e => e.rotation.set(epx, ey, 0));
    av.blinkT -= dt;
    let lid = 0;
    if (!still && av.blinkT < 0) {
      const b = -av.blinkT;
      lid = b < 0.05 ? b / 0.05 : b < 0.09 ? 1 : b < 0.19 ? 1 - (b - 0.09) / 0.1 : 0;
      if (b >= 0.19) av.blinkT = Math.random() < 0.15 ? 0.08 : 2 + Math.random() * 4.5;
    }
    r.lidG.rotation.x = lerp(Math.max(0, epx) * 0.75 + 0.04, 1.02, lid);
  }

  /* ---------------- portraits for the menu ---------------- */
  // drawn through the game's own canvas (same tone mapping and colour output as the room), then copied out
  function portrait(renderer, id, w, h) {
    w = w || 240; h = h || 320;
    const sc = new T.Scene();
    sc.add(new T.HemisphereLight(0xfff0d8, 0x2a1a10, 1.0));
    const key = new T.DirectionalLight(0xffdcae, 2.5); key.position.set(1.6, 2.0, 3); sc.add(key);
    const fill = new T.DirectionalLight(0xffc890, 0.6); fill.position.set(-2, 0.5, 2); sc.add(fill);
    const rim = new T.DirectionalLight(0x8fa8ff, 2.0); rim.position.set(-2.5, 2, -2); sc.add(rim);
    const av = build(id); sc.add(av.root);
    av._still = true; av.root.rotation.y = -0.32; av.update(0);
    av.root.updateMatrixWorld(true);
    const hc = new T.Vector3(); av._r.skull.getWorldPosition(hc);
    const cam = new T.PerspectiveCamera(20, w / h, 0.05, 20);
    cam.position.set(0.2, hc.y - 0.01, 1.45); cam.lookAt(0, hc.y - 0.1, 0);
    const size = renderer.getSize(new T.Vector2()), pr = renderer.getPixelRatio();
    const pc = new T.Color(); renderer.getClearColor(pc); const pa = renderer.getClearAlpha();
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(sc, cam);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0, w, h);
    renderer.setClearColor(pc, pa); renderer.setPixelRatio(pr); renderer.setSize(size.x, size.y, false);
    return c.toDataURL('image/png');
  }

  // a saved or remote reader id as one of LIST (an earlier reader's id becomes who stands in their place)
  const resolve = (id) => { id = ALIAS[id] || id; return LOOKS[id] && LIST.some(p => p.id === id) ? id : 'douglass'; };

  return { LIST, ALIAS, build, portrait, resolve };
})();
