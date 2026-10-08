// Paper formats, page layout and the typewriter-ink renderer shared by the
// live sheet, the stacked sheets and PDF export.

export const FORMATS = {
  a4: {id: 'a4', label: 'A4 竖版', short: 'A4', width: 4.4, height: 4.4 * Math.SQRT2, pdf: [595.28, 841.89]},
  wide: {id: 'wide', label: '16:9 横版', short: '16:9', width: 6.0, height: 6.0 * 9 / 16, pdf: [841.89, 473.56]},
  square: {id: 'square', label: '1:1 方形', short: '1:1', width: 4.4, height: 4.4, pdf: [595.28, 595.28]},
};

export const PAPER_COLORS = [
  {id: 'ivory', label: '象牙白', color: '#f6eedb'},
  {id: 'washi', label: '和纸', color: '#efe4cc'},
  {id: 'sakura', label: '樱花', color: '#f6e1df'},
  {id: 'matcha', label: '抹茶', color: '#e3ead2'},
  {id: 'sora', label: '天空', color: '#dfe9ef'},
];

const CELL_W = 0.08;     // world units per column (≈ 3.8 mm)
const LINE_H = 0.16;     // world units per row (2:1 cell, like pica 10/6)
const MARGIN_TOP = 0.5;
const MIN_MARGIN_X = 0.36;
const MARGIN_BOTTOM = 0.4;
const PX_PER_UNIT = 330;

export function makeLayout(formatId) {
  const f = FORMATS[formatId] || FORMATS.a4;
  const cols = Math.floor((f.width - 2 * MIN_MARGIN_X) / CELL_W);
  const rows = Math.floor((f.height - MARGIN_TOP - MARGIN_BOTTOM) / LINE_H);
  const marginX = (f.width - cols * CELL_W) / 2;
  const texW = Math.round(f.width * PX_PER_UNIT), texH = Math.round(f.height * PX_PER_UNIT);
  return {
    format: f.id, label: f.label, W: f.width, H: f.height, cols, rows,
    cellW: CELL_W, lineH: LINE_H, marginX, marginTop: MARGIN_TOP,
    texW, texH,
    /** Pixel metrics for a canvas of the sheet at the given scale. */
    px(scale = 1) {
      const k = PX_PER_UNIT * scale;
      return {
        w: Math.round(f.width * k), h: Math.round(f.height * k),
        cell: CELL_W * k, line: LINE_H * k, left: marginX * k, top: MARGIN_TOP * k,
        font: CELL_W * k / 0.6,
      };
    },
    /** Paper-local x (centre = 0) of the middle of column c. */
    colX(c) { return -f.width / 2 + marginX + (c + 0.5) * CELL_W; },
    /** Distance from the top edge to the printing line of row r. */
    rowV(r) { return MARGIN_TOP + (r + 0.62) * LINE_H; },
  };
}

// ---- cell records -------------------------------------------------------------
export const F_BOLD = 1, F_ITALIC = 2, F_DIM = 4, F_UNDERLINE = 8, F_INVERSE = 16, F_INVISIBLE = 32, F_STRIKE = 64;

const INK = ['#2b2622', '#a7392f', '#3f6b47', '#8d6a2a', '#35577a', '#7a4466', '#367271', '#9a8f7d',
  '#5e5650', '#c4483c', '#4f8a57', '#b08a3c', '#4c78a3', '#a05f88', '#4d9693', '#d8ccb4'];
export const DEFAULT_INK = '#2b2622';

function ansi256(n) {
  if (n < 16) return INK[n];
  if (n > 231) { const g = 8 + (n - 232) * 10; return `rgb(${g},${g},${g})`; }
  n -= 16;
  const v = [0, 95, 135, 175, 215, 255];
  return `rgb(${v[Math.floor(n / 36)]},${v[Math.floor(n / 6) % 6]},${v[n % 6]})`;
}
function cellColor(cell, fg) {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return null;
  const n = fg ? cell.getFgColor() : cell.getBgColor();
  if (fg ? cell.isFgRGB() : cell.isBgRGB()) return '#' + n.toString(16).padStart(6, '0');
  return ansi256(n);
}

/**
 * Reads one xterm IBufferCell into a plain record (copied data, never a
 * reference to xterm's reusable cell). Returns null for an empty cell.
 */
export function readCell(cell) {
  const w = cell.getWidth();
  if (w === 0) return null;                 // trailing half of a wide char
  const ch = cell.getChars();
  const fg = cellColor(cell, true), bg = cellColor(cell, false);
  let flags = 0;
  if (cell.isBold()) flags |= F_BOLD;
  if (cell.isItalic()) flags |= F_ITALIC;
  if (cell.isDim()) flags |= F_DIM;
  if (cell.isUnderline()) flags |= F_UNDERLINE;
  if (cell.isInverse()) flags |= F_INVERSE;
  if (cell.isInvisible()) flags |= F_INVISIBLE;
  if (cell.isStrikethrough()) flags |= F_STRIKE;
  const blank = (ch === '' || ch === ' ') && !bg && !(flags & (F_INVERSE | F_UNDERLINE | F_STRIKE));
  if (blank) return null;
  return {ch: ch || ' ', w, fg, bg, flags};
}
export const signature = rec => rec ? `${rec.ch}\u0001${rec.fg || ''}\u0001${rec.bg || ''}\u0001${rec.flags}` : '';
/** True when the record leaves visible ink that a typebar could strike. */
export const isGlyph = rec => !!rec && rec.ch !== ' ' && !(rec.flags & F_INVISIBLE) && !rec.bg && !(rec.flags & F_INVERSE);

// ---- drawing --------------------------------------------------------------------
function hash3(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return h;
}
function rand01(h, k) { return (hash3(h, k, 977) % 100000) / 100000; }

let wearPattern = null;
function getWear(ctx) {
  if (!wearPattern) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 192;
    const c = cv.getContext('2d');
    let s = 99;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.6})`;
      const x = r() * 192, y = r() * 192, rad = 0.4 + r() * 1.3;
      c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
    }
    // Faint horizontal ribbon weave.
    for (let y = 0; y < 192; y += 3) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(0, y, 192, 1); }
    wearPattern = cv;
  }
  return ctx.createPattern(wearPattern, 'repeat');
}

const LATIN = '"Courier Prime", "Courier New", Courier';
const CJK = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif';
export const PAPER_FONT = `${LATIN}, ${CJK}`;

/**
 * Draws one cell's ink on a transparent ink-layer canvas context.
 * seed makes the jitter stable for a given sheet.
 */
export function drawInk(ctx, m, r, c, rec, seed, paperColor) {
  const h = hash3(seed, r, c);
  const x = m.left + c * m.cell, y = m.top + r * m.line;
  const w = m.cell * rec.w;
  let fg = rec.fg || DEFAULT_INK;
  let bg = rec.bg;
  if (rec.flags & F_INVERSE) { const old = fg; fg = bg || paperColor; bg = old; }
  ctx.save();
  if (bg) {
    // Backgrounds read as a soft marker wash rather than a solid block.
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = bg;
    ctx.fillRect(x - 0.5, y + m.line * 0.06, w + 1, m.line * 0.92);
    ctx.globalAlpha = 1;
  }
  if (!(rec.flags & F_INVISIBLE) && rec.ch !== ' ') {
    const jx = (rand01(h, 1) - 0.5) * m.cell * 0.07;
    const jy = (rand01(h, 2) - 0.5) * m.line * 0.05;
    const rot = (rand01(h, 3) - 0.5) * 0.035;
    const density = 0.8 + rand01(h, 4) * 0.18;
    const size = m.font * (rec.w > 1 ? 0.86 : 1);
    ctx.translate(x + w / 2 + jx, y + m.line * 0.62 + jy);
    ctx.rotate(rot);
    ctx.font = `${rec.flags & F_ITALIC ? 'italic ' : ''}${rec.flags & F_BOLD ? '700' : '400'} ${size.toFixed(1)}px ${PAPER_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = fg;
    ctx.globalAlpha = density * (rec.flags & F_DIM ? 0.5 : 1);
    ctx.fillText(rec.ch, 0, size * 0.28, w * 1.1);
    // A faint offset second impression: ribbon bleed.
    ctx.globalAlpha *= 0.16;
    ctx.fillText(rec.ch, m.cell * 0.025, size * 0.28 + m.cell * 0.02, w * 1.1);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rec.flags & F_UNDERLINE) { ctx.fillStyle = fg; ctx.globalAlpha = 0.85; ctx.fillRect(x, y + m.line * 0.8, w, Math.max(1.5, m.line * 0.035)); }
    if (rec.flags & F_STRIKE) { ctx.fillStyle = fg; ctx.globalAlpha = 0.85; ctx.fillRect(x, y + m.line * 0.48, w, Math.max(1.5, m.line * 0.035)); }
    // Worn ribbon: knock speckles out of the fresh ink, varying per glyph.
    ctx.globalAlpha = 0.22 + rand01(h, 5) * 0.2;
    ctx.globalCompositeOperation = 'destination-out';
    const pattern = getWear(ctx);
    const ox = Math.floor(rand01(h, 6) * 190), oy = Math.floor(rand01(h, 7) * 190);
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(x + ox - 2, y + oy, w + 4, m.line);
  }
  ctx.restore();
}

/** Paints the paper body: tone, fibres, slight edge shading. */
export function paintPaper(ctx, w, h, color, seed = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  let s = seed * 7919 + 13;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const count = Math.round(w * h / 160);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 3 ? 'rgba(120,90,50,.035)' : 'rgba(255,255,250,.14)';
    const x = r() * w, y = r() * h;
    ctx.fillRect(x, y, 0.8 + r() * 2.4, 0.5 + r() * 1.2);
  }
  // Long washi fibres.
  ctx.strokeStyle = 'rgba(140,110,70,.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < w * h / 9000; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 10 + r() * 40;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r() * 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(110,80,40,.06)'); g.addColorStop(0.04, 'rgba(110,80,40,0)');
  g.addColorStop(0.96, 'rgba(110,80,40,0)'); g.addColorStop(1, 'rgba(110,80,40,.07)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/**
 * Renders a full archived page (cells: rows of [col, rec]) onto a new canvas.
 * Used for PDF export and page thumbnails.
 */
export function renderPage(page, scale = 1) {
  const layout = makeLayout(page.format);
  const m = layout.px(scale);
  const canvas = document.createElement('canvas');
  canvas.width = m.w; canvas.height = m.h;
  const ctx = canvas.getContext('2d');
  paintPaper(ctx, m.w, m.h, page.paperColor, page.seed);
  const ink = document.createElement('canvas');
  ink.width = m.w; ink.height = m.h;
  const ictx = ink.getContext('2d');
  page.rows.forEach((row, r) => {
    for (const [c, rec] of row) drawInk(ictx, m, r, c, rec, page.seed, page.paperColor);
  });
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(ink, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export function pageText(page) {
  return page.rows.map(row => {
    let line = '', col = 0;
    for (const [c, rec] of row) {
      while (col < c) { line += ' '; col++; }
      line += rec.flags & F_INVISIBLE ? ' ' : rec.ch;
      col += rec.w;
    }
    return line.replace(/\s+$/, '');
  }).join('\n').replace(/\n+$/, '');
}

// ---- colours for full-screen programs on paper ---------------------------------
// Programs like btop pick colours for dark terminals; on cream paper the light
// ones would vanish. Keep the hue, cap the brightness, add a little saturation.
const inkCache = new Map();
export function paperInk(color) {
  if (!color) return null;
  let out = inkCache.get(color);
  if (out) return out;
  let r, g, b;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  else {
    const p = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
    if (!p) return color;
    [r, g, b] = [+p[1], +p[2], +p[3]];
  }
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cap = 118;
  if (lum > cap) { const k = cap / lum; r *= k; g *= k; b *= k; }
  const mean = (r + g + b) / 3;
  r = Math.max(0, Math.min(255, mean + (r - mean) * 1.25));
  g = Math.max(0, Math.min(255, mean + (g - mean) * 1.25));
  b = Math.max(0, Math.min(255, mean + (b - mean) * 1.25));
  out = '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  inkCache.set(color, out);
  return out;
}
