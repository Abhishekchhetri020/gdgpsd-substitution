/* GDGPSD Substitution — Milky Way engine + constellation + UI (desktop-first, vanilla) */
(() => {
'use strict';

const reducedMotion = window.matchMedia('(prefers-motion-reduce: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TAU = Math.PI * 2;
const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
const SharedSpin = { value: 0 };   // mouse-drag rotation shared with the hero system

/* Spectral star palette (weighted blue-white → rare orange giants) */
function starColor() {
  const r = Math.random();
  if (r < 0.18) return '#9db4ff';
  if (r < 0.38) return '#cad8ff';
  if (r < 0.64) return '#ffffff';
  if (r < 0.78) return '#fff4e8';
  if (r < 0.90) return '#ffd9a0';
  if (r < 0.96) return '#ffbb7a';
  return '#ff9a5a';
}

/* deterministic pseudo-random from a seed */
function srand01(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ORB_PALETTES = {
  ember:  { hi: '#f2d9a8', mid: '#b07a3e', lo: '#4a2c14', night: '#060402', glow: '216,150,80',  bands: true,  storm: true,  atmo: '255,190,120' },
  ice:    { hi: '#dcf4ff', mid: '#6fb6d9', lo: '#1d4a63', night: '#020608', glow: '110,200,235', bands: true,  storm: false, atmo: '170,220,255' },
  rock:   { hi: '#e6bda3', mid: '#96604a', lo: '#3a2118', night: '#050303', glow: '200,130,100', bands: false, storm: false, atmo: '200,140,110' },
  gold:   { hi: '#f6e7bd', mid: '#c9a45c', lo: '#5d4a1e', night: '#070502', glow: '232,200,126', bands: true,  storm: false, atmo: '240,210,140' },
  giant:  { hi: '#f6ead0', mid: '#c8ab72', lo: '#5f4a20', night: '#030303', glow: '216,190,140', bands: true,  storm: true,  atmo: '230,200,150' },
  earth:  { hi: '#cfeaff', mid: '#2f6fb4', lo: '#0b2c55', night: '#01040a', glow: '120,180,255', bands: false, storm: false, atmo: '140,200,255' },
  mars:   { hi: '#f0a068', mid: '#b45a30', lo: '#4a2113', night: '#0b0503', glow: '255,150,100', bands: false, storm: false, atmo: '255,150,100' },
  violet: { hi: '#dccfff', mid: '#7c5cff', lo: '#2c1e63', night: '#050310', glow: '140,110,255', bands: false, storm: false, atmo: '170,140,255' }
};

/* ---- procedural 3D globes: equirectangular surface textures, sliced with
   true spherical foreshortening so the spin reads as real rotation ---- */
const TEX_W = 256, TEX_H = 128;
const texCache = {}, cloudCache = {};

/* photographic surfaces (NASA-grade maps, local files) with a procedural
   fallback that paints until the photo arrives — page never waits on them */
const TEX_FILES = {
  ember: 'jupitermap.jpg', ice: 'uranusmap.jpg', rock: 'mercurymap.jpg',
  gold: 'venusmap.jpg', violet: 'neptunemap.jpg', giant: 'saturnmap.jpg',
  earth: 'earth-blue-marble.jpg', mars: 'marsmap1k.jpg'
};
const texPhotos = {};
function photoTexture(type) {
  const f = TEX_FILES[type];
  if (!f) return null;
  let rec = texPhotos[type];
  if (!rec) {
    const img = new Image();
    rec = texPhotos[type] = { img, ok: false };
    img.onload = () => { rec.ok = true; };
    img.onerror = () => { rec.ok = false; };
    img.src = 'assets/tex/' + f;
  }
  return rec.ok ? rec.img : null;
}
function globeTexture(type) {
  return photoTexture(type) || proceduralTexture(type);
}
function proceduralTexture(type) {
  if (texCache[type]) return texCache[type];
  const pal = ORB_PALETTES[type] || ORB_PALETTES.gold;
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const R1 = i => srand01(i * 3.77 + type.length * 11.1);
  const bg = g.createLinearGradient(0, 0, 0, TEX_H);
  bg.addColorStop(0, pal.lo); bg.addColorStop(0.5, pal.mid); bg.addColorStop(1, pal.lo);
  g.fillStyle = bg; g.fillRect(0, 0, TEX_W, TEX_H);
  // seamless wrapped blob (drawn 3x so the texture seam never cuts a feature)
  const blob = (x, y, rx, ry, rot) => {
    for (const ox of [-TEX_W, 0, TEX_W]) {
      g.beginPath(); g.ellipse(x + ox, y, rx, ry, rot || 0, 0, TAU); g.fill();
    }
  };
  if (type === 'giant' || type === 'ember' || type === 'gold' || type === 'ice') {
    for (let i = 0; i < 10; i++) {
      const y0 = (i / 10) * TEX_H + (R1(i) - 0.5) * 6;
      g.fillStyle = type === 'ice'
        ? (i % 2 ? 'rgba(255,255,255,0.14)' : 'rgba(120,170,210,0.18)')
        : (i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.10)');
      g.fillRect(0, y0, TEX_W, TEX_H / 10 * (0.5 + R1(i + 40)));
    }
    if (type === 'giant' || type === 'ember') {
      g.fillStyle = 'rgba(245,220,175,0.9)';
      blob(TEX_W * 0.68, TEX_H * 0.62, 20, 11, -0.1);
      g.strokeStyle = 'rgba(120,70,35,0.6)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(TEX_W * 0.68, TEX_H * 0.62, 20, 11, -0.1, 0, TAU); g.stroke();
    }
  } else if (type === 'earth') {
    for (let i = 0; i < 9; i++) {
      const u0 = R1(i * 3 + 1) * TEX_W, v0 = TEX_H * 0.2 + R1(i * 3 + 2) * TEX_H * 0.6;
      for (let k = 0; k < 4; k++) {
        const uu = u0 + (R1(i * 9 + k) - 0.5) * 46, vv = v0 + (R1(i * 7 + k) - 0.5) * 26;
        g.fillStyle = (i + k) % 3 === 0 ? '#8a7a48' : '#2f6b3c';
        blob(uu, vv, 8 + R1(i + k * 3) * 16, 6 + R1(i * 2 + k) * 10, R1(k + i) * 3);
      }
    }
    g.fillStyle = 'rgba(245,250,255,0.95)';
    for (let x = 0; x < TEX_W; x += 4) {
      g.fillRect(x, 0, 4, 5 + R1(x) * 7);
      g.fillRect(x, TEX_H - 6 - R1(x + 999) * 8, 4, 14);
    }
  } else if (type === 'mars') {
    for (let i = 0; i < 7; i++) {
      g.fillStyle = 'rgba(70,28,14,0.5)';
      blob(R1(i * 5 + 1) * TEX_W, TEX_H * 0.3 + R1(i * 5 + 2) * TEX_H * 0.45,
           14 + R1(i) * 26, 8 + R1(i + 3) * 12, R1(i + 9));
    }
    g.strokeStyle = 'rgba(40,16,8,0.6)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(TEX_W * 0.3, TEX_H * 0.58); g.lineTo(TEX_W * 0.62, TEX_H * 0.52); g.stroke();
    g.fillStyle = 'rgba(250,250,252,0.95)';
    for (let x = 0; x < TEX_W; x += 4) g.fillRect(x, 0, 4, 4 + R1(x + 7) * 5);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = R1(i) < 0.5 ? 'rgba(255,190,140,0.10)' : 'rgba(90,35,18,0.12)';
      blob(R1(i * 3) * TEX_W, R1(i * 7) * TEX_H, 1 + R1(i * 11) * 2.5, 1 + R1(i * 11) * 2.5, 0);
    }
  } else if (type === 'violet') {
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(220,200,255,${(0.10 + R1(i) * 0.12).toFixed(3)})`;
      g.lineWidth = 5 + R1(i + 20) * 8;
      g.beginPath();
      g.moveTo(-10, TEX_H * R1(i * 3));
      g.bezierCurveTo(TEX_W * 0.3, TEX_H * R1(i * 3 + 1), TEX_W * 0.7, TEX_H * R1(i * 3 + 2), TEX_W + 10, TEX_H * R1(i * 3 + 3));
      g.stroke();
    }
  } else { // rock
    for (let i = 0; i < 46; i++) {
      g.fillStyle = 'rgba(0,0,0,0.30)';
      blob(R1(i * 3) * TEX_W, R1(i * 7) * TEX_H, 1.5 + R1(i * 11) * 5, 1.5 + R1(i * 11) * 5, 0);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = R1(i + 500) < 0.5 ? 'rgba(255,220,190,0.10)' : 'rgba(0,0,0,0.12)';
      blob(R1(i * 13 + 1) * TEX_W, R1(i * 17 + 2) * TEX_H, 1 + R1(i * 19) * 2, 1 + R1(i * 19) * 2, 0);
    }
  }
  const pd2 = g.createLinearGradient(0, 0, 0, TEX_H);
  pd2.addColorStop(0, 'rgba(0,0,0,0.30)'); pd2.addColorStop(0.2, 'rgba(0,0,0,0)');
  pd2.addColorStop(0.8, 'rgba(0,0,0,0)'); pd2.addColorStop(1, 'rgba(0,0,0,0.30)');
  g.fillStyle = pd2; g.fillRect(0, 0, TEX_W, TEX_H);
  texCache[type] = c;
  return c;
}

function cloudTexture(type) {
  if (type !== 'earth' && type !== 'giant' && type !== 'ice') return null;
  const c = document.createElement('canvas'); c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d');
  const n = type === 'earth' ? 30 : 18;
  for (let i = 0; i < n; i++) {
    const u = srand01(i * 3.3 + type.length) * TEX_W;
    const v = TEX_H * 0.15 + srand01(i * 7.1) * TEX_H * 0.7;
    g.fillStyle = `rgba(255,255,255,${(0.10 + srand01(i * 1.7) * 0.20).toFixed(3)})`;
    g.beginPath();
    g.ellipse(u, v, 12 + srand01(i * 5.9) * 30, 2.5 + srand01(i * 2.3) * 4, (srand01(i) - 0.5) * 0.4, 0, TAU);
    g.fill();
  }
  return c;
}

/* map one texture onto the disc in slices with asin foreshortening */
function paintTex(g, x, y, r, tex, rot, alpha) {
  const SL = 7;
  const TW = tex.naturalWidth || tex.width, TH = tex.naturalHeight || tex.height;
  const off = (((rot / TAU) % 1) + 1) % 1;
  g.save();
  if (alpha !== undefined) g.globalAlpha = alpha;
  for (let i = 0; i < SL; i++) {
    const x0 = -1 + (2 * i) / SL, x1 = -1 + (2 * (i + 1)) / SL;
    const u0 = (Math.asin(clamp(x0, -1, 1)) / Math.PI + 0.5 + off) % 1;
    const u1 = (Math.asin(clamp(x1, -1, 1)) / Math.PI + 0.5 + off) % 1;
    const dx = x + x0 * r, dw = (x1 - x0) * r;
    if (u1 > u0) {
      g.drawImage(tex, u0 * TW, 0, Math.max(1, (u1 - u0) * TW), TH, dx, y - r, dw, r * 2);
    } else {
      const span = u1 + 1 - u0, dw1 = dw * ((1 - u0) / span);
      g.drawImage(tex, u0 * TW, 0, Math.max(1, (1 - u0) * TW), TH, dx, y - r, dw1, r * 2);
      g.drawImage(tex, 0, 0, Math.max(1, u1 * TW), TH, dx + dw1, y - r, dw - dw1, r * 2);
    }
  }
  g.restore();
}

function paintGlobe(g, x, y, r, type, rot, t, seed) {
  const pal = ORB_PALETTES[type] || ORB_PALETTES.gold;
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
  paintTex(g, x, y, r, globeTexture(type), rot);
  const cl = cloudCache[type] || (cloudCache[type] = cloudTexture(type));
  if (cl) paintTex(g, x, y, r, cl, rot * 1.35 + seed + t * 0.02, 0.55);
  const light = g.createRadialGradient(x - r * 0.55, y - r * 0.6, r * 0.1, x - r * 0.15, y - r * 0.15, r * 2.1);
  light.addColorStop(0, 'rgba(255,255,255,0.30)');
  light.addColorStop(0.42, 'rgba(255,255,255,0)');
  light.addColorStop(0.70, 'rgba(0,0,0,0)');
  light.addColorStop(0.90, 'rgba(0,0,0,0.55)');
  light.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.fillStyle = light;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  if (type === 'earth' || type === 'giant' || type === 'ice' || type === 'violet' || type === 'gold') {
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.ellipse(x - r * 0.38, y - r * 0.42, r * 0.15, r * 0.09, -0.5, 0, TAU); g.fill();
  }
  g.restore();
  g.save();
  g.strokeStyle = `rgba(${pal.atmo},0.55)`;
  g.lineWidth = Math.max(1, r * 0.06);
  g.beginPath(); g.arc(x, y, r * 0.97, Math.PI * 0.55, Math.PI * 1.5); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = Math.max(1, r * 0.05);
  g.beginPath(); g.arc(x, y, r * 0.97, -Math.PI * 0.45, Math.PI * 0.5); g.stroke();
  g.restore();
}

/* half-angle (from the ansa) at which a ring of given radius exits the globe disc */
function ringExit(mult) {
  const k = 0.34, kr = k * mult;
  const c = Math.sqrt(Math.max(0.0001, (1 - kr * kr) / (mult * mult - kr * kr)));
  return Math.acos(clamp(c, 0, 1));
}

/* rings that dive BEHIND the globe: the front arc is drawn only outside the
   disc, and the travelling sunlight point never crosses the face */
function paintRings(g, x, y, r, t, seed, front) {
  const wob = Math.sin(t * 0.2 + seed) * 0.07;
  g.save();
  g.translate(x, y); g.rotate(-0.38 + wob); g.scale(1, 0.34);
  const dim = front ? 1 : 0.42;
  const bands = [[1.9, 0.12, '230,210,170', 0.55], [2.32, 0.07, '240,220,180', 0.34]];
  for (const [mult, lw, col, al] of bands) {
    const R = r * mult;
    g.strokeStyle = `rgba(${col},${(al * dim).toFixed(3)})`;
    g.lineWidth = Math.max(1, r * lw);
    if (front) {
      const lim = ringExit(mult);
      g.beginPath(); g.arc(0, 0, R, 0, lim); g.stroke();
      g.beginPath(); g.arc(0, 0, R, Math.PI - lim, Math.PI); g.stroke();
    } else {
      g.beginPath(); g.arc(0, 0, R, Math.PI, TAU); g.stroke();
    }
  }
  if (front) {
    const gnorm = ((t * 0.9 + seed * 2) % TAU + TAU) % TAU;
    if (gnorm <= Math.PI) {
      const lim = ringExit(1.9);
      g.strokeStyle = 'rgba(255,250,235,0.9)';
      g.lineWidth = Math.max(1.2, r * 0.13);
      g.lineCap = 'round';
      const segs = [[0, lim], [Math.PI - lim, Math.PI]];
      for (const [s0, s1] of segs) {
        const q0 = Math.max(gnorm - 0.45, s0), q1 = Math.min(gnorm + 0.45, s1);
        if (q1 - q0 > 0.05) { g.beginPath(); g.arc(0, 0, r * 1.9, q0, q1); g.stroke(); }
      }
    }
  }
  g.restore();
}

/* small realistic planet — shaded sphere, mouse-spun surface, occluded rings.
   rot = spin angle in radians (drag + slow auto-rotation). */
function drawOrbiter(g, x, y, r, type, t, seed, alpha, rot) {
  rot = rot || 0;
  const pal = ORB_PALETTES[type] || ORB_PALETTES.gold;
  const ringed = type === 'ember' || type === 'ice' || type === 'violet' || type === 'giant';
  g.save();
  g.globalAlpha = alpha;
  const halo = g.createRadialGradient(x, y, r * 0.8, x, y, r * 2.8);
  halo.addColorStop(0, `rgba(${pal.glow},0.35)`);
  halo.addColorStop(1, `rgba(${pal.glow},0)`);
  g.fillStyle = halo;
  g.beginPath(); g.arc(x, y, r * 2.8, 0, TAU); g.fill();
  if (ringed) paintRings(g, x, y, r, t, seed, false);
  paintGlobe(g, x, y, r, type, rot, t, seed);
  /* globe surface, clouds, daylight and atmosphere painted by paintGlobe() above */
  if (ringed) paintRings(g, x, y, r, t, seed, true);
  g.restore();
}

/* tiny moonlet circling a planet */
function drawMoonlet(g, x, y, r, t, seed, alpha) {
  const a = t * 1.3 + seed;
  const mx2 = x + Math.cos(a) * r * 2.8, my2 = y + Math.sin(a) * r * 2.8;
  g.save(); g.globalAlpha = alpha * 0.35; g.strokeStyle = '#9aa3b5'; g.lineWidth = 0.7;
  g.beginPath(); g.arc(x, y, r * 2.8, 0, TAU); g.stroke(); g.restore();
  const mr = Math.max(1.5, r * 0.28);
  const mg = g.createRadialGradient(mx2 - mr * 0.3, my2 - mr * 0.3, mr * 0.1, mx2, my2, mr * 1.2);
  mg.addColorStop(0, '#e8e8e8'); mg.addColorStop(0.6, '#8a8a8a'); mg.addColorStop(1, '#111111');
  g.save(); g.globalAlpha = alpha;
  g.fillStyle = mg; g.beginPath(); g.arc(mx2, my2, mr, 0, TAU); g.fill();
  g.restore();
}

function makeSprite(px) {
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  return [c, c.getContext('2d')];
}

/* ============================================================
   1. WHOLE-PAGE MILKY WAY — realistic deep sky
   ============================================================ */
function initGalaxy() {
  const cv = document.getElementById('galaxy');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;

  let W = 0, H = 0;
  let stars = [], band = [], sprinkle = [], lanes = [], nebs = [], brights = [], streams = [];
  let sprites = null, shiva = null;
  let meteors = [], rings = [];
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  let panX = 0, panY = 0, panTX = 0, panTY = 0;
  let dragging = false, moved = 0, lastPX = 0, lastPY = 0;
  let planetSpin = 0, planetSpinVel = 0;
  let scrollVel = 0, lastSY = window.scrollY || 0, lastSpawn = -10;

  const BAND_ANG = -28 * Math.PI / 180;

  /* ---- pre-rendered deep-sky bodies ---- */
  function buildSprites() {
    const m = Math.min(W, H);
    /* (giant planet is drawn live each frame via drawOrbiter — see draw() below) */

    /* (Mars is drawn live each frame as a 3D globe — see draw() below) */

    /* (top-left now hosts a living 3D Earth — drawn per frame below) */

    sprites = {};
    buildShiva();
  }

  /* Mahadev's presence — Adiyogi at night, tightly cropped to the face
     (Rajdweep nlb, CC BY-SA 4.0, via Wikimedia Commons; cropped + graded).
     Loaded async; the sky simply appears without him until he arrives. */
  function buildShiva() {
    const img = new Image();
    img.onload = () => { shiva = img; };
    img.onerror = () => { shiva = null; };
    img.src = 'assets/shiva.png';
  }

  function build() {
    const dpr = DPR();
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const area = W * H;
    const n = Math.round(clamp(area / 4200, 260, 700));
    stars = [];
    for (let i = 0; i < n; i++) {
      const depth = Math.random() < 0.55 ? 0.3 : (Math.random() < 0.6 ? 0.6 : 1);
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: rand(0.35, 0.6 + depth * 1.0),
        a: rand(0.28, 0.5 + depth * 0.5),
        tw: rand(0.4, 2.2), ph: Math.random() * TAU,
        depth, c: starColor()
      });
    }
    const diag = Math.hypot(W, H);
    const ax = Math.cos(BAND_ANG), ay = Math.sin(BAND_ANG);
    const cx = W * 0.5, cy = H * 0.40, bw = Math.min(W, H) * 0.16;
    band = [];
    for (let i = 0; i < 520; i++) {
      const t = rand(-0.55, 0.55) * diag, off = gauss() * bw;
      band.push({
        x: cx + ax * t - ay * off, y: cy + ay * t + ax * off,
        r: rand(0.3, 1.0), a: rand(0.12, 0.5),
        tw: rand(0.3, 1.4), ph: Math.random() * TAU,
        c: Math.random() < 0.25 ? '#e8c87e' : (Math.random() < 0.5 ? '#ffffff' : '#b9c8ff')
      });
    }
    lanes = [];
    for (let i = 0; i < 8; i++) {
      lanes.push({
        t: rand(-0.4, 0.4) * diag, off: gauss() * bw * 0.35,
        rx: rand(90, 260), ry: rand(14, 34),
        a: rand(0.28, 0.5)
      });
    }
    sprinkle = [];
    for (let i = 0; i < 130; i++) {
      const t = rand(-0.5, 0.5) * diag, off = gauss() * bw * 1.4;
      sprinkle.push({
        x: cx + ax * t - ay * off, y: cy + ay * t + ax * off,
        r: rand(0.5, 1.3), a: rand(0.35, 0.8),
        tw: rand(0.6, 2.4), ph: Math.random() * TAU, c: starColor()
      });
    }
    brights = [];
    for (let i = 0; i < 16; i++) {
      brights.push({
        x: Math.random() * W, y: Math.random() * H,
        r: rand(1.8, 3.1), spike: rand(22, 64),
        tw: rand(0.5, 1.5), ph: Math.random() * TAU,
        depth: rand(0.7, 1), c: starColor()
      });
    }
    // aether streams — slow luminous currents, Astra-like flow
    streams = [];
    const streamDefs = [
      { fx: 0.50, fy: 0.45, frx: 0.55, fry: 0.30, rot: -0.42, n: 30, sp: 0.050, sz: [1.0, 2.2], c: '232,200,126', a: 0.50, dir: 1 },
      { fx: 0.50, fy: 0.50, frx: 0.42, fry: 0.22, rot: -0.42, n: 28, sp: 0.042, sz: [0.8, 1.8], c: '150,190,255', a: 0.45, dir: -1 },
      { fx: 0.50, fy: 0.40, frx: 0.68, fry: 0.38, rot: -0.42, n: 34, sp: 0.030, sz: [0.7, 1.6], c: '255,250,238', a: 0.32, dir: 1 },
      { fx: 0.87, fy: 0.20, frx: 0.13, fry: 0.11, rot: 0.0,   n: 18, sp: 0.120, sz: [0.8, 1.6], c: '240,217,160', a: 0.55, dir: 1 }
    ];
    for (const sd of streamDefs) {
      for (let i = 0; i < sd.n; i++) {
        streams.push({
          cx: sd.fx * W, cy: sd.fy * H,
          rx: sd.frx * W, ry: sd.fry * H,
          rot: sd.rot, a0: (i / sd.n) * TAU + rand(-0.05, 0.05),
          sp: sd.sp * rand(0.85, 1.15), dir: sd.dir,
          r: rand(sd.sz[0], sd.sz[1]),
          tw: rand(0.6, 1.8), ph: Math.random() * TAU,
          c: sd.c, a: sd.a * rand(0.7, 1)
        });
      }
    }
    const m = Math.min(W, H);
    nebs = [
      { bx: 0.24, by: 0.30, r: 0.42, c: '43,92,255',   a: 0.10,  sp: 0.050, ph: 0.0 },
      { bx: 0.78, by: 0.22, r: 0.36, c: '124,92,255',  a: 0.090, sp: 0.040, ph: 2.1 },
      { bx: 0.60, by: 0.60, r: 0.48, c: '201,164,92',  a: 0.055, sp: 0.030, ph: 4.2 },
      { bx: 0.14, by: 0.76, r: 0.34, c: '43,120,200',  a: 0.070, sp: 0.045, ph: 1.2 },
      { bx: 0.88, by: 0.78, r: 0.30, c: '200,70,110',  a: 0.060, sp: 0.050, ph: 5.3 },
      { bx: 0.45, by: 0.12, r: 0.30, c: '60,180,170',  a: 0.045, sp: 0.038, ph: 3.0 }
    ].map(o => ({ ...o, rr: o.r * m }));

    buildSprites();
  }

  function spawnMeteor(t, x, y, spread) {
    const fromLeft = Math.random() < 0.5;
    const sp = rand(380, 720);
    meteors.push({
      x: x !== undefined ? x : rand(W * 0.15, W * 0.95),
      y: y !== undefined ? y : rand(-20, H * 0.35),
      vx: (fromLeft ? 1 : -1) * sp * (spread || 0.9),
      vy: sp * rand(0.3, 0.55),
      life: 0, max: rand(0.8, 1.4)
    });
    lastSpawn = t;
  }

  function wrap(v, max) { v %= max; return v < 0 ? v + max : v; }

  function draw(t, dt, scrollY) {
    ctx.clearRect(0, 0, W, H);
    // Mahadev's presence — vast, faint, breathing; dissolves as you scroll
    const heroF = clamp(1 - scrollY / (H * 0.85), 0, 1);
    if (shiva && shiva.complete && shiva.naturalWidth && heroF > 0.01) {
      const SW = Math.min(W, H) * 1.35;
      const SH = SW * (shiva.naturalHeight / shiva.naturalWidth);
      const bx = W * 0.5 - SW / 2 + (mx * 10 + panX) * 0.12;
      const by = H * 0.48 - SH / 2 + (my * 8 + panY) * 0.12;
      ctx.save();
      ctx.globalAlpha = (0.30 + 0.06 * Math.sin(t * 0.3)) * heroF;
      ctx.drawImage(shiva, bx, by, SW, SH);
      ctx.restore();
    }
    mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
    if (!dragging) { panTX *= 0.96; panTY *= 0.96; }
    panX += (panTX - panX) * 0.08; panY += (panTY - panY) * 0.08;
    planetSpinVel *= Math.pow(0.02, dt || 0.016);
    planetSpin += (dt || 0.016) * (0.06 + planetSpinVel * 10);
    scrollVel *= Math.pow(0.02, dt || 0.016);

    const diag = Math.hypot(W, H);
    const m = Math.min(W, H);

    ctx.save();
    ctx.translate(W * 0.5, H * 0.40);
    ctx.rotate(BAND_ANG);
    const bw = m * 0.34;
    const g = ctx.createLinearGradient(0, -bw, 0, bw);
    g.addColorStop(0, 'rgba(43,92,255,0)');
    g.addColorStop(0.40, 'rgba(43,92,255,0.075)');
    g.addColorStop(0.53, 'rgba(195,205,255,0.065)');
    g.addColorStop(0.66, 'rgba(201,164,92,0.05)');
    g.addColorStop(1, 'rgba(201,164,92,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-diag, -bw, diag * 2, bw * 2);
    ctx.restore();

    for (const nb of nebs) {
      const nx = nb.bx * W + Math.sin(t * nb.sp + nb.ph) * m * 0.03 + panX * 0.3;
      const ny = nb.by * H + Math.cos(t * nb.sp * 0.8 + nb.ph) * m * 0.03 + panY * 0.3;
      const rg = ctx.createRadialGradient(nx, ny, 0, nx, ny, nb.rr);
      rg.addColorStop(0, `rgba(${nb.c},${nb.a})`);
      rg.addColorStop(1, `rgba(${nb.c},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(nx - nb.rr, ny - nb.rr, nb.rr * 2, nb.rr * 2);
    }

    const ox = mx * 10 + panX, oy = my * 8 + panY;

    for (const s of band) {
      const y = wrap(s.y - scrollY * 0.02, H);
      const a = s.a * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph));
      ctx.globalAlpha = a; ctx.fillStyle = s.c;
      ctx.fillRect(s.x + ox * 0.5, y + oy * 0.3, s.r, s.r);
    }
    const ax = Math.cos(BAND_ANG), ay = Math.sin(BAND_ANG);
    const cx = W * 0.5, cy = H * 0.40;
    for (const L of lanes) {
      const lx = cx + ax * L.t - ay * L.off + ox * 0.5;
      const ly = wrap(cy + ay * L.t + ax * L.off - scrollY * 0.02, H) + oy * 0.3;
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(BAND_ANG); ctx.scale(1, L.ry / L.rx);
      const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, L.rx);
      dg.addColorStop(0, `rgba(0,0,0,${L.a})`); dg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(0, 0, L.rx, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const s of sprinkle) {
      const y = wrap(s.y - scrollY * 0.035, H);
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x + ox * 0.8, y + oy * 0.5, s.r, s.r);
    }
    for (const s of stars) {
      const drift = t * (1.5 * s.depth);
      const y = wrap(s.y - scrollY * 0.05 * s.depth + drift, H);
      const x = wrap(s.x + ox * s.depth, W);
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = s.c;
      const yy = y + oy * 0.6 * s.depth;
      if (s.r > 1.4) { ctx.beginPath(); ctx.arc(x, yy, s.r, 0, TAU); ctx.fill(); }
      else ctx.fillRect(x, yy, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    if (sprites) {
      const fl = (f, a) => Math.sin(t * f + a) * 9;
      // giant planet, fully live: occluded rings, travelling glint, mouse spin
      const PR = clamp(m * 0.15, 75, 150);
      drawOrbiter(ctx, 0.87 * W + ox * 0.4 + fl(0.10, 1), 0.20 * H + fl(0.13, 2), PR, 'giant', t, 7.7, 1, planetSpin);
      // living 3D Earth, top-left — continents, clouds and ice ride the spin
      const ER = clamp(m * 0.09, 50, 100);
      drawOrbiter(ctx, 0.15 * W + ox * 0.3, 0.22 * H + fl(0.08, 4), ER, 'earth', t, 3.1, 0.95, t * 0.05 + planetSpin * 0.5);
      // Mars, lower-left — rusted 3D globe turning with your drag
      const MR = clamp(m * 0.055, 30, 60);
      drawOrbiter(ctx, 0.09 * W + ox * 0.6 + fl(0.07, 0), 0.70 * H + fl(0.09, 3), MR, 'mars', t, 5.2, 0.95, t * 0.03 + planetSpin);
    }

    const streak = Math.min(46, Math.abs(scrollVel) * 0.09);
    for (const b of brights) {
      const y = wrap(b.y - scrollY * 0.06 * b.depth, H) + oy * 0.7 * b.depth;
      const x = wrap(b.x + ox * b.depth, W);
      const a = 0.65 + 0.35 * Math.sin(t * b.tw + b.ph);
      ctx.globalAlpha = a * 0.20;
      ctx.fillStyle = b.c;
      ctx.beginPath(); ctx.arc(x, y, b.r * 3.4, 0, TAU); ctx.fill();
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = b.c; ctx.lineWidth = 1; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - b.spike, y); ctx.lineTo(x + b.spike, y);
      ctx.moveTo(x, y - b.spike * 0.8); ctx.lineTo(x, y + b.spike * 0.8);
      ctx.stroke();
      ctx.globalAlpha = a * 0.30;
      ctx.beginPath();
      const d = b.spike * 0.4;
      ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
      ctx.moveTo(x - d, y + d); ctx.lineTo(x + d, y - d);
      ctx.stroke();
      if (streak > 3) {
        ctx.globalAlpha = Math.min(0.4, streak / 90);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + streak); ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // aether streams — luminous currents drifting along grand ellipses
    for (const s of streams) {
      const a = s.a0 + t * s.sp * s.dir;
      const ex = Math.cos(a) * s.rx, ey = Math.sin(a) * s.ry;
      const x = s.cx + ex * Math.cos(s.rot) - ey * Math.sin(s.rot) + ox * 0.4;
      const y = wrap(s.cy + ex * Math.sin(s.rot) + ey * Math.cos(s.rot) - scrollY * 0.02, H) + oy * 0.3;
      const al = s.a * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = `rgba(${s.c},${(al * 0.22).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, s.r * 3, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(${s.c},${al.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
    }

    if (!reducedMotion && dt > 0) {
      if ((t - lastSpawn > rand(3.5, 8) && meteors.length < 3) || (Math.abs(scrollVel) > 14 && meteors.length < 4 && Math.random() < 0.1))
        spawnMeteor(t);
    }
    meteors = meteors.filter(mt => (mt.life += dt) < mt.max);
    for (const mt of meteors) {
      mt.x += mt.vx * dt; mt.y += mt.vy * dt;
      const fade = Math.sin((mt.life / mt.max) * Math.PI);
      const tx = mt.x - mt.vx * 0.35, ty = mt.y - mt.vy * 0.35;
      const lg = ctx.createLinearGradient(mt.x, mt.y, tx, ty);
      lg.addColorStop(0, `rgba(255,250,235,${0.9 * fade})`);
      lg.addColorStop(0.4, `rgba(232,200,126,${0.45 * fade})`);
      lg.addColorStop(1, 'rgba(232,200,126,0)');
      ctx.strokeStyle = lg; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(mt.x, mt.y); ctx.lineTo(tx, ty); ctx.stroke();
    }

    rings = rings.filter(r => (r.life += dt) < r.max);
    for (const r of rings) {
      const p = r.life / r.max, e = 1 - Math.pow(1 - p, 2);
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.strokeStyle = '#f0d9a0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, 6 + e * 90, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  build();
  if (reducedMotion) { draw(2.3, 0, window.scrollY || 0); }
  else {
    let last = performance.now(), rT = 0;
    const loop = now => {
      const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
      rT += dt;
      draw(rT, dt, window.scrollY || 0);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---- interactivity: parallax, drag-pan, click meteors ---- */
  const interactive = el => !(el && el.closest && el.closest('a,button,.card,.demo-shell,input,select,textarea,iframe'));
  window.addEventListener('pointermove', e => {
    tmx = (e.clientX / window.innerWidth - 0.5) * 2;
    tmy = (e.clientY / window.innerHeight - 0.5) * 2;
    if (dragging) {
      const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
      panTX = clamp(panTX + dx * 0.5, -70, 70);
      panTY = clamp(panTY + dy, -70, 70);
      // horizontal drag spins the planets; the hero system follows too
      planetSpinVel = clamp(planetSpinVel + dx * 0.0035, -0.09, 0.09);
      SharedSpin.value += dx * 0.0022;
      moved += Math.abs(dx) + Math.abs(dy);
      lastPX = e.clientX; lastPY = e.clientY;
    }
  }, { passive: true });
  window.addEventListener('pointerdown', e => {
    if (!interactive(e.target)) return;
    dragging = true; moved = 0;
    lastPX = e.clientX; lastPY = e.clientY;
  }, { passive: true });
  window.addEventListener('pointerup', e => {
    if (dragging && moved < 6 && interactive(e.target) && !reducedMotion) {
      spawnMeteor(performance.now() / 1000, e.clientX, e.clientY, 0.7);
      if (rings.length < 5) rings.push({ x: e.clientX, y: e.clientY, life: 0, max: 0.7 });
    }
    dragging = false;
  }, { passive: true });
  window.addEventListener('scroll', () => {
    const y = window.scrollY || 0;
    scrollVel = clamp((y - lastSY) * 2.2, -60, 60) * 0.4 + scrollVel * 0.6;
    lastSY = y;
  }, { passive: true });

  let rsz;
  window.addEventListener('resize', () => {
    clearTimeout(rsz);
    rsz = setTimeout(() => { build(); if (reducedMotion) draw(2.3, 0, window.scrollY || 0); }, 200);
  }, { passive: true });
}

/* ============================================================
   2. HERO CONSTELLATION — stars form the school name,
      five planets orbit it on visible paths
   ============================================================ */
function initConstellation() {
  const wrapEl = document.querySelector('.constellation-wrap');
  const cv = document.getElementById('constellation');
  if (!wrapEl || !cv) return () => {};
  const ctx = cv.getContext('2d');
  if (!ctx) { document.body.classList.add('no-constellation'); return () => {}; }

  const L1 = 'GD GOENKA', L2 = 'DARBHAANGA';
  let parts = [], orbiters = [], raf = 0, running = false, visible = true, t0 = 0;
  let mmx = -9999, mmy = -9999;
  let W = 0, H = 0;

  function sampleTargets() {
    const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
    if (!w || !h) return null;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const o = off.getContext('2d', { willReadFrequently: true });
    if (!o) return null;
    o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'alphabetic';
    try { o.letterSpacing = '6px'; } catch (e) {}
    const s = Math.min(w * 0.105, 140);   // both lines, one size
    o.font = `700 ${s}px "Space Grotesk", Inter, Arial, sans-serif`;
    const y1 = h * 0.5 - s * 0.42;
    o.fillText(L1, w / 2, y1);
    try { o.letterSpacing = '12px'; } catch (e) {}
    o.fillText(L2, w / 2, y1 + s * 1.45);
    let data;
    try { data = o.getImageData(0, 0, w, h).data; }
    catch (e) { return null; }
    const step = 3, pts = [];
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step)
        if (data[(y * w + x) * 4 + 3] > 128) pts.push([x, y]);
    const MAX = 2200;
    if (pts.length > MAX) {
      const stride = Math.ceil(pts.length / MAX);
      return pts.filter((_, i) => i % stride === 0);
    }
    return pts;
  }

  function scatterStart(side, w, h) {
    if (side === 0) return [rand(-40, w + 40), -30];
    if (side === 1) return [w + 30, rand(-40, h + 40)];
    if (side === 2) return [rand(-40, w + 40), h + 30];
    return [-30, rand(-40, h + 40)];
  }

  function buildOrbiters() {
    const defs = [
      { fx: 0.46, fy: 0.40, size: 22, sp: 0.110, ph: 0.0, type: 'ember',  dir: 1,  moon: false },
      { fx: 0.38, fy: 0.33, size: 14, sp: 0.160, ph: 2.2, type: 'ice',    dir: -1, moon: false },
      { fx: 0.30, fy: 0.44, size: 10, sp: 0.220, ph: 4.0, type: 'rock',   dir: 1,  moon: true },
      { fx: 0.42, fy: 0.28, size: 12, sp: 0.135, ph: 1.1, type: 'gold',   dir: 1,  moon: false },
      { fx: 0.34, fy: 0.38, size: 16, sp: 0.085, ph: 5.3, type: 'violet', dir: -1, moon: false }
    ];
    orbiters = defs.map((d, i) => ({ ...d, rx: d.fx * W, ry: d.fy * H, seed: i * 3.7 + 1.3 }));
  }

  function orbiterPos(o, t) {
    const a = o.ph + o.dir * (t * o.sp + SharedSpin.value * 0.6);
    return [W / 2 + Math.cos(a) * o.rx, H / 2 + Math.sin(a) * o.ry, Math.sin(a)];
  }

  function build() {
    const dpr = DPR();
    W = wrapEl.clientWidth; H = wrapEl.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = sampleTargets();
    if (!pts || !pts.length) { document.body.classList.add('no-constellation'); return false; }
    document.body.classList.remove('no-constellation');
    parts = pts.map(([tx, ty], i) => {
      const r = Math.random();
      const col = r < 0.55 ? '255,248,231' : (r < 0.80 ? '232,200,126' : '188,208,255');
      const [sx, sy] = scatterStart(i % 4, W, H);
      return {
        sx, sy, tx, ty,
        delay: (i / pts.length) * 0.9 + rand(0, 0.35),
        dur: rand(1.2, 2.1),
        size: rand(0.9, 2.5), col,
        tw: rand(1, 3.2), ph: Math.random() * TAU,
        done: false
      };
    });
    buildOrbiters();
    t0 = performance.now();
    return true;
  }

  function frame(now) {
    if (!running) return;
    const el = (now - t0) / 1000;
    const t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    const orbitA = clamp((el - 3.4) / 2.2, 0, 1);

    if (orbitA > 0.01) {
      ctx.save();
      ctx.globalAlpha = orbitA;
      ctx.strokeStyle = 'rgba(201,164,92,0.16)';
      ctx.lineWidth = 1;
      for (const o of orbiters) {
        ctx.beginPath(); ctx.ellipse(W / 2, H / 2, o.rx, o.ry, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      for (const o of orbiters) {
        const [px2, py2, s] = orbiterPos(o, t);
        if (s < 0) {
          drawOrbiter(ctx, px2, py2, o.size, o.type, t, o.seed, orbitA * 0.85, t * 0.3 + o.seed + SharedSpin.value);
          if (o.moon) drawMoonlet(ctx, px2, py2, o.size, t, o.seed, orbitA * 0.85);
        }
      }
    }

    let allDone = true;
    for (const p of parts) {
      const lt = clamp((el - p.delay) / p.dur, 0, 1);
      const e = 1 - Math.pow(1 - lt, 3);
      let x = p.sx + (p.tx - p.sx) * e;
      let y = p.sy + (p.ty - p.sy) * e;
      let boost = 0;
      if (lt >= 1) {
        p.done = true;
        x = p.tx + Math.sin(t * 0.6 + p.ph) * 5;
        y = p.ty + Math.cos(t * 0.5 + p.ph * 1.3) * 4;
        const dx = x - mmx, dy = y - mmy, d2 = dx * dx + dy * dy;
        if (d2 < 130 * 130 && d2 > 1) {
          const d = Math.sqrt(d2);
          boost = 1 - d / 130;
          const push = boost * 30;
          x += (dx / d) * push; y += (dy / d) * push;
        }
      } else allDone = false;
      let a = (lt < 1 ? lt : 1) * (0.55 + 0.45 * Math.sin(t * p.tw + p.ph));
      a = Math.min(1, a + boost * 0.4);
      if (a <= 0.02) continue;
      const rr = p.size * (1 + boost * 1.3);
      ctx.fillStyle = `rgba(${p.col},${(a * 0.28).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, rr * 3, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(${p.col},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
    }

    if (allDone && parts.length) {
      ctx.lineWidth = 0.6;
      let drawn = 0;
      for (let i = 0; i < parts.length && drawn < 480; i += 6) {
        const a = parts[i];
        const axx = a.tx + Math.sin(t * 0.6 + a.ph) * 5;
        const ayy = a.ty + Math.cos(t * 0.5 + a.ph * 1.3) * 4;
        for (let j = i + 6; j < Math.min(i + 66, parts.length) && drawn < 480; j += 6) {
          const b = parts[j];
          if (!b.done) continue;
          const bxx = b.tx + Math.sin(t * 0.6 + b.ph) * 5;
          const byy = b.ty + Math.cos(t * 0.5 + b.ph * 1.3) * 4;
          const dx = axx - bxx, dy = ayy - byy, d2 = dx * dx + dy * dy;
          if (d2 < 30 * 30) {
            const d = Math.sqrt(d2);
            ctx.strokeStyle = `rgba(232,200,126,${(0.12 * (1 - d / 30)).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(axx, ayy); ctx.lineTo(bxx, byy); ctx.stroke();
            drawn++;
          }
        }
      }
    }

    if (orbitA > 0.01) {
      for (const o of orbiters) {
        const [px2, py2, s] = orbiterPos(o, t);
        if (s >= 0) {
          drawOrbiter(ctx, px2, py2, o.size, o.type, t, o.seed, orbitA, t * 0.3 + o.seed + SharedSpin.value);
          if (o.moon) drawMoonlet(ctx, px2, py2, o.size, t, o.seed, orbitA);
        }
      }
    }
    if (visible) raf = requestAnimationFrame(frame);
    else running = false;
  }

  function play() {
    cancelAnimationFrame(raf);
    if (!build()) return;
    if (reducedMotion) {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.strokeStyle = 'rgba(201,164,92,0.16)';
      ctx.lineWidth = 1;
      for (const o of orbiters) {
        ctx.beginPath(); ctx.ellipse(W / 2, H / 2, o.rx, o.ry, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      for (const p of parts) {
        ctx.fillStyle = `rgba(${p.col},0.28)`;
        ctx.beginPath(); ctx.arc(p.tx, p.ty, p.size * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(${p.col},0.9)`;
        ctx.beginPath(); ctx.arc(p.tx, p.ty, p.size, 0, TAU); ctx.fill();
      }
      for (const o of orbiters) {
        const [px2, py2] = orbiterPos(o, 2);
        drawOrbiter(ctx, px2, py2, o.size, o.type, 2, o.seed, 1, 0.6 + o.seed);
        if (o.moon) drawMoonlet(ctx, px2, py2, o.size, 2, o.seed, 1);
      }
      return;
    }
    running = true; visible = true;
    raf = requestAnimationFrame(frame);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => {
      es.forEach(en => {
        visible = en.isIntersecting;
        if (visible && !running && parts.length && !reducedMotion) { running = true; raf = requestAnimationFrame(frame); }
      });
    }, { threshold: 0.05 }).observe(wrapEl);
  }
  wrapEl.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    mmx = e.clientX - r.left; mmy = e.clientY - r.top;
  }, { passive: true });
  wrapEl.addEventListener('pointerleave', () => { mmx = -9999; mmy = -9999; }, { passive: true });

  let rsz;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(play, 250); }, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => play()).catch(() => {});
  play();
  return play;
}

/* ============================================================
   3. UI — nav, progress, reveals, counters, tilt, demo
   ============================================================ */
function initUI(replayFn) {
  const nav = document.querySelector('.nav');
  const prog = document.querySelector('.progress');
  let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || 0;
      if (nav) nav.classList.toggle('scrolled', y > 30);
      if (prog) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => {
      es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  } else document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));

  const counters = document.querySelectorAll('[data-count]');
  const runCounter = el => {
    const target = parseFloat(el.dataset.count), suf = el.dataset.suffix || '';
    if (reducedMotion) { el.textContent = target + suf; return; }
    const t0 = performance.now(), dur = 1700;
    const step = now => {
      const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * e) + suf;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver(es => {
      es.forEach(en => { if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); } });
    }, { threshold: 0.4 });
    counters.forEach(el => cio.observe(el));
  } else counters.forEach(runCounter);

  if (finePointer && !reducedMotion && window.innerWidth > 1020) {
    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', (px * 100) + '%');
        card.style.setProperty('--my', (py * 100) + '%');
        card.style.transform = `perspective(900px) rotateX(${((0.5 - py) * 5).toFixed(2)}deg) rotateY(${((px - 0.5) * 6).toFixed(2)}deg) translateY(-3px)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  const replay = document.getElementById('replay');
  if (replay && replayFn) replay.addEventListener('click', replayFn);

  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  initDemo();
}

/* ---------- animated product mock (theatre, no real data) ---------- */
function initDemo() {
  const root = document.getElementById('demo');
  if (!root) return;
  const typeEl = document.getElementById('demo-type');
  const chipsEl = document.getElementById('demo-chips');
  const slots = Array.from(root.querySelectorAll('.slot-row'));
  const bars = Array.from(root.querySelectorAll('.wload-bar i'));
  const NAME = 'Ms. Sharma';
  const SUBS = ['Mr. Verma', 'Ms. Iyer', 'Mr. Khan'];
  const WIDTHS = ['72%', '46%', '31%'];
  let timers = [], alive = false, started = false;

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clear() { timers.forEach(clearTimeout); timers = []; }

  function reset() {
    if (typeEl) typeEl.innerHTML = '<span class="caret"></span>';
    if (chipsEl) chipsEl.innerHTML = '';
    slots.forEach(s => {
      s.classList.remove('done');
      const w = s.querySelector('.who'); if (w) w.textContent = 'Pending';
    });
    bars.forEach(b => { b.style.width = '0'; });
  }

  function final() {
    if (typeEl) typeEl.textContent = NAME;
    if (chipsEl) chipsEl.innerHTML = `<span class="fchip">${NAME} <span>✕</span></span>`;
    slots.forEach((s, i) => {
      s.classList.add('done');
      const w = s.querySelector('.who'); if (w && SUBS[i]) w.textContent = SUBS[i];
    });
    bars.forEach((b, i) => { if (WIDTHS[i]) b.style.width = WIDTHS[i]; });
  }

  function play() {
    clear(); reset();
    if (reducedMotion) { final(); return; }
    let t = 600;
    const chars = NAME.split('');
    chars.forEach((ch, i) => later(() => {
      if (!alive || !typeEl) return;
      typeEl.innerHTML = NAME.slice(0, i + 1).replace(/</g, '&lt;') + '<span class="caret"></span>';
    }, t + i * 70));
    t += chars.length * 70 + 350;
    later(() => {
      if (!alive || !chipsEl) return;
      chipsEl.innerHTML = `<span class="fchip">${NAME} <span>✕</span></span>`;
      if (typeEl) typeEl.innerHTML = '<span style="color:#6b7280">Type a teacher\'s name…</span><span class="caret"></span>';
    }, t);
    t += 700;
    slots.forEach((s, i) => later(() => {
      if (!alive) return;
      s.classList.add('done');
      const w = s.querySelector('.who'); if (w && SUBS[i]) w.textContent = SUBS[i];
      if (bars[i] && WIDTHS[i]) bars[i].style.width = WIDTHS[i];
    }, t + i * 650));
    t += slots.length * 650 + 2600;
    later(() => { if (alive) play(); }, t);
  }

  function stop() { alive = false; clear(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => {
      es.forEach(en => {
        if (en.isIntersecting && !started) { started = true; alive = true; play(); }
        else if (en.isIntersecting && !alive) { alive = true; play(); }
        else if (!en.isIntersecting && alive) stop();
      });
    }, { threshold: 0.25 }).observe(root);
  } else { alive = true; play(); }
}

document.addEventListener('DOMContentLoaded', () => {
  initGalaxy();
  const replayFn = initConstellation();
  initUI(replayFn);
});
})();
