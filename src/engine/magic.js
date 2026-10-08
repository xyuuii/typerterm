// Magic for things a typewriter cannot do: full-screen programs (btop, vim,
// less…) shown live on the sheet, erasing and overwriting. This module holds
// the shared pieces: a GPU sparkle system, exact drawing of box-drawing /
// block / braille glyphs, and reading the active screen into cell records.
import * as THREE from 'three';
import {NO_OUTLINE_LAYER} from './toon.js';
import {readCell} from './ink.js';

const PI = Math.PI;

/** Reads the whole active screen (cell records with paper-ink colours). */
export function readScreen(term, cache) {
  const b = term.buffer.active;
  const cols = term.cols, rows = term.rows;
  const grid = new Array(cols * rows).fill(null);
  const cell = cache.cell ??= b.getNullCell();
  for (let r = 0; r < rows; r++) {
    const line = b.getLine(b.baseY + r);
    if (!line) continue;
    for (let c = 0; c < cols; c++) {
      const x = line.getCell(c, cell);
      if (x) grid[r * cols + c] = readCell(x);
    }
  }
  return {grid, cols, rows};
}

// ---------------------------------------------------------------------------
// Box drawing, block elements and braille drawn as shapes so they join up.
// Directions: up, right, down, left. 1 light, 2 heavy, 3 double.
const BOX = {};
const def = (code, u, r, d, l, round = false) => { BOX[code] = {u, r, d, l, round}; };
def(0x2500, 0, 1, 0, 1); def(0x2501, 0, 2, 0, 2); def(0x2502, 1, 0, 1, 0); def(0x2503, 2, 0, 2, 0);
for (const [c, src] of [[0x2504, 0x2500], [0x2505, 0x2501], [0x2506, 0x2502], [0x2507, 0x2503], [0x2508, 0x2500], [0x2509, 0x2501], [0x250A, 0x2502], [0x250B, 0x2503], [0x254C, 0x2500], [0x254D, 0x2501], [0x254E, 0x2502], [0x254F, 0x2503]]) BOX[c] = BOX[src];
def(0x250C, 0, 1, 1, 0); def(0x2510, 0, 0, 1, 1); def(0x2514, 1, 1, 0, 0); def(0x2518, 1, 0, 0, 1);
def(0x250F, 0, 2, 2, 0); def(0x2513, 0, 0, 2, 2); def(0x2517, 2, 2, 0, 0); def(0x251B, 2, 0, 0, 2);
def(0x251C, 1, 1, 1, 0); def(0x2524, 1, 0, 1, 1); def(0x252C, 0, 1, 1, 1); def(0x2534, 1, 1, 0, 1); def(0x253C, 1, 1, 1, 1);
def(0x2523, 2, 2, 2, 0); def(0x252B, 2, 0, 2, 2); def(0x2533, 0, 2, 2, 2); def(0x253B, 2, 2, 0, 2); def(0x254B, 2, 2, 2, 2);
def(0x2550, 0, 3, 0, 3); def(0x2551, 3, 0, 3, 0); def(0x2554, 0, 3, 3, 0); def(0x2557, 0, 0, 3, 3); def(0x255A, 3, 3, 0, 0); def(0x255D, 3, 0, 0, 3);
def(0x2560, 3, 3, 3, 0); def(0x2563, 3, 0, 3, 3); def(0x2566, 0, 3, 3, 3); def(0x2569, 3, 3, 0, 3); def(0x256C, 3, 3, 3, 3);
def(0x256D, 0, 1, 1, 0, true); def(0x256E, 0, 0, 1, 1, true); def(0x256F, 1, 0, 0, 1, true); def(0x2570, 1, 1, 0, 0, true);
def(0x2574, 0, 0, 0, 1); def(0x2575, 1, 0, 0, 0); def(0x2576, 0, 1, 0, 0); def(0x2577, 0, 0, 1, 0);
def(0x2578, 0, 0, 0, 2); def(0x2579, 2, 0, 0, 0); def(0x257A, 0, 2, 0, 0); def(0x257B, 0, 0, 2, 0);
// Remaining mixed light/heavy/double junctions: approximate from their shape class.
for (let c = 0x250C; c <= 0x254B; c++) if (!BOX[c]) {
  const base = c < 0x2510 ? 0x250C : c < 0x2514 ? 0x2510 : c < 0x2518 ? 0x2514 : c < 0x251C ? 0x2518 : c < 0x2524 ? 0x251C : c < 0x252C ? 0x2524 : c < 0x2534 ? 0x252C : c < 0x253C ? 0x2534 : 0x253C;
  BOX[c] = BOX[base];
}
for (let c = 0x2552; c <= 0x256B; c++) if (!BOX[c]) {
  const base = c < 0x2555 ? 0x2554 : c < 0x2558 ? 0x2557 : c < 0x255B ? 0x255A : c < 0x255E ? 0x255D : c < 0x2561 ? 0x2560 : c < 0x2564 ? 0x2563 : c < 0x2567 ? 0x2566 : c < 0x256A ? 0x2569 : 0x256C;
  BOX[c] = BOX[base];
}

export function drawSpecial(ctx, ch, x, y, w, h, color) {
  const code = ch.codePointAt(0);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  if (code >= 0x2800 && code <= 0x28FF) {
    const bits = code - 0x2800;
    const dots = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
    const rad = Math.min(w * 0.17, h * 0.085);
    for (let i = 0; i < 8; i++) if (bits & (1 << i)) {
      const [cx, cy] = dots[i];
      ctx.beginPath(); ctx.arc(x + w * (0.3 + cx * 0.4), y + h * (0.125 + cy * 0.25), rad, 0, PI * 2); ctx.fill();
    }
    return true;
  }
  if (code >= 0x2580 && code <= 0x259F) {
    const fill = (fx, fy, fw, fh, a = 1) => { ctx.globalAlpha *= a; ctx.fillRect(x + fx * w, y + fy * h, fw * w + 0.5, fh * h + 0.5); ctx.globalAlpha /= a; };
    if (code === 0x2580) fill(0, 0, 1, 0.5);
    else if (code >= 0x2581 && code <= 0x2588) { const k = code - 0x2580; fill(0, 1 - k / 8, 1, k / 8); }
    else if (code >= 0x2589 && code <= 0x258F) { const k = 0x2590 - code; fill(0, 0, k / 8, 1); }
    else if (code === 0x2590) fill(0.5, 0, 0.5, 1);
    else if (code === 0x2591) fill(0, 0, 1, 1, 0.25);
    else if (code === 0x2592) fill(0, 0, 1, 1, 0.5);
    else if (code === 0x2593) fill(0, 0, 1, 1, 0.75);
    else if (code === 0x2594) fill(0, 0, 1, 1 / 8);
    else if (code === 0x2595) fill(7 / 8, 0, 1 / 8, 1);
    else {
      // Quadrants 2596–259F: bits TL, TR, BL, BR.
      const q = {0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 1 | 4 | 8, 0x259A: 1 | 8, 0x259B: 1 | 2 | 4, 0x259C: 1 | 2 | 8, 0x259D: 2, 0x259E: 2 | 4, 0x259F: 2 | 4 | 8}[code] || 0;
      if (q & 1) fill(0, 0, 0.5, 0.5); if (q & 2) fill(0.5, 0, 0.5, 0.5); if (q & 4) fill(0, 0.5, 0.5, 0.5); if (q & 8) fill(0.5, 0.5, 0.5, 0.5);
    }
    return true;
  }
  const box = BOX[code];
  if (box) {
    const lw = Math.max(1.4, w * 0.11);
    const cx = x + w / 2, cy = y + h / 2;
    ctx.lineCap = 'butt';
    if (box.round) {
      ctx.lineWidth = lw;
      ctx.beginPath();
      const ex = box.r ? x + w : x, ey = box.d ? y + h : y;
      ctx.moveTo(cx, ey);
      ctx.quadraticCurveTo(cx, cy, ex, cy);
      ctx.stroke();
      return true;
    }
    const seg = (weight, dx, dy) => {
      if (!weight) return;
      const tx = dx > 0 ? x + w : dx < 0 ? x : cx, ty = dy > 0 ? y + h : dy < 0 ? y : cy;
      if (weight === 3) {
        const o = Math.max(1.5, w * 0.13);
        ctx.lineWidth = lw * 0.8;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          if (dx) { ctx.moveTo(cx - o, cy + s * o); ctx.lineTo(tx, cy + s * o); }
          else { ctx.moveTo(cx + s * o, cy - o); ctx.lineTo(cx + s * o, ty); }
          ctx.stroke();
        }
        return;
      }
      ctx.lineWidth = weight === 2 ? lw * 2 : lw;
      ctx.beginPath();
      ctx.moveTo(dx ? cx - Math.sign(dx) * lw / 2 : cx, dy ? cy - Math.sign(dy) * lw / 2 : cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    };
    seg(box.u, 0, -1); seg(box.r, 1, 0); seg(box.d, 0, 1); seg(box.l, -1, 0);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
/** GPU-animated sparkles: each one is written once and lives in the shader. */
export class Sparkles {
  constructor(scene, max = 700) {
    this.max = max;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.attr = {
      start: new THREE.BufferAttribute(new Float32Array(max * 3), 3),
      velocity: new THREE.BufferAttribute(new Float32Array(max * 3), 3),
      color: new THREE.BufferAttribute(new Float32Array(max * 3), 3),
      birth: new THREE.BufferAttribute(new Float32Array(max).fill(-100), 1),
      life: new THREE.BufferAttribute(new Float32Array(max).fill(1), 1),
      size: new THREE.BufferAttribute(new Float32Array(max), 1),
    };
    g.setAttribute('position', this.attr.start);
    for (const [k, a] of Object.entries(this.attr)) if (k !== 'start') g.setAttribute(k, a);
    this.uniforms = {time: {value: 0}, pixelRatio: {value: 1}};
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 velocity; attribute vec3 color; attribute float birth; attribute float life; attribute float size;
        uniform float time; uniform float pixelRatio;
        varying vec3 vColor; varying float vAlpha; varying float vSpin;
        void main(){
          float age = time - birth;
          float k = clamp(age / life, 0.0, 1.0);
          vec3 p = position + velocity * age + vec3(sin(age * 3.0 + birth) * 0.04, 0.12 * age * age, cos(age * 2.0 + birth) * 0.04);
          vAlpha = (age < 0.0 || age > life) ? 0.0 : smoothstep(0.0, 0.08, k) * (1.0 - k);
          vColor = color;
          vSpin = birth * 13.0 + age * 3.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = size * pixelRatio * (12.0 / -mv.z) * (0.6 + 0.4 * sin(age * 9.0 + birth * 5.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha; varying float vSpin;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vSpin), s = sin(vSpin);
          q = mat2(c, -s, s, c) * q;
          float star = max(0.0, 1.0 - abs(q.x) * 14.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 14.0 - abs(q.x) * 2.2);
          float core = smoothstep(0.22, 0.0, length(q));
          float a = (star * 0.8 + core) * vAlpha;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.layers.set(NO_OUTLINE_LAYER);
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.geometry = g;
    this.dirty = false;
  }
  spawn(pos, now, {color = 0xffe7a8, count = 1, spread = 0.05, speed = 0.35, life = 1.1, size = 22} = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.attr.start.setXYZ(i, pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread);
      const a = Math.random() * PI * 2, up = 0.3 + Math.random() * 0.7;
      this.attr.velocity.setXYZ(i, Math.cos(a) * speed * 0.6, up * speed, Math.sin(a) * speed * 0.6);
      this.attr.color.setXYZ(i, c.r, c.g, c.b);
      this.attr.birth.setX(i, now + Math.random() * 0.05);
      this.attr.life.setX(i, life * (0.6 + Math.random() * 0.8));
      this.attr.size.setX(i, size * (0.6 + Math.random() * 0.8));
    }
    this.dirty = true;
  }
  update(now, pixelRatio) {
    this.uniforms.time.value = now;
    this.uniforms.pixelRatio.value = pixelRatio;
    if (this.dirty) {
      for (const a of Object.values(this.attr)) a.needsUpdate = true;
      this.dirty = false;
    }
  }
  dispose() { this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
