// The view from the window: a Japanese town in spring, painted like an anime
// background. A sky dome with cel-shaded cumulus; Mt. Fuji behind a
// five-storey pagoda; a hazy city with a lattice tower; rows of tiled roofs
// with an elevated railway and a passing train; the houses across the lane
// with balconies, laundry and a coffee shop sign; utility poles with sagging
// wires; and cherry trees whose blossom clusters are painted cards that always
// face the camera, with petals drifting in through the open sash.
//
// The painted layers are bands of cylinders centred just outside the window
// (see paint.js), so they keep their parallax while the camera moves.
import * as THREE from 'three';
import {toon, NO_OUTLINE_LAYER} from './toon.js';
import {DEG, rng, HAZE, paintBand, paintMountains, paintCity, paintTown, paintStreet, paintGround, paintClouds,
  paintBlossomAtlas, paintTrain, pagoda, viaduct, chimney, shrine} from './paint.js';

const PI = Math.PI;
export const GROUND = -190;                    // street level: the room is on the 4th floor (floor y = -15)
const WALL_X = -17.7;                          // outer face of our building
const EYE = new THREE.Vector3(-17.7, 11, 0.4); // centre of the panorama
const PHI0 = -96 * DEG, PHI1 = 102 * DEG;      // 0 = straight out, + = to the right (towards -z)
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = hex => new THREE.Color(hex);
/** World position at angle phi (radians), distance r from the eye axis, height y. */
const ring = (phi, r, y) => V(EYE.x - r * Math.cos(phi), y, EYE.z - r * Math.sin(phi));

// The houses across the lane (front at R = 380), left to right as seen from the room.
const STREET_HOUSES = [
  {from: -98, to: -63, floors: 4, roof: 'flat', wall: '#ece6da', balcony: 'all', laundry: true, seed: 11},
  {from: -61, to: -35, floors: 2, roof: 'hip', wall: '#6a5148', roofCol: '#4d5566', siding: true, fascia: '#3e3030', flowers: true, seed: 12},
  {from: -33, to: -8, floors: 2, roof: 'gable', wall: '#f1e6d2', roofCol: '#5b6b86', balcony: 1, futon: true, laundry: true, antenna: true, seed: 13},
  {from: -6, to: 15, floors: 2, roof: 'gable', wall: '#cfdad3', roofCol: '#a65d43', balcony: 1, laundry: true, flowers: true, seed: 14},
  {from: 17, to: 33, floors: 3, roof: 'flat', wall: '#dde2e0', balcony: 'all', laundry: true, cat: true, seed: 15},
  {from: 35, to: 56, floors: 2, roof: 'front', wall: '#a77b58', roofCol: '#3f4f6b', rise: 70, siding: true, sign: '珈琲', flowers: true, seed: 16},
  {from: 60, to: 101, floors: 2, roof: 'hip', wall: '#f0dcc6', roofCol: '#4f7775', balcony: 1, laundry: true, solar: true, antenna: true, cat: true, seed: 17},
];

// Times of day: sky, cloud tones, and how the painted layers are tinted.
const PRESETS = {
  afternoon: {zenith: 0x4b8fdc, horizon: 0xc5ddf0, ground: 0xa9bccc, sun: 0xfff0cc, sunSize: 0.99955, glow: 0.16,
    cloudLit: 0xffffff, cloudMid: 0xe8eef8, cloudShade: 0xb7c6e2, stars: 0,
    tint: [1, 1, 1], haze: HAZE, hazeK: 0, lights: 0, blossom: [1, 1, 1], blossomGlow: [0, 0, 0], lamps: 0.15},
  sunset: {zenith: 0x5a5c9c, horizon: 0xffb48a, ground: 0xc89a8e, sun: 0xffd6a8, sunSize: 0.9992, glow: 0.4,
    cloudLit: 0xffd8b8, cloudMid: 0xf2a69e, cloudShade: 0x9878a8, stars: 0,
    tint: [1.0, 0.8, 0.74], haze: '#f2b08e', hazeK: 1, lights: 0.55, blossom: [1.0, 0.8, 0.78], blossomGlow: [0.02, 0.005, 0.01], lamps: 0.8},
  night: {zenith: 0x0b1330, horizon: 0x283766, ground: 0x1a2140, sun: 0xf3efdc, sunSize: 0.99975, glow: 0.22,
    cloudLit: 0x5d6a9a, cloudMid: 0x3a4677, cloudShade: 0x222b52, stars: 1,
    tint: [0.24, 0.28, 0.46], haze: '#1e2a56', hazeK: 0.8, lights: 1, blossom: [0.36, 0.33, 0.5], blossomGlow: [0.05, 0.022, 0.042], lamps: 1.4},
};

// ---------------------------------------------------------------------------
// A small geometry accumulator for the 3D bits (poles, wires, branches).
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  vert(p, n, color) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(color.r, color.g, color.b); }
  /** Smooth tapered tube through `points`. */
  tube(points, r0, r1, color, radial = 6, perSeg = 5) {
    const curve = new THREE.CatmullRomCurve3(points);
    const N = Math.max(2, (points.length - 1) * perSeg);
    const fr = curve.computeFrenetFrames(N, false);
    const rings = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPointAt(t), rad = r0 + (r1 - r0) * t;
      const ringPts = [];
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * PI * 2;
        const n = fr.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(fr.binormals[i], Math.sin(a));
        ringPts.push([p.clone().addScaledVector(n, rad), n]);
      }
      rings.push(ringPts);
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < radial; j++) {
        const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
        for (const v of [a, b, c, a, c, d]) this.vert(v[0], v[1], color);
      }
    }
  }
  rod(a, b, r, color, radial = 6) { this.tube([a, b], r, r, color, radial, 1); }
  box(center, size, color, rotY = 0) {
    const g = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
    g.rotateY(rotY);
    g.translate(center.x, center.y, center.z);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) this.vert(V(p[i], p[i + 1], p[i + 2]), V(n[i], n[i + 1], n[i + 2]), color);
    g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Band of a cylinder of radius R around the eye axis (inward facing, uv 0..1). */
function bandGeometry(R, phiA, phiB, y0, y1) {
  const segs = Math.max(2, Math.ceil((phiB - phiA) / (1.5 * DEG)));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = ring(phiA + (phiB - phiA) * t, R, 0);
    pos.push(p.x, y0, p.z, p.x, y1, p.z);
    uv.push(t, 0, t, 1);
    if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Flat ring sector at height y, uv.x along the angle, uv.y from r0 (1) to r1 (0). */
function discGeometry(r0, r1, y) {
  const segA = 96, segR = 8, pos = [], uv = [], idx = [];
  for (let j = 0; j <= segR; j++) {
    const rr = r0 + (r1 - r0) * j / segR;
    for (let i = 0; i <= segA; i++) {
      const t = i / segA, p = ring(PHI0 + (PHI1 - PHI0) * t, rr, y);
      pos.push(p.x, p.y, p.z);
      uv.push(t, 1 - j / segR);
    }
  }
  for (let j = 0; j < segR; j++) {
    for (let i = 0; i < segA; i++) {
      const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createStreet(scene, {quality = 'high'} = {}) {
  const root = new THREE.Group();
  root.name = 'Window view';
  scene.add(root);
  const owned = [];
  const own = x => (owned.push(x), x);
  const animated = [];
  const rand = rng(2024);
  const ppd = {high: 30, medium: 22, low: 15}[quality] || 30;

  const texture = (canvas, srgb = true) => {
    const t = own(new THREE.CanvasTexture(canvas));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const black = own(new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1));
  black.needsUpdate = true;

  // ---- painted layers --------------------------------------------------------------------
  const paintU = {tint: {value: new THREE.Vector3(1, 1, 1)}, haze: {value: C(HAZE)}, hazeK: {value: 0}, lightAmt: {value: 0}};
  const paintedMaterial = (map, light, hazeAmt) => own(new THREE.ShaderMaterial({
    uniforms: {map: {value: map}, lightMap: {value: light || black}, hazeAmt: {value: hazeAmt}, ...paintU},
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform sampler2D lightMap; uniform vec3 tint; uniform vec3 haze;
      uniform float hazeAmt; uniform float hazeK; uniform float lightAmt;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.01) discard;
        vec3 col = mix(c.rgb * tint, haze, hazeAmt * hazeK);
        vec4 l = texture2D(lightMap, vUv);
        col += l.rgb * l.a * lightAmt * 1.15;
        gl_FragColor = vec4(col, c.a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  const tiles = (scale = 1) => [[-96, -12, ppd * 0.45 * scale], [-12, 74, ppd * scale], [74, 102, ppd * 0.6 * scale]];
  const base = {phi0: PHI0, phi1: PHI1, eyeY: EYE.y, ground: GROUND, haze: HAZE};
  const LAYERS = [
    {R: 3300, y0: -60, y1: 390, scale: 0.9, lights: 0, haze: 0.5, order: -9, paint: (c, l, v) => paintMountains(c, l, v, {fujiPhi: 48})},
    {R: 2400, y0: -60, y1: 330, scale: 0.8, lights: 0.5, haze: 0.4, order: -8, paint: (c, l, v) => paintCity(c, l, v, {towerPhi: -18})},
    {R: 1300, y0: -200, y1: 120, scale: 1, lights: 0.5, haze: 0.28, order: -7, paint: (c, l, v) => paintTown(c, l, v, {
      seed: 7, rows: [1350, 1520, 1720, 1960, 2250, 2600, 3000, 3500, 4200, 5100, 6400, 8000],
      hazeAt: D => Math.min(0.62, 0.12 + (D - 1300) / 9000),
      landmarks: [pagoda(40, 3300), viaduct(2800), chimney(66, 2050), shrine(-24, 1600)],
    })},
    {R: 650, y0: -200, y1: 130, scale: 1, lights: 1, haze: 0.14, order: -6, paint: (c, l, v) => paintTown(c, l, v, {
      seed: 3, rows: [660, 760, 880, 1020, 1180], hazeAt: D => 0.02 + (D - 650) / 9000,
    })},
    {R: 380, y0: -200, y1: 80, scale: 1, lights: 1, haze: 0.05, order: -5, paint: (c, l, v) => paintStreet(c, l, v, STREET_HOUSES)},
  ];
  for (const L of LAYERS) {
    const band = {...base, R: L.R, y0: L.y0, y1: L.y1, tiles: tiles(L.scale), lights: L.lights};
    for (const tile of paintBand(band, L.paint)) {
      const mat = paintedMaterial(texture(tile.canvas), tile.light ? texture(tile.light) : null, L.haze);
      const mesh = new THREE.Mesh(own(bandGeometry(L.R, tile.phiA, tile.phiB, L.y0, L.y1)), mat);
      mesh.renderOrder = L.order;
      mesh.layers.set(NO_OUTLINE_LAYER);
      root.add(mesh);
    }
  }
  // Ground around the building: only seen when looking steeply down.
  {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 512;
    paintGround(cv.getContext('2d'), cv.width, cv.height, 384);
    const mesh = new THREE.Mesh(own(discGeometry(0, 384, GROUND)), paintedMaterial(texture(cv), null, 0.05));
    mesh.renderOrder = -5.5;
    mesh.layers.set(NO_OUTLINE_LAYER);
    root.add(mesh);
  }

  // ---- the train on the viaduct -----------------------------------------------------------
  const train = (() => {
    const R = 1250, D = 2800, len = 1700 / D;              // four cars, ≈ 80 m
    const yRail = EYE.y + R * (GROUND + 200 - EYE.y) / D, h = R * 76 / D;
    const art = paintTrain();
    const g = own(new THREE.BufferGeometry());
    const segs = 24, pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, phi = t * len;
      pos.push(-R * Math.cos(phi), yRail, -R * Math.sin(phi), -R * Math.cos(phi), yRail + h, -R * Math.sin(phi));
      uv.push(t, 0, t, 1);
      if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, paintedMaterial(texture(art.canvas), texture(art.light), 0.3));
    mesh.position.set(EYE.x, 0, EYE.z);
    mesh.renderOrder = -7.5;                                 // behind the town rows in front of the viaduct
    mesh.layers.set(NO_OUTLINE_LAYER);
    mesh.frustumCulled = false;
    root.add(mesh);
    return {mesh, len};
  })();
  animated.push(t => {
    // A train every 40 s, alternating directions, ≈ 25 s across the view.
    const cycle = 40, k = (t % cycle) / 25, n = Math.floor(t / cycle);
    train.mesh.visible = k < 1;
    if (k >= 1) return;
    const from = PHI0 - train.len - 0.1, to = PHI1 + 0.1;
    const phi = n % 2 ? from + (to - from) * k : to - (to - from) * k;
    train.mesh.rotation.y = -phi;
  });

  // ---- sky dome with cel-shaded clouds, sun / moon and stars --------------------------------
  const cloudTex = texture(paintClouds(), false);
  cloudTex.colorSpace = THREE.NoColorSpace;
  cloudTex.wrapS = THREE.RepeatWrapping;
  const skyU = {
    zenith: {value: C(0x4b8fdc)}, horizon: {value: C(0xc5ddf0)}, groundCol: {value: C(0xa9bccc)},
    sunDir: {value: V(-1, 0.5, 0).normalize()}, sunColor: {value: C(0xfff0cc)}, sunSize: {value: 0.99955}, glow: {value: 0.16},
    clouds: {value: cloudTex}, cloudLit: {value: C(0xffffff)}, cloudMid: {value: C(0xe8eef8)}, cloudShade: {value: C(0xb7c6e2)},
    time: {value: 0}, stars: {value: 0},
  };
  const sky = new THREE.Mesh(own(new THREE.SphereGeometry(3600, 48, 24)), own(new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 groundCol; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float sunSize; uniform float glow; uniform sampler2D clouds; uniform vec3 cloudLit; uniform vec3 cloudMid;
      uniform vec3 cloudShade; uniform float time; uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float e = d.y;
        vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.5, e));
        col = mix(groundCol, col, smoothstep(-0.12, 0.0, e));
        vec3 s = normalize(sunDir);
        float sd = dot(d, s);
        col += sunColor * pow(max(sd, 0.0), 24.0) * glow;
        col = mix(col, sunColor * 1.3, smoothstep(sunSize, sunSize + 0.0003, sd));
        if (stars > 0.0) {
          vec3 cell = floor(d * 380.0);
          float h = hash(cell);
          col += vec3(step(0.9965, h)) * stars * smoothstep(0.05, 0.3, e) * (0.6 + 0.4 * sin(time * 2.0 + h * 90.0));
        }
        float az = atan(d.z, d.x) / 6.2831853 + 0.5;
        float v = clamp(e / 0.42, 0.0, 1.0);
        vec4 cl = texture2D(clouds, vec2(az * 2.0 + time * 0.0012, v));
        float t1 = smoothstep(0.2, 0.3, cl.r), t2 = smoothstep(0.7, 0.8, cl.r);
        vec3 cc = mix(mix(cloudShade, cloudMid, t1), cloudLit, t2);
        col = mix(col, cc, cl.a * smoothstep(0.0, 0.05, e) * (1.0 - smoothstep(0.9, 1.0, v)));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })));
  sky.layers.set(NO_OUTLINE_LAYER);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  root.add(sky);

  // ---- utility poles and wires ----------------------------------------------------------------
  const B = new Builder(), W = new Builder();
  const concrete = C(0xb3b0a8), steel = C(0x6f7479), porcelain = C(0xf0efe8), wireCol = C(0x2c2b33);
  const lamps = [];
  const pole = (phiDeg, r, {transformer = false, lamp = 0} = {}) => {
    const phi = phiDeg * DEG, bottom = ring(phi, r, GROUND), top = ring(phi, r, GROUND + 232);
    B.tube([bottom, top], 2.2, 1.5, concrete, 10, 1);
    const tangent = V(Math.sin(phi), 0, -Math.cos(phi));   // along the lane
    const arms = [];
    for (const [h, half] of [[224, 22], [210, 17]]) {
      const c = ring(phi, r, GROUND + h);
      B.box(c, V(2, 2, half * 2), steel, Math.atan2(tangent.x, tangent.z));
      for (const k of [-1, 0, 1]) {
        const p = c.clone().addScaledVector(tangent, k * (half - 3));
        B.box(p.clone().add(V(0, 2.4, 0)), V(1.6, 3, 1.6), porcelain);
        arms.push(p.clone().add(V(0, 4, 0)));
      }
    }
    if (transformer) B.tube([ring(phi, r + 5, GROUND + 172), ring(phi, r + 5, GROUND + 186)], 4.2, 4.2, C(0x9aa0a4), 12, 1);
    if (lamp) {
      // Street lamp arm reaching over the lane (lamp = +1 outwards, -1 inwards).
      const a = ring(phi, r, GROUND + 150), b = ring(phi, r + 16 * lamp, GROUND + 154);
      B.rod(a, b, 0.7, steel);
      B.box(ring(phi, r + 17 * lamp, GROUND + 152.5), V(5, 2.2, 3.5), C(0x55595d), -phi);
      lamps.push(ring(phi, r + 17 * lamp, GROUND + 151));
    }
    return {arms, cable: ring(phi, r - 1, GROUND + 186)};
  };
  const catenary = (a, b, sag, radius) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(V(0, -sag * 4 * t * (1 - t), 0)));
    }
    W.tube(pts, radius, radius, wireCol, 4, 1);
  };
  const runs = [
    [[-42, 92, {}], [16, 92, {transformer: true, lamp: 1}], [74, 92, {lamp: 1}]],
    [[-34, 238, {lamp: -1}], [10, 238, {}], [50, 238, {transformer: true}], [92, 238, {lamp: -1}]],
  ];
  const nearPoles = [];
  for (const run of runs) {
    const ps = run.map(([phi, r, o]) => pole(phi, r, o));
    nearPoles.push(ps);
    for (let i = 0; i < ps.length - 1; i++) {
      const A = ps[i], Bp = ps[i + 1];
      A.arms.forEach((p, k) => catenary(p, Bp.arms[k], 7 + (k % 3) * 1.5, 0.11));
      catenary(A.cable, Bp.cable, 11, 0.32);          // telecom cable
    }
  }
  // Service drops from the near poles to our building and across the lane.
  catenary(nearPoles[0][1].arms[4], V(WALL_X - 0.4, 30, -15), 4, 0.1);
  catenary(nearPoles[0][1].arms[3], nearPoles[1][1].arms[3], 9, 0.1);
  catenary(nearPoles[0][2].arms[5], nearPoles[1][2].arms[4], 10, 0.1);
  const outdoorMat = own(toon(0xffffff, {vertexColors: true, rim: 0.1}));
  const poleMesh = new THREE.Mesh(own(B.geometry()), outdoorMat);
  root.add(poleMesh);
  const wireMesh = new THREE.Mesh(own(W.geometry()), own(toon(0xffffff, {vertexColors: true, rim: 0})));
  wireMesh.layers.set(NO_OUTLINE_LAYER);
  root.add(wireMesh);
  const lampMat = own(new THREE.MeshBasicMaterial({color: 0xfff1c8}));
  for (const p of lamps) {
    const bulb = new THREE.Mesh(own(new THREE.SphereGeometry(1.6, 10, 8)), lampMat);
    bulb.position.copy(p);
    bulb.layers.set(NO_OUTLINE_LAYER);
    root.add(bulb);
  }

  // ---- cherry trees -------------------------------------------------------------------------------
  // Branches are toon tubes; the blossoms are painted clusters on camera-facing cards.
  const bark = C(0x5c4741);
  const T = new Builder();
  const clumps = [];
  const wallLimit = WALL_X - 7;                 // keep blossom cards out of the room
  function clump(p, size, r) {
    if (p.x > wallLimit - size * 0.4) p.x = wallLimit - size * 0.4;
    clumps.push({p, size, variant: Math.floor(r() * 4), rot: (r() - 0.5) * 0.5, shade: 0.86 + r() * 0.18, phase: r()});
  }
  function grow(r, from, dir, len, rad, depth, clumpSize) {
    const d = dir.clone();
    let end = from.clone().addScaledVector(d, len);
    if (end.x > wallLimit) { d.x = -Math.abs(d.x) - 0.3; d.normalize(); end = from.clone().addScaledVector(d, len); }
    const mid = from.clone().lerp(end, 0.5).add(V(0, len * 0.1, 0));
    end.y -= len * 0.05 * (3 - depth);         // tips droop a little
    T.tube([from, mid, end], rad, rad * 0.6, bark, depth >= 2 ? 7 : 5, 4);
    if (depth <= 1) clump(mid.clone().add(V((r() - 0.5) * 4, 2 + r() * 3, (r() - 0.5) * 4)), clumpSize * (0.75 + r() * 0.3), r);
    if (depth === 0) {
      for (let k = 0; k < 3; k++) clump(end.clone().add(V((r() - 0.5) * clumpSize * 0.9, (r() - 0.3) * clumpSize * 0.6, (r() - 0.5) * clumpSize * 0.9)), clumpSize * (0.8 + r() * 0.4), r);
      return;
    }
    const n = depth >= 2 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const nd = d.clone().add(V((r() - 0.5) * 1.1, (r() - 0.25) * 0.7, (r() - 0.5) * 1.1)).normalize();
      grow(r, end, nd, len * (0.58 + r() * 0.18), rad * 0.62, depth - 1, clumpSize);
    }
  }
  function sakura({base, height, spread, seed, clumpSize, limbs = 5, trunk = 4, guides = []}) {
    const r = rng(seed);
    const fork = base.clone().add(V((r() - 0.5) * 10, height, (r() - 0.5) * 10));
    T.tube([base, base.clone().lerp(fork, 0.5).add(V((r() - 0.5) * 6, 0, (r() - 0.5) * 6)), fork], trunk, trunk * 0.72, bark, 9, 4);
    for (let i = 0; i < limbs; i++) {
      const az = i / limbs * PI * 2 + r() * 0.9, el = 0.3 + r() * 0.45;
      grow(r, fork, V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), spread * (0.5 + r() * 0.2), trunk * 0.5, 3, clumpSize);
    }
    // Guided limbs: hand-placed boughs that reach towards the window.
    for (const g of guides) {
      const pts = [fork, ...g];
      T.tube(pts, trunk * 0.45, trunk * 0.12, bark, 7, 5);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const dir = p.clone().sub(pts[i - 1]).normalize();
        grow(r, p, dir.add(V((r() - 0.5) * 0.8, 0.3, (r() - 0.5) * 0.8)).normalize(), spread * 0.22, trunk * 0.12, 1, clumpSize);
        clump(p.clone().add(V(-r() * 3, 3 + r() * 3, (r() - 0.5) * 3)), clumpSize * (0.9 + r() * 0.3), r);
      }
    }
  }
  // A tall old tree in our yard, right of the window: its crown frames the top of the view.
  sakura({base: ring(80 * DEG, 74, GROUND), height: 200, spread: 64, seed: 31, clumpSize: 10, limbs: 6, trunk: 6,
    guides: [
      [V(-46, 28, -52), V(-38, 32, -34), V(-31, 30, -18), V(-27, 27, -4)],
      [V(-58, 22, -48), V(-62, 26, -26), V(-56, 22, -8), V(-50, 24, 8)],
    ]});
  // A row along the far side of the lane, their crowns a sea of pink below the window.
  for (const [phi, s] of [[-52, 41], [-6, 42], [41, 43], [86, 44]]) {
    sakura({base: ring(phi * DEG, 228, GROUND), height: 84, spread: 82, seed: s, clumpSize: 22, limbs: 6, trunk: 4.5});
  }
  const branchMesh = new THREE.Mesh(own(T.geometry()), outdoorMat);
  root.add(branchMesh);

  const atlas = texture(paintBlossomAtlas());
  const blossomU = {atlas: {value: atlas}, time: {value: 0}, tint: {value: new THREE.Vector3(1, 1, 1)}, glow: {value: new THREE.Vector3()}};
  {
    const g = own(new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const iPos = new Float32Array(clumps.length * 4), iData = new Float32Array(clumps.length * 4);
    clumps.forEach((c, i) => {
      iPos.set([c.p.x, c.p.y, c.p.z, c.phase], i * 4);
      iData.set([c.size, c.variant, c.rot, c.shade], i * 4);
    });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
    g.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4));
    g.instanceCount = clumps.length;
    const mat = own(new THREE.ShaderMaterial({
      uniforms: blossomU,
      vertexShader: /* glsl */`
        attribute vec4 iPos; attribute vec4 iData;
        uniform float time;
        varying vec2 vUv; varying float vShade;
        void main(){
          vec3 p = iPos.xyz;
          float sway = sin(time * 0.9 + iPos.w * 6.2832 + p.y * 0.02) * 0.6 + sin(time * 2.3 + iPos.w * 17.0) * 0.15;
          p.x += sway * 0.7; p.z += sway * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float c = cos(iData.z), s = sin(iData.z);
          mv.xy += mat2(c, s, -s, c) * position.xy * iData.x;
          gl_Position = projectionMatrix * mv;
          vec2 cell = vec2(mod(iData.y, 2.0), floor(iData.y / 2.0));
          vUv = (cell + vec2(position.x + 0.5, 0.5 - position.y)) * 0.5;
          vUv.y = 1.0 - vUv.y;
          vShade = iData.w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D atlas; uniform vec3 tint; uniform vec3 glow;
        varying vec2 vUv; varying float vShade;
        void main(){
          vec4 c = texture2D(atlas, vUv);
          if (c.a < 0.05) discard;
          gl_FragColor = vec4(c.rgb * tint * vShade + glow, c.a);
        }`,
      alphaToCoverage: true,
    }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.layers.set(NO_OUTLINE_LAYER);
    root.add(mesh);
  }

  // ---- birds crossing the sky now and then -----------------------------------------------------
  const birds = [];
  const birdGeo = own(new THREE.BufferGeometry());
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -3, 0.6, 3.5, 0, 0.2, 1, 0, 0, 0, 0, 0.2, 1, 3, 0.6, 3.5], 3));
  birdGeo.computeVertexNormals();
  const birdMat = own(new THREE.MeshBasicMaterial({color: 0x3b3a44, side: THREE.DoubleSide}));
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(birdGeo, birdMat);
    b.scale.setScalar(3 + rand() * 2);
    b.layers.set(NO_OUTLINE_LAYER);
    root.add(b);
    birds.push({mesh: b, phase: rand() * 100, offset: V((rand() - 0.5) * 30, (rand() - 0.5) * 14, (rand() - 0.5) * 30), flap: 6 + rand() * 3});
  }
  animated.push(t => {
    const cycle = 52, k = (t % cycle) / cycle;
    const start = ring(-40 * DEG, 520, 46), end = ring(95 * DEG, 520, 70);
    const dir = new THREE.Vector3().subVectors(end, start);
    for (const b of birds) {
      const p = new THREE.Vector3().lerpVectors(start, end, k).add(b.offset);
      p.y += Math.sin(t * 0.8 + b.phase) * 3;
      b.mesh.position.copy(p);
      b.mesh.lookAt(p.clone().sub(dir));        // wing tips trail behind
      b.mesh.scale.y = b.mesh.scale.x * (0.2 + 1.4 * Math.abs(Math.sin(t * b.flap + b.phase)));
      b.mesh.visible = k < 0.96;
    }
  });

  // ---- falling petals (some drift in through the open window) ------------------------------------
  const PETALS = 320;
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, -0.5); petalShape.quadraticCurveTo(0.5, -0.2, 0.32, 0.38); petalShape.lineTo(0, 0.24); petalShape.lineTo(-0.32, 0.38); petalShape.quadraticCurveTo(-0.5, -0.2, 0, -0.5);
  const petalGeo = own(new THREE.ShapeGeometry(petalShape, 4));
  const petalMat = own(toon(0xf8c8d6, {side: THREE.DoubleSide, rim: 0.2}));
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, PETALS);
  petals.frustumCulled = false;
  petals.layers.set(NO_OUTLINE_LAYER);
  root.add(petals);
  const P = [];
  const spawn = (p, initial) => {
    p.pos = V(-75 + rand() * 50, -25 + rand() * 55, -60 + rand() * 50);
    if (initial) p.pos.y = -80 + rand() * 110;
    p.vel = V(0, 0, 0);
    p.spin = V(rand() * 3, rand() * 3, rand() * 3);
    p.rot = new THREE.Euler(rand() * PI, rand() * PI, rand() * PI);
    p.phase = rand() * 10;
    p.size = 0.3 + rand() * 0.25;
    p.landed = 0; p.inside = false;
    p.drifter = rand() < 0.11;   // aims for the open part of the window
  };
  for (let i = 0; i < PETALS; i++) { const p = {}; spawn(p, true); P.push(p); }
  {
    const pinks = [0xfbd3df, 0xf7bccd, 0xfde6ec];
    for (let i = 0; i < PETALS; i++) petals.setColorAt(i, C(pinks[i % 3]));
  }
  const WIN = {z0: 0.6, z1: 6.4, y0: 3.6, y1: 19};   // the open sash
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  let landedCount = 0;
  animated.push((t, dt) => {
    dt = Math.min(dt, 0.05);
    const gust = 0.6 + 0.4 * Math.sin(t * 0.31) * Math.sin(t * 0.17 + 1);
    for (let i = 0; i < PETALS; i++) {
      const p = P[i];
      if (p.landed > 0) {
        p.landed += dt;
        if (p.landed > 40) { landedCount--; spawn(p, false); }
      } else {
        const wind = p.inside ? V(1.2, -0.2, 0.3) : V(3 + 5 * gust, 0, 2.5 * gust);
        if (p.drifter && !p.inside) {
          // Steer gently towards the open sash.
          const target = V(-16, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2);
          wind.add(target.clone().sub(p.pos).normalize().multiplyScalar(4));
        }
        p.vel.lerp(wind, 1 - Math.exp(-dt * 1.5));
        const fall = p.inside ? 1.6 : 2.4;
        p.pos.x += (p.vel.x + Math.sin(t * 1.7 + p.phase) * 1.2) * dt;
        p.pos.y += (p.vel.y - fall + Math.sin(t * 2.3 + p.phase) * 0.8) * dt;
        p.pos.z += (p.vel.z + Math.cos(t * 1.3 + p.phase) * 1.2) * dt;
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        // Our wall: only the open sash lets petals through.
        if (!p.inside && p.pos.x > WALL_X - 0.5) {
          const through = p.pos.z > WIN.z0 && p.pos.z < WIN.z1 && p.pos.y > WIN.y0 && p.pos.y < WIN.y1;
          if (through && landedCount < 26) p.inside = true;
          else { p.pos.x = WALL_X - 0.6; p.vel.x = -Math.abs(p.vel.x) * 0.3; }
        }
        if (p.inside) {
          // Land on the sill or the desk; never fly through the typewriter.
          const onSill = p.pos.x < -14.5 && p.pos.y <= 3.45 && p.pos.y > 3.0;
          const onDesk = p.pos.y <= 0.03 && p.pos.x < -5.5 && p.pos.z > -7.5 && p.pos.z < 6.4;
          if (onSill || onDesk) {
            p.pos.y = onSill ? 3.43 : 0.03;
            p.rot.set(-PI / 2 + (rand() - 0.5) * 0.3, 0, rand() * PI * 2);
            p.landed = 0.001; landedCount++;
          } else if (p.pos.x > -5.5 || p.pos.y < -3) { spawn(p, false); }
        } else if (p.pos.y < -95 || p.pos.x < -300 || p.pos.z > 120 || p.pos.z < -260) spawn(p, false);
      }
      q.setFromEuler(p.rot);
      const fade = p.landed > 34 ? Math.max(0.001, 1 - (p.landed - 34) / 6) : 1;
      m4.compose(p.pos, q, sc.setScalar(p.size * fade));
      petals.setMatrixAt(i, m4);
    }
    petals.instanceMatrix.needsUpdate = true;
  });

  // ---- time of day ------------------------------------------------------------------------------------
  function setMode(mode, sunDir) {
    const p = PRESETS[mode] || PRESETS.afternoon;
    skyU.zenith.value.set(p.zenith);
    skyU.horizon.value.set(p.horizon);
    skyU.groundCol.value.set(p.ground);
    skyU.sunColor.value.set(p.sun);
    skyU.sunSize.value = p.sunSize;
    skyU.glow.value = p.glow;
    skyU.cloudLit.value.set(p.cloudLit);
    skyU.cloudMid.value.set(p.cloudMid);
    skyU.cloudShade.value.set(p.cloudShade);
    skyU.stars.value = p.stars;
    if (sunDir) skyU.sunDir.value.copy(sunDir);
    paintU.tint.value.set(...p.tint);
    paintU.haze.value.set(p.haze);
    paintU.hazeK.value = p.hazeK;
    paintU.lightAmt.value = p.lights;
    blossomU.tint.value.set(...p.blossom);
    blossomU.glow.value.set(...p.blossomGlow);
    lampMat.color.setRGB(1, 0.92, 0.75).multiplyScalar(0.5 + p.lamps);
  }

  return {
    root,
    setMode,
    update(t, dt) {
      skyU.time.value = t;
      blossomU.time.value = t;
      for (const f of animated) f(t, dt);
    },
    dispose() {
      for (const o of owned) o.dispose?.();
      root.removeFromParent();
    },
  };
}
