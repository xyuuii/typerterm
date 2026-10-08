// A small Japanese lofi study: a honey-oak desk under a side window, warm
// afternoon sun falling through the frame and the leaves outside, potted
// flowers on the sill, a wind chime, a sleeping cat, tea, books and a lamp.
// All geometry and textures are generated here; nothing is downloaded.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {toon, NO_OUTLINE_LAYER} from './toon.js';
import {createStreet} from './street.js';
import {createDecor} from './decor.js';
import {createCat} from './cat.js';
import {createLofi} from './lofi.js';
import {createPlayerCard} from './player3d.js';

const PI = Math.PI;

// Room frame (desk top is y = 0).
export const ROOM = {
  wallX: -16.5,          // left wall with the window (inner face)
  backZ: -8,             // back wall (inner face)
  window: {z0: -6.4, z1: 6.6, y0: 3.4, y1: 19.2},
  desk: {x0: -16.5, x1: 15, z0: -7.7, z1: 6.6},
  floorY: -15,
  stack: {x: -8.6, z: 1.6, rot: -0.16},   // where finished pages settle
};

const LIGHTING = {
  afternoon: {
    sunDir: [-1, 0.56, -0.16], sun: 0xffd6a0, sunI: 2.35,
    hemiSky: 0xfff0dc, hemiGround: 0xb58866, hemiI: 1.3,
    fill: 0.55, lamp: 0, lampGlow: 0.15, fairy: 0.25, exposure: 1.0,
    shafts: 0.1, dust: 1, line: 0x3a2418, bg: 0xf3dfc2,
  },
  sunset: {
    sunDir: [-1, 0.3, -0.02], sun: 0xff9e6a, sunI: 2.2,
    hemiSky: 0xffc9b0, hemiGround: 0x7a5068, hemiI: 1.05,
    fill: 0.4, lamp: 30, lampGlow: 1.5, fairy: 1.2, exposure: 1.0,
    shafts: 0.18, dust: 0.8, line: 0x3a1f22, bg: 0xd8a089,
  },
  night: {
    sunDir: [-1, 0.9, 0.25], sun: 0x9db6ff, sunI: 0.7,
    hemiSky: 0x5a6ea8, hemiGround: 0x2b2440, hemiI: 0.75,
    fill: 0.18, lamp: 65, lampGlow: 3.2, fairy: 2.6, exposure: 1.05,
    shafts: 0.08, dust: 0.25, line: 0x15121f, bg: 0x1a1f36,
  },
};

export function createRoom(scene, {quality = 'high'} = {}) {
  const geometries = new Set(), textures = new Set(), materials = new Set();
  const own = g => (geometries.add(g), g);
  const mat = m => (materials.add(m), m);
  const animated = [];
  const disposers = [];
  const root = new THREE.Group();
  root.name = 'Room';
  scene.add(root);

  // ---- helpers --------------------------------------------------------------
  const batches = new Map();
  const tmp = new THREE.Object3D();
  function add(geo, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], parent = root) {
    tmp.position.set(...pos); tmp.rotation.set(...rot); tmp.scale.set(...scale); tmp.updateMatrix();
    let byMat = batches.get(parent);
    if (!byMat) batches.set(parent, byMat = new Map());
    if (!byMat.has(material)) byMat.set(material, []);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(tmp.matrix);
    byMat.get(material).push(g);
  }
  function flush() {
    for (const [parent, byMat] of batches) for (const [material, list] of byMat) {
      const merged = own(mergeGeometries(list, false));
      list.forEach(g => g.dispose());
      const m = new THREE.Mesh(merged, material);
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
    }
    batches.clear();
  }
  function mesh(geo, material, pos = [0, 0, 0], rot = [0, 0, 0], parent = root) {
    const m = new THREE.Mesh(own(geo), material);
    m.position.set(...pos); m.rotation.set(...rot);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const rbox = (w, h, d, r = 0.08, s = 3) => own(new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
  const cyl = (r1, r2, h, n = 28) => own(new THREE.CylinderGeometry(r1, r2, h, n));
  const sphere = (r, w = 20, h = 14) => own(new THREE.SphereGeometry(r, w, h));
  function canvasTex(w, h, paint, repeat) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    textures.add(t);
    return t;
  }
  const rand = (() => { let s = 777; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

  // ---- materials --------------------------------------------------------------
  const oakTex = canvasTex(2048, 512, (c, w, h) => {
    c.fillStyle = '#dca46b'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? 'rgba(196,132,78,.22)' : 'rgba(240,190,130,.18)'; c.fillRect(0, i * h / 9, w, h / 9 - 3); }
    c.fillStyle = 'rgba(150,92,52,.35)';
    for (let i = 1; i < 9; i++) c.fillRect(0, i * h / 9 - 2, w, 2);
    for (let j = 0; j < 160; j++) {
      const y = rand() * h; c.strokeStyle = `rgba(160,98,52,${0.1 + rand() * 0.14})`; c.lineWidth = 1 + rand() * 2;
      c.beginPath(); for (let x = 0; x <= w; x += 32) { const yy = y + Math.sin(x * 0.003 + j) * 6; x ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.stroke();
    }
  });
  const M = {
    oak: mat(toon(0xffffff, {map: oakTex, spec: 0.15, shine: 20, rim: 0.08})),
    darkWood: mat(toon(0x9a6440, {spec: 0.1, rim: 0.1})),
    pillar: mat(toon(0xb27a4c, {spec: 0.08, rim: 0.06})),
    wall: mat(toon(0xf4e3c6, {rim: 0})),
    wallLow: mat(toon(0xe6cfaa, {rim: 0})),
    ceiling: mat(toon(0xf6ead6, {rim: 0})),
    floor: mat(toon(0xb98557, {rim: 0})),
    sill: mat(toon(0xd9a873, {spec: 0.15})),
    frame: mat(toon(0xc28a58, {spec: 0.12})),
    terracotta: mat(toon(0xd9784f, {spec: 0.15})),
    potWhite: mat(toon(0xf2efe6, {spec: 0.35})),
    potBlue: mat(toon(0x6e9fc9, {spec: 0.4})),
    soil: mat(toon(0x5a3f2c)),
    leaf: mat(toon(0x6aa865, {rim: 0.15, rimColor: 0xf6ffb0})),
    leafDark: mat(toon(0x4d8a55, {rim: 0.12, rimColor: 0xf6ffb0})),
    succulent: mat(toon(0x9cc7a4, {rim: 0.2})),
    cactus: mat(toon(0x7fb173, {rim: 0.15})),
    flowerPink: mat(toon(0xf497ac, {rim: 0.2})),
    flowerRed: mat(toon(0xec6a63, {rim: 0.2})),
    flowerWhite: mat(toon(0xfffaf0, {rim: 0.1})),
    flowerYellow: mat(toon(0xffd25e)),
    glass: mat(new THREE.MeshBasicMaterial({color: 0xdff4ff, transparent: true, opacity: 0.07, depthWrite: false})),
    bookA: mat(toon(0xd46a5a)), bookB: mat(toon(0x5f8fb8)), bookC: mat(toon(0xe8c56a)), bookD: mat(toon(0x7da37a)), bookE: mat(toon(0xb48ab8)),
    pages: mat(toon(0xfaf1dc)),
    cup: mat(toon(0xf3ead6, {spec: 0.5, shine: 50})),
    cupBand: mat(toon(0x4f7fae, {spec: 0.4})),
    tea: mat(toon(0x9a8a3c, {spec: 0.8, shine: 80})),
    cushion: mat(toon(0x6f8fc6, {rim: 0.15})),
    lampShade: mat(toon(0xe9b949, {side: THREE.DoubleSide, spec: 0.5, shine: 40, emissive: 0xffc27a, emissiveIntensity: 0.0})),
    lampMetal: mat(toon(0xe2a05a, {spec: 0.8, shine: 30})),
    bulb: mat(new THREE.MeshBasicMaterial({color: 0xfff1c9})),
    chimeGlass: mat(new THREE.MeshToonMaterial({color: 0xbfe6ff, transparent: true, opacity: 0.55})),
    chimePaint: mat(toon(0xe96a6a)),
    paperStrip: mat(toon(0xfff4c4, {side: THREE.DoubleSide})),
    string: mat(toon(0x8a6a4a)),
    fairyWire: mat(toon(0x5a4a3a)),
    fairyBulb: mat(new THREE.MeshBasicMaterial({color: 0xffd38a})),
    daruma: mat(toon(0xd94a3e, {spec: 0.6, shine: 50})),
    gold: mat(toon(0xf0c05a, {spec: 0.7})),
    white: mat(toon(0xfffaf2)),
    black: mat(toon(0x2e2a2a)),
    clockFace: mat(toon(0xfbf3e0)),
    cork: mat(toon(0xc79a6a)),
    trunk: mat(toon(0x7a5a44)),
    foliageA: mat(toon(0x79b26a, {rim: 0.25, rimColor: 0xfaffc0})),
    foliageB: mat(toon(0x5d9a5c, {rim: 0.2, rimColor: 0xfaffc0})),
    curtain: mat(toon(0xfaf0dc, {side: THREE.DoubleSide, transparent: true, opacity: 0.92})),
    sudare: mat(toon(0xd9b27a)),
  };

  // ---- architecture -------------------------------------------------------------
  const W = ROOM.window;
  // Left wall with a window opening (it casts the shadow that shapes the sunlight).
  {
    const shape = new THREE.Shape();
    shape.moveTo(-9, ROOM.floorY); shape.lineTo(30, ROOM.floorY); shape.lineTo(30, 36); shape.lineTo(-9, 36); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(W.z0, W.y0); hole.lineTo(W.z0, W.y1); hole.lineTo(W.z1, W.y1); hole.lineTo(W.z1, W.y0); hole.closePath();
    shape.holes.push(hole);
    const g = own(new THREE.ExtrudeGeometry(shape, {depth: 1.2, bevelEnabled: false}));
    // Shape x → world -z? Rotate so shape x maps to world z and extrusion goes to -x.
    g.rotateY(-PI / 2);   // (x, y, z) → (-z?): verify: rotateY(-90°) maps x→z, z→-x
    g.translate(ROOM.wallX, 0, 0);
    const wall = new THREE.Mesh(g, M.wall);
    wall.castShadow = wall.receiveShadow = true;
    root.add(wall);
  }
  // Back wall, right wall, floor, ceiling.
  add(rbox(48, 52, 1, 0.02, 1), M.wall, [7, 10.5, ROOM.backZ - 0.5]);
  add(rbox(1, 52, 40, 0.02, 1), M.wall, [31, 10.5, 12]);
  add(rbox(50, 1, 42, 0.02, 1), M.floor, [7, ROOM.floorY - 0.5, 12]);
  add(rbox(50, 1, 42, 0.02, 1), M.ceiling, [7, 36.5, 12]);
  // Wainscot band and the nageshi beam (Japanese horizontal lintel).
  add(rbox(48, 0.5, 0.35, 0.08), M.pillar, [7, 21.2, ROOM.backZ + 0.12]);
  add(rbox(0.35, 0.5, 40, 0.08), M.pillar, [ROOM.wallX + 0.12, 21.2, 12]);
  // Corner pillar (hashira).
  add(rbox(1.0, 52, 1.0, 0.1), M.pillar, [ROOM.wallX + 0.45, 10.5, ROOM.backZ + 0.45]);

  // ---- window -----------------------------------------------------------------
  const wx = ROOM.wallX;
  // Deep frame lining the opening.
  add(rbox(1.6, 0.45, W.z1 - W.z0 + 0.9, 0.06), M.frame, [wx - 0.3, W.y1 + 0.2, (W.z0 + W.z1) / 2]);
  add(rbox(1.6, 0.4, W.z1 - W.z0 + 0.9, 0.06), M.frame, [wx - 0.3, W.y0 - 0.2, (W.z0 + W.z1) / 2]);
  for (const z of [W.z0 - 0.22, W.z1 + 0.22]) add(rbox(1.6, W.y1 - W.y0 + 0.8, 0.45, 0.06), M.frame, [wx - 0.3, (W.y0 + W.y1) / 2, z]);
  // Sill board protruding into the room.
  add(rbox(2.4, 0.32, W.z1 - W.z0 + 2.2, 0.1), M.sill, [wx + 0.9, W.y0 - 0.16, (W.z0 + W.z1) / 2]);
  // Two sliding sashes on separate tracks, each with a mid rail.
  const sashW = (W.z1 - W.z0) / 2 + 0.2;
  const sashes = [
    {x: wx - 0.75, z0: W.z0, z1: W.z0 + sashW},
    // The outer sash is slid open, leaving the front half of the window open.
    {x: wx - 0.45, z0: W.z0 + 0.25, z1: W.z0 + 0.25 + sashW},
  ];
  for (const s of sashes) {
    const zc = (s.z0 + s.z1) / 2, h = W.y1 - W.y0;
    for (const z of [s.z0 + 0.12, s.z1 - 0.12]) add(rbox(0.22, h, 0.24, 0.05), M.frame, [s.x, (W.y0 + W.y1) / 2, z]);
    for (const y of [W.y0 + 0.12, W.y1 - 0.12, W.y0 + h * 0.42]) add(rbox(0.22, 0.24, s.z1 - s.z0, 0.05), M.frame, [s.x, y, zc]);
    const glass = mesh(new THREE.PlaneGeometry(s.z1 - s.z0, h), M.glass, [s.x, (W.y0 + W.y1) / 2, zc], [0, PI / 2, 0]);
    glass.castShadow = false; glass.receiveShadow = false;
    glass.layers.set(NO_OUTLINE_LAYER);
  }
  // Rolled bamboo blind (sudare) under the lintel.
  {
    const tex = canvasTex(64, 512, (c, w, h) => {
      c.fillStyle = '#d9b27a'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) { c.fillStyle = 'rgba(140,96,50,.35)'; c.fillRect(0, y, w, 2); }
    });
    M.sudare.map = tex;
    const roll = mesh(cyl(0.38, 0.38, W.z1 - W.z0 + 0.4, 24), M.sudare, [wx + 0.25, W.y1 - 0.45, (W.z0 + W.z1) / 2], [PI / 2, 0, 0]);
    roll.castShadow = true;
    for (const z of [W.z0 + 1.5, W.z1 - 1.5]) add(cyl(0.03, 0.03, 1.2, 6), M.string, [wx + 0.6, W.y1 - 0.9, z]);
  }
  // Curtain gathered at the front edge of the window.
  const curtain = (() => {
    const cols = 18, rowsN = 24, width = 3.2, height = W.y1 - W.y0 + 2.8;
    const g = own(new THREE.PlaneGeometry(width, height, cols, rowsN));
    const base = g.attributes.position.array.slice();
    const m = new THREE.Mesh(g, M.curtain);
    m.position.set(wx + 1.15, (W.y0 + W.y1) / 2 + 0.6, W.z1 + 1.1);
    m.rotation.y = PI / 2;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    animated.push(t => {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = base[i], y = base[i + 1];
        const fall = (height / 2 - y) / height;  // 0 top → 1 bottom
        const fold = Math.sin(x * 6.5) * 0.28;
        p[i + 2] = fold + Math.sin(t * 0.9 + x * 2 + y * 0.3) * 0.12 * fall * fall;
        p[i] = x * (0.7 + 0.3 * fall) + Math.sin(t * 0.6 + y * 0.2) * 0.05 * fall;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    });
    return m;
  })();
  void curtain;
  // Rod for the curtain.
  add(cyl(0.06, 0.06, 4.4, 10), M.lampMetal, [wx + 1.15, W.y1 + 1.8, W.z1 + 1.1], [PI / 2, 0, 0]);

  // ---- outside: the street, sakura, town and sky (street.js) ---------------------------
  const street = createStreet(scene, {quality});

  // ---- desk -----------------------------------------------------------------------
  const D = ROOM.desk;
  const deskW = D.x1 - D.x0, deskD = D.z1 - D.z0;
  {
    const top = new THREE.Mesh(rbox(deskW, 0.8, deskD, 0.18), M.oak);
    top.position.set((D.x0 + D.x1) / 2, -0.4, (D.z0 + D.z1) / 2);
    top.castShadow = top.receiveShadow = true;
    root.add(top);
    add(rbox(deskW - 1, 2.0, 0.5, 0.1), M.darkWood, [(D.x0 + D.x1) / 2, -1.8, D.z1 - 0.9]);
    for (const x of [D.x0 + 1, D.x1 - 1]) for (const z of [D.z0 + 1, D.z1 - 1.2]) add(rbox(1.0, 14, 1.0, 0.12), M.darkWood, [x, -8, z]);
  }

  // ---- windowsill plants ---------------------------------------------------------------
  const sillTop = W.y0;
  const sillX = wx + 1.05;
  const lathe = (points, segments = 28) => own(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments));
  const potGeo = lathe([[0, 0], [0.62, 0], [0.7, 0.1], [0.82, 1.05], [0.95, 1.12], [0.95, 1.3], [0.8, 1.3], [0.78, 1.2], [0, 1.2]]);
  const smallPot = lathe([[0, 0], [0.45, 0], [0.55, 0.7], [0.62, 0.75], [0.62, 0.86], [0, 0.86]]);
  function pot(geo, material, x, y, z, scale = 1) {
    add(geo, material, [x, y, z], [0, 0, 0], [scale, scale, scale]);
    add(cyl(0.78 * scale * (geo === potGeo ? 1 : 0.72), 0.78 * scale * (geo === potGeo ? 1 : 0.72), 0.06, 20), M.soil, [x, y + (geo === potGeo ? 1.18 : 0.8) * scale, z]);
  }
  // 1. Geranium in terracotta: leaf mounds and pink flower umbels.
  {
    const x = sillX, z = -4.4, y = sillTop;
    pot(potGeo, M.terracotta, x, y, z, 1);
    for (let i = 0; i < 11; i++) {
      const a = rand() * PI * 2, r = 0.2 + rand() * 0.7;
      add(sphere(0.42, 12, 8), rand() < 0.5 ? M.leaf : M.leafDark, [x + Math.cos(a) * r, y + 1.5 + rand() * 0.6, z + Math.sin(a) * r], [0, 0, 0], [1, 0.45, 1]);
    }
    const flowerGeo = own(new THREE.IcosahedronGeometry(0.11, 0));
    for (let f = 0; f < 4; f++) {
      const a = f * PI / 2 + rand(), r = 0.35 + rand() * 0.3;
      const fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r, fy = y + 2.5 + rand() * 0.7;
      add(cyl(0.025, 0.025, fy - y - 1.4, 5), M.leafDark, [fx, (fy + y + 1.4) / 2, fz]);
      for (let k = 0; k < 9; k++) add(flowerGeo, f % 2 ? M.flowerPink : M.flowerRed, [fx + (rand() - 0.5) * 0.36, fy + (rand() - 0.3) * 0.22, fz + (rand() - 0.5) * 0.36]);
    }
  }
  // 2. Succulent rosette in a white pot.
  {
    const x = sillX + 0.1, z = -1.7, y = sillTop;
    pot(smallPot, M.potWhite, x, y, z, 1);
    const petal = own(new THREE.SphereGeometry(0.3, 10, 6));
    for (let ring = 0; ring < 3; ring++) {
      const n = 8 - ring * 2;
      for (let i = 0; i < n; i++) {
        const a = i * 2 * PI / n + ring * 0.4, r = 0.42 - ring * 0.14;
        add(petal, M.succulent, [x + Math.cos(a) * r, y + 0.98 + ring * 0.12, z + Math.sin(a) * r], [0, -a, 0.5 - ring * 0.15], [1, 0.32, 0.55]);
      }
    }
  }
  // 3. Cactus in a blue pot with a little pink flower.
  {
    const x = sillX, z = 0.8, y = sillTop;
    pot(smallPot, M.potBlue, x, y, z, 1.1);
    const body = lathe([[0, 0], [0.42, 0.05], [0.46, 0.6], [0.4, 1.2], [0.25, 1.5], [0, 1.58]], 16);
    add(body, M.cactus, [x, y + 0.9, z]);
    add(own(new THREE.CapsuleGeometry(0.16, 0.4, 4, 10)), M.cactus, [x + 0.42, y + 1.6, z], [0, 0, -0.5]);
    for (let i = 0; i < 6; i++) add(sphere(0.07, 6, 4), M.flowerPink, [x + Math.cos(i) * 0.1, y + 2.5, z + Math.sin(i) * 0.1]);
    add(sphere(0.06, 6, 4), M.flowerYellow, [x, y + 2.53, z]);
  }
  // 4. Tall glass bottle with daisies.
  {
    const x = sillX + 0.1, z = 3.0, y = sillTop;
    const bottle = mesh(lathe([[0, 0], [0.35, 0], [0.38, 0.9], [0.14, 1.35], [0.13, 1.8], [0, 1.8]], 20), M.chimeGlass, [x, y, z]);
    bottle.castShadow = false;
    for (let f = 0; f < 3; f++) {
      const fx = x + (f - 1) * 0.35, fy = y + 2.9 + f * 0.25 - (f === 1 ? -0.3 : 0), fz = z + (f - 1) * 0.15;
      add(cyl(0.022, 0.022, fy - y - 1.4, 5), M.leafDark, [(fx + x) / 2, (fy + y + 1.4) / 2, (fz + z) / 2], [0, 0, (x - fx) * 0.5]);
      for (let k = 0; k < 8; k++) {
        const a = k * PI / 4;
        add(sphere(0.12, 8, 5), M.flowerWhite, [fx + Math.cos(a) * 0.17, fy, fz + Math.sin(a) * 0.17], [0, -a, 0], [1, 0.35, 0.55]);
      }
      add(sphere(0.09, 8, 6), M.flowerYellow, [fx, fy + 0.03, fz]);
    }
  }
  // 5. Pothos trailing from the sill end down towards the desk.
  {
    const x = sillX + 0.1, z = 5.4, y = sillTop;
    pot(potGeo, M.potWhite, x, y, z, 0.8);
    const heart = own(new THREE.SphereGeometry(0.26, 10, 6));
    for (let v = 0; v < 3; v++) {
      const pts = [];
      for (let i = 0; i < 9; i++) pts.push(new THREE.Vector3(x + 0.3 + i * 0.12 + v * 0.2, y + 1.1 - i * (0.32 + v * 0.06), z - 0.8 + v * 0.7 + Math.sin(i + v) * 0.3));
      const curve = new THREE.CatmullRomCurve3(pts);
      add(own(new THREE.TubeGeometry(curve, 16, 0.025, 5)), M.leafDark);
      for (let i = 1; i < 9; i++) {
        const p = curve.getPoint(i / 9);
        add(heart, i % 2 ? M.leaf : M.leafDark, [p.x + 0.15, p.y, p.z + (i % 2 ? 0.2 : -0.2)], [0.4, i, 0.3], [1, 0.3, 0.8]);
      }
    }
  }

  // ---- wind chime (furin) with its paper strip -------------------------------------------
  const furin = new THREE.Group();
  furin.position.set(wx - 0.1, W.y1 - 1.0, 4.4);
  root.add(furin);
  {
    const bell = new THREE.Mesh(own(new THREE.SphereGeometry(0.42, 20, 12, 0, PI * 2, 0, PI * 0.55)), M.chimeGlass);
    bell.position.y = -0.55;
    furin.add(bell);
    const band = new THREE.Mesh(own(new THREE.TorusGeometry(0.36, 0.035, 6, 24)), M.chimePaint);
    band.rotation.x = PI / 2; band.position.y = -0.82; furin.add(band);
    const s1 = new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4)), M.string);
    s1.position.y = -0.27; furin.add(s1);
    const clapper = new THREE.Group(); clapper.position.y = -0.6; furin.add(clapper);
    const s2 = new THREE.Mesh(own(new THREE.CylinderGeometry(0.01, 0.01, 1.3, 4)), M.string);
    s2.position.y = -0.65; clapper.add(s2);
    const strip = new THREE.Mesh(own(new THREE.PlaneGeometry(0.42, 1.25)), M.paperStrip);
    strip.position.y = -1.85; clapper.add(strip);
    for (const o of [bell, band, strip]) { o.castShadow = true; }
    furin.userData.clapper = clapper;
  }
  let chimeEnergy = 0, chimeCallback = null;
  animated.push((t, dt) => {
    const gust = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1.3));
    furin.rotation.x = Math.sin(t * 1.7) * 0.04 * (0.4 + gust);
    const c = furin.userData.clapper;
    c.rotation.x = Math.sin(t * 2.3 + 0.5) * 0.25 * (0.3 + gust);
    c.rotation.z = Math.sin(t * 1.9) * 0.12 * gust;
    chimeEnergy += dt * gust * 0.9;
    if (chimeEnergy > 1 && chimeCallback) { chimeEnergy = -Math.random() * 0.8; chimeCallback(gust); }
  });

  // ---- back wall decor -----------------------------------------------------------------
  const bz = ROOM.backZ;
  // Wall clock with live hands.
  const clock = new THREE.Group();
  clock.position.set(10.4, 17.6, bz + 0.15);
  root.add(clock);
  {
    const face = new THREE.Mesh(cyl(1.5, 1.5, 0.22, 40), M.clockFace); face.rotation.x = PI / 2; face.castShadow = face.receiveShadow = true; clock.add(face);
    const rim = new THREE.Mesh(own(new THREE.TorusGeometry(1.52, 0.12, 8, 40)), M.darkWood); rim.position.z = 0.1; clock.add(rim);
    for (let i = 0; i < 12; i++) {
      const a = i * PI / 6;
      const tick = new THREE.Mesh(rbox(0.08, i % 3 ? 0.18 : 0.32, 0.04, 0.02), M.black);
      tick.position.set(Math.sin(a) * 1.22, Math.cos(a) * 1.22, 0.13); tick.rotation.z = -a; clock.add(tick);
    }
    const hand = (len, w, m) => { const g = new THREE.Group(); const h = new THREE.Mesh(rbox(w, len, 0.04, 0.02), m); h.position.y = len / 2 - 0.1; g.add(h); g.position.z = 0.16; clock.add(g); return g; };
    const hourHand = hand(0.75, 0.12, M.black), minuteHand = hand(1.1, 0.08, M.black), secondHand = hand(1.15, 0.03, M.daruma);
    animated.push(() => {
      const d = new Date();
      const s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
      hourHand.rotation.z = -h * PI / 6; minuteHand.rotation.z = -m * PI / 30; secondHand.rotation.z = -Math.floor(s) * PI / 30;
    });
  }
  // Cork board with polaroids and notes.
  {
    add(rbox(6.0, 4.0, 0.2, 0.08), M.darkWood, [10.5, 8.0, bz + 0.1]);
    add(rbox(5.6, 3.6, 0.22, 0.05), M.cork, [10.5, 8.0, bz + 0.12]);
    // (Polaroids are pinned on it in lofi.js.) One sticky note peeking out.
    add(rbox(0.9, 0.9, 0.04, 0.02), mat(toon(0xfff2a8)), [13.0, 9.2, bz + 0.25], [0, 0, 0.12]);
  }
  // Fairy lights draped along the back wall.
  const fairyBulbs = [];
  {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const x = -4.5 + i * 0.5, sag = Math.sin(((i % 10) / 10) * PI) * 1.0;
      pts.push(new THREE.Vector3(x, 20.6 - sag, bz + 0.35));
    }
    add(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.03, 4)), M.fairyWire);
    const bulbGeo = sphere(0.14, 10, 8);
    for (let i = 1; i < 40; i += 2) {
      const p = pts[i];
      const b = new THREE.Mesh(bulbGeo, M.fairyBulb);
      b.position.set(p.x, p.y - 0.18, p.z);
      b.layers.set(NO_OUTLINE_LAYER);
      root.add(b);
      fairyBulbs.push(b);
    }
  }

  // ---- desk props ------------------------------------------------------------------------
  // Stack of books with a mug of pencils on top (back left).
  {
    const x = -12.5, z = -5.6;
    const mats = [M.bookB, M.bookA, M.bookD];
    mats.forEach((m, i) => {
      add(rbox(3.4 - i * 0.2, 0.5, 2.5 - i * 0.1, 0.06), m, [x, 0.25 + i * 0.5, z], [0, 0.08 * (i - 1), 0]);
      add(rbox(3.2 - i * 0.2, 0.42, 2.3 - i * 0.1, 0.03), M.pages, [x + 0.12, 0.25 + i * 0.5, z], [0, 0.08 * (i - 1), 0]);
    });
  }
  // Sleeping cat on a cushion, in the sun: a curled "loaf" facing the room.
  const cat = new THREE.Group();
  cat.position.set(-10.4, 0, -4.4);
  cat.rotation.y = 0.5;
  root.add(cat);
  {
    const cushion = new THREE.Mesh(rbox(4.0, 0.62, 3.6, 0.3, 4), M.cushion);
    cushion.position.y = 0.31; cushion.castShadow = cushion.receiveShadow = true; cat.add(cushion);
    for (const [x, z] of [[-1.85, -1.65], [1.85, -1.65], [-1.85, 1.65], [1.85, 1.65]]) {
      const tassel = new THREE.Mesh(sphere(0.13, 8, 6), M.flowerYellow); tassel.position.set(x, 0.58, z); cat.add(tassel);
    }
  }
  // The cat itself: a chibi orange tabby (cat.js).
  const kitty = createCat();
  kitty.group.position.set(0, 0, 0.1);
  kitty.group.scale.setScalar(1.08);
  cat.add(kitty.group);
  disposers.push(() => kitty.dispose());
  animated.push((t, dt) => kitty.update(t, dt));
  const decor = createDecor(root, {backZ: ROOM.backZ});
  disposers.push(() => decor.dispose());
  const lofi = createLofi(root, {backZ: ROOM.backZ});
  disposers.push(() => lofi.dispose());
  // The floating music player, between the big print and the clock.
  const player = createPlayerCard({position: new THREE.Vector3(9.3, 13.2, ROOM.backZ + 1.4), size: [5.8, 2.9], turn: 0.15});
  root.add(player.group);
  disposers.push(() => player.dispose());
  const slots = [...decor.slots, ...lofi.slots];

  // Tea cup (yunomi) on a wooden coaster with rising steam.
  const teaPos = new THREE.Vector3(9.6, 0, 3.2);
  {
    add(cyl(0.95, 0.95, 0.1, 28), M.darkWood, [teaPos.x, 0.05, teaPos.z]);
    const cup = lathe([[0, 0], [0.5, 0], [0.56, 0.08], [0.66, 1.15], [0.6, 1.15], [0.52, 0.18], [0, 0.18]], 28);
    add(cup, M.cup, [teaPos.x, 0.1, teaPos.z]);
    add(cyl(0.66, 0.63, 0.18, 28), M.cupBand, [teaPos.x, 0.85, teaPos.z]);
    add(cyl(0.56, 0.56, 0.02, 24), M.tea, [teaPos.x, 1.0, teaPos.z]);
  }
  // Pencil cup and pencils.
  {
    const x = 11.8, z = -4.6;
    add(cyl(0.6, 0.55, 1.5, 20), M.potBlue, [x, 0.75, z]);
    const cols = [M.bookC, M.daruma, M.leaf, M.bookB];
    cols.forEach((m, i) => {
      add(cyl(0.08, 0.08, 2.2, 6), m, [x + (i - 1.5) * 0.18, 1.9, z + (i % 2 ? 0.12 : -0.1)], [(i % 2 ? 0.12 : -0.1), 0, (i - 1.5) * 0.08]);
      add(own(new THREE.ConeGeometry(0.08, 0.25, 6)), M.pages, [x + (i - 1.5) * 0.18 + (i - 1.5) * 0.09, 3.1, z + (i % 2 ? 0.25 : -0.22)], [(i % 2 ? 0.12 : -0.1), 0, (i - 1.5) * 0.08]);
    });
  }
  // Desk lamp (right back) with a warm point light.
  const lampHead = new THREE.Vector3(9.2, 7.6, -4.2);
  {
    const base = new THREE.Vector3(12.5, 0, -5.5);
    add(cyl(1.0, 1.15, 0.35, 32), M.lampMetal, [base.x, 0.18, base.z]);
    const elbow = new THREE.Vector3(13.2, 5.4, -5.8);
    const arm = (a, b) => {
      const d = b.clone().sub(a); const len = d.length();
      const o = new THREE.Object3D(); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); o.updateMatrix();
      const g = cyl(0.12, 0.12, len, 10).clone().applyMatrix4(o.matrix); own(g);
      add(g, M.lampMetal);
    };
    arm(new THREE.Vector3(base.x, 0.3, base.z), elbow);
    arm(elbow, lampHead.clone().add(new THREE.Vector3(0.6, 0.6, -0.2)));
    add(sphere(0.25, 12, 8), M.lampMetal, [elbow.x, elbow.y, elbow.z]);
    // Dome shade, opening tilted towards the typewriter.
    const shade = new THREE.Mesh(own(new THREE.SphereGeometry(1.25, 32, 14, 0, PI * 2, 0, PI * 0.46)), M.lampShade);
    shade.position.copy(lampHead).add(new THREE.Vector3(0, 0.15, 0));
    shade.scale.set(1, 0.8, 1);
    shade.rotation.set(0.32, 0, 0.55);
    shade.castShadow = true;
    root.add(shade);
    // Rolled rim: a child of the shade so it shares the exact tilt.
    const rimRing = new THREE.Mesh(own(new THREE.TorusGeometry(1.25 * Math.sin(PI * 0.46), 0.08, 8, 32)), M.lampMetal);
    rimRing.position.y = 1.25 * Math.cos(PI * 0.46);
    rimRing.rotation.x = PI / 2;
    rimRing.castShadow = true;
    shade.add(rimRing);
    const bulb = new THREE.Mesh(sphere(0.38, 14, 10), M.bulb);
    bulb.position.copy(lampHead).add(new THREE.Vector3(-0.25, -0.35, 0.15));
    bulb.layers.set(NO_OUTLINE_LAYER);
    root.add(bulb);
  }

  flush();

  // ---- lights -------------------------------------------------------------------------------
  const sun = new THREE.DirectionalLight(0xffd9a4, 3.4);
  sun.castShadow = true;
  const shadowSize = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -27; sc.right = 27; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(-2, 4, -1);
  sun.target = sunTarget;
  scene.add(sun, sunTarget);
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0xb58866, 1.5);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe7cf, 0.45);
  fill.position.set(10, 14, 22);
  scene.add(fill);
  const lamp = new THREE.PointLight(0xffb36b, 0, 40, 1.6);
  lamp.position.copy(lampHead).add(new THREE.Vector3(-0.4, -0.9, 0.2));
  scene.add(lamp);

  // ---- light shafts and dust motes (inside the sunbeam only) -------------------------------
  const sunDir = new THREE.Vector3();
  const shaftUniforms = {
    sunDir: {value: sunDir},
    color: {value: new THREE.Color(0xffd9a4)},
    strength: {value: 0.24},
    time: {value: 0},
    windowMin: {value: new THREE.Vector2(W.z0, W.y0)},
    windowMax: {value: new THREE.Vector2(W.z1, W.y1)},
    wallX: {value: ROOM.wallX},
  };
  const shafts = new THREE.Group();
  root.add(shafts);
  {
    // Each shaft: a strip starting on the window plane, extruded along the
    // light, expanded sideways towards the camera in the vertex shader.
    const shaftMat = mat(new THREE.ShaderMaterial({
      uniforms: shaftUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec3 start; attribute vec2 shape; attribute float seed;
        uniform vec3 sunDir;
        varying vec2 vShape; varying float vSeed; varying float vSide;
        void main(){
          vec3 axis = -normalize(sunDir);
          float len = 26.0;
          vec3 p = start + axis * (shape.y * len);
          vec3 view = normalize(cameraPosition - p);
          vec3 side = normalize(cross(axis, view));
          float width = mix(1.1, 2.6, fract(seed * 7.3));
          p += side * shape.x * width;
          // Seen end-on (looking towards the window) the beams would stack up
          // and wash out the view, so they fade; from the side they show.
          vSide = 1.0 - smoothstep(0.55, 0.92, abs(dot(view, axis)));
          vShape = shape; vSeed = seed;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 color; uniform float strength; uniform float time;
        varying vec2 vShape; varying float vSeed; varying float vSide;
        void main(){
          float across = 1.0 - smoothstep(0.0, 1.0, abs(vShape.x));
          float along = smoothstep(0.0, 0.1, vShape.y) * (1.0 - smoothstep(0.22, 0.8, vShape.y));
          float flicker = 0.75 + 0.25 * sin(time * 0.6 + vSeed * 40.0);
          gl_FragColor = vec4(color * across * across * along * strength * flicker * vSide, 1.0);
        }`,
    }));
    const count = 7;
    const starts = [], shapes = [], seeds = [], index = [];
    for (let i = 0; i < count; i++) {
      const z = W.z0 + 1 + (W.z1 - W.z0 - 2) * (i + 0.5) / count + (rand() - 0.5);
      const y = W.y0 + 3 + rand() * (W.y1 - W.y0 - 6);
      const st = [ROOM.wallX - 0.3, y, z];
      const base = i * 4;
      for (const [sx, sy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) { starts.push(...st); shapes.push(sx, sy); seeds.push(rand()); }
      index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(starts.length), 3));
    g.setAttribute('start', new THREE.Float32BufferAttribute(starts, 3));
    g.setAttribute('shape', new THREE.Float32BufferAttribute(shapes, 2));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    g.setIndex(index);
    const m = new THREE.Mesh(g, shaftMat);
    m.frustumCulled = false;
    m.layers.set(NO_OUTLINE_LAYER);
    m.renderOrder = 5;
    shafts.add(m);
  }
  const dust = (() => {
    const n = quality === 'low' ? 120 : 320;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -15 + rand() * 24; pos[i * 3 + 1] = 0.5 + rand() * 13; pos[i * 3 + 2] = -7 + rand() * 13;
      seed[i] = rand();
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = mat(new THREE.ShaderMaterial({
      uniforms: {...shaftUniforms, pixelRatio: {value: 1}, dustStrength: {value: 1}},
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float seed;
        uniform float time; uniform vec3 sunDir; uniform vec2 windowMin; uniform vec2 windowMax; uniform float wallX; uniform float pixelRatio;
        varying float vLit; varying float vSeed;
        void main(){
          vec3 p = position;
          p.x += sin(time * 0.11 + seed * 31.0) * 0.6;
          p.y += mod(time * (0.05 + seed * 0.08) + seed * 13.0, 13.0) - 6.5 + sin(time * 0.3 + seed * 9.0) * 0.3;
          p.y = 0.5 + mod(p.y, 13.0);
          p.z += cos(time * 0.13 + seed * 17.0) * 0.6;
          // Lit only if the ray towards the sun passes through the window.
          vec3 L = normalize(sunDir);
          float k = (wallX - p.x) / L.x;
          vec3 h = p + L * k;
          vec2 w = vec2(h.z, h.y);
          vec2 inside = smoothstep(windowMin, windowMin + 0.6, w) * (1.0 - smoothstep(windowMax - 0.6, windowMax, w));
          vLit = inside.x * inside.y * step(0.0, k);
          vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + seed * 3.5) * pixelRatio * (14.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 color; uniform float time; uniform float dustStrength;
        varying float vLit; varying float vSeed;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          float tw = 0.55 + 0.45 * sin(time * (1.0 + vSeed * 2.0) + vSeed * 50.0);
          gl_FragColor = vec4(color * a * vLit * tw * 0.9 * dustStrength, 1.0);
        }`,
    }));
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.layers.set(NO_OUTLINE_LAYER);
    root.add(pts);
    return {points: pts, material: m};
  })();
  // Steam above the tea.
  const steam = (() => {
    const n = 12;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = teaPos.x; pos[i * 3 + 1] = 1.1; pos[i * 3 + 2] = teaPos.z; seed[i] = i / n; }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = mat(new THREE.ShaderMaterial({
      uniforms: {time: {value: 0}, pixelRatio: {value: 1}, tint: {value: new THREE.Color(0xffffff)}},
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float seed; uniform float time; uniform float pixelRatio; varying float vAge;
        void main(){
          float age = fract(time * 0.11 + seed);
          vec3 p = position + vec3(sin(age * 5.0 + seed * 20.0 + time * 0.7) * 0.55 * age, age * 3.2, cos(age * 4.0 + seed * 9.0) * 0.4 * age);
          vAge = age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (30.0 + age * 90.0) * pixelRatio * (14.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 tint; varying float vAge;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * smoothstep(0.0, 0.2, vAge) * (1.0 - vAge) * 0.07;
          gl_FragColor = vec4(tint, a);
        }`,
    }));
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.layers.set(NO_OUTLINE_LAYER);
    root.add(pts);
    return m;
  })();

  // ---- lighting presets ------------------------------------------------------------------------
  let mode = 'afternoon', intensity = 1, renderer = null, onLineColor = null;
  function apply() {
    const p = LIGHTING[mode];
    sunDir.set(...p.sunDir).normalize();
    sun.position.copy(sunTarget.position).addScaledVector(sunDir, 55);
    sun.color.set(p.sun); sun.intensity = p.sunI * intensity;
    hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemiI * intensity;
    fill.intensity = p.fill * intensity;
    lamp.intensity = p.lamp * intensity;
    M.lampShade.emissiveIntensity = p.lampGlow * 0.25;
    M.bulb.color.setRGB(1, 0.92, 0.75).multiplyScalar(0.6 + p.lampGlow);
    M.fairyBulb.color.setRGB(1, 0.8, 0.5).multiplyScalar(p.fairy);
    shaftUniforms.color.value.set(p.sun);
    shaftUniforms.strength.value = p.shafts;
    dust.material.uniforms.dustStrength.value = p.dust;
    steam.uniforms.tint.value.set(mode === 'night' ? 0xc9d2ff : 0xffffff);
    street.setMode(mode, sunDir);
    lofi.setMode(mode);
    scene.background = new THREE.Color(p.bg);
    if (renderer) renderer.toneMappingExposure = p.exposure;
    onLineColor?.(p.line);
  }

  let musicState = {count: 0, index: 0, title: '', playing: false, progress: 0, time: 0, duration: 0, levels: new Float32Array(32), level: 0};
  let pixelRatio = 1;
  function update(t, dt) {
    lofi.update(t, dt);
    player.update(t, dt, musicState, pixelRatio);
    for (const f of animated) f(t, dt);
    street.update(t, dt);
    decor.update(t, dt);
    shaftUniforms.time.value = t;
    steam.uniforms.time.value = t;
    for (let i = 0; i < fairyBulbs.length; i++) {
      const s = 1 + Math.sin(t * 1.3 + i * 1.7) * 0.08;
      fairyBulbs[i].scale.setScalar(s);
    }
  }
  function setPixelRatio(pr) {
    pixelRatio = pr;
    dust.material.uniforms.pixelRatio.value = pr;
    steam.uniforms.pixelRatio.value = pr;
  }

  apply();
  return {
    root,
    sun,
    ready: decor.ready,
    update,
    setPixelRatio,
    setRenderer(r) { renderer = r; apply(); },
    setLight(v) { if (LIGHTING[v]) { mode = v; apply(); } },
    setIntensity(v) { intensity = v; apply(); },
    onLineColor(fn) { onLineColor = fn; apply(); },
    onChime(fn) { chimeCallback = fn; },
    /** The cat perks up (carriage bell). */
    catReact() { kitty.react(); },
    /** Picture slots on the walls: [{id, label, mesh, aspect}]. */
    slots,
    /** Put a canvas into a slot (null restores the original picture). */
    setSlotCanvas(id, canvas) {
      const slot = slots.find(s => s.id === id);
      if (!slot) return;
      if (slot.custom) { slot.custom.dispose(); slot.custom = null; }
      if (canvas) {
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        slot.custom = t;
      }
      slot.material.map = slot.custom || slot.defaultMap;
      slot.material.color.set(0xffffff);
      slot.material.needsUpdate = true;
    },
    player,
    /** Music state for the floating player and the record player. */
    setMusic(state) { musicState = state; lofi.setMusic(state); },
    setShadowQuality(q) {
      const size = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    },
    get mode() { return mode; },
    dispose() {
      geometries.forEach(g => g.dispose());
      textures.forEach(t => t.dispose());
      materials.forEach(m => m.dispose());
      sun.shadow.map?.dispose();
      street.dispose();
      for (const slot of slots) slot.custom?.dispose();
      disposers.forEach(f => f());
      scene.remove(sun, sunTarget, hemi, fill, lamp);
      root.removeFromParent();
    },
  };
}
