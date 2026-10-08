// Wall bookshelf, framed ukiyo-e prints, an air-conditioner, desk props and
// soft contact shadows. Prints are public-domain works from The Met's Open
// Access programme (CC0), stored in public/assets.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {toon, NO_OUTLINE_LAYER} from './toon.js';

const PI = Math.PI;
const asset = name => new URL(`assets/${name}`, document.baseURI).href;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createDecor(root, {backZ}) {
  const owned = [];
  const own = x => (owned.push(x), x);
  const rand = rng(31);
  const animated = [];
  const tex = (w, h, paint) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    const t = own(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  const rbox = (w, h, d, r = 0.05, s = 2) => own(new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
  // Static parts are merged per material.
  const batches = new Map();
  const o3 = new THREE.Object3D();
  function add(geo, mat, pos, rot = [0, 0, 0], scale = [1, 1, 1]) {
    o3.position.set(...pos); o3.rotation.set(...rot); o3.scale.set(...scale); o3.updateMatrix();
    if (!batches.has(mat)) batches.set(mat, []);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    g.applyMatrix4(o3.matrix);
    batches.get(mat).push(g);
  }
  const M = {
    wood: own(toon(0xb98252, {spec: 0.12, rim: 0.08})),
    woodDark: own(toon(0x7c5136, {spec: 0.1})),
    tinted: own(toon(0xffffff, {vertexColors: true, rim: 0.1})),
    white: own(toon(0xf7f4ec, {spec: 0.3})),
    frame: own(toon(0x3e2c22, {spec: 0.25, shine: 40})),
    mat: own(toon(0xf3ead6)),
    felt: own(toon(0x3f6656, {rim: 0.05})),
    plastic: own(toon(0x2f2d33, {spec: 0.5, shine: 50})),
    cream: own(toon(0xf3e6c8, {spec: 0.3})),
    leaf: own(toon(0x5f9d63, {rim: 0.15, rimColor: 0xf6ffb0, side: THREE.DoubleSide})),
    gold: own(toon(0xe9b44c, {spec: 0.8, shine: 40})),
    red: own(toon(0xd9493e, {spec: 0.5})),
  };

  // ---- book spines: one tinted texture, details in greys -------------------
  const spineTex = tex(512, 256, (c, w, h) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
    // 8 spine designs side by side (each 64 px wide).
    const r = rng(9);
    for (let i = 0; i < 8; i++) {
      const x = i * 64;
      c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(x, 0, 3, h); c.fillRect(x + 61, 0, 3, h);
      const bands = 1 + Math.floor(r() * 3);
      for (let b = 0; b < bands; b++) {
        const y = 20 + b * 22 + (i % 2) * 150;
        c.fillStyle = i % 3 ? 'rgba(255,240,200,.85)' : 'rgba(40,30,20,.35)';
        c.fillRect(x + 6, y, 52, 6);
      }
      // Title: a column of little glyph strokes.
      c.fillStyle = i % 3 ? 'rgba(255,248,230,.9)' : 'rgba(30,22,16,.6)';
      const ty = 80 + r() * 20;
      for (let k = 0; k < 5 + Math.floor(r() * 4); k++) c.fillRect(x + 24 + r() * 8, ty + k * 14, 10 + r() * 6, 7);
    }
  });
  M.books = own(toon(0xffffff, {map: spineTex, vertexColors: true, rim: 0.08}));
  const bookColors = [0xc4523f, 0x3f6f8f, 0xe0b04f, 0x5f8f5a, 0x8f5f8f, 0x2f4f6f, 0xd8885a, 0x7a3f3f, 0x4f7f7a, 0xe9dcc0, 0x9a6a4a, 0x35556e];
  const bookBatch = [];
  /** A book with its spine facing +z; spine texture on the spine face only. */
  function book(x, y, z, w, h, d, color, lean = 0) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    const uv = g.attributes.uv;
    const design = Math.floor(rand() * 8);
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z (6 vertices each).
    for (let f = 0; f < 6; f++) for (let k = 0; k < 6; k++) {
      const i = f * 6 + k;
      if (f === 4) uv.setXY(i, (design + uv.getX(i)) / 8, uv.getY(i));
      else uv.setXY(i, (design + 0.5) / 8, 0.5);   // plain part of the spine colour
    }
    const pages = f => f === 2;   // top shows page edges (paler)
    const col = new THREE.Color(color), paper = new THREE.Color(0xf4ecd8);
    const colors = new Float32Array(36 * 3);
    for (let f = 0; f < 6; f++) for (let k = 0; k < 6; k++) {
      const c = pages(f) ? paper : col;
      colors.set([c.r, c.g, c.b], (f * 6 + k) * 3);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    o3.position.set(x, y, z); o3.rotation.set(0, 0, lean); o3.scale.set(1, 1, 1); o3.updateMatrix();
    g.applyMatrix4(o3.matrix);
    bookBatch.push(g);
  }

  // ---- wall bookshelf (left of the back wall) ---------------------------------
  const bz = backZ;
  const shelf = {x0: -15.2, x1: -5.4, depth: 2.1};
  const shelves = [6.0, 10.7, 15.4, 20.0];
  const sw = shelf.x1 - shelf.x0, sx = (shelf.x0 + shelf.x1) / 2, sd = shelf.depth;
  for (const y of shelves) add(rbox(sw, 0.32, sd, 0.06), M.wood, [sx, y, bz + sd / 2 + 0.05]);
  for (const x of [shelf.x0 + 0.15, shelf.x1 - 0.15]) add(rbox(0.3, shelves[3] - shelves[0] + 0.3, sd, 0.06), M.wood, [x, (shelves[0] + shelves[3]) / 2, bz + sd / 2 + 0.05]);
  add(rbox(sw, shelves[3] - shelves[0], 0.12, 0.02), M.woodDark, [sx, (shelves[0] + shelves[3]) / 2, bz + 0.1]);
  // Fill each tier with books, leaving room for objects.
  const fillRow = (y, from, to) => {
    let x = from;
    while (x < to - 0.3) {
      const w = 0.28 + rand() * 0.26, h = 2.4 + rand() * 1.4, d = 1.45 + rand() * 0.35;
      if (x + w > to) break;
      const lean = rand() < 0.08 ? -0.12 : 0;
      book(x + w / 2, y + 0.16 + h / 2, bz + 0.25 + d / 2, w, h, d, bookColors[Math.floor(rand() * bookColors.length)], lean);
      x += w + 0.02 + (rand() < 0.1 ? 0.25 : 0);
    }
  };
  fillRow(shelves[0], shelf.x0 + 0.35, shelf.x0 + 5.6);
  fillRow(shelves[1], shelf.x0 + 2.9, shelf.x1 - 0.35);
  fillRow(shelves[2], shelf.x0 + 0.35, shelf.x0 + 4.2);
  // A stack of books lying flat.
  for (let k = 0; k < 3; k++) book(shelf.x0 + 1.4, shelves[1] + 0.32 + k * 0.42, bz + 1.1, 2.3 - k * 0.2, 0.4, 1.6 - k * 0.1, bookColors[(k * 5) % bookColors.length]);
  // Maneki-neko on the bottom tier.
  {
    const x = shelf.x1 - 2.2, y = shelves[0] + 0.16, z = bz + 1.15;
    add(own(new THREE.SphereGeometry(0.62, 20, 14)), M.white, [x, y + 0.55, z], [0, 0, 0], [1, 1.05, 0.9]);
    add(own(new THREE.SphereGeometry(0.5, 20, 14)), M.white, [x, y + 1.45, z + 0.02]);
    for (const s of [-1, 1]) add(own(new THREE.ConeGeometry(0.16, 0.3, 4)), M.white, [x + s * 0.3, y + 1.88, z], [0, PI / 4, -s * 0.3]);
    add(own(new THREE.TorusGeometry(0.42, 0.06, 6, 20)), M.red, [x, y + 1.0, z + 0.05], [PI / 2 + 0.25, 0, 0]);
    add(own(new THREE.SphereGeometry(0.11, 8, 6)), M.gold, [x, y + 0.92, z + 0.5]);
    add(own(new THREE.CapsuleGeometry(0.11, 0.38, 4, 8)), M.white, [x + 0.42, y + 1.62, z + 0.18], [0.2, 0, -0.25]);   // raised paw
    add(own(new THREE.CircleGeometry(0.04, 8)), M.plastic, [x - 0.17, y + 1.5, z + 0.5]);
    add(own(new THREE.CircleGeometry(0.04, 8)), M.plastic, [x + 0.17, y + 1.5, z + 0.5]);
    add(own(new THREE.SphereGeometry(0.33, 12, 8)), M.gold, [x, y + 0.4, z + 0.48], [0, 0, 0], [1, 0.75, 0.4]);   // koban coin
  }
  // A potted plant with real leaf shapes, bottom tier right.
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.bezierCurveTo(0.35, 0.15, 0.4, 0.6, 0, 1); leafShape.bezierCurveTo(-0.4, 0.6, -0.35, 0.15, 0, 0);
  const leafGeo = own(new THREE.ShapeGeometry(leafShape, 6));
  {
    const x = shelf.x1 - 0.95, y = shelves[0] + 0.16, z = bz + 1.1;
    add(own(new THREE.CylinderGeometry(0.42, 0.34, 0.75, 16)), M.cream, [x, y + 0.37, z]);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4;
      add(leafGeo, M.leaf, [x + Math.cos(a) * 0.12, y + 0.7, z + Math.sin(a) * 0.12], [-0.5 - rand() * 0.5, a, 0], [0.55, 0.9 + rand() * 0.4, 0.55]);
    }
  }
  // Top tier: a vase with dried flowers and a small photo frame.
  {
    const x = shelf.x1 - 1.4, y = shelves[2] + 0.16, z = bz + 1.0;
    add(own(new THREE.LatheGeometry([[0, 0], [0.32, 0], [0.38, 0.4], [0.18, 1.0], [0.2, 1.3], [0, 1.3]].map(([r, h]) => new THREE.Vector2(r, h)), 18)), M.cream, [x, y, z]);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.1, tip = new THREE.Vector3(x + Math.cos(a) * 0.5, y + 2.4 + rand() * 0.6, z + Math.sin(a) * 0.3);
      const dir = tip.clone().sub(new THREE.Vector3(x, y + 1.2, z));
      const len = dir.length();
      add(own(new THREE.CylinderGeometry(0.02, 0.02, len, 4)), M.woodDark, [x + dir.x / 2, y + 1.2 + dir.y / 2, z + dir.z / 2], [Math.atan2(dir.z, dir.y), 0, -Math.atan2(dir.x, dir.y)]);
      add(own(new THREE.SphereGeometry(0.1, 6, 5)), M.gold, [tip.x, tip.y, tip.z]);
    }
    // Photo: two little figures under a cherry tree (drawn).
    const photo = tex(128, 160, (c, w, h) => {
      c.fillStyle = '#fbf6ec'; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 10, 0, 120); g.addColorStop(0, '#8fc6ec'); g.addColorStop(1, '#e8f3f2');
      c.fillStyle = g; c.fillRect(10, 10, 108, 110);
      c.fillStyle = '#f6b8c8'; c.beginPath(); c.arc(40, 50, 26, 0, PI * 2); c.arc(70, 40, 24, 0, PI * 2); c.fill();
      c.fillStyle = '#7a5a4a'; c.fillRect(52, 60, 6, 50);
      c.fillStyle = '#9fbf8a'; c.fillRect(10, 105, 108, 15);
      c.fillStyle = '#e86a4f'; c.fillRect(80, 85, 9, 22); c.fillStyle = '#4f6f9f'; c.fillRect(94, 88, 9, 19);
    });
    add(rbox(1.1, 1.35, 0.14, 0.04), M.frame, [shelf.x0 + 1.3, y + 0.85, bz + 0.6], [-0.15, 0.2, 0]);
    const ph = new THREE.Mesh(own(new THREE.PlaneGeometry(0.88, 1.1)), own(toon(0xffffff, {map: photo})));
    ph.position.set(shelf.x0 + 1.31, y + 0.85, bz + 0.68);
    ph.rotation.set(-0.15, 0.2, 0);
    root.add(ph);
  }

  // Daruma on the top tier.
  {
    const x = shelf.x0 + 5.6, y = shelves[2] + 0.16, z = bz + 1.05;
    add(own(new THREE.SphereGeometry(0.72, 22, 16)), M.red, [x, y + 0.7, z], [0, 0, 0], [1, 1.06, 0.95]);
    add(own(new THREE.SphereGeometry(0.42, 18, 12)), M.cream, [x, y + 0.92, z + 0.48], [0, 0, 0], [1, 0.9, 0.42]);
    for (const s of [-1, 1]) {
      add(own(new THREE.SphereGeometry(0.09, 10, 8)), M.plastic, [x + s * 0.15, y + 0.97, z + 0.66]);
      add(own(new THREE.BoxGeometry(0.2, 0.05, 0.05)), M.plastic, [x + s * 0.17, y + 1.13, z + 0.64], [0, 0, s * 0.3]);
    }
    add(own(new THREE.TorusGeometry(0.5, 0.05, 6, 24, PI)), M.gold, [x, y + 0.45, z + 0.5], [0, 0, PI]);
  }

  // ---- framed ukiyo-e prints (public domain, The Met, CC0) ----------------------
  const loader = new THREE.TextureLoader();
  const prints = [
    {id: 'print-wave', label: '大幅浮世绘（神奈川冲浪里）', file: 'great-wave.jpg', x: 1.6, y: 14.6, w: 6.4, aspect: 600 / 403},
    {id: 'print-fuji', label: '左下小画（凯风快晴）', file: 'red-fuji.jpg', x: -2.0, y: 8.3, w: 3.5, aspect: 599 / 413},
    {id: 'print-sakura', label: '右下小画（御殿山夕樱）', file: 'gotenyama-sakura.jpg', x: 5.0, y: 8.3, w: 3.5, aspect: 600 / 403},
  ];
  // Each print is a slot the user can put their own picture into.
  const slots = [];
  const loads = prints.map(p => new Promise(resolve => {
    const h = p.w / p.aspect;
    add(rbox(p.w + 0.7, h + 0.7, 0.22, 0.05), M.frame, [p.x, p.y, bz + 0.12]);
    add(rbox(p.w + 0.32, h + 0.32, 0.06, 0.01), M.mat, [p.x, p.y, bz + 0.25]);
    const material = own(toon(0xffffff, {rim: 0}));
    const plane = new THREE.Mesh(own(new THREE.PlaneGeometry(p.w, h)), material);
    plane.position.set(p.x, p.y, bz + 0.29);
    plane.receiveShadow = true;
    root.add(plane);
    const slot = {id: p.id, label: p.label, mesh: plane, material, aspect: p.aspect, defaultMap: null};
    slots.push(slot);
    loader.load(asset(p.file), t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      own(t);
      slot.defaultMap = t;
      if (!slot.custom) { material.map = t; material.needsUpdate = true; }
      resolve();
    }, undefined, () => { material.color.set(0xd8cdb4); resolve(); });
  }));

  // ---- wall-mounted air conditioner ---------------------------------------------------
  {
    const x = 6.2, y = 25.2, z = bz + 1.1;
    add(rbox(13, 3.6, 2.2, 0.5, 3), M.white, [x, y, z]);
    add(rbox(12.2, 0.25, 0.4, 0.1), M.cream, [x, y - 1.55, z + 1.0]);
    add(rbox(1.2, 0.22, 0.05, 0.05), M.plastic, [x + 5.0, y + 0.9, z + 1.11]);
    const led = new THREE.Mesh(own(new THREE.SphereGeometry(0.07, 8, 6)), own(new THREE.MeshBasicMaterial({color: 0x7fe0a0})));
    led.position.set(x + 4.2, y + 0.9, z + 1.12);
    led.layers.set(NO_OUTLINE_LAYER);
    root.add(led);
  }

  // ---- desk props ------------------------------------------------------------------------
  // Felt mat under the typewriter (dampens the clatter on real desks too).
  add(rbox(9.6, 0.1, 8.4, 0.05, 2), M.felt, [0, 0.05, 1.1]);
  // Headphones lying on the desk.
  {
    const x = 13.0, z = 1.5;
    add(own(new THREE.TorusGeometry(1.1, 0.13, 8, 24, PI)), M.plastic, [x, 0.25, z], [-PI / 2, 0, 0.3]);
    for (const s of [-1, 1]) {
      const cx = x + Math.cos(0.3) * s * 1.1, cz = z - Math.sin(0.3) * s * 1.1;
      add(own(new THREE.CylinderGeometry(0.55, 0.55, 0.42, 20)), M.plastic, [cx, 0.25, cz], [0, 0, 0]);
      add(own(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20)), M.cream, [cx, 0.48, cz]);
    }
  }
  // Notebook with a pencil.
  {
    const x = 7.4, z = 3.9;
    add(rbox(3.0, 0.24, 3.8, 0.06), M.cream, [x, 0.12, z], [0, 0.25, 0]);
    add(rbox(3.04, 0.06, 3.84, 0.02), M.felt, [x, 0.26, z], [0, 0.25, 0]);
    add(own(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6)), M.gold, [x + 0.2, 0.36, z], [PI / 2, 0, 0.6]);
  }

  // ---- contact shadows ---------------------------------------------------------------------
  const blob = tex(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.55, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const shadowMat = own(new THREE.MeshBasicMaterial({map: blob, transparent: true, depthWrite: false, color: 0x3a2418, opacity: 0.65}));
  const shadows = [
    [0, 1.2, 10.6, 9.4, 0], [9.6, 3.2, 2.6, 2.6, 0], [11.8, -4.6, 1.9, 1.9, 0], [12.5, -5.5, 3, 3, 0],
    [-12.5, -5.6, 4.4, 3.3, 0.05], [-10.4, -4.4, 5.2, 4.6, 0.5], [7.4, 3.9, 3.8, 4.6, 0.25], [13.0, 1.5, 3.6, 2.6, 0.3], [9.3, -2.1, 5.6, 4.6, -0.22],
  ];
  for (const [x, z, w, d, rot] of shadows) {
    const m = new THREE.Mesh(own(new THREE.PlaneGeometry(w, d)), shadowMat);
    m.rotation.set(-PI / 2, 0, rot);
    m.position.set(x, 0.012, z);
    m.layers.set(NO_OUTLINE_LAYER);
    m.renderOrder = 1;
    root.add(m);
  }

  // ---- flush batches -----------------------------------------------------------------------
  for (const [mat, list] of batches) {
    const g = own(mergeGeometries(list, false));
    list.forEach(x => x.dispose());
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (bookBatch.length) {
    const g = own(mergeGeometries(bookBatch, false));
    bookBatch.forEach(x => x.dispose());
    const mesh = new THREE.Mesh(g, M.books);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  return {
    slots,
    ready: Promise.all(loads),
    update(t, dt) { for (const f of animated) f(t, dt); },
    dispose() { owned.forEach(o => o.dispose?.()); },
  };
}
