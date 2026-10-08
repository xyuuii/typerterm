// The live sheet in the machine and the finished sheets on the desk.
//
// Live sheet: a subdivided surface whose every row is placed on the paper
// path by arclength (geometry.js). The path wraps the platen (contact), is
// held under the bail (clamped segment) and continues as a free segment whose
// lean grows with length and with lower stiffness (a visual cantilever
// approximation, not a calibrated material model). Text lives in the sheet's
// texture, so it is bound to the paper coordinates and bends with it.
import * as THREE from 'three';
import {toon} from './toon.js';
import {PaperPath, S_EXIT, S_BACK} from './geometry.js';
import {paintPaper, drawInk, paperInk, signature, DEFAULT_INK, PAPER_FONT, F_BOLD, F_ITALIC, F_DIM, F_UNDERLINE, F_INVERSE, F_INVISIBLE, F_STRIKE} from './ink.js';
import {drawSpecial} from './magic.js';

const NO_GLOW = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
NO_GLOW.needsUpdate = true;

function paperMaterial(texture, tint, glow = null) {
  const material = toon(0xffffff, {map: texture, side: THREE.DoubleSide, spec: 0, rim: 0.1, rimColor: 0xfff6e0});
  const base = material.onBeforeCompile;
  const uniforms = {
    paperTint: {value: new THREE.Color(tint)},
    glowMap: {value: glow?.texture || NO_GLOW},
    gridRect: {value: glow?.rect || new THREE.Vector4(0, 0, 1, 1)},
  };
  material.userData.paperUniforms = uniforms;
  material.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 paperTint;\nuniform sampler2D glowMap;\nuniform vec4 gridRect;\nvoid main() {')
      .replace('#include <map_fragment>', `#include <map_fragment>
      // The reverse side shows the text only faintly, mirrored through the sheet.
      if ( !gl_FrontFacing ) diffuseColor.rgb = mix( paperTint, diffuseColor.rgb, 0.14 );
      {
        // Magic corrections: cells that were erased or overwritten glow briefly.
        vec2 g = vec2((vMapUv.x - gridRect.x) / gridRect.z, ((1.0 - vMapUv.y) - gridRect.y) / gridRect.w);
        float inside = step(0.0, g.x) * step(g.x, 1.0) * step(0.0, g.y) * step(g.y, 1.0);
        float fl = texture2D(glowMap, g).r * inside * float(gl_FrontFacing);
        // The ink itself turns amber-gold; the paper only gets a faint warm halo.
        // Kept under the bloom threshold so changing digits stay readable.
        float paperLum = max(dot(paperTint, vec3(0.299, 0.587, 0.114)), 0.05);
        float ink = clamp(1.0 - dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) / paperLum, 0.0, 1.0);
        totalEmissiveRadiance += vec3(0.95, 0.58, 0.16) * fl * (0.05 + ink * 0.5);
      }`);
  };
  material.customProgramCacheKey = () => 'ink-toon-paper-v4';
  return material;
}

export class LiveSheet {
  constructor(layout, paperColor, path, seed) {
    this.layout = layout;
    this.paperColor = paperColor;
    this.path = path;
    this.seed = seed;
    this.m = layout.px(1);
    const {w, h} = this.m;
    this.base = document.createElement('canvas'); this.base.width = w; this.base.height = h;
    this.ink = document.createElement('canvas'); this.ink.width = w; this.ink.height = h;
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.bctx = this.base.getContext('2d');
    this.ictx = this.ink.getContext('2d');
    this.ctx = this.canvas.getContext('2d');
    paintPaper(this.bctx, w, h, paperColor, seed);
    this.ctx.drawImage(this.base, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 16;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.segX = 14;
    this.segY = Math.max(40, Math.ceil(layout.H / 0.035));
    this.geometry = new THREE.PlaneGeometry(layout.W, layout.H, this.segX, this.segY);
    this.paperRect = new THREE.Vector4(layout.marginX / layout.W, layout.marginTop / layout.H, layout.cols * layout.cellW / layout.W, layout.rows * layout.lineH / layout.H);
    this.makeGlow(layout.cols, layout.rows);
    this.material = paperMaterial(this.texture, paperColor, {texture: this.glowTex, rect: this.paperRect.clone()});
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Live sheet';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.sTop = S_BACK;      // fully on the paper table until fed
    this.dirtyTex = true;
    this.overlayRects = [];
    this._sample = [0, 0, 0, 0];
    this.layoutGeometry(true);
  }
  /** Places the sheet so its top edge is at arclength sTop on the path. */
  setFeed(sTop) {
    if (Math.abs(sTop - this.sTop) < 1e-5) return;
    this.sTop = sTop;
    this.layoutGeometry();
  }
  layoutGeometry() {
    const pos = this.geometry.attributes.position.array;
    const nrm = this.geometry.attributes.normal.array;
    const {W, H} = this.layout;
    const sx = this.segX, sy = this.segY, out = this._sample;
    let k = 0;
    for (let j = 0; j <= sy; j++) {
      const v = (j / sy) * H;
      this.path.sample(this.sTop - v, out);
      for (let i = 0; i <= sx; i++, k += 3) {
        pos[k] = (i / sx - 0.5) * W;
        pos[k + 1] = out[0];
        pos[k + 2] = out[1];
        nrm[k] = 0; nrm[k + 1] = out[2]; nrm[k + 2] = out[3];
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
  /** World-space vertex grid at a coarser resolution (for hand-off to the stack). */
  sampleGrid(nx, ny, carriageX) {
    const {W, H} = this.layout, out = this._sample;
    const pts = new Float32Array((nx + 1) * (ny + 1) * 3);
    let k = 0;
    for (let j = 0; j <= ny; j++) {
      this.path.sample(this.sTop - (j / ny) * H, out);
      for (let i = 0; i <= nx; i++, k += 3) {
        pts[k] = carriageX + (i / nx - 0.5) * W; pts[k + 1] = out[0]; pts[k + 2] = out[1];
      }
    }
    return pts;
  }
  cellRect(r, c, w = 1) {
    const m = this.m;
    // Generous padding: jittered glyphs may overhang their cell slightly.
    return [Math.floor(m.left + c * m.cell - m.cell * 0.4), Math.floor(m.top + r * m.line - m.line * 0.25), Math.ceil(m.cell * (w + 0.8)), Math.ceil(m.line * 1.5)];
  }
  composite(rect) {
    const [x, y, w, h] = rect || [0, 0, this.m.w, this.m.h];
    const cx = Math.max(0, x), cy = Math.max(0, y);
    const cw = Math.min(this.m.w, x + w) - cx, ch = Math.min(this.m.h, y + h) - cy;
    if (cw <= 0 || ch <= 0) return;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.base, cx, cy, cw, ch, cx, cy, cw, ch);
    this.ctx.globalCompositeOperation = 'multiply';
    this.ctx.drawImage(this.ink, cx, cy, cw, ch, cx, cy, cw, ch);
    this.ctx.globalCompositeOperation = 'source-over';
    this.dirtyTex = true;
  }
  /** Ink one cell (a typebar has just struck it). */
  strikeCell(r, c, rec) {
    drawInk(this.ictx, this.m, r, c, rec, this.seed, this.paperColor);
    const rect = this.cellRect(r, c, rec.w);
    this.composite(rect);
    this.redrawOverlay(rect);
  }
  /** Replace a cell digitally (erase, overwrite, recolour). */
  replaceCell(r, c, rec, oldWidth = 1) {
    const m = this.m;
    const x = m.left + c * m.cell, y = m.top + r * m.line;
    this.ictx.clearRect(Math.floor(x) - 1, Math.floor(y), Math.ceil(m.cell * Math.max(oldWidth, rec?.w || 1)) + 2, Math.ceil(m.line));
    if (rec) drawInk(this.ictx, m, r, c, rec, this.seed, this.paperColor);
    const rect = this.cellRect(r, c, Math.max(oldWidth, rec?.w || 1));
    this.composite(rect);
    this.redrawOverlay(rect);
  }
  /** Redraw all ink from a grid of records (array rows×cols, null = blank). */
  redrawAll(grid, rows, cols) {
    this.ictx.clearRect(0, 0, this.m.w, this.m.h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const rec = grid[r * cols + c];
      if (rec) drawInk(this.ictx, this.m, r, c, rec, this.seed, this.paperColor);
    }
    this.composite();
    this.redrawOverlay();
  }
  setPaperColor(color) {
    this.paperColor = color;
    paintPaper(this.bctx, this.m.w, this.m.h, color, this.seed);
    this.material.userData.paperUniforms.paperTint.value.set(color);
    this.composite();
    this.redrawOverlay();
  }
  /**
   * Transient marks drawn on top of the ink: a pencil caret at the printing
   * position and in-progress IME composition. Never archived.
   */
  setOverlay(items) {
    const old = this.overlayRects;
    this.overlay = items;
    for (const rect of old) this.composite(rect);
    this.overlayRects = [];
    this.redrawOverlay();
  }
  redrawOverlay(onlyRect) {
    if (!this.overlay) return;
    const m = this.m, ctx = this.ctx;
    for (const item of this.overlay) {
      const x = m.left + item.c * m.cell, y = m.top + item.r * m.line;
      let rect;
      if (item.type === 'bar') {
        rect = [Math.floor(item.x - 2), Math.floor(item.y - 2), Math.ceil(item.w + 4), Math.ceil(item.h + 4)];
        if (onlyRect && !overlaps(rect, onlyRect)) continue;
        ctx.fillStyle = 'rgba(196,86,64,.75)';
        ctx.fillRect(item.x, item.y, item.w, item.h);
      } else if (item.type === 'caret') {
        rect = [Math.floor(x - 2), Math.floor(y + m.line * 0.78), Math.ceil(m.cell + 4), Math.ceil(m.line * 0.2)];
        if (onlyRect && !overlaps(rect, onlyRect)) continue;
        ctx.fillStyle = 'rgba(196,86,64,.55)';
        ctx.fillRect(x + m.cell * 0.12, y + m.line * 0.82, m.cell * 0.76, Math.max(2, m.line * 0.05));
      } else if (item.type === 'compose' && item.text) {
        ctx.font = `400 ${(m.font * 0.92).toFixed(1)}px "Courier Prime", "Songti SC", "STSong", serif`;
        const width = ctx.measureText(item.text).width;
        rect = [Math.floor(x - 4), Math.floor(y - 2), Math.ceil(width + 10), Math.ceil(m.line + 6)];
        if (onlyRect && !overlaps(rect, onlyRect)) continue;
        ctx.fillStyle = 'rgba(90,110,150,.55)';
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillText(item.text, x, y + m.line * 0.62 + m.font * 0.28);
        ctx.fillRect(x, y + m.line * 0.86, width, 2);
      }
      // Partial redraws repaint items already tracked by the last full pass.
      if (rect && !onlyRect) this.overlayRects.push(rect);
    }
    this.dirtyTex = true;
  }
  flushTexture() {
    if (this.dirtyTex) { this.texture.needsUpdate = true; this.dirtyTex = false; }
  }
  /** (Re)create the per-cell glow grid. */
  makeGlow(cols, rows) {
    this.glowTex?.dispose();
    this.glowCols = cols;
    this.glowF = new Float32Array(cols * rows);
    this.glowData = new Uint8Array(cols * rows);
    this.glowTex = new THREE.DataTexture(this.glowData, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.glowTex.unpackAlignment = 1;          // rows of e.g. 46 bytes are not 4-aligned
    this.glowTex.minFilter = this.glowTex.magFilter = THREE.LinearFilter;
    this.glowTex.needsUpdate = true;
    const u = this.material?.userData.paperUniforms;
    if (u) u.glowMap.value = this.glowTex;
  }

  // ---- full-screen programs, drawn live on this sheet -------------------------
  /**
   * Switch the sheet to a cols × rows screen fitted inside the text area
   * (cells keep a 1:2 shape; the block is centred horizontally).
   */
  enterAlt(cols, rows) {
    const m = this.m;
    const areaW = m.cell * this.layout.cols, areaH = m.line * this.layout.rows;
    let cw = areaW / cols, lh = cw * 2;
    if (lh * rows > areaH) { lh = areaH / rows; cw = lh / 2; }
    this.alt = {cols, rows, cw, lh, left: m.left + (areaW - cw * cols) / 2, top: m.top, prev: new Array(cols * rows).fill(''), prevW: new Uint8Array(cols * rows)};
    this.setOverlay(null);
    this.ictx.clearRect(0, 0, m.w, m.h);
    this.composite();
    this.makeGlow(cols, rows);
    this.material.userData.paperUniforms.gridRect.value.set(this.alt.left / m.w, this.alt.top / m.h, cw * cols / m.w, lh * rows / m.h);
  }
  exitAlt() {
    if (!this.alt) return;
    this.alt = null;
    this.setOverlay(null);
    this.ictx.clearRect(0, 0, this.m.w, this.m.h);
    this.composite();
    this.makeGlow(this.layout.cols, this.layout.rows);
    this.material.userData.paperUniforms.gridRect.value.copy(this.paperRect);
  }
  /** Centre (machine frame), outward normal and size of the screen block. */
  altFrame(carriageX) {
    const a = this.alt;
    if (!a) return null;
    const k = this.m.cell / this.layout.cellW;
    const p = this.path.sample(this.sTop - (a.top + a.rows * a.lh / 2) / k, [0, 0, 0, 0]);
    const cx = carriageX - this.layout.W / 2 + (a.left + a.cols * a.cw / 2) / k;
    return {center: [cx, p[0], p[1]], normal: [0, p[2], p[3]], width: a.cols * a.cw / k, height: a.rows * a.lh / k};
  }
  /** World distance from the top edge to the bottom of the screen block. */
  altBlockBottom() {
    const a = this.alt;
    return a ? (a.top + a.rows * a.lh) / (this.m.cell / this.layout.cellW) : 0;
  }
  drawAltCell(r, c, rec) {
    const a = this.alt, ctx = this.ictx;
    const x = a.left + c * a.cw, y = a.top + r * a.lh, w = a.cw * Math.max(1, rec?.w || 1);
    ctx.clearRect(x - 0.5, y - 0.5, w + 1, a.lh + 1);
    if (rec) {
      let fg = paperInk(rec.fg) || DEFAULT_INK;
      let bg = rec.bg ? paperInk(rec.bg) : null;
      let bgAlpha = 0.28;
      if (rec.flags & F_INVERSE) { bg = fg; fg = this.paperColor; bgAlpha = 0.86; }
      if (bg) { ctx.globalAlpha = bgAlpha; ctx.fillStyle = bg; ctx.fillRect(x, y, w, a.lh); ctx.globalAlpha = 1; }
      if (!(rec.flags & F_INVISIBLE) && rec.ch !== ' ') {
        ctx.globalAlpha = rec.flags & F_DIM ? 0.5 : 0.94;
        if (!drawSpecial(ctx, rec.ch, x, y, w, a.lh, fg)) {
          const size = (a.cw / 0.6) * (rec.w > 1 ? 0.86 : 1);
          ctx.font = `${rec.flags & F_ITALIC ? 'italic ' : ''}${rec.flags & F_BOLD ? '700' : '400'} ${size.toFixed(1)}px ${PAPER_FONT}`;
          ctx.fillStyle = fg;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(rec.ch, x + w / 2, y + a.lh * 0.55, w * 1.08);
          if (rec.flags & F_UNDERLINE) ctx.fillRect(x, y + a.lh * 0.86, w, Math.max(1, a.lh * 0.05));
          if (rec.flags & F_STRIKE) ctx.fillRect(x, y + a.lh * 0.5, w, Math.max(1, a.lh * 0.05));
        }
        ctx.globalAlpha = 1;
      }
    }
    const rect = [Math.floor(x) - 2, Math.floor(y) - 2, Math.ceil(w) + 4, Math.ceil(a.lh) + 4];
    this.composite(rect);
    this.redrawOverlay(rect);
  }
  /** Show the latest full screen; returns the indices of changed cells. */
  altUpdate(screen, cursor) {
    const a = this.alt;
    if (!a || screen.cols !== a.cols || screen.rows !== a.rows) return [];
    const changed = [];
    const {grid, cols} = screen;
    for (let i = 0; i < grid.length; i++) {
      const sig = signature(grid[i]);
      if (sig === a.prev[i]) continue;
      const r = Math.floor(i / cols), c = i % cols;
      // A wide glyph that shrank leaves its old right half behind: repaint it.
      if (a.prevW[i] > 1 && (!grid[i] || grid[i].w < 2) && c + 1 < cols) this.drawAltCell(r, c + 1, grid[i + 1] || null);
      this.drawAltCell(r, c, grid[i]);
      a.prev[i] = sig;
      a.prevW[i] = grid[i]?.w || 0;
      changed.push(i);
    }
    // Small updates flare; a whole-screen repaint only shimmers.
    const flare = changed.length > grid.length * 0.4 ? 0.2 : changed.length > grid.length * 0.1 ? 0.45 : 0.8;
    for (const i of changed) this.glowF[i] = Math.max(this.glowF[i], flare);
    if (changed.length) this.glowActive = true;
    const items = cursor ? [{type: 'bar', x: a.left + cursor.c * a.cw + a.cw * 0.1, y: a.top + cursor.r * a.lh + a.lh * 0.84, w: a.cw * 0.8, h: Math.max(2, a.lh * 0.06)}] : null;
    const key = cursor ? `${cursor.r}:${cursor.c}` : '';
    if (key !== this.altCursorKey) { this.altCursorKey = key; this.setOverlay(items); }
    return changed;
  }
  /** World position (machine frame) of a full-screen cell. */
  altCellWorld(i, carriageX, out) {
    const a = this.alt;
    const r = Math.floor(i / a.cols), c = i % a.cols;
    const k = this.m.cell / this.layout.cellW;
    const p = this.path.sample(this.sTop - (a.top + (r + 0.5) * a.lh) / k, this._sample);
    return out.set(carriageX - this.layout.W / 2 + (a.left + (c + 0.5) * a.cw) / k, p[0] + p[2] * 0.03, p[1] + p[3] * 0.03);
  }
  glowCell(r, c) {
    const i = r * this.glowCols + c;
    if (i >= 0 && i < this.glowF.length) { this.glowF[i] = 1; this.glowActive = true; }
  }
  tickGlow(dt) {
    if (!this.glowActive) return;
    const decay = Math.exp(-dt * (this.alt ? 3.6 : 2.8));
    let any = false;
    for (let i = 0; i < this.glowF.length; i++) {
      if (this.glowF[i] > 0.004) { this.glowF[i] *= decay; any = true; } else this.glowF[i] = 0;
      this.glowData[i] = Math.round(this.glowF[i] * 255);
    }
    this.glowTex.needsUpdate = true;
    this.glowActive = any;
  }
  /** World position (machine frame) of a cell on the sheet. */
  cellWorld(r, c, carriageX, out) {
    const p = this.path.sample(this.sTop - this.layout.rowV(r), this._sample);
    return out.set(carriageX + this.layout.colX(c), p[0] + p[2] * 0.03, p[1] + p[3] * 0.03);
  }
  /** A downscaled copy of the sheet (base + ink, no overlay) for the stack. */
  snapshot(scale = 0.5) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(this.m.w * scale); cv.height = Math.round(this.m.h * scale);
    const c = cv.getContext('2d');
    c.drawImage(this.base, 0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'multiply';
    c.drawImage(this.ink, 0, 0, cv.width, cv.height);
    return cv;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.glowTex.dispose();
  }
}

function overlaps(a, b) {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

// ---------------------------------------------------------------------------
// A finished sheet leaving the machine: lifted out along its lean, carried in
// a short arc and laid down on the stack. The motion is choreographed
// (rigid frame + local bending blended over time), not a physics simulation.
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class StackSheet {
  constructor(scene, {canvas, layout, paperColor, grid, nx, ny, target, index, now, instant = false}) {
    this.layout = layout;
    this.nx = nx; this.ny = ny;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.geometry = new THREE.PlaneGeometry(layout.W, layout.H, nx, ny);
    this.material = paperMaterial(this.texture, paperColor);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Finished sheet';
    scene.add(this.mesh);
    this.start = now;
    this.done = false;
    // Start frame from the sampled live geometry.
    const count = (nx + 1) * (ny + 1);
    const center = new THREE.Vector3();
    for (let i = 0; i < count; i++) center.add(_v.set(grid[i * 3], grid[i * 3 + 1], grid[i * 3 + 2]));
    center.multiplyScalar(1 / count);
    const top = new THREE.Vector3(), bottom = new THREE.Vector3();
    for (let i = 0; i <= nx; i++) {
      top.add(_v.set(grid[i * 3], grid[i * 3 + 1], grid[i * 3 + 2]));
      const b = (ny * (nx + 1) + i) * 3;
      bottom.add(_v.set(grid[b], grid[b + 1], grid[b + 2]));
    }
    const up = top.sub(bottom).normalize();            // sheet "up" (towards its top edge)
    const right = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(right, up).normalize();
    up.crossVectors(normal, right).normalize();
    this.q0 = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(right, up, normal));
    this.c0 = center.clone();
    const inv = this.q0.clone().invert();
    this.local0 = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      _v.set(grid[i * 3], grid[i * 3 + 1], grid[i * 3 + 2]).sub(center).applyQuaternion(inv);
      this.local0[i * 3] = _v.x; this.local0[i * 3 + 1] = _v.y; this.local0[i * 3 + 2] = _v.z;
    }
    // Final frame: lying on the desk, top edge away from the typist.
    const y = 0.012 + index * 0.014;
    this.c1 = new THREE.Vector3(target.x, y, target.z);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this.q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), target.rot).multiply(flat);
    this.local1 = new Float32Array(count * 3);
    const {W, H} = layout;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = (j * (nx + 1) + i) * 3;
      const u = (i / nx - 0.5) * W, v = (0.5 - j / ny) * H;
      // A slight curl at the free corners keeps it from looking like a decal.
      const curl = 0.035 * Math.pow(Math.abs(u) / (W / 2), 3) + 0.025 * Math.pow(Math.max(0, -v / (H / 2)), 2);
      this.local1[k] = u; this.local1[k + 1] = v; this.local1[k + 2] = curl;
    }
    this.lift = up.clone().multiplyScalar(1.6).add(new THREE.Vector3(0, 0.8, 0));
    this.duration = 1.55;
    if (instant) this.start = now - this.duration;
    this.step(now);
  }
  step(now) {
    if (this.done) return false;
    const t = Math.min(1, (now - this.start) / this.duration);
    const pos = this.geometry.attributes.position.array;
    const n = pos.length / 3;
    // Phase A (0–0.3): pull straight out along the sheet; phase B: arc to the stack.
    const a = Math.min(1, t / 0.3), b = Math.max(0, (t - 0.24) / 0.76);
    const ea = 1 - Math.pow(1 - a, 3);
    const eb = b < 0.5 ? 4 * b * b * b : 1 - Math.pow(-2 * b + 2, 3) / 2;
    const c = this.c0.clone().addScaledVector(this.lift, ea);
    const peak = new THREE.Vector3().lerpVectors(c, this.c1, 0.5).add(new THREE.Vector3(0, 2.2, 0));
    // Quadratic Bezier from lifted position via peak to the stack.
    const p0 = c, p1 = peak, p2 = this.c1;
    const center = new THREE.Vector3()
      .addScaledVector(p0, (1 - eb) * (1 - eb))
      .addScaledVector(p1, 2 * (1 - eb) * eb)
      .addScaledVector(p2, eb * eb);
    _q.copy(this.q0).slerp(this.q1, eb);
    // Flutter while gliding.
    const flutter = Math.sin(b * Math.PI) * 0.12;
    const wob = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(b * 9) * flutter, 0, Math.sin(b * 7 + 1) * flutter * 0.8));
    _q.multiply(wob);
    const bend = Math.min(1, b * 1.4);
    const settle = t >= 1 ? 0 : Math.sin(b * Math.PI) * 0.35;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const lx = this.local0[k] + (this.local1[k] - this.local0[k]) * bend;
      const ly = this.local0[k + 1] + (this.local1[k + 1] - this.local0[k + 1]) * bend;
      let lz = this.local0[k + 2] + (this.local1[k + 2] - this.local0[k + 2]) * bend;
      // Air under the sheet as it lands.
      lz += settle * Math.cos((lx / this.layout.W) * Math.PI) * 0.6;
      _v.set(lx, ly, lz).applyQuaternion(_q).add(center);
      pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    if (t >= 1) this.done = true;
    return true;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

export {PaperPath, S_EXIT, S_BACK};
