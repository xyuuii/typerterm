// Lofi furniture and decor: a record player that spins with the music,
// record sleeves leaning on the wall, a neon sign, a lava lamp, a hanging
// pothos in a macrame hanger, LED strips under the shelves and polaroids
// pinned to the cork board (the polaroids take the user's own photos).
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {toon, NO_OUTLINE_LAYER} from './toon.js';

const PI = Math.PI;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createLofi(root, {backZ, turntable: tt = {x: 9.3, z: -2.1, rot: -0.22}} = {}) {
  const owned = [];
  const own = x => (owned.push(x), x);
  const animated = [];
  const canvasTex = (w, h, paint, srgb = true) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    const t = own(new THREE.CanvasTexture(cv));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const rbox = (w, h, d, r = 0.05) => own(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
  const mesh = (geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = null) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.receiveShadow = true;           // small parts skip the shadow pass; big ones opt in with .castShadow
    parent.add(m);
    return m;
  };
  const glow = m => { m.layers.set(NO_OUTLINE_LAYER); m.castShadow = false; return m; };
  const M = {
    walnut: own(toon(0x8a5a3c, {spec: 0.2, shine: 30})),
    black: own(toon(0x2c2a30, {spec: 0.45, shine: 50})),
    silver: own(toon(0xcfd0d6, {spec: 0.9, shine: 70, rim: 0.2})),
    gold: own(toon(0xd9a748, {spec: 0.8, shine: 50})),
    cream: own(toon(0xf3e6cc, {spec: 0.3})),
    paper: own(toon(0xfbf8f1)),
    pin: own(toon(0xe2574c, {spec: 0.5})),
  };

  // ---- record player ------------------------------------------------------------------------
  const player = new THREE.Group();
  player.position.set(tt.x, 0, tt.z);
  player.rotation.y = tt.rot;
  root.add(player);
  const top = 0.62;
  mesh(rbox(4.3, 0.56, 3.5, 0.12), M.walnut, player, [0, 0.34, 0]).castShadow = true;
  mesh(rbox(4.1, 0.06, 3.3, 0.03), M.black, player, [0, top, 0]);
  for (const [x, z] of [[-1.85, -1.45], [1.85, -1.45], [-1.85, 1.45], [1.85, 1.45]]) mesh(own(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 12)), M.black, player, [x, 0.06, z]);
  const platter = new THREE.Group();
  platter.position.set(-0.45, top + 0.03, 0);
  player.add(platter);
  mesh(own(new THREE.CylinderGeometry(1.42, 1.42, 0.12, 48)), M.silver, platter, [0, 0.06, 0]);
  const vinylTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#1f1c23'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, PI * 2); c.fill();
    for (let r = 70; r < 250; r += 4) { c.strokeStyle = `rgba(255,255,255,${0.03 + (r % 12 === 0 ? 0.05 : 0)})`; c.lineWidth = 1.5; c.beginPath(); c.arc(w / 2, h / 2, r, 0, PI * 2); c.stroke(); }
    c.fillStyle = '#f2a7bf'; c.beginPath(); c.arc(w / 2, h / 2, 64, 0, PI * 2); c.fill();
    c.fillStyle = '#fff3e4'; c.font = '700 26px "Courier Prime", monospace'; c.textAlign = 'center'; c.fillText('INK FM', w / 2, h / 2 - 14);
    c.font = '400 16px "Courier Prime", monospace'; c.fillText('side A · lofi', w / 2, h / 2 + 30);
    // Sheen wedges.
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.beginPath(); c.moveTo(w / 2, h / 2); c.arc(w / 2, h / 2, 250, -0.9, -0.5); c.fill();
    c.beginPath(); c.moveTo(w / 2, h / 2); c.arc(w / 2, h / 2, 250, 2.2, 2.6); c.fill();
  });
  const vinylMat = own(toon(0xffffff, {map: vinylTex, spec: 0.6, shine: 60}));
  const record = mesh(own(new THREE.CylinderGeometry(1.34, 1.34, 0.035, 64)), [M.black, vinylMat, M.black], platter, [0, 0.14, 0]);
  void record;
  mesh(own(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8)), M.silver, platter, [0, 0.2, 0]);
  // Tonearm on its pivot.
  const pivot = new THREE.Group();
  pivot.position.set(1.45, top, -1.05);
  player.add(pivot);
  mesh(own(new THREE.CylinderGeometry(0.26, 0.3, 0.22, 20)), M.silver, pivot, [0, 0.11, 0]);
  const arm = new THREE.Group();
  arm.position.y = 0.32;
  pivot.add(arm);
  mesh(own(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 14)), M.black, arm, [0, 0, 0]);
  const armCurve = new THREE.CatmullRomCurve3([[0, 0, 0], [-0.05, 0, 0.8], [-0.12, 0, 1.6], [-0.42, -0.02, 2.15]].map(p => new THREE.Vector3(...p)));
  mesh(own(new THREE.TubeGeometry(armCurve, 24, 0.035, 8)), M.silver, arm);
  mesh(rbox(0.22, 0.06, 0.36, 0.02), M.black, arm, [-0.46, -0.05, 2.25], [0, 0.35, 0]);
  mesh(own(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 16)), M.silver, arm, [0, 0, -0.42], [PI / 2, 0, 0]);
  mesh(own(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8)), M.silver, player, [1.75, top + 0.18, 0.7]);   // arm rest
  // Knobs and a power light.
  for (const x of [1.15, 1.7]) mesh(own(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 16)), M.silver, player, [x, top + 0.06, 1.3]);
  const ledMat = own(new THREE.MeshBasicMaterial({color: 0x6b6b6b}));
  glow(mesh(own(new THREE.SphereGeometry(0.05, 8, 6)), ledMat, player, [0.75, top + 0.04, 1.42]));
  let spin = 0, armAngle = 0;
  const music = {playing: false, level: 0};
  animated.push((t, dt) => {
    const target = music.playing ? 3.49 : 0;   // 33⅓ rpm
    spin += (target - spin) * (1 - Math.exp(-dt * (music.playing ? 2.5 : 1.2)));
    platter.rotation.y -= spin * dt;
    const armTarget = music.playing ? 0.52 : 0;
    armAngle += (armTarget - armAngle) * (1 - Math.exp(-dt * 3));
    arm.rotation.y = armAngle;
    arm.rotation.x = music.playing ? -0.02 + Math.sin(t * 3.49) * 0.002 : 0;
    ledMat.color.set(music.playing ? 0x7dff9a : 0x6b6b6b);
  });

  // Record sleeves leaning on the wall behind it.
  const sleeveArt = [
    (c, w, h) => { c.fillStyle = '#f7c9a8'; c.fillRect(0, 0, w, h); c.fillStyle = '#f08a6c'; c.beginPath(); c.arc(w * 0.5, h * 0.55, w * 0.26, 0, PI * 2); c.fill(); c.fillStyle = '#6c8fc9'; for (let i = 0; i < 4; i++) c.fillRect(0, h * (0.66 + i * 0.08), w, h * 0.04); c.fillStyle = '#3b2a3c'; c.font = `700 ${w * 0.1}px "Courier Prime", monospace`; c.fillText('sunset tapes', w * 0.08, h * 0.16); },
    (c, w, h) => { c.fillStyle = '#2f3b63'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffe9b0'; c.beginPath(); c.arc(w * 0.68, h * 0.32, w * 0.14, 0, PI * 2); c.fill(); c.fillStyle = '#2f3b63'; c.beginPath(); c.arc(w * 0.74, h * 0.28, w * 0.13, 0, PI * 2); c.fill(); c.fillStyle = '#f3a65c'; c.beginPath(); c.ellipse(w * 0.4, h * 0.78, w * 0.2, h * 0.09, 0, 0, PI * 2); c.fill(); c.beginPath(); c.arc(w * 0.27, h * 0.7, w * 0.08, 0, PI * 2); c.fill(); c.fillStyle = '#fff4dc'; c.font = `700 ${w * 0.1}px "Courier Prime", monospace`; c.fillText('midnight cat', w * 0.08, h * 0.16); },
  ];
  sleeveArt.forEach((paint, i) => {
    const art = canvasTex(256, 256, paint);
    const m = own(toon(0xffffff, {map: art}));
    mesh(own(new THREE.BoxGeometry(2.5, 2.5, 0.05)), [M.paper, M.paper, M.paper, M.paper, m, M.paper], root, [11.2 + i * 1.3, 1.26, backZ + 0.55 + i * 0.25], [-0.16, -0.12 + i * 0.1, 0]);
  });

  // ---- neon sign on the back wall: a crescent moon and 夜ふかし ---------------------------------------
  const neonTex = canvasTex(512, 1100, (c, w, h) => {
    const stroke = (fn, color, core) => {
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
      for (const [lw, blur, a] of [[22, 40, 0.5], [12, 18, 0.8]]) { c.shadowColor = color; c.shadowBlur = blur; c.strokeStyle = color; c.globalAlpha = a; c.lineWidth = lw; fn(); c.stroke(); }
      c.shadowBlur = 0; c.globalAlpha = 1; c.strokeStyle = core; c.lineWidth = 5; fn(); c.stroke();
      c.restore();
    };
    // Moon and a little star.
    stroke(() => { c.beginPath(); c.arc(250, 200, 120, 0.9, PI * 1.62 + 0.9 - 0.2, false); c.arc(300, 165, 100, PI * 1.62 + 0.55, 1.05, true); }, '#ffd27a', '#fff6dc');
    stroke(() => { c.beginPath(); const sx = 390, sy = 100, r = 26; for (let i = 0; i <= 8; i++) { const a = -PI / 2 + i * PI / 4, rr = i % 2 ? r * 0.38 : r; c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); } }, '#8fe6ff', '#effcff');
    // Vertical text.
    c.save();
    c.font = '700 150px "Hiragino Maru Gothic ProN", "Hiragino Sans", "PingFang SC", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const chars = ['夜', 'ふ', 'か', 'し'];
    chars.forEach((ch, i) => {
      const y = 420 + i * 165;
      for (const [lw, blur, a] of [[16, 40, 0.55], [8, 16, 0.85]]) { c.shadowColor = '#ff6fb0'; c.shadowBlur = blur; c.strokeStyle = '#ff6fb0'; c.globalAlpha = a; c.lineWidth = lw; c.strokeText(ch, 256, y); }
      c.shadowBlur = 0; c.globalAlpha = 1; c.lineWidth = 3.5; c.strokeStyle = '#fff0f7'; c.strokeText(ch, 256, y);
    });
    c.restore();
  });
  const neonMat = own(new THREE.MeshBasicMaterial({map: neonTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
  const neon = new THREE.Group();
  neon.position.set(-3.62, 13.9, backZ + 0.32);
  root.add(neon);
  glow(mesh(own(new THREE.PlaneGeometry(2.5, 5.37)), neonMat, neon, [0, 0, 0.06]));
  const acrylic = glow(mesh(own(new THREE.PlaneGeometry(2.7, 5.6)), own(new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false})), neon));
  void acrylic;
  for (const [x, y] of [[-1.2, 2.65], [1.2, 2.65], [-1.2, -2.65], [1.2, -2.65]]) mesh(own(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8)), M.silver, neon, [x, y, -0.1], [PI / 2, 0, 0]);
  let neonLevel = 1;
  animated.push(t => {
    // A gentle hum, and a rare flicker.
    const flicker = Math.sin(t * 37) > 0.995 ? 0.55 : 1;
    neonMat.color.setScalar(neonLevel * (0.94 + Math.sin(t * 2.1) * 0.06) * flicker);
  });

  // ---- lava lamp on the book stack -------------------------------------------------------------
  {
    const lamp = new THREE.Group();
    lamp.position.set(-12.55, 1.5, -5.65);
    root.add(lamp);
    mesh(own(new THREE.LatheGeometry([[0, 0], [0.62, 0], [0.5, 0.9], [0.36, 1.05], [0, 1.05]].map(([r, y]) => new THREE.Vector2(r, y)), 28)), M.gold, lamp);
    mesh(own(new THREE.LatheGeometry([[0.2, 2.95], [0.3, 3.25], [0, 3.32]].map(([r, y]) => new THREE.Vector2(r, y)), 24)), M.gold, lamp);
    const glass = own(new THREE.MeshBasicMaterial({color: 0x8f4fd0, transparent: true, opacity: 0.55, depthWrite: false}));
    glow(mesh(own(new THREE.LatheGeometry([[0.36, 1.05], [0.5, 1.9], [0.22, 2.95]].map(([r, y]) => new THREE.Vector2(r, y)), 28)), glass, lamp));
    const waxMat = own(new THREE.MeshBasicMaterial({color: 0xff8a6a}));
    const blobs = [0, 1, 2, 3, 4].map(i => {
      const b = glow(mesh(own(new THREE.SphereGeometry(0.16 + (i % 3) * 0.05, 14, 10)), waxMat, lamp, [0, 1.3, 0]));
      b.userData = {phase: i * 1.37, speed: 0.11 + i * 0.023};
      return b;
    });
    animated.push(t => {
      for (const b of blobs) {
        const k = 0.5 - 0.5 * Math.cos(t * b.userData.speed * PI * 2 + b.userData.phase);
        const y = 1.2 + k * 1.55;
        const r = 0.5 - Math.abs(y - 1.9) * 0.28;
        b.position.set(Math.sin(b.userData.phase * 3 + t * 0.2) * r * 0.35, y, Math.cos(b.userData.phase * 2 + t * 0.17) * r * 0.3);
        b.scale.set(1, 1.2 + Math.sin(t * 0.8 + b.userData.phase) * 0.25, 1);
      }
    });
  }

  // ---- pothos in a macrame hanger by the window ------------------------------------------------------
  // Pieces are baked into a few merged meshes (vertex colours): the hanger and
  // pot, the crown of leaves, and one mesh per trailing vine so each can sway.
  {
    const r = rng(12);
    const hang = new THREE.Group();
    hang.position.set(-13.9, 20.4, -4.7);
    root.add(hang);
    const o3 = new THREE.Object3D();
    const temp = [];
    const tmp = g => (temp.push(g), g);
    const bake = (list, geo, color, pos = [0, 0, 0], rot = [0, 0, 0], s = 1) => {
      o3.position.set(...pos); o3.rotation.set(...rot); o3.scale.setScalar(s); o3.updateMatrix();
      const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(o3.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(g);
    };
    const merged = (list, mat, parent, shadow = false) => {
      const m = new THREE.Mesh(own(mergeGeometries(list, false)), mat);
      list.forEach(g => g.dispose());
      m.castShadow = shadow; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const plantMat = own(toon(0xffffff, {vertexColors: true, side: THREE.DoubleSide, rim: 0.18, rimColor: 0xf0ffb8}));
    const potMat = own(toon(0xffffff, {vertexColors: true, spec: 0.3}));
    const leafColors = [0x4f9a5a, 0x7dbb63, 0xa9cf7a];
    const ceiling = 36 - 20.4;
    const fixed = [];
    for (let k = 0; k < 4; k++) {
      const a = k * PI / 2 + PI / 4;
      const pts = [new THREE.Vector3(0, ceiling, 0), new THREE.Vector3(Math.cos(a) * 0.3, 2.6, Math.sin(a) * 0.3), new THREE.Vector3(Math.cos(a) * 0.72, 0.9, Math.sin(a) * 0.72), new THREE.Vector3(Math.cos(a) * 0.55, -0.1, Math.sin(a) * 0.55)];
      bake(fixed, tmp(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 5)), 0xe9dcc0);
      bake(fixed, tmp(new THREE.SphereGeometry(0.09, 8, 6)), 0xe9dcc0, [Math.cos(a) * 0.3, 2.6, Math.sin(a) * 0.3]);
    }
    bake(fixed, tmp(new THREE.TorusGeometry(0.12, 0.04, 6, 14)), 0xd9a748, [0, ceiling - 0.1, 0]);
    bake(fixed, tmp(new THREE.LatheGeometry([[0, -0.2], [0.42, -0.2], [0.6, 0.15], [0.66, 0.8], [0.6, 0.8], [0.54, 0.2], [0, 0.2]].map(([rr, y]) => new THREE.Vector2(rr, y)), 24)), 0xf3e6cc);
    merged(fixed, potMat, hang, true);
    // Heart-shaped leaves.
    const heart = new THREE.Shape();
    heart.moveTo(0, 0); heart.bezierCurveTo(0.32, 0.12, 0.38, 0.55, 0.12, 0.72); heart.bezierCurveTo(0.05, 0.76, 0.02, 0.7, 0, 0.66);
    heart.bezierCurveTo(-0.02, 0.7, -0.05, 0.76, -0.12, 0.72); heart.bezierCurveTo(-0.38, 0.55, -0.32, 0.12, 0, 0);
    const leafGeo = tmp(new THREE.ShapeGeometry(heart, 8));
    const crown = [];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, s = 0.7 + r() * 0.3;
      bake(crown, leafGeo, leafColors[i % 3], [Math.cos(a) * 0.35, 0.8, Math.sin(a) * 0.35], [-0.6 - r() * 0.5, -a + PI / 2, 0], s);
    }
    merged(crown, plantMat, hang);
    const vines = [];
    for (let v = 0; v < 7; v++) {
      const a = v / 7 * PI * 2 + r() * 0.5, len = 2.2 + r() * 4.2;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const k = i / 6;
        pts.push(new THREE.Vector3(Math.cos(a) * (0.5 + k * 0.5), 0.75 - k * len + Math.sin(k * 3) * 0.2, Math.sin(a) * (0.5 + k * 0.5)));
      }
      const vine = new THREE.Group();
      hang.add(vine);
      const parts = [];
      const curve = new THREE.CatmullRomCurve3(pts);
      bake(parts, tmp(new THREE.TubeGeometry(curve, 24, 0.025, 4)), 0x5d8a4a);
      const n = Math.floor(len * 2.4);
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, p = curve.getPointAt(k);
        const s = 0.55 + (1 - k) * 0.35 + r() * 0.2;
        bake(parts, leafGeo, leafColors[Math.floor(r() * 3)], [p.x, p.y, p.z], [0.3 + r() * 0.6, a + (i % 2 ? 1.2 : -1.2) + r() * 0.4, (r() - 0.5) * 0.6], s);
      }
      merged(parts, plantMat, vine);
      vine.userData.phase = r() * 6;
      vines.push(vine);
    }
    temp.forEach(g => g.dispose());
    animated.push(t => {
      for (const v of vines) { v.rotation.z = Math.sin(t * 0.6 + v.userData.phase) * 0.025; v.rotation.x = Math.sin(t * 0.45 + v.userData.phase) * 0.02; }
      hang.rotation.y = Math.sin(t * 0.25) * 0.05;
    });
  }

  // ---- LED strips under the bookshelf boards ------------------------------------------------------
  const ledStrip = own(new THREE.MeshBasicMaterial({color: 0xd38bff}));
  for (const y of [10.7, 15.4, 20.0]) glow(mesh(own(new THREE.BoxGeometry(9.2, 0.05, 0.06)), ledStrip, root, [-10.3, y - 0.18, backZ + 1.95]));
  // A soft wash of that light on the wall behind the shelf.
  const washTex = canvasTex(256, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.1, 4, w / 2, h * 0.1, w * 0.6);
    g.addColorStop(0, 'rgba(210,140,255,0.9)'); g.addColorStop(1, 'rgba(210,140,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const washMat = own(new THREE.MeshBasicMaterial({map: washTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2}));
  for (const y of [10.7, 15.4, 20.0]) glow(mesh(own(new THREE.PlaneGeometry(9.6, 3.6)), washMat, root, [-10.3, y - 2.0, backZ + 0.24]));

  // ---- polaroids on the cork board (they take the user's photos) -----------------------------------
  const slots = [];
  const polaroidArt = [
    (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8ec5ec'); g.addColorStop(1, '#f6e3c8'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#f3a65c'; c.beginPath(); c.ellipse(w * 0.5, h * 0.78, w * 0.3, h * 0.14, 0, 0, PI * 2); c.fill(); c.beginPath(); c.arc(w * 0.32, h * 0.62, w * 0.16, 0, PI * 2); c.fill(); for (const s of [-1, 1]) { c.beginPath(); c.moveTo(w * (0.32 + s * 0.12), h * 0.5); c.lineTo(w * (0.32 + s * 0.06), h * 0.42); c.lineTo(w * (0.32 + s * 0.02), h * 0.5); c.fill(); } c.strokeStyle = '#4a2e26'; c.lineWidth = 3; for (const s of [-1, 1]) { c.beginPath(); c.arc(w * (0.32 + s * 0.06), h * 0.62, 6, 0.2, PI - 0.2); c.stroke(); } },
    (c, w, h) => { c.fillStyle = '#bfe0f5'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.beginPath(); c.arc(w * 0.3, h * 0.25, 26, 0, PI * 2); c.arc(w * 0.42, h * 0.22, 30, 0, PI * 2); c.fill(); c.fillStyle = '#9aa7c8'; c.beginPath(); c.moveTo(0, h * 0.75); c.lineTo(w * 0.5, h * 0.35); c.lineTo(w, h * 0.75); c.fill(); c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(w * 0.4, h * 0.44); c.lineTo(w * 0.5, h * 0.35); c.lineTo(w * 0.6, h * 0.44); c.fill(); c.fillStyle = '#5f9cc9'; c.fillRect(0, h * 0.75, w, h * 0.25); },
    (c, w, h) => { c.fillStyle = '#fbe3ea'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a5a4a'; c.fillRect(w * 0.47, h * 0.45, w * 0.06, h * 0.55); c.fillStyle = '#f5bccd'; for (const [x, y, r] of [[0.3, 0.38, 0.2], [0.55, 0.3, 0.24], [0.75, 0.42, 0.18], [0.45, 0.5, 0.16]]) { c.beginPath(); c.arc(w * x, h * y, w * r, 0, PI * 2); c.fill(); } c.fillStyle = '#e895b0'; c.beginPath(); c.arc(w * 0.62, h * 0.36, w * 0.1, 0, PI * 2); c.fill(); },
  ];
  const corkZ = backZ + 0.27;
  [[8.95, 8.05, 0.07], [10.55, 7.85, -0.06], [12.15, 8.1, 0.05]].forEach(([x, y, rz], i) => {
    const pol = new THREE.Group();
    pol.position.set(x, y, corkZ);
    pol.rotation.z = rz;
    root.add(pol);
    mesh(own(new THREE.BoxGeometry(1.42, 1.72, 0.03)), M.paper, pol, [0, 0, 0]);
    const art = canvasTex(256, 256, polaroidArt[i]);
    const mat = own(toon(0xffffff, {map: art}));
    const photo = mesh(own(new THREE.PlaneGeometry(1.22, 1.22)), mat, pol, [0, 0.14, 0.02]);
    photo.castShadow = false;
    mesh(own(new THREE.SphereGeometry(0.09, 10, 8)), M.pin, pol, [0, 0.72, 0.06]);
    slots.push({id: `polaroid-${i + 1}`, label: `软木板照片 ${i + 1}`, mesh: photo, material: mat, aspect: 1, defaultMap: art});
  });

  function setMode(mode) {
    neonLevel = mode === 'night' ? 1.45 : mode === 'sunset' ? 1.05 : 0.6;
    const led = mode === 'night' ? 1.3 : mode === 'sunset' ? 0.85 : 0.35;
    ledStrip.color.setRGB(0.83 * led, 0.55 * led, 1.0 * led);
    washMat.opacity = mode === 'night' ? 0.35 : mode === 'sunset' ? 0.22 : 0.08;
  }

  return {
    slots,
    setMusic(state) { music.playing = state.playing; music.level = state.level || 0; },
    setMode,
    update(t, dt) { for (const f of animated) f(t, dt); },
    dispose() { owned.forEach(o => o.dispose?.()); player.removeFromParent(); neon.removeFromParent(); },
  };
}
