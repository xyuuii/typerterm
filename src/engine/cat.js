// The sleeping cat: a chibi orange tabby curled up on its cushion. A big
// round "mochi" head resting on its paws, closed smiling eyes, an ω mouth,
// blushing cheeks, a red collar with a little bell and a tail wrapped around
// the front. Head and body are single smooth meshes with painted fur, so the
// ink outline stays clean; the face is drawn on top without outlines. It
// breathes, twitches an ear now and then, sways the tail tip and lets a few
// "z" drift up. react() perks it up for a moment.
import * as THREE from 'three';
import {toon, NO_OUTLINE_LAYER} from './toon.js';

const PI = Math.PI;
const ORANGE = '#f3a65c', STRIPE = '#dc8638', CREAM = '#fff2de', PINK = '#f4a3ad', INK = '#4a2e26';

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Sphere UVs: u = 0.25 faces +z (the cat's front), v = 1 is the top.
function headFur(c, w, h) {
  c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
  const fx = w * 0.25;
  // Forehead stripes ("川") and a pair on each cheek.
  c.fillStyle = STRIPE;
  for (const [dx, len, wd] of [[-0.034, 0.17, 0.016], [0, 0.2, 0.018], [0.034, 0.17, 0.016]]) {
    c.beginPath(); c.ellipse(fx + dx * w, h * (0.12 + len / 2), wd * w, len / 2 * h, 0, 0, PI * 2); c.fill();
  }
  for (const s of [-1, 1]) {
    for (const k of [0, 1]) {
      c.beginPath(); c.ellipse(fx + s * w * (0.15 + k * 0.012), h * (0.42 + k * 0.06), w * 0.035, h * 0.012, s * 0.25, 0, PI * 2); c.fill();
    }
  }
  // Stripes over the back of the head.
  for (let k = 0; k < 5; k++) {
    c.beginPath(); c.ellipse(w * (0.6 + k * 0.06), h * 0.2, w * 0.012, h * 0.16, 0, 0, PI * 2); c.fill();
  }
  // Cream muzzle, chin and cheek fluff.
  c.fillStyle = CREAM;
  c.beginPath(); c.ellipse(fx, h * 0.66, w * 0.105, h * 0.2, 0, 0, PI * 2); c.fill();
  c.beginPath(); c.ellipse(fx, h * 0.93, w * 0.4, h * 0.16, 0, 0, PI * 2); c.fill();
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(fx + s * w * 0.08, h * 0.72, w * 0.07, h * 0.12, 0, 0, PI * 2); c.fill(); }
}
function bodyFur(c, w, h) {
  c.fillStyle = ORANGE; c.fillRect(0, 0, w, h);
  c.fillStyle = STRIPE;
  // Bands across the back.
  for (let k = 0; k < 7; k++) {
    const u = 0.47 + k * 0.08;
    c.beginPath(); c.ellipse(w * u, h * 0.24, w * 0.016, h * 0.2, 0, 0, PI * 2); c.fill();
  }
  // Cream chest and belly.
  c.fillStyle = CREAM;
  c.beginPath(); c.ellipse(w * 0.25, h * 0.7, w * 0.16, h * 0.32, 0, 0, PI * 2); c.fill();
  c.fillRect(0, h * 0.86, w, h * 0.14);
}

/** A unit sphere squashed into a soft "mochi" shape (wider cheeks, flatter bottom). */
function mochiGeometry(sx, sy, sz, cheek = 0, flat = 0.25) {
  const g = new THREE.SphereGeometry(1, 64, 40);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Cheek fluff: push the lower sides out.
    const low = THREE.MathUtils.smoothstep(-v.y, -0.1, 0.55);
    v.x *= 1 + cheek * low * (1 - Math.abs(v.z) * 0.4);
    if (v.y < -0.55) v.y = -0.55 - (v.y + 0.55) * (1 - flat);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

export function createCat() {
  const owned = [];
  const own = x => (owned.push(x), x);
  const group = new THREE.Group();
  group.name = 'Cat';

  const M = {
    head: own(toon(0xffffff, {map: own(canvasTexture(1024, 512, headFur)), rim: 0.2, rimColor: 0xfff0c8})),
    body: own(toon(0xffffff, {map: own(canvasTexture(1024, 512, bodyFur)), rim: 0.2, rimColor: 0xfff0c8})),
    orange: own(toon(ORANGE, {rim: 0.2, rimColor: 0xfff0c8})),
    cream: own(toon(CREAM, {rim: 0.15})),
    pink: own(toon(PINK)),
    ink: own(new THREE.MeshBasicMaterial({color: INK})),
    blush: own(new THREE.MeshBasicMaterial({color: 0xf59aa6, transparent: true, opacity: 0.75, depthWrite: false})),
    collar: own(toon(0xd9493f, {spec: 0.3, shine: 30})),
    bell: own(toon(0xf2c14e, {spec: 0.9, shine: 60, rim: 0.3, rimColor: 0xfff6d0})),
  };
  const mesh = (geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = null, shadow = true) => {
    const m = new THREE.Mesh(own(geo), mat);
    m.position.set(...pos); m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const face = m => { m.layers.set(NO_OUTLINE_LAYER); m.castShadow = false; return m; };

  // ---- body: a loaf with its paws tucked in front
  const body = new THREE.Group();
  body.position.set(0, 0.6, -0.2);
  group.add(body);
  const torso = mesh(mochiGeometry(1.22, 0.74, 1.05, 0.05, 0.6), M.body, body, [0, 0.66, 0]);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(1, 20, 14), M.cream, body, [s * 0.42, 0.16, 1.02], [0, 0, 0], [0.3, 0.19, 0.4]);
  // Tail wrapped around the right side to the front; the tip sways.
  const tailPts = [[1.0, 0.32, -0.7], [1.38, 0.24, 0.15], [1.08, 0.2, 0.92], [0.52, 0.19, 1.28]].map(p => new THREE.Vector3(...p));
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 40, 0.23, 14), M.orange, body);
  for (const t of [0.3, 0.55]) {
    const c = new THREE.CatmullRomCurve3(tailPts).getPointAt(t);
    mesh(new THREE.TorusGeometry(0.235, 0.02, 6, 20), own(toon(STRIPE)), body, [c.x, c.y, c.z], [0, PI / 2 - t * 2.2, 0], null, false);
  }
  const tip = new THREE.Group();
  tip.position.copy(tailPts[3]);
  body.add(tip);
  mesh(new THREE.CapsuleGeometry(0.23, 0.32, 8, 16), M.cream, tip, [-0.22, 0, 0.04], [0, 0, PI / 2]);

  // ---- head: big and round, resting on the paws, tilted a little
  const head = new THREE.Group();
  head.position.set(0.02, 1.42, 0.62);
  head.rotation.set(0.12, 0.08, -0.13);
  body.add(head);
  mesh(mochiGeometry(1.08, 0.88, 0.94, 0.16, 0.2), M.head, head);
  // Ears with pink insides.
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.56, 0.62, -0.08);
    ear.rotation.set(-0.12, 0, -s * 0.36);
    head.add(ear);
    mesh(new THREE.ConeGeometry(0.33, 0.56, 20), M.orange, ear, [0, 0.2, 0], [0, 0, 0], [1, 1, 0.6]);
    face(mesh(new THREE.ConeGeometry(0.19, 0.36, 16), M.pink, ear, [0, 0.14, 0.13], [0, 0, 0], [1, 1, 0.35], false));
    ears.push(ear);
  }
  // Closed, smiling eyes (◡ ◡), ω mouth, nose and blush.
  for (const s of [-1, 1]) {
    face(mesh(new THREE.TorusGeometry(0.15, 0.036, 8, 20, PI), M.ink, head, [s * 0.36, 0.04, 0.87], [0, s * 0.36, PI], null, false));
    face(mesh(new THREE.SphereGeometry(1, 16, 10), M.blush, head, [s * 0.6, -0.2, 0.7], [0, s * 0.72, 0], [0.17, 0.085, 0.03], false));
    face(mesh(new THREE.TorusGeometry(0.075, 0.022, 6, 14, PI), M.ink, head, [s * 0.075, -0.25, 0.9], [0, s * 0.1, PI], null, false));
    // Whiskers.
    for (const k of [0, 1]) {
      face(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4), M.ink, head, [s * 0.92, -0.12 - k * 0.09, 0.56], [0, 0, PI / 2 + s * (0.12 - k * 0.2)], null, false));
    }
  }
  face(mesh(new THREE.SphereGeometry(1, 14, 10), M.pink, head, [0, -0.13, 0.93], [0.2, 0, 0], [0.085, 0.055, 0.05], false));
  // Collar and bell under the chin.
  mesh(new THREE.TorusGeometry(0.66, 0.065, 10, 40), M.collar, head, [0, -0.6, 0.08], [PI / 2 - 0.35, 0, 0], null, false);
  const bell = mesh(new THREE.SphereGeometry(0.14, 18, 12), M.bell, head, [0, -0.74, 0.66]);
  face(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), M.ink, bell, [0, -0.04, 0.12], [0, 0, 0], null, false));

  // ---- "z" bubbles drifting up
  const zTex = own(canvasTexture(128, 128, (c, w, h) => {
    c.font = 'italic 700 88px "Chalkboard SE", "Comic Sans MS", "Marker Felt", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 9; c.strokeStyle = 'rgba(255, 246, 230, 0.9)'; c.strokeText('z', w / 2, h / 2);
    c.fillStyle = '#8a6250'; c.fillText('z', w / 2, h / 2);
  }));
  const zs = [0, 1, 2].map(i => {
    const s = new THREE.Sprite(own(new THREE.SpriteMaterial({map: zTex, transparent: true, depthWrite: false, opacity: 0})));
    s.layers.set(NO_OUTLINE_LAYER);
    s.userData.phase = i / 3;
    group.add(s);
    return s;
  });

  // ---- life
  let twitch = 0, twitchSide = 0, nextTwitch = 4, perk = 0;
  function update(t, dt) {
    const breath = Math.sin(t * 1.4) * 0.5 + 0.5;
    torso.scale.set(1 + breath * 0.015, 1 + breath * 0.04, 1);
    perk = Math.max(0, perk - dt * 0.8);
    const lift = Math.sin(Math.min(1, perk) * PI) * 0.12;
    head.position.y = 1.42 + breath * 0.03 + lift;
    head.rotation.x = 0.12 - lift * 0.8;
    nextTwitch -= dt;
    if (nextTwitch < 0) { twitch = 0.32; twitchSide = Math.random() < 0.5 ? 0 : 1; nextTwitch = 4 + Math.random() * 8; }
    twitch = Math.max(0, twitch - dt);
    ears.forEach((ear, i) => {
      const flick = (i === twitchSide && twitch > 0 ? Math.sin(twitch * 40) * 0.35 : 0) + (perk > 0 ? -0.18 * Math.min(1, perk) : 0);
      ear.rotation.x = -0.12 + flick;
    });
    tip.rotation.y = Math.sin(t * 0.8) * 0.35;
    tip.rotation.z = Math.sin(t * 0.55 + 1) * 0.1;
    for (const z of zs) {
      const k = (t * 0.22 + z.userData.phase) % 1;
      z.position.set(0.7 + k * 0.9, 2.9 + k * 1.6, 0.6 + Math.sin(k * 6) * 0.15);
      z.scale.setScalar(0.24 + k * 0.3);
      z.material.opacity = perk > 0 ? 0 : Math.sin(k * PI) * 0.75;
    }
  }
  return {
    group,
    update,
    /** Perk up for a moment (e.g. at the carriage bell). */
    react() { perk = 1.6; },
    dispose() { for (const o of owned) o.dispose?.(); group.removeFromParent(); },
  };
}
