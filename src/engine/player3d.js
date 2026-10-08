// The floating music player on the wall: a flat, translucent glass card that
// bobs in the air, with a spinning record, the track title, a visualiser,
// progress and buttons, a soft pastel halo and a few sparkles orbiting it.
// Clicks are resolved from the card's UV into button actions.
import * as THREE from 'three';
import {NO_OUTLINE_LAYER} from './toon.js';

const W = 1024, H = 512;
const BUTTONS = [
  {action: 'prev', x: 430, y: 432, r: 34},
  {action: 'toggle', x: 530, y: 432, r: 46},
  {action: 'next', x: 630, y: 432, r: 34},
  {action: 'add', x: 790, y: 432, r: 30},
  {action: 'list', x: 880, y: 432, r: 30},
];
const BAR = {x0: 290, x1: 960, y: 342};
const PASTEL = ['#f7a8c4', '#c9b6f2', '#9fd8cf', '#ffd59e', '#a8cdf7'];

function hashHue(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PASTEL[h % PASTEL.length]; }
function fmt(t) { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function rounded(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

export function createPlayerCard({position, size = [4.4, 2.2], turn = 0.22} = {}) {
  const owned = [];
  const own = x => (owned.push(x), x);
  const group = new THREE.Group();
  group.name = 'Music player';
  group.position.copy(position);
  group.rotation.y = turn;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const tex = own(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const card = new THREE.Mesh(own(new THREE.PlaneGeometry(size[0], size[1])), own(new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide})));
  card.layers.set(NO_OUTLINE_LAYER);
  card.renderOrder = 3;
  group.add(card);

  // Pastel halo behind the glass.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 256;
  {
    const h = haloCanvas.getContext('2d');
    const g = h.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,214,236,0.85)'); g.addColorStop(0.45, 'rgba(206,190,255,0.35)'); g.addColorStop(1, 'rgba(160,220,255,0)');
    h.fillStyle = g; h.fillRect(0, 0, 256, 256);
  }
  const haloTex = own(new THREE.CanvasTexture(haloCanvas));
  haloTex.colorSpace = THREE.SRGBColorSpace;
  const haloMat = own(new THREE.MeshBasicMaterial({map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35}));
  const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(size[0] * 1.7, size[1] * 2.1)), haloMat);
  halo.position.z = -0.08;
  halo.layers.set(NO_OUTLINE_LAYER);
  halo.renderOrder = 2;
  group.add(halo);

  // Sparkles orbiting the card.
  const N = 34;
  const sparkGeo = own(new THREE.BufferGeometry());
  const sp = new Float32Array(N * 3), seeds = new Float32Array(N), cols = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    seeds[i] = Math.random();
    const col = new THREE.Color(PASTEL[i % PASTEL.length]);
    cols.set([col.r, col.g, col.b], i * 3);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sparkGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sparkMat = own(new THREE.ShaderMaterial({
    uniforms: {time: {value: 0}, pixelRatio: {value: 1}, boost: {value: 0}},
    vertexShader: /* glsl */`
      attribute float seed; attribute vec3 color; uniform float time; uniform float pixelRatio; uniform float boost;
      varying vec3 vColor; varying float vA;
      void main(){
        vColor = color;
        vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * (1.5 + seed * 2.0) + seed * 40.0), 3.0);
        vA *= 0.7 + boost * 0.6;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (10.0 + seed * 12.0) * (1.0 + boost * 0.5) * pixelRatio * (16.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main(){
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p);
        float star = max(0.0, 1.0 - abs(p.x) * 9.0) * max(0.0, 1.0 - abs(p.y) * 2.2) + max(0.0, 1.0 - abs(p.y) * 9.0) * max(0.0, 1.0 - abs(p.x) * 2.2);
        float a = (smoothstep(0.5, 0.0, d) * 0.55 + star * 0.8) * vA;
        gl_FragColor = vec4(vColor * 1.4, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.layers.set(NO_OUTLINE_LAYER);
  sparks.frustumCulled = false;
  group.add(sparks);

  // Music notes drifting up while playing.
  const noteTex = own(new THREE.CanvasTexture((() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const n = cv.getContext('2d');
    n.font = '700 100px "Apple Symbols", "Segoe UI Symbol", serif';
    n.textAlign = 'center'; n.textBaseline = 'middle';
    n.shadowColor = 'rgba(255,170,210,0.9)'; n.shadowBlur = 18;
    n.fillStyle = '#ffffff';
    n.fillText('♪', 64, 64); n.fillText('♫', 192, 64);
    return cv;
  })()));
  noteTex.colorSpace = THREE.SRGBColorSpace;
  const notes = [0, 1, 2, 3].map(i => {
    const t = noteTex.clone(); own(t);
    t.repeat.set(0.5, 1); t.offset.set(i % 2 ? 0.5 : 0, 0); t.needsUpdate = true;
    const s = new THREE.Sprite(own(new THREE.SpriteMaterial({map: t, transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color(PASTEL[i])})));
    s.layers.set(NO_OUTLINE_LAYER);
    s.userData.phase = i / 4;
    group.add(s);
    return s;
  });

  // ---- drawing ---------------------------------------------------------------------
  let angle = 0, hover = null, lastSig = '', lastDraw = 0, marquee = 0;
  function draw(state) {
    c.clearRect(0, 0, W, H);
    // Glass body.
    c.save();
    c.shadowColor = 'rgba(255, 182, 220, 0.75)'; c.shadowBlur = 36;
    rounded(c, 26, 26, W - 52, H - 52, 64);
    c.fillStyle = 'rgba(250, 240, 252, 0.5)'; c.fill();
    c.restore();
    c.save();
    rounded(c, 26, 26, W - 52, H - 52, 64); c.clip();
    let g = c.createLinearGradient(0, 26, W * 0.6, H);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.45, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,196,226,0.22)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // A diagonal sheen.
    c.globalAlpha = 0.25; c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(560, 26); c.lineTo(680, 26); c.lineTo(520, H); c.lineTo(400, H); c.fill();
    c.globalAlpha = 1;
    c.restore();
    rounded(c, 26, 26, W - 52, H - 52, 64);
    c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.92)'; c.stroke();

    // Record.
    const has = state.count > 0;
    c.save();
    c.translate(160, 236);
    c.rotate(angle);
    c.beginPath(); c.arc(0, 0, 112, 0, Math.PI * 2); c.fillStyle = has ? '#27222c' : 'rgba(60,50,70,0.35)'; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 2;
    for (let r = 50; r < 108; r += 7) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 2); c.fillStyle = has ? hashHue(state.title || '') : '#e8dff0'; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(-18, -4, 36, 3);
    c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fillStyle = '#f6efe4'; c.fill();
    c.restore();
    // Sheen on the record (does not rotate).
    c.save(); c.translate(160, 236);
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 10;
    c.beginPath(); c.arc(0, 0, 86, -2.4, -1.6); c.stroke();
    c.restore();

    // Title and subtitle.
    c.save();
    c.beginPath(); c.rect(BAR.x0 - 4, 70, BAR.x1 - BAR.x0 + 8, 120); c.clip();
    c.fillStyle = '#3b2a3c';
    c.font = '700 46px "Courier Prime", "PingFang SC", "Hiragino Sans GB", sans-serif';
    c.textBaseline = 'alphabetic';
    const title = has ? state.title : '点我添加音乐 ♪';
    const tw = c.measureText(title).width, room = BAR.x1 - BAR.x0;
    if (tw > room) {
      const off = (marquee % (tw + 80));
      c.fillText(title, BAR.x0 - off, 126); c.fillText(title, BAR.x0 - off + tw + 80, 126);
    } else c.fillText(title, BAR.x0, 126);
    c.font = '400 26px "Courier Prime", "PingFang SC", sans-serif';
    c.fillStyle = '#6d5a72';
    c.fillText(state.error ? state.error : has ? `${state.index + 1} / ${state.count} · 本地音乐${state.loop === 'one' ? ' · 单曲循环' : ''}` : 'mp3 · m4a · ogg · wav · flac，只存在本机', BAR.x0, 172);
    c.restore();

    // Visualiser.
    const L = state.levels;
    const n = L.length, bw = (BAR.x1 - BAR.x0) / n;
    for (let i = 0; i < n; i++) {
      const v = has ? L[i] : 0.04 + 0.03 * Math.sin(i * 0.7 + angle * 3);
      const h = 8 + v * 92;
      const x = BAR.x0 + i * bw + bw * 0.18;
      const grad = c.createLinearGradient(0, 300 - h, 0, 300);
      grad.addColorStop(0, PASTEL[(i >> 2) % PASTEL.length]); grad.addColorStop(1, 'rgba(255,255,255,0.65)');
      c.fillStyle = grad;
      rounded(c, x, 300 - h, bw * 0.64, h, bw * 0.32); c.fill();
    }
    // Progress.
    rounded(c, BAR.x0, BAR.y - 4, BAR.x1 - BAR.x0, 8, 4); c.fillStyle = 'rgba(70,45,80,0.18)'; c.fill();
    const px = BAR.x0 + (BAR.x1 - BAR.x0) * (state.progress || 0);
    rounded(c, BAR.x0, BAR.y - 4, px - BAR.x0, 8, 4); c.fillStyle = '#e8789a'; c.fill();
    c.beginPath(); c.arc(px, BAR.y, 10, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.font = '400 22px "Courier Prime", monospace'; c.fillStyle = '#6d5a72';
    c.fillText(fmt(state.time), BAR.x0, BAR.y + 34);
    c.textAlign = 'right'; c.fillText(fmt(state.duration), BAR.x1, BAR.y + 34); c.textAlign = 'left';

    // Buttons.
    for (const b of BUTTONS) {
      const on = hover === b.action;
      const main = b.action === 'toggle';
      c.beginPath(); c.arc(b.x, b.y, b.r + (on ? 4 : 0), 0, Math.PI * 2);
      c.fillStyle = main ? (on ? '#f08aaa' : '#e8789a') : on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
      c.fill();
      c.lineWidth = 2.5; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
      c.fillStyle = main ? '#ffffff' : (!has && b.action !== 'add' && b.action !== 'list' ? 'rgba(80,60,90,0.35)' : '#5b4560');
      const s = b.r * 0.42;
      c.save(); c.translate(b.x, b.y);
      c.beginPath();
      if (b.action === 'toggle') {
        if (!has) { c.fillRect(-s, -4, s * 2, 8); c.fillRect(-4, -s, 8, s * 2); }
        else if (state.playing) { c.fillRect(-s * 0.75, -s, s * 0.5, s * 2); c.fillRect(s * 0.25, -s, s * 0.5, s * 2); }
        else { c.moveTo(-s * 0.6, -s); c.lineTo(s * 1.05, 0); c.lineTo(-s * 0.6, s); c.fill(); }
      } else if (b.action === 'prev' || b.action === 'next') {
        c.scale(b.action === 'prev' ? -1 : 1, 1);
        c.moveTo(-s * 0.8, -s * 0.8); c.lineTo(s * 0.4, 0); c.lineTo(-s * 0.8, s * 0.8); c.fill();
        c.fillRect(s * 0.4, -s * 0.8, s * 0.32, s * 1.6);
      } else if (b.action === 'add') {
        c.fillRect(-s, -3, s * 2, 6); c.fillRect(-3, -s, 6, s * 2);
      } else {
        for (const y of [-s * 0.7, 0, s * 0.7]) c.fillRect(-s, y - 2.5, s * 2, 5);
      }
      c.restore();
    }
    tex.needsUpdate = true;
  }

  function hit(uv) {
    const x = uv.x * W, y = (1 - uv.y) * H;
    if (x < 26 || x > W - 26 || y < 26 || y > H - 26) return null;
    for (const b of BUTTONS) if (Math.hypot(x - b.x, y - b.y) < b.r + 8) return {action: b.action};
    if (x >= BAR.x0 - 10 && x <= BAR.x1 + 10 && Math.abs(y - BAR.y) < 22) return {action: 'seek', value: (x - BAR.x0) / (BAR.x1 - BAR.x0)};
    if (Math.hypot(x - 160, y - 236) < 112) return {action: 'toggle'};
    return {action: 'open'};
  }

  const base = position.y;
  function update(t, dt, state, pixelRatio = 1) {
    group.position.y = base + Math.sin(t * 1.1) * 0.07;
    group.rotation.z = Math.sin(t * 0.7) * 0.012;
    if (state.playing) { angle += dt * 3.49; marquee += dt * 60; }
    const sig = [state.count, state.index, state.title, state.playing, state.error, state.loop, hover, Math.round((state.progress || 0) * 400)].join('|');
    const animating = state.playing;
    if (sig !== lastSig || (animating && t - lastDraw > 1 / 30)) { draw(state); lastSig = sig; lastDraw = t; }
    // Sparkles orbit; louder music makes them livelier.
    const lv = state.level || 0;
    sparkMat.uniforms.time.value = t;
    sparkMat.uniforms.pixelRatio.value = pixelRatio;
    sparkMat.uniforms.boost.value = lv * 2;
    for (let i = 0; i < N; i++) {
      const s = seeds[i], a = t * (0.15 + s * 0.25) * (i % 2 ? 1 : -1) + s * 30;
      sp[i * 3] = Math.cos(a) * size[0] * (0.56 + s * 0.12);
      sp[i * 3 + 1] = Math.sin(a * 1.3) * size[1] * (0.62 + s * 0.15) + Math.sin(t + s * 9) * 0.1;
      sp[i * 3 + 2] = 0.1 + Math.sin(a) * 0.35;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    haloMat.opacity = 0.28 + lv * 0.5 + (hover ? 0.08 : 0);
    for (const n of notes) {
      const k = (t * 0.3 + n.userData.phase) % 1;
      n.position.set(-size[0] * 0.32 + Math.sin(k * 5 + n.userData.phase * 9) * 0.3, size[1] * 0.3 + k * 1.6, 0.15);
      n.scale.set(0.42, 0.42, 1);
      n.material.opacity = state.playing ? Math.sin(k * Math.PI) * 0.9 : Math.max(0, n.material.opacity - dt * 2);
    }
  }
  return {
    group,
    card,
    hit,
    update,
    setHover(action) { hover = action; },
    dispose() { for (const o of owned) o.dispose?.(); group.removeFromParent(); },
  };
}
