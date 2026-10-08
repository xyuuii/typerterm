// Painted backdrops for the window view, in the manner of an anime
// background: flat colour masses with two or three cel tones, thin coloured
// outlines on near things and aerial perspective on far ones.
//
// Painters draw in world units on a cylinder around the eye point outside
// the window: s is the arc length along the layer (left → right as seen from
// the room) and y is the world height, y up. Houses are tiny 3D models (front
// wall, roof slopes, balconies) projected through the eye point onto that
// cylinder, so every row of the town has the right perspective seen from the
// room.

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/** Smooth 1D value noise in [-1, 1]. */
export function noise1(seed) {
  const r = rng(seed);
  const v = Array.from({length: 1024}, () => r() * 2 - 1);
  return x => {
    const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
    const a = v[((i % 1024) + 1024) % 1024], b = v[(((i + 1) % 1024) + 1024) % 1024];
    return a + (b - a) * t;
  };
}

// ---- colour -------------------------------------------------------------------------
function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const SHADOW = '#2c2444';                      // cel shadows lean cool and violet
const darker = (hex, k) => mix(hex, SHADOW, k);
const lighter = (hex, k) => mix(hex, '#ffffff', k);

export const HAZE = '#c3d6ea';                 // afternoon horizon

const PAL = {
  walls: ['#f1e6d2', '#e9d8bd', '#dde2e0', '#f5efe4', '#dccbb2', '#e6d3c8', '#cfdad3', '#f0dcc6', '#d6dee6', '#e2d8c4', '#efe9dd'],
  roofs: ['#5b6b86', '#4d5566', '#3f4f6b', '#4f7775', '#a65d43', '#7c5848', '#8f99a6', '#56705a', '#5b6b86', '#4d5566'],
  glass: '#6d84a2', frame: '#eef0ec', line: '#4a3b46',
  curtains: ['#f4e3c1', '#d5e6da', '#f1cfcf', '#e8dcf0', '#fff4dc', '#cfe0f0'],
  laundry: ['#ffffff', '#9cc3e6', '#f5b5b8', '#f7e08a', '#b9d9a5', '#e9e2f5', '#ffd3a8', '#ffffff'],
  futons: [['#f6f1e6', '#e88f8f'], ['#eef3fb', '#7fa6d8'], ['#fff5e0', '#e8b25a'], ['#f4ecf6', '#a98bc9']],
  green: ['#5f9a63', '#7fb46c', '#a8d38a'],
  pink: ['#e895b0', '#f5bccd', '#fde2ea'],
};

// ---- canvas ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function poly(ctx, pts, fill, stroke = null, lw = 0) {
  path(ctx, pts);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke && lw > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}
function line(ctx, a, b, color, lw) {
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
}
function disc(ctx, x, y, r, fill) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); ctx.fillStyle = fill; ctx.fill();
}

/**
 * Paint a band of a cylinder (radius R, eye height eyeY, phi0..phi1 in
 * radians, y0..y1) into tiles [[fromDeg, toDeg, pxPerDeg], …]. Each tile gets
 * its own canvas (and a quarter-size light canvas for windows at night when
 * `lights` is set). paint(ctx, lctx, view) draws in world units.
 */
export function paintBand(band, paint) {
  const {R, phi0, y0, y1, tiles, lights = 0} = band;
  return tiles.map(([from, to, ppd]) => {
    const sA = (from * DEG - phi0) * R, sB = (to * DEG - phi0) * R;
    const k = ppd / (R * DEG);
    const W = Math.min(4096, Math.ceil((sB - sA) * k)), H = Math.min(4096, Math.ceil((y1 - y0) * k));
    const kx = W / (sB - sA), ky = H / (y1 - y0);
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(kx, 0, 0, -ky, -sA * kx, y1 * ky);
    let light = null, lctx = null;
    if (lights) {
      light = makeCanvas(W * lights, H * lights);
      lctx = light.getContext('2d');
      lctx.setTransform(kx * lights, 0, 0, -ky * lights, -sA * kx * lights, y1 * ky * lights);
    }
    const kRef = Math.max(...tiles.map(t => t[2])) / (R * DEG);   // LOD decisions use the sharpest tile
    const view = {...band, sA, sB, k: kx, kRef, S: phi => (phi - phi0) * R,
      proj(phiC, x, D, h) {
        const rho = Math.hypot(x, D);
        return [(phiC + Math.atan2(x, D) - phi0) * R, band.eyeY + R * (h - band.eyeY) / rho];
      }};
    paint(ctx, lctx, view);
    return {phiA: from * DEG, phiB: to * DEG, canvas, light};
  });
}

/** Text in world units (the band transform is flipped vertically). */
function text(ctx, str, x, y, size, color, {vertical = false, weight = 700} = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.font = `${weight} ${size}px "Hiragino Mincho ProN", "Songti SC", "Noto Serif CJK SC", serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) [...str].forEach((ch, i) => ctx.fillText(ch, 0, i * size * 1.05));
  else ctx.fillText(str, 0, 0);
  ctx.restore();
}

// ---- puffs: cel-shaded clusters for trees, blossoms and clouds ----------------------------------
/** A cluster of discs with shade / base / light tones, lit from the upper left (y up). */
function puffs(ctx, cx, cy, rx, ry, n, r, pal, {outline = null, lw = 0, flat = false} = {}) {
  const P = [];
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r());
    const rad = (0.34 + r() * 0.26) * Math.min(rx, ry);
    let y = cy + Math.sin(a) * d * (ry - rad * 0.6);
    if (flat) y = Math.max(y, cy - ry * 0.35);
    P.push([cx + Math.cos(a) * d * (rx - rad * 0.6), y, rad]);
  }
  const p2 = new Path2D();
  for (const [x, y, rad] of P) { p2.moveTo(x + rad, y); p2.arc(x, y, rad, 0, TAU); }
  if (outline && lw > 0) { ctx.strokeStyle = outline; ctx.lineWidth = lw * 2; ctx.lineJoin = 'round'; ctx.stroke(p2); }
  ctx.fillStyle = pal[0]; ctx.fill(p2);
  ctx.save();
  ctx.clip(p2);
  ctx.fillStyle = pal[1];
  for (const [x, y, rad] of P) { ctx.beginPath(); ctx.arc(x - rad * 0.2, y + rad * 0.24, rad * 0.84, 0, TAU); ctx.fill(); }
  ctx.fillStyle = pal[2];
  for (const [x, y, rad] of P) {
    if (y < cy - ry * 0.15) continue;
    ctx.beginPath(); ctx.arc(x - rad * 0.4, y + rad * 0.45, rad * 0.46, 0, TAU); ctx.fill();
  }
  ctx.restore();
  return P;
}

// ---- houses ------------------------------------------------------------------------------------------
/**
 * One house (or small block) of a painted row.
 * h: {phi, D, w, d, G, floors, fh, roof: 'gable'|'hip'|'front'|'flat', rise, o,
 *     wall, roofCol, haze, lod (0–2), line, balcony, laundry, futon, antenna,
 *     solar, sign, flowers, lit}
 */
function drawHouse(ctx, lctx, v, h, r) {
  const {phi, D, w, d, G} = h;
  const P = (x, dist, y) => v.proj(phi, x, dist, y);
  const hz = c => (h.haze ? mix(c, v.haze || HAZE, h.haze) : c);
  const f = v.R / D;                                  // painted scale at this distance
  const lw = h.line ? h.line * f : 0;
  const ink = hz(PAL.line);
  const top = G + h.floors * h.fh;
  const wallC = hz(h.wall);
  const W2 = w / 2;

  // ---- front wall (+ gable triangle for houses whose ridge runs away from us)
  const wall = [P(-W2, D, G), P(W2, D, G), P(W2, D, top), P(-W2, D, top)];
  poly(ctx, wall, wallC, ink, lw);
  if (h.roof === 'front') poly(ctx, [P(-W2, D, top), P(W2, D, top), P(0, D, top + h.rise)], wallC, ink, lw);
  // Wood siding, tile joints or plaster: a few faint horizontal lines.
  if (h.lod >= 2 && h.siding) {
    for (let y = G + 6; y < top - 3; y += 7) line(ctx, P(-W2 + 0.5, D, y), P(W2 - 0.5, D, y), hz(darker(h.wall, 0.16)), 0.5);
  }

  // ---- windows, balconies, laundry per floor
  for (let fl = 0; fl < h.floors; fl++) {
    const yF = G + fl * h.fh;
    const hasBalcony = h.balcony && fl >= 1 && (h.balcony === 'all' || fl === h.balcony);
    const n = Math.max(1, Math.round(w / (h.lod >= 1 ? 62 : 70)));
    const slot = w / n;
    for (let i = 0; i < n; i++) {
      const xc = -W2 + slot * (i + 0.5);
      if (fl === 0 && i === h.door) {
        // Entrance: a sliding lattice door under a small canopy.
        const dw = Math.min(30, slot * 0.6);
        poly(ctx, [P(xc - dw / 2, D, yF), P(xc + dw / 2, D, yF), P(xc + dw / 2, D, yF + h.fh * 0.74), P(xc - dw / 2, D, yF + h.fh * 0.74)], hz('#8a6a55'), ink, lw * 0.7);
        if (h.lod >= 2) for (let k = 1; k < 5; k++) line(ctx, P(xc - dw / 2 + dw * k / 5, D, yF + 2), P(xc - dw / 2 + dw * k / 5, D, yF + h.fh * 0.72), hz('#e8dcc4'), 0.6);
        poly(ctx, [P(xc - dw * 0.8, D - 9, yF + h.fh * 0.78), P(xc + dw * 0.8, D - 9, yF + h.fh * 0.78), P(xc + dw * 0.8, D, yF + h.fh * 0.86), P(xc - dw * 0.8, D, yF + h.fh * 0.86)], hz(h.roofCol), ink, lw * 0.7);
        continue;
      }
      const tall = hasBalcony;
      const ww = Math.min(46, slot * (tall ? 0.7 : 0.56));
      const y0 = yF + (tall ? 2 : h.fh * 0.3), y1 = yF + h.fh * (tall ? 0.8 : 0.78);
      const lit = h.lit && r() < h.lit;
      drawWindow(ctx, lctx, P, D, xc, ww, y0, y1, h, hz, ink, lw, r, lit);
      if (h.flowers && fl >= 1 && !tall && h.lod >= 2 && r() < 0.6) {
        // Flower box under the window.
        poly(ctx, [P(xc - ww / 2 - 1, D - 4, y0 - 5), P(xc + ww / 2 + 1, D - 4, y0 - 5), P(xc + ww / 2 + 1, D - 4, y0), P(xc - ww / 2 - 1, D - 4, y0)], hz('#8a5a44'), ink, lw * 0.6);
        for (let k = 0; k < 7; k++) {
          const [fx, fy] = P(xc - ww / 2 + (k + 0.5) * ww / 7, D - 5, y0 + 1.5 + r() * 2);
          disc(ctx, fx, fy, 2.2 * f, hz(['#6fae5e', '#f28aa5', '#ffd166', '#6fae5e', '#ff9f80'][k % 5]));
        }
      }
    }
    if (hasBalcony) drawBalcony(ctx, P, D, W2, yF, {...h, cat: h.cat && fl === h.floors - 1}, hz, ink, lw, r, f);
  }

  // ---- shadow under the eaves (cel band)
  if (h.lod >= 1 && h.roof !== 'flat') {
    ctx.globalAlpha = 0.28;
    poly(ctx, [P(-W2, D, top - h.fh * 0.16), P(W2, D, top - h.fh * 0.16), P(W2, D, top), P(-W2, D, top)], SHADOW);
    ctx.globalAlpha = 1;
  }
  // Downspout at one corner.
  if (h.lod >= 2 && h.roof !== 'flat') line(ctx, P(W2 - 3, D - 1, G), P(W2 - 3, D - 1, top), hz('#b8b2a8'), 1.4);

  // ---- sign board projecting from the upper floor (shops)
  if (h.sign) {
    const sx = -W2 + 10, y0 = G + h.fh * 1.05, y1 = G + h.fh * 1.85;
    poly(ctx, [P(sx - 7, D - 12, y0), P(sx + 7, D - 12, y0), P(sx + 7, D - 12, y1), P(sx - 7, D - 12, y1)], hz('#fbf3e2'), ink, lw);
    poly(ctx, [P(sx - 5.5, D - 12, y0 + 1.5), P(sx + 5.5, D - 12, y0 + 1.5), P(sx + 5.5, D - 12, y1 - 1.5), P(sx - 5.5, D - 12, y1 - 1.5)], null, hz('#c0463a'), 1.1);
    const [tx, ty] = P(sx, D - 12, y1 - 9);
    text(ctx, h.sign, tx, ty, 9.5, hz('#3a2a2a'), {vertical: true});
    if (lctx) poly(lctx, [P(sx - 7, D - 12, y0), P(sx + 7, D - 12, y0), P(sx + 7, D - 12, y1), P(sx - 7, D - 12, y1)], '#7a5a3a');
  }

  // ---- roof
  drawRoof(ctx, P, h, hz, ink, lw, r, f);
}

function drawWindow(ctx, lctx, P, D, xc, ww, y0, y1, h, hz, ink, lw, r, lit) {
  const rect = (x0, x1, a, b, dist = D) => [P(x0, dist, a), P(x1, dist, a), P(x1, dist, b), P(x0, dist, b)];
  if (h.lod === 0) {
    poly(ctx, rect(xc - ww / 2, xc + ww / 2, y0, y1), hz(darker(h.wall, 0.45)));
    if (lctx && lit) poly(lctx, rect(xc - ww * 0.32, xc + ww * 0.32, y0 + (y1 - y0) * 0.2, y1 - (y1 - y0) * 0.2), '#d99a52');
    return;
  }
  poly(ctx, rect(xc - ww / 2 - 1.5, xc + ww / 2 + 1.5, y0 - 1.5, y1 + 1.5), hz(PAL.frame), ink, lw * 0.6);
  poly(ctx, rect(xc - ww / 2, xc + ww / 2, y0, y1), hz(PAL.glass));
  // Reflection band and the sliding mullion.
  if (h.lod >= 2) {
    ctx.globalAlpha = 0.35;
    poly(ctx, [P(xc - ww / 2, D, y1 - (y1 - y0) * 0.5), P(xc - ww / 2 + ww * 0.3, D, y1), P(xc - ww / 2 + ww * 0.5, D, y1), P(xc - ww / 2, D, y0 + (y1 - y0) * 0.15)], hz('#dfe9f5'));
    ctx.globalAlpha = 1;
  }
  line(ctx, P(xc, D, y0), P(xc, D, y1), hz(PAL.frame), 1.6);
  // Curtains on one side.
  let curtain = null;
  if (r() < 0.65) {
    const side = r() < 0.5 ? -1 : 1, cw = ww * (0.25 + r() * 0.25);
    const x0 = side < 0 ? xc - ww / 2 : xc + ww / 2 - cw;
    curtain = [x0, x0 + cw];
    poly(ctx, rect(x0, x0 + cw, y0, y1), hz(PAL.curtains[Math.floor(r() * PAL.curtains.length)]));
    if (h.lod >= 2) for (let k = 1; k < 3; k++) line(ctx, P(x0 + cw * k / 3, D, y0 + 1), P(x0 + cw * k / 3, D, y1 - 1), hz('#00000022'), 0.5);
  }
  if (lctx && lit) {
    poly(lctx, rect(xc - ww / 2, xc + ww / 2, y0, y1), '#e8a35a');
    if (curtain) poly(lctx, rect(curtain[0], curtain[1], y0, y1), '#c99a66');
  }
}

function drawBalcony(ctx, P, D, W2, yF, h, hz, ink, lw, r, f) {
  const bd = 18, front = D - bd, bw = W2 - 4;
  const rail = h.fh * 0.42;
  // AC unit and a pot or two behind the railing.
  if (h.lod >= 2) {
    const ax = r() < 0.5 ? -bw + 16 : bw - 16;
    poly(ctx, [P(ax - 13, front + 6, yF), P(ax + 13, front + 6, yF), P(ax + 13, front + 6, yF + 19), P(ax - 13, front + 6, yF + 19)], hz('#e3e5e2'), ink, lw * 0.6);
    const [fx, fy] = P(ax + 2, front + 6, yF + 9.5);
    ctx.beginPath(); ctx.arc(fx, fy, 6.5 * f, 0, TAU); ctx.fillStyle = hz('#a5acb1'); ctx.fill();
  }
  // Laundry on a pole above the railing.
  if (h.laundry && h.lod >= 1) {
    const yPole = yF + h.fh * 0.86, dist = front + 7;
    line(ctx, P(-bw + 4, dist, yPole), P(bw - 4, dist, yPole), hz('#9aa0a6'), 1.1);
    let x = -bw + 8;
    while (x < bw - 14) {
      const iw = 8 + r() * 12, ih = 10 + r() * 14, col = hz(PAL.laundry[Math.floor(r() * PAL.laundry.length)]);
      if (r() < 0.4) {
        // A shirt.
        poly(ctx, [P(x, dist, yPole), P(x + iw, dist, yPole), P(x + iw + 3, dist, yPole - 5), P(x + iw - 1, dist, yPole - 6), P(x + iw - 1, dist, yPole - ih), P(x + 1, dist, yPole - ih), P(x + 1, dist, yPole - 6), P(x - 3, dist, yPole - 5)], col, ink, lw * 0.5);
      } else {
        poly(ctx, [P(x, dist, yPole), P(x + iw, dist, yPole), P(x + iw, dist, yPole - ih), P(x, dist, yPole - ih)], col, ink, lw * 0.5);
      }
      x += iw + 3 + r() * 6;
    }
  }
  // Slab edge and railing.
  poly(ctx, [P(-bw, front, yF - 4), P(bw, front, yF - 4), P(bw, front, yF), P(-bw, front, yF)], hz(darker(h.wall, 0.12)), ink, lw * 0.7);
  ctx.globalAlpha = 0.92;
  poly(ctx, [P(-bw, front, yF), P(bw, front, yF), P(bw, front, yF + rail), P(-bw, front, yF + rail)], hz(h.railCol || '#e3e8ea'));
  ctx.globalAlpha = 1;
  if (h.lod >= 2) for (let x = -bw + 5; x < bw; x += 5) line(ctx, P(x, front, yF), P(x, front, yF + rail), hz('#b9c0c6'), 0.5);
  line(ctx, P(-bw, front, yF + rail), P(bw, front, yF + rail), hz('#8f969c'), 1.6);
  if (lw) poly(ctx, [P(-bw, front, yF), P(bw, front, yF), P(bw, front, yF + rail), P(-bw, front, yF + rail)], null, ink, lw * 0.7);
  // A futon airing over the railing.
  if (h.futon && h.lod >= 1) {
    const [base, stripe] = PAL.futons[Math.floor(r() * PAL.futons.length)];
    const fx0 = -bw * 0.1 - 22, fx1 = fx0 + 48;
    poly(ctx, [P(fx0, front - 1, yF + rail + 2), P(fx1, front - 1, yF + rail + 2), P(fx1, front - 1, yF + rail - 20), P(fx0, front - 1, yF + rail - 20)], hz(base), ink, lw * 0.7);
    for (let k = 0; k < 4; k++) {
      const yy = yF + rail - 3 - k * 5;
      poly(ctx, [P(fx0, front - 1, yy), P(fx1, front - 1, yy), P(fx1, front - 1, yy - 1.8), P(fx0, front - 1, yy - 1.8)], hz(stripe));
    }
  }
  // Now and then a cat on the railing.
  if (h.cat && h.lod >= 2) {
    const [cx, cy] = P(bw * 0.55, front - 1, yF + rail);
    const s = f;
    ctx.fillStyle = hz('#3b3036');
    ctx.beginPath(); ctx.ellipse(cx, cy + 5 * s, 7 * s, 5 * s, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5 * s, cy + 11 * s, 4 * s, 0, TAU); ctx.fill();
    poly(ctx, [[cx + 2.2 * s, cy + 13.5 * s], [cx + 3.4 * s, cy + 17.5 * s], [cx + 5 * s, cy + 14.5 * s]], hz('#3b3036'));
    poly(ctx, [[cx + 5.5 * s, cy + 14.5 * s], [cx + 7.4 * s, cy + 17.5 * s], [cx + 8.2 * s, cy + 13.2 * s]], hz('#3b3036'));
    ctx.beginPath(); ctx.moveTo(cx - 6 * s, cy + 3 * s); ctx.quadraticCurveTo(cx - 12 * s, cy - 6 * s, cx - 8 * s, cy - 11 * s);
    ctx.strokeStyle = hz('#3b3036'); ctx.lineWidth = 1.6 * s; ctx.stroke();
  }
}

function drawRoof(ctx, P, h, hz, ink, lw, r, f) {
  const {D, w, d, G} = h;
  const W2 = w / 2, o = h.o ?? 9;
  const top = G + h.floors * h.fh;
  const base = hz(h.roofCol), dark = hz(darker(h.roofCol, 0.3)), light = hz(lighter(h.roofCol, 0.22));
  if (h.roof === 'flat') {
    // Roof deck, parapet and a few things on top.
    poly(ctx, [P(-W2, D, top), P(W2, D, top), P(W2, D + d, top), P(-W2, D + d, top)], hz('#b9bdbf'), ink, lw);
    poly(ctx, [P(-W2, D, top), P(W2, D, top), P(W2, D, top + 5), P(-W2, D, top + 5)], hz(lighter(h.wall, 0.3)), ink, lw * 0.8);
    if (h.lod >= 1) {
      const tx = (r() - 0.5) * w * 0.5, dist = D + d * 0.55;
      // Water tank on legs.
      for (const lx of [-7, 7]) line(ctx, P(tx + lx, dist, top), P(tx + lx, dist, top + 10), hz('#7b8085'), 1.2);
      poly(ctx, [P(tx - 11, dist, top + 10), P(tx + 11, dist, top + 10), P(tx + 11, dist, top + 26), P(tx - 11, dist, top + 26)], hz('#d7dde0'), ink, lw * 0.8);
      line(ctx, P(tx - 11, dist, top + 18), P(tx + 11, dist, top + 18), hz('#aab3b8'), 1);
      // Stair hut.
      const sx = tx > 0 ? -W2 + 30 : W2 - 30;
      poly(ctx, [P(sx - 18, D + d * 0.3, top), P(sx + 18, D + d * 0.3, top), P(sx + 18, D + d * 0.3, top + 30), P(sx - 18, D + d * 0.3, top + 30)], hz(darker(h.wall, 0.08)), ink, lw * 0.8);
    }
    return;
  }
  const he = top - o * 0.3;                                 // eave height
  const hr = top + h.rise;                                  // ridge height
  if (h.roof === 'front') {
    // Ridge runs away from us: two slopes seen from above, left lit and right in shade.
    const L = [P(-W2 - o, D - o, he), P(0, D - o, hr + o * 0.25), P(0, D + d + o, hr), P(-W2 - o, D + d + o, he)];
    const Rr = [P(W2 + o, D - o, he), P(0, D - o, hr + o * 0.25), P(0, D + d + o, hr), P(W2 + o, D + d + o, he)];
    poly(ctx, Rr, dark, ink, lw);
    poly(ctx, L, base, ink, lw);
    if (h.lod >= 1) {
      for (let t = 0.12; t < 1; t += 0.12) {
        line(ctx, P(-(W2 + o) * t, D - o, he + (hr - he) * (1 - t)), P(-(W2 + o) * t, D + d + o, he + (hr - he) * (1 - t)), hz(darker(h.roofCol, 0.15)), 0.6);
        line(ctx, P((W2 + o) * t, D - o, he + (hr - he) * (1 - t)), P((W2 + o) * t, D + d + o, he + (hr - he) * (1 - t)), hz(darker(h.roofCol, 0.45)), 0.6);
      }
      // Verge boards along the front edges and a round vent in the gable.
      line(ctx, P(-W2 - o, D - o, he), P(0, D - o, hr + o * 0.25), hz('#efe8dc'), 1.6);
      line(ctx, P(W2 + o, D - o, he), P(0, D - o, hr + o * 0.25), hz('#efe8dc'), 1.6);
      const [vx, vy] = P(0, D, top + h.rise * 0.45);
      disc(ctx, vx, vy, 4.5 * f, hz(darker(h.wall, 0.4)));
    }
    return;
  }
  const hip = h.roof === 'hip';
  const xr = hip ? Math.max(6, W2 - d * 0.45) : W2 + o;
  const front = [P(-W2 - o, D - o, he), P(W2 + o, D - o, he), P(xr, D + d / 2, hr), P(-xr, D + d / 2, hr)];
  if (hip) {
    poly(ctx, [P(-W2 - o, D - o, he), P(-xr, D + d / 2, hr), P(-W2 - o, D + d + o, he)], base, ink, lw);
    poly(ctx, [P(W2 + o, D - o, he), P(xr, D + d / 2, hr), P(W2 + o, D + d + o, he)], dark, ink, lw);
  }
  poly(ctx, front, base, ink, lw);
  // Upper band of the slope catches more light.
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  poly(ctx, [lerp(front[0], front[3], 0.62), lerp(front[1], front[2], 0.62), front[2], front[3]], light);
  if (h.lod >= 1) {
    // Tile rows running down the slope.
    const step = h.lod >= 2 ? 7 : 12;
    for (let x = -W2 - o + step; x < W2 + o; x += step) {
      const xt = Math.max(-xr, Math.min(xr, x * (hip ? xr / (W2 + o) : 1)));
      line(ctx, P(x, D - o, he), P(xt, D + d / 2, hr), hz(darker(h.roofCol, 0.22)), h.lod >= 2 ? 0.7 : 0.9);
    }
    // Eave board.
    line(ctx, P(-W2 - o, D - o, he), P(W2 + o, D - o, he), hz(h.fascia || '#ece6da'), 1.8);
  }
  if (h.solar && h.lod >= 1) {
    const q = (x, t) => P(x, D - o + (d / 2 + o) * t, he + (hr - he) * t);
    const a = -w * 0.32, b = w * 0.08;
    poly(ctx, [q(a, 0.25), q(b, 0.25), q(b, 0.8), q(a, 0.8)], hz('#2e3f66'), ink, lw * 0.6);
    for (let k = 1; k < 4; k++) line(ctx, q(a + (b - a) * k / 4, 0.25), q(a + (b - a) * k / 4, 0.8), hz('#7f93c2'), 0.5);
    line(ctx, q(a, 0.52), q(b, 0.52), hz('#7f93c2'), 0.5);
  }
  // Ridge cap with the onigawara at both ends.
  line(ctx, P(-xr, D + d / 2, hr), P(xr, D + d / 2, hr), dark, 4.2);
  if (h.lod >= 1) {
    line(ctx, P(-xr, D + d / 2, hr + 1.6), P(xr, D + d / 2, hr + 1.6), lighter(dark, 0.35), 0.8);
    for (const s of [-1, 1]) {
      const [ex, ey] = P(s * xr, D + d / 2, hr + 1.5);
      disc(ctx, ex, ey, 3.6 * f, dark);
    }
  }
  if (h.antenna && h.lod >= 1) {
    const ax = (r() - 0.5) * xr, dist = D + d / 2;
    line(ctx, P(ax, dist, hr), P(ax, dist, hr + 30), hz('#5b5f66'), 1);
    for (const [y, half] of [[hr + 29, 12], [hr + 24, 9], [hr + 19, 6]]) line(ctx, P(ax - half, dist, y), P(ax + half, dist, y), hz('#5b5f66'), 0.8);
  }
}

// ---- trees for painted rows ------------------------------------------------------------------------
function drawTree(ctx, v, phi, D, G, size, kind, r, haze) {
  const f = v.R / D;
  const hz = c => (haze ? mix(c, v.haze || HAZE, haze) : c);
  const [bx, by] = v.proj(phi, 0, D, G);
  const height = size * (kind === 'pine' ? 1.6 : 1.45);
  const [tx, ty] = v.proj(phi, 0, D, G + height * 0.55);
  line(ctx, [bx, by], [tx, ty], hz('#6b4f45'), Math.max(0.6, 5 * f));
  const pal = kind === 'sakura' ? PAL.pink : PAL.green;
  const [cx, cy] = v.proj(phi, 0, D, G + height * 0.72);
  puffs(ctx, cx, cy, size * f * 0.75, size * f * 0.55, kind === 'sakura' ? 9 : 7, r, pal.map(hz), {outline: f > 0.6 ? hz(kind === 'sakura' ? '#c0708f' : '#3f6a4c') : null, lw: 0.9 * f, flat: true});
}

// ---- layers -------------------------------------------------------------------------------------------
/** Far mountain ranges and Mt. Fuji. */
export function paintMountains(ctx, lctx, v, {fujiPhi = 44, seed = 5} = {}) {
  const R = v.R, eye = v.eyeY;
  const yEl = el => eye + R * Math.tan(el * DEG);
  const n1 = noise1(seed), n2 = noise1(seed + 9);
  const ridge = (fn, fill, step = 18) => {
    ctx.beginPath();
    ctx.moveTo(v.sA - 50, v.y0);
    for (let s = v.sA - 50; s <= v.sB + 50; s += step) ctx.lineTo(s, fn(s));
    ctx.lineTo(v.sB + 50, v.y0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Farthest range, barely darker than the sky.
  ridge(s => yEl(1.1 + 1.0 * n1(s / 700) + 0.5 * n1(s / 230 + 40)), '#b9cbe2');
  // Mt. Fuji.
  const sF = v.S(fujiPhi * DEG);
  if (sF > v.sA - 2400 && sF < v.sB + 2400) {
    const peak = yEl(4.8), foot = yEl(-0.4), hgt = peak - foot, half = hgt * 3.5, flat = half * 0.085;
    const prof = x => {
      const ax = Math.abs(x);
      if (ax <= flat) return peak - Math.max(0, Math.sin(ax / flat * Math.PI * 3)) * hgt * 0.012;
      return peak - hgt * Math.pow(Math.min(1, (ax - flat) / (half - flat)), 0.62);
    };
    const outline = [];
    for (let x = -half; x <= half; x += half / 90) outline.push([sF + x, prof(x)]);
    const body = [...outline, [sF + half, v.y0], [sF - half, v.y0]];
    poly(ctx, body, '#8aa6d1');
    // Shade on the right flank.
    ctx.save();
    path(ctx, body); ctx.clip();
    poly(ctx, [[sF + flat * 0.3, peak + 5], [sF + half * 1.2, peak + 5], [sF + half * 1.2, v.y0], [sF + half * 0.18, v.y0]], '#7590c0');
    // Snow cap with long fingers down the ravines.
    const rr = rng(seed + 3);
    const snowY = peak - hgt * 0.4;
    const snow = [];
    for (let x = -half; x <= half; x += half / 90) { if (prof(x) >= snowY) snow.push([sF + x, prof(x) + 2]); }
    const xs = snow.length ? snow[snow.length - 1][0] - sF : flat;
    const fingers = [];
    for (let x = xs; x >= -xs; x -= half * 0.028) {
      const deep = rr() < 0.55;
      const len = deep ? hgt * (0.06 + rr() * 0.16) * (1 - Math.abs(x) / xs * 0.5) : hgt * rr() * 0.03;
      fingers.push([sF + x, snowY + hgt * 0.03 - len * (deep ? 1 : 0.4)]);
      fingers.push([sF + x - half * 0.012, snowY + hgt * 0.035]);
    }
    const cap = [...snow, ...fingers];
    poly(ctx, cap, '#f7f9fd');
    ctx.save();
    path(ctx, cap); ctx.clip();
    poly(ctx, [[sF + flat * 0.3, peak + 5], [sF + half, peak + 5], [sF + half, v.y0], [sF + half * 0.12, v.y0]], '#cdd8ee');
    ctx.restore();
    // Haze at the foot.
    const g = ctx.createLinearGradient(0, foot + hgt * 0.45, 0, foot);
    g.addColorStop(0, 'rgba(195,214,234,0)');
    g.addColorStop(1, 'rgba(195,214,234,0.85)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = g;
    ctx.fillRect(sF - half, v.y0, half * 2, foot + hgt * 0.45 - v.y0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
  // Nearer hills with a fringe of trees along their tops.
  const hill = s => yEl(-0.15 + 0.85 * n2(s / 520) + 0.35 * n2(s / 160 + 7));
  ridge(hill, '#a7bedb');
  const rr = rng(seed + 11);
  ctx.fillStyle = '#a2b9d7';
  for (let s = v.sA - 40; s <= v.sB + 40; s += 9 + rr() * 9) {
    const rad = 6 + rr() * 9;
    ctx.beginPath(); ctx.arc(s, hill(s) - rad * 0.3, rad, 0, TAU); ctx.fill();
  }
  ridge(s => yEl(-0.9 + 0.45 * n1(s / 300 + 13)), '#9fb5d3');
}

/** The distant city: mid-rise blocks, a few towers and a red lattice tower. */
export function paintCity(ctx, lctx, v, {seed = 21, towerPhi = -16} = {}) {
  const G = v.ground;
  const rows = [60000, 42000, 30000, 21000, 15000];
  rows.forEach((D, ri) => {
    const haze = 0.62 - ri * 0.09;
    const fh = 64;
    let phi = v.phi0 - 0.05;
    let idx = 0;
    while (phi < v.phi1 + 0.05) {
      const hr = rng(seed * 7 + ri * 1013 + idx++);
      const w = 260 + hr() * 520, gap = hr() * 160;
      const phiC = phi + w / 2 / D;
      phi += (w + gap) / D;
      // Downtown on the right, low-rise below Fuji.
      const dPhi = phiC / DEG;
      const downtown = dPhi > 58 && dPhi < 96 ? 1 : dPhi > -45 && dPhi < -5 ? 0.6 : 0;
      const floors = Math.round(3 + hr() * 5 + downtown * hr() * hr() * 24);
      const s = v.S(phiC), half = w / 2 * v.R / D;
      if (s + half < v.sA || s - half > v.sB) continue;
      const P = (x, h) => v.proj(phiC, x, D, h);
      const top = G + floors * fh;
      const col = mix(['#a9bcd6', '#b4c5dc', '#9fb3cf', '#bccbe0', '#aebfd8'][Math.floor(hr() * 5)], HAZE, haze);
      poly(ctx, [P(-w / 2, G), P(w / 2, G), P(w / 2, top), P(-w / 2, top)], col);
      // Shaded right face hint.
      poly(ctx, [P(w / 2 - w * 0.12, G), P(w / 2, G), P(w / 2, top), P(w / 2 - w * 0.12, top)], mix(col, '#7f93b5', 0.25));
      // Window rows.
      const wc = mix(col, '#e8eef6', 0.35);
      const lit = mix('#ffd18a', '#ffffff', 0.2);
      for (let fl = 1; fl < floors; fl++) {
        const y = G + fl * fh + fh * 0.35;
        if (D < 15000) line(ctx, P(-w / 2 + 12, y), P(w / 2 - w * 0.14, y), wc, Math.max(0.4, fh * 0.28 * v.R / D));
        if (lctx) {
          for (let x = -w / 2 + 14; x < w / 2 - 14; x += 34) {
            if (hr() < 0.32) { const [lx, ly] = P(x, y); disc(lctx, lx, ly, Math.max(0.5, 7 * v.R / D), lit); }
          }
        }
      }
      // Aviation light on tall ones.
      if (floors > 18 && lctx) { const [ax, ay] = P(0, top + 8); disc(lctx, ax, ay, Math.max(1, 10 * v.R / D), '#ff5a4a'); }
    }
  });
  // A red-and-white lattice tower (a nod to Tokyo Tower).
  const D = 60000, phiT = towerPhi * DEG, s = v.S(phiT);
  if (s > v.sA - 400 && s < v.sB + 400) {
    const P = (x, h) => v.proj(phiT, x, D, h);
    const H = 6200, base = 1100;
    const leg = t => base / 2 * Math.pow(1 - t, 2.2) + 26;
    const pts = [];
    for (let t = 0; t <= 1.001; t += 0.05) pts.push(P(-leg(t), G + H * t));
    for (let t = 1; t >= -0.001; t -= 0.05) pts.push(P(leg(t), G + H * t));
    poly(ctx, pts, mix('#e8826e', HAZE, 0.42));
    // White bands.
    for (const t of [0.22, 0.42, 0.6, 0.76, 0.9]) {
      poly(ctx, [P(-leg(t), G + H * t), P(leg(t), G + H * t), P(leg(t + 0.035), G + H * (t + 0.035)), P(-leg(t + 0.035), G + H * (t + 0.035))], mix('#f4ece6', HAZE, 0.42));
    }
    // Observation decks.
    for (const [t, wd] of [[0.43, 2.4], [0.72, 1.6]]) poly(ctx, [P(-leg(t) * wd, G + H * t), P(leg(t) * wd, G + H * t), P(leg(t) * wd, G + H * (t + 0.03)), P(-leg(t) * wd, G + H * (t + 0.03))], mix('#e9dfda', HAZE, 0.42));
    if (lctx) {
      for (let t = 0.05; t < 1; t += 0.06) { const [lx, ly] = P(0, G + H * t); disc(lctx, lx, ly, Math.max(1.2, 70 * v.R / D * (1 - t * 0.6)), '#ff9a55'); }
    }
  }
}

/**
 * The town: rows of houses from `far` to `near` (front distances), with trees,
 * poles and a few landmarks. hazeAt(D) gives aerial perspective per row.
 */
export function paintTown(ctx, lctx, v, {seed = 3, rows, hazeAt, landmarks = []} = {}) {
  const G = v.ground;
  const sorted = [...rows].sort((a, b) => b - a);
  let prevD = Infinity;
  sorted.forEach((D, ri) => {
    const haze = hazeAt(D);
    const f = v.R / D;
    // Landmarks standing between the previous (farther) row and this one.
    for (const lm of landmarks) if (lm.D > D && lm.D <= prevD) lm.draw(ctx, lctx, v);
    prevD = D;
    // Ground and lanes for this row.
    const [, gy] = v.proj(0, 0, D - 60, G);
    ctx.fillStyle = mix(ri % 3 === 0 ? '#9ea58d' : '#a4a597', HAZE, haze);
    ctx.fillRect(v.sA - 10, v.y0 - 10, v.sB - v.sA + 20, gy - v.y0 + 10);
    let phi = v.phi0 - 0.08;
    let idx = 0;
    const poles = [];
    while (phi < v.phi1 + 0.08) {
      const hr = rng(seed * 131 + Math.round(D) * 7 + idx++);
      const kind = hr();
      const apartment = kind < 0.12;
      const w = apartment ? 220 + hr() * 160 : 130 + hr() * 120;
      const gap = 10 + hr() * 34;
      const phiC = phi + w / 2 / D;
      phi += (w + gap) / D;
      const s = v.S(phiC), half = (w / 2 + 40) * f;
      const visible = s + half > v.sA - 20 && s - half < v.sB + 20;
      const lod = w * f * v.kRef > 260 ? 2 : w * f * v.kRef > 70 ? 1 : 0;
      const house = {
        phi: phiC, D, w, d: apartment ? 120 : 150 + hr() * 60, G,
        floors: apartment ? 3 + Math.floor(hr() * 3) : hr() < 0.25 ? 1 : 2, fh: 56,
        roof: apartment ? 'flat' : ['gable', 'gable', 'hip', 'front', 'gable', 'hip'][Math.floor(hr() * 6)],
        rise: 32 + hr() * 22, o: 9,
        wall: PAL.walls[Math.floor(hr() * PAL.walls.length)],
        roofCol: PAL.roofs[Math.floor(hr() * PAL.roofs.length)],
        haze, lod, line: lod >= 2 ? 0.5 : 0,
        balcony: apartment ? 'all' : hr() < 0.45 ? 1 : 0,
        laundry: hr() < 0.45, futon: hr() < 0.2, antenna: hr() < 0.35, solar: hr() < 0.12,
        lit: 0.3, door: -1,
      };
      // Trees in some of the gaps, behind or beside the houses.
      if (visible && hr() < 0.28) {
        const tk = hr() < 0.45 ? 'sakura' : 'green';
        drawTree(ctx, v, phiC + (w / 2 + gap / 2) / D, D + 30 + hr() * 60, G, 34 + hr() * 26, tk, hr, haze);
      }
      if (visible) drawHouse(ctx, lctx, v, house, hr);
      if (idx % 3 === 0) poles.push(phiC + (w / 2 + gap / 2) / D);
    }
    // Utility poles with sagging wires along the nearer rows.
    if (f > 0.45) {
      const ink = mix('#4a4450', HAZE, haze);
      const tops = poles.map(p => [v.proj(p, 0, D - 25, G + 190), v.proj(p, 0, D - 25, G)]);
      for (const [t, b] of tops) {
        if (t[0] < v.sA - 60 || t[0] > v.sB + 60) continue;
        line(ctx, b, t, ink, 2.6 * f);
        line(ctx, [t[0] - 9 * f, t[1] - 6 * f], [t[0] + 9 * f, t[1] - 6 * f], ink, 1.6 * f);
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.6 * f;
      for (let i = 0; i < tops.length - 1; i++) {
        const a = tops[i][0], b = tops[i + 1][0];
        if (b[0] < v.sA - 60 || a[0] > v.sB + 60) continue;
        for (const dy of [-6, -12]) {
          ctx.beginPath();
          ctx.moveTo(a[0], a[1] + dy * f);
          ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + (dy - 18) * f, b[0], b[1] + dy * f);
          ctx.stroke();
        }
      }
    }
  });
  for (const lm of landmarks) if (lm.D <= prevD) lm.draw(ctx, lctx, v);
}

/** The houses across the lane, painted with full detail. */
export function paintStreet(ctx, lctx, v, houses) {
  for (const spec of houses) {
    const r = rng(spec.seed || 1);
    const phiC = (spec.from + spec.to) / 2 * DEG;
    const D = v.R;
    const w = 2 * D * Math.tan((spec.to - spec.from) / 2 * DEG);
    const s = v.S(phiC), half = (w / 2 + 40);
    if (s + half < v.sA - 20 || s - half > v.sB + 20) continue;
    if (spec.tree) drawTree(ctx, v, (spec.to + 1) * DEG, D + 40, v.ground, spec.tree.size, spec.tree.kind, r, 0);
    drawHouse(ctx, lctx, v, {
      phi: phiC, D, w, d: 180, G: v.ground, fh: 56, rise: 46, o: 11, lod: 2, line: 0.55, lit: 0.55, haze: 0, door: 0, roofCol: '#8f99a6',
      ...spec,
    }, r);
  }
}

/** Ground disc around the building: yard, lane, pavements (seen only looking steeply down). */
export function paintGround(c, W, H, rMax) {
  // u: angle (left → right), v: radius 0 (top row) → rMax (bottom row)
  const band = (r0, r1, color) => { c.fillStyle = color; c.fillRect(0, r0 / rMax * H, W, (r1 - r0) / rMax * H); };
  band(0, 58, '#b9ab8e');
  const r = rng(8);
  for (let i = 0; i < 900; i++) { c.fillStyle = r() < 0.5 ? '#a99c80' : '#c9bda1'; c.fillRect(r() * W, r() * 58 / rMax * H, 2, 2); }
  band(58, 66, '#a8a8a0');
  band(66, 74, '#cfcabe');
  band(74, 200, '#7c7f86');
  band(80, 82, '#eceae4');
  band(192, 194, '#eceae4');
  band(200, 232, '#c8c2b5');
  for (let x = 0; x < W; x += 14) { c.fillStyle = '#b8b2a5'; c.fillRect(x, 200 / rMax * H, 1, 32 / rMax * H); }
  band(232, rMax, '#bdb6a8');
}

// ---- sky ---------------------------------------------------------------------------------------------
/**
 * Cumulus clouds for the sky dome: R holds the cel tone (0 shade, 0.5 mid,
 * 1 lit) and A the coverage, so the sky shader can recolour them per time of
 * day. Tileable horizontally.
 */
export function paintClouds(W = 4096, H = 1024) {
  const cv = makeCanvas(W, H);
  const c = cv.getContext('2d');
  const r = rng(99);
  const cloud = (cx, base, s) => {
    const P = [];
    const n = 9 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 2.4;
      const tower = 1 - Math.abs(x) / 1.4;
      P.push([cx + x * 120 * s, base - (18 + r() * 70 * tower) * s, (34 + r() * 46 * (0.5 + tower)) * s]);
    }
    for (const dx of [-W, 0, W]) {
      const p2 = new Path2D();
      for (const [x, y, rad] of P) { p2.moveTo(x + dx + rad, y); p2.arc(x + dx, y, rad, 0, TAU); }
      c.save();
      // Flat bottom.
      c.beginPath(); c.rect(dx + cx - 400 * s, 0, 800 * s, base + 4 * s); c.clip();
      c.fillStyle = 'rgb(0,0,0)'; c.fill(p2);
      c.clip(p2);
      c.fillStyle = 'rgb(128,128,128)';
      for (const [x, y, rad] of P) { c.beginPath(); c.arc(x + dx - rad * 0.16, y - rad * 0.22, rad * 0.86, 0, TAU); c.fill(); }
      c.fillStyle = 'rgb(255,255,255)';
      for (const [x, y, rad] of P) { c.beginPath(); c.arc(x + dx - rad * 0.32, y - rad * 0.42, rad * 0.6, 0, TAU); c.fill(); }
      c.restore();
    }
  };
  // Big clouds near the horizon, smaller ones higher up (v = 0 is the horizon at the bottom).
  for (let i = 0; i < 22; i++) {
    const high = r();
    const base = H * (0.97 - high * 0.62);
    cloud(r() * W, base, (1.25 - high * 0.85) * (0.7 + r() * 0.6));
  }
  // A few thin streaks high up.
  for (let i = 0; i < 18; i++) {
    const x = r() * W, y = H * (0.1 + r() * 0.35), len = 160 + r() * 380;
    for (const dx of [-W, 0, W]) {
      c.fillStyle = 'rgb(255,255,255)';
      c.beginPath(); c.ellipse(x + dx, y, len, 5 + r() * 6, 0, 0, TAU); c.fill();
    }
  }
  return cv;
}

// ---- blossoms ----------------------------------------------------------------------------------------
/** Four painted sakura clusters in a 2×2 atlas (y down, light from the upper left). */
export function paintBlossomAtlas(size = 1024) {
  const cv = makeCanvas(size, size);
  const c = cv.getContext('2d');
  const S = size / 2;
  for (let v = 0; v < 4; v++) {
    const r = rng(77 + v * 13);
    c.save();
    c.translate((v % 2) * S, Math.floor(v / 2) * S);
    const cx = S / 2, cy = S / 2;
    // Twigs peeking out from under the flowers.
    c.strokeStyle = '#5e433f'; c.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a = Math.PI * (0.25 + r() * 0.5) + (k - 1) * 0.9;
      c.lineWidth = S * (0.016 - k * 0.003);
      c.beginPath(); c.moveTo(cx, cy + S * 0.05);
      c.quadraticCurveTo(cx + Math.cos(a) * S * 0.2, cy + Math.sin(a) * S * 0.25, cx + Math.cos(a) * S * 0.42, cy + Math.sin(a) * S * 0.4);
      c.stroke();
    }
    // Lumpy silhouette: a few sub-clusters of small puffs.
    const P = [];
    const subs = 3 + Math.floor(r() * 3);
    for (let k = 0; k < subs; k++) {
      const a0 = r() * TAU, d0 = S * (0.06 + r() * 0.15);
      const sx = cx + Math.cos(a0) * d0 * 1.2, sy = cy + Math.sin(a0) * d0 * 0.8;
      const n = 7 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r());
        P.push([sx + Math.cos(a) * d * S * 0.13, sy + Math.sin(a) * d * S * 0.1, S * (0.05 + r() * 0.045)]);
      }
    }
    const p2 = new Path2D();
    for (const [x, y, rad] of P) { p2.moveTo(x + rad, y); p2.arc(x, y, rad, 0, TAU); }
    c.lineWidth = S * 0.018; c.lineJoin = 'round';
    c.strokeStyle = '#c4738f'; c.stroke(p2);
    c.fillStyle = '#e894b0'; c.fill(p2);
    c.save();
    c.clip(p2);
    c.fillStyle = '#f6bccd';
    for (const [x, y, rad] of P) { c.beginPath(); c.arc(x - rad * 0.2, y - rad * 0.24, rad * 0.86, 0, TAU); c.fill(); }
    c.fillStyle = '#fde3ea';
    for (const [x, y, rad] of P) {
      if (y > cy + S * 0.04) continue;
      c.beginPath(); c.arc(x - rad * 0.42, y - rad * 0.44, rad * 0.5, 0, TAU); c.fill();
    }
    // Individual flowers on the lit side, darker buds in the shade.
    for (let k = 0; k < 34; k++) {
      const [x, y, rad] = P[Math.floor(r() * P.length)];
      const fx = x - rad * (0.2 + r() * 0.6), fy = y - rad * (0.2 + r() * 0.6);
      const fr = S * (0.012 + r() * 0.008);
      c.fillStyle = '#fff6f8';
      for (let p = 0; p < 5; p++) {
        const a = p / 5 * TAU + r();
        c.beginPath(); c.arc(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.75, 0, TAU); c.fill();
      }
      c.fillStyle = '#e0718f';
      c.beginPath(); c.arc(fx, fy, fr * 0.38, 0, TAU); c.fill();
    }
    c.fillStyle = '#c4627f';
    for (let k = 0; k < 26; k++) {
      const [x, y, rad] = P[Math.floor(r() * P.length)];
      c.beginPath(); c.arc(x + rad * (0.1 + r() * 0.5), y + rad * (0.2 + r() * 0.5), S * 0.006, 0, TAU); c.fill();
    }
    c.restore();
    // Loose petals around the edge.
    for (let k = 0; k < 6; k++) {
      const a = r() * TAU, d = S * (0.3 + r() * 0.12);
      c.fillStyle = '#f9cdd9';
      c.beginPath(); c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, S * 0.012, S * 0.007, r() * 3, 0, TAU); c.fill();
    }
    c.restore();
  }
  return cv;
}

/** A short commuter train: cream body, green band, windows (and their light at night). */
export function paintTrain(W = 2048, H = 90) {
  const cv = makeCanvas(W, H), lv = makeCanvas(W / 2, H / 2);
  const c = cv.getContext('2d'), l = lv.getContext('2d');
  const cars = 4, gap = 10, cw = (W - gap * (cars - 1)) / cars;
  for (let i = 0; i < cars; i++) {
    const x = i * (cw + gap);
    c.fillStyle = '#f2ead8'; c.beginPath(); c.roundRect(x, 6, cw, H - 14, i === 0 || i === cars - 1 ? 12 : 3); c.fill();
    c.fillStyle = '#3f8a6a'; c.fillRect(x, H - 24, cw, 8);
    c.fillStyle = '#54606f'; c.fillRect(x, H - 14, cw, 6);
    for (let wx = x + 22; wx < x + cw - 30; wx += 46) {
      c.fillStyle = '#5b7392'; c.fillRect(wx, 16, 32, 18);
      l.fillStyle = '#ffd9a0'; l.fillRect(wx / 2, 8, 16, 9);
    }
    for (const dx of [cw * 0.25, cw * 0.72]) { c.fillStyle = '#c9c2b1'; c.fillRect(x + dx, 14, 18, H - 30); }
  }
  // Pantograph.
  c.strokeStyle = '#4a4f57'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(cw * 0.4, 6); c.lineTo(cw * 0.5, 0); c.lineTo(cw * 0.6, 6); c.stroke();
  return {canvas: cv, light: lv};
}

// ---- landmarks for the town rows (each {D, draw(ctx, lctx, v)}) ---------------------------------------
/** A five-storey pagoda (a nod to the Chureito view with Fuji behind it). */
export function pagoda(phiDeg, D, H = 560) {
  return {D, draw(ctx, lctx, v) {
    const phi = phiDeg * DEG, G = v.ground;
    const s = v.S(phi);
    if (s < v.sA - 400 || s > v.sB + 400) return;
    const P = (x, h) => v.proj(phi, x, D, h);
    const hz = c => mix(c, HAZE, 0.32);
    const body = H * 0.74, tier = body / 5;
    // Stone base.
    poly(ctx, [P(-52, G), P(52, G), P(52, G + 14), P(-52, G + 14)], hz('#b9b2a6'));
    for (let i = 0; i < 5; i++) {
      const y = G + 14 + i * tier, bw = 36 - i * 4.2, ew = 66 - i * 6.5;
      poly(ctx, [P(-bw, y), P(bw, y), P(bw, y + tier * 0.62), P(-bw, y + tier * 0.62)], hz('#c4563e'));
      poly(ctx, [P(-bw, y + tier * 0.5), P(bw, y + tier * 0.5), P(bw, y + tier * 0.62), P(-bw, y + tier * 0.62)], hz('#f1e5cf'));
      // Eaves with upturned tips.
      const ey = y + tier * 0.62;
      poly(ctx, [P(-ew - 6, ey + tier * 0.12), P(-ew, ey), P(ew, ey), P(ew + 6, ey + tier * 0.12), P(bw * 0.8, ey + tier * 0.38), P(-bw * 0.8, ey + tier * 0.38)], hz('#3d4250'));
      line(ctx, P(-ew, ey + 0.8), P(ew, ey + 0.8), hz('#8a8f9c'), 1.2);
    }
    // Spire with rings.
    const sy = G + 14 + body;
    line(ctx, P(0, sy), P(0, G + H), hz('#7b6a48'), 4);
    for (let k = 0; k < 9; k++) line(ctx, P(-6, sy + 12 + k * (H - body - 30) / 10), P(6, sy + 12 + k * (H - body - 30) / 10), hz('#8d7b55'), 2.2);
    if (lctx) for (let i = 0; i < 5; i++) { const [lx, ly] = P(0, G + 14 + i * tier + tier * 0.3); disc(lctx, lx, ly, 3 * v.R / D, '#ffb070'); }
  }};
}

/** An elevated railway (the train itself is a separate moving strip). */
export function viaduct(D, deck = 200) {
  return {D, draw(ctx, lctx, v) {
    const G = v.ground, f = v.R / D;
    const P = (phi, h) => v.proj(phi, 0, D, h);
    const col = mix('#c9c6bf', HAZE, 0.38), under = mix('#8f8c88', HAZE, 0.38);
    const a = Math.max(v.phi0, (v.sA - 60) / v.R + v.phi0), b = Math.min(v.phi1, (v.sB + 60) / v.R + v.phi0);
    // Piers every 25 m.
    const step = 520 / D;
    for (let phi = Math.ceil(a / step) * step; phi <= b; phi += step) {
      const [x0, y0] = P(phi, G), [, y1] = P(phi, G + deck - 14);
      ctx.fillStyle = under; ctx.fillRect(x0 - 16 * f, y0, 32 * f, y1 - y0);
    }
    const [xa, ya] = P(a, G + deck - 16), [xb] = P(b, G + deck - 16), [, yb] = P(a, G + deck);
    ctx.fillStyle = under; ctx.fillRect(xa, ya, xb - xa, (yb - ya) * 0.35);
    ctx.fillStyle = col; ctx.fillRect(xa, ya + (yb - ya) * 0.35, xb - xa, (yb - ya) * 0.65);
    // Overhead line masts and wire.
    const ink = mix('#5a5560', HAZE, 0.4);
    for (let phi = Math.ceil(a / (step * 2)) * step * 2; phi <= b; phi += step * 2) line(ctx, P(phi, G + deck), P(phi, G + deck + 110), ink, Math.max(0.5, 5 * f));
    const [wa, wy] = P(a, G + deck + 96), [wb] = P(b, G + deck + 96);
    line(ctx, [wa, wy], [wb, wy], ink, Math.max(0.4, 2 * f));
  }};
}

/** The bathhouse chimney. */
export function chimney(phiDeg, D, H = 520) {
  return {D, draw(ctx, lctx, v) {
    const phi = phiDeg * DEG, G = v.ground;
    if (v.S(phi) < v.sA - 200 || v.S(phi) > v.sB + 200) return;
    const P = (x, h) => v.proj(phi, x, D, h);
    poly(ctx, [P(-17, G), P(17, G), P(11, G + H), P(-11, G + H)], mix('#ece6dc', HAZE, 0.3));
    poly(ctx, [P(-12, G + H - 50), P(12, G + H - 50), P(11, G + H), P(-11, G + H)], mix('#c9483c', HAZE, 0.3));
    if (lctx) { const [lx, ly] = P(0, G + H); disc(lctx, lx, ly, 8 * v.R / D, '#ff4a3a'); }
  }};
}

/** A shrine grove: dark green trees around a vermilion torii. */
export function shrine(phiDeg, D) {
  return {D, draw(ctx, lctx, v) {
    const phi = phiDeg * DEG, G = v.ground, f = v.R / D;
    if (v.S(phi) < v.sA - 500 || v.S(phi) > v.sB + 500) return;
    const r = rng(404);
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 46 + (r() - 0.5) * 20, size = 60 + r() * 40;
      const [cx, cy] = v.proj(phi, x, D + 80, G + size * 1.3);
      puffs(ctx, cx, cy, size * f * 0.8, size * f * 0.7, 8, r, ['#3e6b52', '#4f8463', '#76a77a'].map(c => mix(c, HAZE, 0.25)), {flat: true});
    }
    const P = (x, h) => v.proj(phi, x, D, h);
    const red = mix('#d0473a', HAZE, 0.2);
    for (const x of [-26, 26]) poly(ctx, [P(x - 3.5, G), P(x + 3.5, G), P(x + 3, G + 92), P(x - 3, G + 92)], red);
    poly(ctx, [P(-44, G + 92), P(44, G + 92), P(48, G + 104), P(-48, G + 104)], mix('#2f2a2e', HAZE, 0.2));
    poly(ctx, [P(-36, G + 76), P(36, G + 76), P(36, G + 82), P(-36, G + 82)], red);
  }};
}
