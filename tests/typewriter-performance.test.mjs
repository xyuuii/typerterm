import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTypewriter} from '../src/engine/typewriter.js';
import {STRIKE} from '../src/engine/geometry.js';

// Construction paints labels but does not require a renderer. Geometry,
// transforms and raycasts below use the actual Three.js implementation.
async function withMachine(run) {
  const previous = globalThis.document;
  const context = {fillRect() {}, clearRect() {}, fillText() {}, save() {}, restore() {}, translate() {}};
  globalThis.document = {createElement(tag) {
    assert.equal(tag, 'canvas');
    return {width: 0, height: 0, getContext: () => context};
  }};
  let machine;
  try {
    machine = await createTypewriter();
    await run(machine);
  } finally {
    machine?.dispose();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

function worldInstance(mesh, index) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.premultiply(mesh.matrixWorld);
}

function closeVector(actual, expected, message) {
  assert.ok(actual.distanceTo(expected) < 1e-5, `${message}: ${actual.toArray()} vs ${expected.toArray()}`);
}

// Original individual-mesh centres captured at impact before instancing.
// Outer bars meet the ribbon slightly behind its centre because they rotate
// in radial planes; preserving that authored pose is part of this change.
const impactCentres = new Map([
  [0, [-0.009019435507956919, 3.180107877598459, -0.9793774607747598]],
  [19, [-0.004615674665084349, 3.1795996026836293, -0.9351111836033682]],
  [41, [0.009019435507956919, 3.180107877598459, -0.9793774607747598]],
]);

test('all typebars retain their printing pose with the slug face aligned', async () => {
  await withMachine(machine => {
    const arms = machine.root.getObjectByName('Typebar arms');
    const slugs = machine.root.getObjectByName('Typebar slugs');
    assert.ok(arms.isInstancedMesh && slugs.isInstancedMesh);
    assert.equal(arms.count, 42);
    assert.equal(slugs.count, 42);
    assert.equal(arms.castShadow, true);
    assert.equal(arms.receiveShadow, true);
    assert.equal(slugs.castShadow, true);
    assert.equal(slugs.receiveShadow, false);
    const paperNormal = new THREE.Vector3(0, Math.sin(7 * Math.PI / 180), Math.cos(7 * Math.PI / 180));
    const contact = new THREE.Vector3(STRIKE.x, STRIKE.y, STRIKE.z).addScaledVector(paperNormal, 0.047);
    for (let i = 0; i < machine.bars.length; i++) {
      const now = i + 1;
      const k = i % 2 ? 0.4 : 1;
      const delay = machine.strike(i, now, k);
      machine.update(now + delay, 1 / 60);
      machine.root.updateMatrixWorld(true);
      const slug = worldInstance(slugs, i);
      const centre = new THREE.Vector3().setFromMatrixPosition(slug);
      assert.ok(centre.distanceTo(contact) < 0.05, `bar ${i} must reach the printing line`);
      if (impactCentres.has(i)) closeVector(centre, new THREE.Vector3(...impactCentres.get(i)), `bar ${i} impact pose`);
      closeVector(new THREE.Vector3(0, 1, 0).transformDirection(slug), paperNormal.clone().negate(), `bar ${i} face`);
    }
    let meshes = 0;
    machine.root.traverse(object => { if (object.isMesh) meshes++; });
    assert.ok(meshes <= 131, `machine mesh budget exceeded: ${meshes}`);
  });
});

test('bar instances animate independently, settle without uploads and follow segment shift', async () => {
  await withMachine(machine => {
    const arms = machine.root.getObjectByName('Typebar arms');
    const slugs = machine.root.getObjectByName('Typebar slugs');
    const initial = Array.from(slugs.instanceMatrix.array);
    machine.strike(0, 1);
    machine.update(1.025, 1 / 60);
    assert.notDeepEqual(Array.from(slugs.instanceMatrix.array.slice(0, 16)), initial.slice(0, 16));
    assert.deepEqual(Array.from(slugs.instanceMatrix.array.slice(16)), initial.slice(16));
    machine.update(1.4, 1 / 60);
    assert.deepEqual(Array.from(slugs.instanceMatrix.array), initial);
    const versions = [arms.instanceMatrix.version, slugs.instanceMatrix.version];
    machine.update(1.5, 1 / 60);
    assert.deepEqual([arms.instanceMatrix.version, slugs.instanceMatrix.version], versions);

    machine.strike(41, 2, 1, true);
    machine.update(2.05, 1 / 60);
    machine.root.updateMatrixWorld(true);
    assert.equal(arms.parent, slugs.parent);
    const shift = slugs.parent.position.y;
    assert.ok(shift < 0 && shift >= -0.06);
    const contact = new THREE.Vector3(...impactCentres.get(41));
    contact.y += shift;
    closeVector(new THREE.Vector3().setFromMatrixPosition(worldInstance(slugs, 41)), contact, 'shifted contact');
  });
});

test('animated keycaps remain individually pickable', async () => {
  await withMachine(machine => {
    assert.equal(machine.keyMeshes.length, 92);
    const rings = machine.root.getObjectByName('Key rings');
    const stems = machine.root.getObjectByName('Key stems');
    assert.equal(rings.count, 45);
    assert.equal(stems.count, 45);
    assert.equal(rings.castShadow, true);
    assert.equal(stems.castShadow, false);
    const cap = machine.keyMeshes.find(mesh => mesh.userData.key === 'a');
    assert.ok(cap);
    machine.pressKey('a', 1);
    machine.update(1.06, 1 / 60);
    machine.root.updateMatrixWorld(true);
    const origin = cap.localToWorld(new THREE.Vector3(0, 0.4, 0));
    const direction = new THREE.Vector3(0, -1, 0).transformDirection(cap.matrixWorld);
    const hit = new THREE.Raycaster(origin, direction, 0, 1).intersectObjects(machine.keyMeshes, false)[0];
    assert.equal(hit?.object.userData.key, 'a');
    closeVector(new THREE.Vector3().setFromMatrixPosition(worldInstance(rings, 22)),
      cap.localToWorld(new THREE.Vector3(0, 0.005, 0)), 'pressed A ring follows its keycap');
    closeVector(new THREE.Vector3().setFromMatrixPosition(worldInstance(stems, 22)),
      cap.localToWorld(new THREE.Vector3(0, -0.33, 0)), 'pressed A stem follows its keycap');
    machine.update(1.4, 1 / 60);
    const versions = [rings.instanceMatrix.version, stems.instanceMatrix.version];
    machine.update(1.5, 1 / 60);
    assert.deepEqual([rings.instanceMatrix.version, stems.instanceMatrix.version], versions);
  });
});
