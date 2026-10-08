// Stylised front-strike portable typewriter, built for cel shading.
// Original design (not a replica of any model). Mechanically it follows the
// front-strike layout described in the Underwood manual: a fan of typebars
// on a segment in front of the platen swings up so that every bar arrives at
// one fixed printing point; the carriage (platen, paper, bail, table) slides
// left one letter space per character and right on carriage return.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {toon, NO_OUTLINE_LAYER} from './toon.js';
import {PLATEN, STRIKE, BASKET, PAPER_R, BAIL_ANGLE, PaperPath, S_BACK} from './geometry.js';

const PI = Math.PI;
const Y = new THREE.Vector3(0, 1, 0);

// Keyboard layout: [lower, upper] pairs. Each printable key owns one typebar.
const ROWS = [
  {z: 1.98, y: 2.04, x0: -2.60, keys: ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_']},
  {z: 2.64, y: 1.78, x0: -2.38, keys: ['qQ', 'wW', 'eE', 'rR', 'tT', 'yY', 'uU', 'iI', 'oO', 'pP', '/?']},
  {z: 3.30, y: 1.52, x0: -2.14, keys: ['aA', 'sS', 'dD', 'fF', 'gG', 'hH', 'jJ', 'kK', 'lL', ';:', "'\""]},
  {z: 3.96, y: 1.26, x0: -1.90, keys: ['zZ', 'xX', 'cC', 'vV', 'bB', 'nN', 'mM', ',<', '.>']},
];
const KEY_STEP = 0.48;
const CAP_R = 0.2;

export const PALETTE = {
  body: 0x8fcdb7,
  bodyShade: 0x5f9c88,
  cream: 0xf6ecd3,
  chrome: 0xd9e3e6,
  steel: 0xa7b3b8,
  rubber: 0x3a3436,
  well: 0x2f3b38,
  felt: 0x9b4a3e,
  brass: 0xe7b65a,
  legend: '#3a2c24',
};

export async function createTypewriter() {
  const root = new THREE.Group();
  root.name = 'INK typewriter';
  const carriage = new THREE.Group();
  carriage.name = 'Carriage (slides in x)';
  root.add(carriage);
  const platen = new THREE.Group();
  platen.name = 'Platen (rotates about x)';
  platen.position.set(0, PLATEN.y, PLATEN.z);
  carriage.add(platen);
  const basket = new THREE.Group();
  basket.name = 'Typebasket (segment shift)';
  root.add(basket);

  const geometries = new Set();
  const textures = new Set();
  const own = g => { geometries.add(g); return g; };

  const M = {
    body: toon(PALETTE.body, {spec: 0.55, shine: 70, rim: 0.22}),
    bodyShade: toon(PALETTE.bodyShade, {spec: 0.2, shine: 30}),
    cream: toon(PALETTE.cream, {spec: 0.45, shine: 55, rim: 0.12}),
    chrome: toon(PALETTE.chrome, {spec: 1.0, shine: 28, rim: 0.35, rimColor: 0xffffff}),
    steel: toon(PALETTE.steel, {spec: 0.8, shine: 26, rim: 0.2}),
    rubber: toon(PALETTE.rubber, {spec: 0.18, shine: 18, rim: 0.12}),
    well: toon(PALETTE.well, {spec: 0.05}),
    felt: toon(PALETTE.felt, {spec: 0}),
    brass: toon(PALETTE.brass, {spec: 0.9, shine: 30, rim: 0.25}),
    clear: toon(0xe4f4ff, {transparent: true, opacity: 0.28, spec: 1.0, shine: 70, rim: 0.4, rimColor: 0xffffff}),
    mark: toon(0xd8483a),
  };
  M.clear.depthWrite = false;

  // ---- static geometry batching --------------------------------------------
  const batches = new Map();
  const tmp = new THREE.Object3D();
  function add(geo, material, parent = root, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    tmp.position.set(...pos); tmp.rotation.set(...rot); tmp.scale.set(...scale); tmp.updateMatrix();
    addMatrix(geo, material, parent, tmp.matrix);
  }
  function addMatrix(geo, material, parent, matrix) {
    let byMat = batches.get(parent);
    if (!byMat) batches.set(parent, byMat = new Map());
    if (!byMat.has(material)) byMat.set(material, []);
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    byMat.get(material).push(g);
  }
  const vA = new THREE.Vector3(), vB = new THREE.Vector3();
  const unitRod = own(new THREE.CylinderGeometry(1, 1, 1, 10));
  function rod(a, b, radius, material, parent = root) {
    vA.set(...a); vB.set(...b);
    const d = vB.clone().sub(vA); const len = d.length();
    tmp.position.copy(vA).addScaledVector(d, 0.5);
    tmp.quaternion.setFromUnitVectors(Y, d.normalize());
    tmp.scale.set(radius, len, radius); tmp.updateMatrix();
    addMatrix(unitRod, material, parent, tmp.matrix);
    tmp.rotation.set(0, 0, 0);
  }
  function flush() {
    for (const [parent, byMat] of batches) {
      for (const [material, list] of byMat) {
        const merged = own(mergeGeometries(list, false));
        list.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = mesh.receiveShadow = true;
        parent.add(mesh);
      }
    }
    batches.clear();
  }
  function mesh(geo, material, parent = root, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(own(geo), material);
    m.position.set(...pos); m.rotation.set(...rot);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const rbox = (w, h, d, r = 0.06, s = 3) => own(new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
  const cyl = (r1, r2, h, n = 32) => own(new THREE.CylinderGeometry(r1, r2, h, n));

  // ---- body -----------------------------------------------------------------
  const BODY_W = 6.8;
  // Cream lower base with rubber feet.
  add(rbox(BODY_W, 0.46, 7.3, 0.2), M.cream, root, [0, 0.37, 1.05]);
  for (const x of [-2.9, 2.9]) for (const z of [-2.2, 4.25]) add(cyl(0.3, 0.34, 0.16, 24), M.rubber, root, [x, 0.08, z]);

  // Side cheeks: one sculpted profile, extruded across their thickness.
  // Shape space: u = -z (so extruding along +z after a +90° Y turn maps to +x).
  const profile = new THREE.Shape();
  const P = (z, y) => [-z, y];
  profile.moveTo(...P(4.62, 0.55));
  profile.lineTo(...P(4.62, 1.02));
  profile.bezierCurveTo(...P(4.55, 1.22), ...P(4.3, 1.2), ...P(3.8, 1.38));
  profile.lineTo(...P(1.9, 2.12));
  profile.bezierCurveTo(...P(1.2, 2.42), ...P(0.9, 2.6), ...P(0.2, 2.62));
  profile.lineTo(...P(-2.25, 2.62));
  profile.bezierCurveTo(...P(-2.62, 2.62), ...P(-2.66, 2.4), ...P(-2.66, 2.1));
  profile.lineTo(...P(-2.66, 0.55));
  profile.closePath();
  const cheekT = 0.26;
  const cheek = own(new THREE.ExtrudeGeometry(profile, {depth: cheekT, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 4, curveSegments: 20}));
  for (const side of [-1, 1]) {
    const x = side * (BODY_W / 2 - 0.22) - cheekT / 2;
    add(cheek, M.body, root, [x, 0, 0], [0, PI / 2, 0]);
  }
  // Front apron and a cream accent band.
  add(rbox(BODY_W - 0.3, 0.5, 0.36, 0.14), M.body, root, [0, 0.8, 4.48]);
  add(rbox(BODY_W - 0.7, 0.07, 0.05, 0.03), M.chrome, root, [0, 0.72, 4.67]);
  // Keyboard well: dark sloped floor under the keys.
  {
    const len = Math.hypot(4.4 - 1.2, 1.55 - 0.82);
    const ang = Math.atan2(1.55 - 0.82, 4.4 - 1.2);
    add(rbox(BODY_W - 0.6, 0.08, len, 0.03), M.well, root, [0, (1.55 + 0.82) / 2 - 0.05, (4.4 + 1.2) / 2], [ang, 0, 0]);
  }
  // Basket floor beneath the fan.
  add(rbox(BODY_W - 0.6, 0.1, 3.4, 0.04), M.well, root, [0, 1.36, -0.15]);
  // Back housing under the carriage rails.
  add(rbox(BODY_W - 0.2, 1.9, 1.15, 0.22), M.body, root, [0, 1.6, -2.02]);

  // Top deck: U-shaped plate around the basket opening (plan-view shape,
  // shape y = -world z; rotated so the extrusion rises along +y).
  {
    const s = new THREE.Shape();
    const hw = BODY_W / 2 - 0.12, front = 1.05, back = -2.5, open = 2.1;
    const openBack = -0.62;   // straight sides end here, then an elliptical back
    s.moveTo(-hw, -back);
    s.lineTo(-hw, -front);
    s.lineTo(-open, -front);
    s.lineTo(-open, -openBack);
    s.absellipse(0, -openBack, open, 0.62, PI, 0, true);
    s.lineTo(open, -front);
    s.lineTo(hw, -front);
    s.lineTo(hw, -back);
    s.closePath();
    const deck = own(new THREE.ExtrudeGeometry(s, {depth: 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 36}));
    add(deck, M.body, root, [0, 2.36, 0], [-PI / 2, 0, 0]);
  }
  // Fixed rails for the carriage at the back.
  rod([-3.25, 2.7, -2.25], [3.25, 2.7, -2.25], 0.07, M.chrome);
  rod([-3.25, 2.7, -1.82], [3.25, 2.7, -1.82], 0.05, M.chrome);

  // Maker's badge on the apron.
  const badgeTex = canvasTexture(512, 128, (c, w, h) => {
    c.fillStyle = '#e7b65a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7a4f1f'; c.fillRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#f6e3b0';
    c.font = 'bold 74px "Courier Prime", "Courier New", monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('I N K', w / 2, h / 2 + 4);
  });
  const badgeMat = toon(0xffffff, {map: badgeTex, spec: 0.6, shine: 30});
  mesh(new THREE.PlaneGeometry(1.2, 0.3), badgeMat, root, [0, 0.82, 4.665]);

  // ---- typebasket -------------------------------------------------------------
  const keySpecs = [];
  ROWS.forEach((row, ri) => row.keys.forEach((pair, i) => {
    keySpecs.push({lower: pair[0], upper: pair[1], name: pair[0], x: row.x0 + i * KEY_STEP, y: row.y, z: row.z, row: ri});
  }));
  // Assign bars left→right following key positions so linkages read naturally.
  const order = [...keySpecs].sort((a, b) => (a.x + a.row * 0.14) - (b.x + b.row * 0.14));
  const barCount = order.length;
  const strikeV = new THREE.Vector3(STRIKE.x, STRIKE.y, STRIKE.z);
  const paperNormal = new THREE.Vector3(0, Math.sin(7 * PI / 180), Math.cos(7 * PI / 180));
  const bars = [];
  const barGeo = rbox(0.032, 1, 0.075, 0.012, 1);
  const slugGeo = rbox(0.09, 0.07, 0.15, 0.02, 2);
  const barByChar = new Map();
  order.forEach((spec, i) => {
    const a = -BASKET.span + (2 * BASKET.span) * i / (barCount - 1);
    const u = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const pivot = new THREE.Vector3(STRIKE.x, BASKET.pivotY, STRIKE.z).addScaledVector(u, BASKET.pivotRadius);
    // The slug's centre must sit so that its face (0.035 in front of the
    // centre) presses the ribbon onto the paper exactly at the printing line.
    const contact = strikeV.clone().addScaledVector(paperNormal, 0.035 + 0.012);
    const toStrike = contact.clone().sub(pivot);
    const length = toStrike.length();
    const restAngle = -0.16;   // radians below horizontal, outward
    const strikeAngle = Math.atan2(toStrike.y, toStrike.dot(u));
    const axis = new THREE.Vector3().crossVectors(u, Y).normalize();
    // Rest frame: local +Y along the bar (outward/down), local +X along axis.
    const dirRest = u.clone().multiplyScalar(Math.cos(restAngle)).addScaledVector(Y, Math.sin(restAngle)).normalize();
    const zAxis = new THREE.Vector3().crossVectors(axis, dirRest).normalize();
    const restQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis, dirRest, zAxis));
    // Rotating about axis (= u × Y) by +swing lifts the outward rest
    // direction up and over the pivot towards the printing point.
    const swing = strikeAngle - restAngle;
    const pivotGroup = new THREE.Group();
    pivotGroup.position.copy(pivot);
    pivotGroup.quaternion.copy(restQ);
    pivotGroup.name = `Typebar ${spec.lower}${spec.upper}`;
    basket.add(pivotGroup);
    const arm = new THREE.Mesh(barGeo, M.steel);
    arm.scale.y = length - 0.05;
    arm.position.y = (length - 0.05) / 2;
    arm.castShadow = arm.receiveShadow = true;
    pivotGroup.add(arm);
    // Slug, bent so its face lies flat on the platen at the moment of impact.
    const strikeQ = new THREE.Quaternion().setFromAxisAngle(axis, swing).multiply(restQ);
    const faceWorld = paperNormal.clone().negate();
    const faceLocal = faceWorld.applyQuaternion(strikeQ.clone().invert());
    const slug = new THREE.Mesh(slugGeo, M.chrome);
    slug.quaternion.setFromUnitVectors(Y, faceLocal);
    slug.position.y = length;
    slug.castShadow = true;
    pivotGroup.add(slug);
    const bar = {index: i, key: spec.name, group: pivotGroup, restQ, axis: axis.clone(), swing, t0: -10, k: 1, amount: 0, strikeQ};
    bars.push(bar);
    barByChar.set(spec.lower, {bar: i, shift: false});
    barByChar.set(spec.upper, {bar: i, shift: true});
    // Pivot bolt on the segment and a sublever linking down to the key.
    add(cyl(0.035, 0.035, 0.07, 8), M.chrome, basket, [pivot.x, pivot.y, pivot.z], [0, 0, PI / 2]);
    spec.pivot = pivot;
  });
  // Segment (pivot arc), its slotted comb and the felt typebar rest.
  {
    const arc = (radius, y, tube, mat, parent, span = BASKET.span + 0.08) => {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = -span + 2 * span * i / 48;
        pts.push(new THREE.Vector3(Math.sin(a) * radius, y, STRIKE.z + Math.cos(a) * radius));
      }
      add(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, tube, 8, false)), mat, parent);
    };
    arc(BASKET.pivotRadius + 0.02, BASKET.pivotY - 0.03, 0.07, M.chrome, basket);
    arc(BASKET.pivotRadius - 0.1, BASKET.pivotY - 0.08, 0.05, M.steel, basket);
    const restR = BASKET.pivotRadius + BASKET.barLength * Math.cos(0.16) - 0.12;
    const restY = BASKET.pivotY - BASKET.barLength * Math.sin(0.16) - 0.09;
    arc(restR, restY, 0.06, M.felt, root, BASKET.span + 0.1);
  }

  // ---- printing point: type guide, card holder, ribbon vibrator -------------
  // A small bridge in front of the platen carries the type guide (the U the
  // slug enters) and the card holder fingers; its feet sit on the deck.
  const guideZ = STRIKE.z + 0.075;
  // Everything here sits below the printing line, so the line being typed is
  // never covered. These parts live in their own group: the "clear view"
  // switch hides them (with the ribbon and the bail) for an unobstructed page.
  const frontParts = new THREE.Group();
  frontParts.name = 'Type guide and card holder';
  root.add(frontParts);
  add(rbox(0.34, 0.04, 0.05, 0.018), M.chrome, frontParts, [0, STRIKE.y - 0.2, guideZ]);
  for (const x of [-0.15, 0.15]) add(rbox(0.04, 0.08, 0.05, 0.015), M.chrome, frontParts, [x, STRIKE.y - 0.15, guideZ]);
  for (const side of [-1, 1]) {
    const x = side * 0.62;
    // Clear plastic card-holder finger below the line, red mark at its tip.
    add(rbox(0.09, 0.18, 0.02, 0.01), M.clear, frontParts, [x, STRIKE.y - 0.2, STRIKE.z + 0.045], [0.1, 0, 0]);
    add(rbox(0.012, 0.05, 0.022, 0.004), M.mark, frontParts, [x, STRIKE.y - 0.13, STRIKE.z + 0.047], [0.1, 0, 0]);
    // Bridge arm from below the finger down to the deck shoulder.
    const pts = [[x, STRIKE.y - 0.29, STRIKE.z + 0.06], [side * 1.25, STRIKE.y - 0.4, STRIKE.z + 0.2], [side * 2.05, 2.62, STRIKE.z + 0.35]].map(p => new THREE.Vector3(...p));
    add(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.035, 8, false)), M.chrome, frontParts);
  }
  add(rbox(1.26, 0.045, 0.04, 0.015), M.chrome, frontParts, [0, STRIKE.y - 0.29, STRIKE.z + 0.065]);
  const vibrator = new THREE.Group();
  vibrator.name = 'Ribbon vibrator';
  root.add(vibrator);
  add(rbox(0.52, 0.035, 0.025, 0.01), M.chrome, vibrator, [0, -0.085, guideZ - 0.025]);
  for (const x of [-0.24, 0.24]) add(rbox(0.035, 0.22, 0.025, 0.01), M.chrome, vibrator, [x, 0.02, guideZ - 0.025]);
  const RIBBON_REST = -0.33;   // ribbon sits well below the printing line at rest

  // ---- ribbon spools and the ribbon itself -----------------------------------
  const spools = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 2.62, 2.62, -0.35);
    root.add(g);
    spools.push(g);
    add(cyl(0.52, 0.52, 0.05, 40), M.chrome, root, [g.position.x, 2.6, g.position.z]);
    const reel = new THREE.Group();
    g.add(reel);
    add(cyl(0.44, 0.44, 0.17, 40), M.rubber, reel, [0, 0.11, 0]);
    // Cover cap with three holes suggested by darker discs.
    add(cyl(0.48, 0.5, 0.06, 40), M.chrome, reel, [0, 0.23, 0]);
    for (let i = 0; i < 3; i++) {
      const a = i * 2 * PI / 3;
      add(cyl(0.1, 0.1, 0.02, 20), M.rubber, reel, [Math.sin(a) * 0.26, 0.26, Math.cos(a) * 0.26]);
    }
    add(cyl(0.1, 0.1, 0.12, 20), M.brass, reel, [0, 0.29, 0]);
    g.userData.reel = reel;
  }
  const ribbonTex = canvasTexture(8, 64, (c, w, h) => {
    c.fillStyle = '#2b2627'; c.fillRect(0, 0, w, h / 2);
    c.fillStyle = '#c4473b'; c.fillRect(0, h / 2, w, h / 2);
  });
  ribbonTex.magFilter = THREE.NearestFilter;
  const ribbonMat = toon(0xffffff, {map: ribbonTex, side: THREE.DoubleSide, spec: 0.1});
  const RIBBON_N = 26;
  const ribbonGeo = own(new THREE.PlaneGeometry(1, 1, RIBBON_N - 1, 1));
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.castShadow = true;
  ribbon.frustumCulled = false;
  root.add(ribbon);
  const ribbonPts = Array.from({length: RIBBON_N}, () => new THREE.Vector3());
  function layoutRibbon(lift) {
    const yc = STRIKE.y + RIBBON_REST + lift * (-RIBBON_REST + 0.01);
    const zc = STRIKE.z + 0.038;
    // Control path: left spool → guide post → vibrator span → guide → right spool.
    const ctrl = [
      [-2.62 + 0.42, 2.78, -0.25],
      [-1.3, 2.86, -0.62],
      [-0.55, yc - 0.02, zc + 0.02],
      [-0.2, yc, zc],
      [0.2, yc, zc],
      [0.55, yc - 0.02, zc + 0.02],
      [1.3, 2.86, -0.62],
      [2.62 - 0.42, 2.78, -0.25],
    ].map(p => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const pos = ribbonGeo.attributes.position;
    const half = 0.065;
    for (let i = 0; i < RIBBON_N; i++) {
      const p = curve.getPoint(i / (RIBBON_N - 1), ribbonPts[i]);
      // Top row (index i) and bottom row (index i + N) of the plane.
      pos.setXYZ(i, p.x, p.y + half, p.z);
      pos.setXYZ(i + RIBBON_N, p.x, p.y - half, p.z);
    }
    pos.needsUpdate = true;
    ribbonGeo.computeVertexNormals();
  }
  layoutRibbon(0);

  // ---- keys ---------------------------------------------------------------------
  const legendTex = makeLegendAtlas(keySpecs);
  textures.add(legendTex.texture);
  const legendMat = toon(0xffffff, {map: legendTex.texture, spec: 0.45, shine: 50});
  const capGeo = own(new THREE.CylinderGeometry(CAP_R, CAP_R * 0.96, 0.09, 36));
  const rimGeo = own(new THREE.TorusGeometry(CAP_R + 0.005, 0.028, 8, 36));
  const stemGeo = own(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8));
  const keyMeshes = [];
  const keys = [];
  const keyByName = new Map();
  function legendGeometry(slot, radius = CAP_R - 0.012) {
    const g = new THREE.CircleGeometry(radius, 36);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (slot.u + uv.getX(i) * slot.size), (slot.v + uv.getY(i) * slot.size));
    }
    g.rotateX(-PI / 2);
    return own(g);
  }
  function addKey(name, x, y, z, scale = 1, legend = name) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.x = 0.14;
    g.scale.setScalar(scale);
    g.name = `Key ${name}`;
    root.add(g);
    const cap = new THREE.Mesh(capGeo, M.cream); cap.castShadow = cap.receiveShadow = true; g.add(cap);
    const ring = new THREE.Mesh(rimGeo, M.chrome); ring.rotation.x = PI / 2; ring.position.y = 0.005; ring.castShadow = true; g.add(ring);
    const slot = legendTex.slots.get(legend);
    const top = new THREE.Mesh(slot ? legendGeometry(slot) : own(new THREE.CircleGeometry(CAP_R - 0.012, 36).rotateX(-PI / 2)), slot ? legendMat : M.cream);
    top.position.y = 0.0455;
    g.add(top);
    const stem = new THREE.Mesh(stemGeo, M.chrome); stem.position.y = -0.33; g.add(stem);
    cap.userData.key = name; top.userData.key = name; ring.userData.key = name;
    keyMeshes.push(cap, top);
    const state = {name, group: g, baseY: y, t0: -10, amount: 0};
    keys.push(state);
    if (!keyByName.has(name)) keyByName.set(name, []);
    keyByName.get(name).push(state);
    return state;
  }
  for (const spec of keySpecs) {
    addKey(spec.name, spec.x, spec.y, spec.z, 1, spec.name);
    // Key lever and sublever: from the stem foot back to the bar heel.
    const foot = [spec.x, spec.y - 0.62, spec.z - 0.05];
    const heel = [spec.pivot.x * 1.05, BASKET.pivotY - 0.42, spec.pivot.z + 0.2];
    rod(foot, [spec.x * 0.92, 1.12, Math.min(spec.z - 0.6, 1.6)], 0.018, M.steel);
    rod([spec.x * 0.92, 1.12, Math.min(spec.z - 0.6, 1.6)], heel, 0.016, M.steel);
  }
  addKey('BACKSPACE', 2.7, 2.04, 1.98, 0.9, '⌫');
  addKey('SHIFT', -2.52, 1.26, 3.96, 1.12, '⇧');
  addKey('SHIFT', 2.46, 1.26, 3.96, 1.12, '⇧');
  // Space bar on two arms.
  const space = new THREE.Group();
  space.position.set(0, 1.0, 4.62);
  space.name = 'Space bar';
  root.add(space);
  const spaceBar = mesh(rbox(3.7, 0.11, 0.26, 0.05), M.cream, space);
  spaceBar.userData.key = 'SPACE';
  keyMeshes.push(spaceBar);
  for (const x of [-1.5, 1.5]) {
    const arm = mesh(cyl(0.035, 0.035, 0.5, 8), M.chrome, space, [x, -0.18, -0.2], [0.7, 0, 0]);
    arm.castShadow = true;
  }
  const spaceState = {name: 'SPACE', group: space, baseY: 1.0, t0: -10, amount: 0};
  keys.push(spaceState);
  keyByName.set('SPACE', [spaceState]);

  // ---- carriage -----------------------------------------------------------------
  // Platen rubber, axle and knobs (all rotate together).
  add(cyl(PLATEN.r, PLATEN.r, PLATEN.length, 56), M.rubber, platen, [0, 0, 0], [0, 0, PI / 2]);
  add(cyl(0.07, 0.07, PLATEN.length + 1.6, 12), M.chrome, platen, [0, 0, 0], [0, 0, PI / 2]);
  const knobProfile = [
    [0, -0.24], [0.36, -0.24], [0.46, -0.2], [0.5, -0.12], [0.5, 0.12], [0.46, 0.2], [0.36, 0.24], [0.1, 0.26], [0, 0.26],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const knobGeo = own(new THREE.LatheGeometry(knobProfile, 40));
  for (const side of [-1, 1]) {
    const x = side * (PLATEN.length / 2 + 0.62);
    add(knobGeo, M.cream, platen, [x, 0, 0], [0, 0, PI / 2]);
    // Grip ridges.
    for (let i = 0; i < 18; i++) {
      const a = i * 2 * PI / 18;
      add(rbox(0.36, 0.06, 0.06, 0.02, 1), M.cream, platen, [x, Math.sin(a) * 0.5, Math.cos(a) * 0.5], [a, 0, 0]);
    }
    add(cyl(0.16, 0.16, 0.04, 24), M.chrome, platen, [x + side * 0.27, 0, 0], [0, 0, PI / 2]);
    // Carriage end plates holding the axle.
    const endShape = new THREE.Shape();
    endShape.moveTo(-0.85, 0); endShape.lineTo(0.75, 0); endShape.lineTo(0.75, 0.25);
    endShape.quadraticCurveTo(0.7, 0.9, 0.05, 1.0);
    endShape.quadraticCurveTo(-0.65, 0.95, -0.85, 0.35);
    endShape.closePath();
    const plate = own(new THREE.ExtrudeGeometry(endShape, {depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16}));
    // Shape (x, y) → world (-z, y) after a +90° turn about y.
    add(plate, M.body, carriage, [side * (PLATEN.length / 2 + 0.12) - 0.07, 2.62, PLATEN.z - 0.05], [0, PI / 2, 0]);
  }
  // Carriage back rail riding on the fixed rails.
  add(rbox(PLATEN.length + 0.6, 0.22, 0.42, 0.08), M.body, carriage, [0, 2.86, -2.06]);
  add(rbox(PLATEN.length + 0.4, 0.06, 0.08, 0.025), M.chrome, carriage, [0, 3.0, -1.86]);
  // Margin stops on the rail.
  for (const x of [-2.4, 2.7]) add(rbox(0.12, 0.16, 0.14, 0.03), M.brass, carriage, [x, 3.05, -1.9]);

  // Paper table: follows the back paper path, just behind the sheet.
  {
    const path = new PaperPath(0.9);
    const pts = [];
    const tmpS = [0, 0, 0, 0];
    for (let s = S_BACK - 0.05; s > S_BACK - 2.9; s -= 0.15) {
      path.sample(s, tmpS);
      pts.push([tmpS[0] + tmpS[2] * 0.06, tmpS[1] + tmpS[3] * 0.06]);
    }
    const W = 5.4;
    // A curved thin plate built as a strip of quads.
    const n = pts.length;
    const positions = [], idx = [];
    for (let i = 0; i < n; i++) {
      const [y, z] = pts[i];
      positions.push(-W / 2, y, z, W / 2, y, z);
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const plateGeo = new THREE.BufferGeometry();
    plateGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    plateGeo.setIndex(idx);
    plateGeo.computeVertexNormals();
    const plateMat = toon(PALETTE.body, {spec: 0.3, side: THREE.DoubleSide});
    M.table = plateMat;
    const table = new THREE.Mesh(own(plateGeo), plateMat);
    table.castShadow = table.receiveShadow = true;
    carriage.add(table);
    const [ty, tz] = pts[n - 1];
    rod([-W / 2, ty, tz], [W / 2, ty, tz], 0.05, M.chrome, carriage);
    // Two small folding paper-support ears.
    for (const x of [-1.9, 1.9]) {
      rod([x, ty, tz], [x, ty + 0.75, tz - 0.55], 0.03, M.chrome, carriage);
      rod([x, ty + 0.75, tz - 0.55], [x * 0.82, ty + 0.75, tz - 0.55], 0.03, M.chrome, carriage);
    }
  }

  // Paper bail with rollers and a scale, pressing the sheet above the print line.
  const bailParts = new THREE.Group();
  bailParts.name = 'Paper bail';
  carriage.add(bailParts);
  {
    const br = PAPER_R + 0.045;
    const by = PLATEN.y + br * Math.sin(BAIL_ANGLE);
    const bz = PLATEN.z + br * Math.cos(BAIL_ANGLE);
    rod([-PLATEN.length / 2 + 0.1, by, bz], [PLATEN.length / 2 - 0.1, by, bz], 0.032, M.chrome, bailParts);
    for (const x of [-2.2, 2.2]) add(cyl(0.05, 0.05, 0.18, 16), M.rubber, bailParts, [x, by, bz], [0, 0, PI / 2]);
    for (const side of [-1, 1]) {
      const x = side * (PLATEN.length / 2 - 0.05);
      rod([x, by, bz], [x, PLATEN.y + 0.1, PLATEN.z - 0.05], 0.04, M.chrome, bailParts);
    }
    // Paper scale strip behind the print line, on the carriage front.
    // Clear plastic scale: only the ticks are opaque, the text shows through.
    const scaleTex = canvasTexture(1024, 32, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(225,240,250,0.22)'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#5b4636';
      for (let i = 0; i <= 80; i++) {
        const x = 12 + i * (w - 24) / 80;
        const len = i % 10 === 0 ? h * 0.8 : i % 5 === 0 ? h * 0.5 : h * 0.3;
        c.fillRect(x - 1, 0, 2, len);
      }
    });
    const scaleMat = toon(0xffffff, {map: scaleTex, spec: 0.8, shine: 70, transparent: true});
    scaleMat.depthWrite = false;
    const scale = mesh(new THREE.PlaneGeometry(PLATEN.length - 0.8, 0.07), scaleMat, bailParts, [0, by + 0.012, bz + 0.036], [-(BAIL_ANGLE) + 0.35, 0, 0]);
    scale.castShadow = false;
    scale.layers.set(NO_OUTLINE_LAYER);
  }

  // Carriage return lever on the left end plate.
  const returnLever = new THREE.Group();
  returnLever.name = 'Carriage return lever';
  returnLever.position.set(-PLATEN.length / 2 - 0.1, PLATEN.y + 0.62, PLATEN.z + 0.1);
  carriage.add(returnLever);
  add(cyl(0.11, 0.11, 0.12, 20), M.chrome, returnLever, [0, 0, 0], [0, 0, PI / 2]);
  rod([0, 0, 0], [-0.32, 0.12, 0.55], 0.045, M.chrome, returnLever);
  rod([-0.32, 0.12, 0.55], [-0.5, 0.16, 1.3], 0.045, M.chrome, returnLever);
  const paddle = mesh(rbox(0.46, 0.08, 0.3, 0.035), M.cream, returnLever, [-0.54, 0.17, 1.42], [-0.1, 0.25, 0.1]);
  paddle.userData.key = 'RETURN';
  keyMeshes.push(paddle);
  // Line-space ratchet wheel inside the left knob (visible teeth).
  for (let i = 0; i < 24; i++) {
    const a = i * 2 * PI / 24;
    add(rbox(0.06, 0.07, 0.07, 0.015, 1), M.steel, platen, [-PLATEN.length / 2 - 0.08, Math.sin(a) * 0.36, Math.cos(a) * 0.36], [a, 0, 0]);
  }

  flush();
  // Clear plastic is drawn without ink outlines.
  for (const m of frontParts.children) if (m.material === M.clear) m.layers.set(NO_OUTLINE_LAYER);

  // ---- animation ---------------------------------------------------------------
  let spoolAngle = 0;
  let ribbonLift = 0;
  let shiftAmount = 0, shiftUntil = -10;
  let lastStrike = -10, lastStrikeK = 1;
  const axisQ = new THREE.Quaternion();

  function barFor(ch) {
    const hit = barByChar.get(ch);
    if (hit) return hit;
    if (ch === ' ' || !ch) return null;
    // Outside the physical type: digital extension. Pick a stable bar.
    const code = ch.codePointAt(0);
    const lowerHit = barByChar.get(ch.toLowerCase());
    if (lowerHit) return {bar: lowerHit.bar, shift: ch !== ch.toLowerCase()};
    return {bar: code % bars.length, shift: false, digital: true};
  }
  /** Starts a strike. k scales all timings (1 = deliberate, 0.4 = rapid). Returns contact delay. */
  function strike(barIndex, now, k = 1, shift = false) {
    const bar = bars[barIndex];
    if (!bar) return 0;
    bar.t0 = now; bar.k = k;
    lastStrike = now; lastStrikeK = k;
    spoolAngle += 0.045;
    if (shift) shiftUntil = now + 0.16 * k + 0.05;
    const key = keyByName.get(bar.key);
    if (key) for (const s of key) s.t0 = Math.max(s.t0, now - 0.012);
    if (shift) for (const s of keyByName.get('SHIFT') || []) s.t0 = now;
    return 0.05 * k;
  }
  function pressKey(name, now) {
    const list = keyByName.get(name);
    if (!list) return false;
    for (const s of list) s.t0 = now;
    return true;
  }
  function update(t, dt, {carriageX = 0, platenAngle = 0, returnPull = 0} = {}) {
    carriage.position.x = carriageX;
    platen.rotation.x = platenAngle;
    returnLever.rotation.y = -returnPull * 0.5;
    returnLever.rotation.x = returnPull * 0.12;
    // Keys: quick press, springy release.
    for (const s of keys) {
      const age = t - s.t0;
      let a = 0;
      if (age >= 0 && age < 0.05) a = Math.sin(age / 0.05 * PI / 2);
      else if (age >= 0.05 && age < 0.075) a = 1;
      else if (age >= 0.075 && age < 0.2) { const r = (age - 0.075) / 0.125; a = (1 - r) * (1 - r) - Math.sin(r * PI) * 0.12; }
      s.amount = a;
      s.group.position.y = s.baseY - a * 0.13;
    }
    // Typebars: thrown up (ease-in) to contact, a brief dwell, spring back.
    for (const bar of bars) {
      const age = t - bar.t0, k = bar.k;
      const up = 0.05 * k, dwell = 0.012 * k, back = 0.13 * k;
      let a = 0;
      if (age >= 0 && age < up) { const r = age / up; a = r * r * (1.6 - 0.6 * r); }
      else if (age >= up && age < up + dwell) a = 1 - 0.015 * Math.sin((age - up) / dwell * PI);
      else if (age >= up + dwell && age < up + dwell + back) {
        const r = (age - up - dwell) / back;
        a = (1 - r) * (1 - r) * (1 - r * 0.2);
      } else if (age >= up + dwell + back && age < up + dwell + back + 0.06) {
        const r = (age - up - dwell - back) / 0.06;
        a = -0.04 * Math.sin(r * PI);
      }
      if (a !== bar.amount) {
        bar.amount = a;
        axisQ.setFromAxisAngle(bar.axis, bar.swing * a);
        bar.group.quaternion.copy(axisQ).multiply(bar.restQ);
      }
    }
    // Ribbon vibrator rises just ahead of the bar and drops after impact.
    {
      const age = t - lastStrike, k = lastStrikeK;
      let lift = 0;
      if (age >= 0 && age < 0.045 * k) lift = Math.sin(age / (0.045 * k) * PI / 2);
      else if (age >= 0.045 * k && age < 0.075 * k) lift = 1;
      else if (age >= 0.075 * k && age < 0.16 * k) lift = 1 - (age - 0.075 * k) / (0.085 * k);
      if (Math.abs(lift - ribbonLift) > 1e-3 || (lift === 0 && ribbonLift !== 0)) {
        ribbonLift = lift;
        vibrator.position.y = STRIKE.y + RIBBON_REST * (1 - lift) + 0.01 * lift;
        layoutRibbon(lift);
      }
    }
    // Segment shift for capitals.
    const wantShift = t < shiftUntil ? 1 : 0;
    shiftAmount += (wantShift - shiftAmount) * (1 - Math.exp(-dt * 40));
    basket.position.y = -shiftAmount * 0.06;
    // Spools take up ribbon after each stroke.
    spools[0].userData.reel.rotation.y += (spoolAngle - spools[0].userData.reel.rotation.y) * (1 - Math.exp(-dt * 14));
    spools[1].userData.reel.rotation.y += (-spoolAngle * 0.8 - spools[1].userData.reel.rotation.y) * (1 - Math.exp(-dt * 14));
  }
  vibrator.position.y = STRIKE.y + RIBBON_REST;

  function dispose() {
    geometries.forEach(g => g.dispose());
    textures.forEach(t => t.dispose());
    new Set(Object.values(M)).forEach(m => m.dispose());
    badgeMat.dispose(); ribbonMat.dispose(); legendMat.dispose();
    root.removeFromParent();
  }

  function canvasTexture(w, h, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    paint(canvas.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    textures.add(tex);
    return tex;
  }

  /** Hide everything that can sit in front of the page (clear view). */
  function setClearView(on) {
    frontParts.visible = !on;
    bailParts.visible = !on;
    vibrator.visible = !on;
    ribbon.visible = !on;
  }
  return {
    root, carriage, platen, keyMeshes, bars, materials: M, setClearView,
    barFor, strike, pressKey, update, dispose,
    bounds: {width: BODY_W, front: 4.8, back: -2.7, top: 2.7},
  };
}

function makeLegendAtlas(specs) {
  const labels = [...specs.map(s => s.name), '⌫', '⇧', '⇥'];
  const cols = 8, tile = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cols * tile; canvas.height = cols * tile;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f6ecd3';
  c.fillRect(0, 0, canvas.width, canvas.height);
  const upperOf = new Map(specs.map(s => [s.name, s.upper]));
  const slots = new Map();
  labels.forEach((label, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    c.save();
    c.translate(col * tile + tile / 2, row * tile + tile / 2);
    c.fillStyle = PALETTE.legend;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const upper = upperOf.get(label);
    if (/[a-z]/.test(label)) {
      c.font = 'bold 70px "Courier Prime", "Courier New", monospace';
      c.fillText(label.toUpperCase(), 0, 6);
    } else if (upper && upper !== label) {
      c.font = 'bold 44px "Courier Prime", "Courier New", monospace';
      c.fillText(upper, 0, -24);
      c.fillText(label, 0, 26);
    } else {
      c.font = 'bold 60px "Courier Prime", "Apple Symbols", "Segoe UI Symbol", sans-serif';
      c.fillText(label, 0, 6);
    }
    c.restore();
    // CircleGeometry uvs span 0..1 over its bounding square; v runs bottom-up.
    slots.set(label, {u: col / cols, v: 1 - (row + 1) / cols, size: 1 / cols});
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {texture, slots};
}
