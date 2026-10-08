import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {ToonPipeline} from '../src/engine/toon.js';

function makePipeline(pixelRatio = 1) {
  const renderer = {
    getPixelRatio: () => pixelRatio,
    getSize: out => out.set(960, 540),
    getRenderTarget: () => null,
    setRenderTarget: () => {},
  };
  return {renderer, pipeline: new ToonPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera())};
}

test('Toon quality: low skips the second scene render while balanced keeps ink with cheaper buffers', () => {
  const {pipeline} = makePipeline(2);
  try {
    // Composer and outline must agree at DPR 2, rather than scaling twice.
    assert.equal(pipeline.composer.renderTarget1.width, 1920);
    assert.equal(pipeline.outline.target.width, 1920);
    assert.equal(pipeline.bloom.renderTargetBright.width, 960);
    pipeline.setQuality('medium');
    assert.equal(pipeline.outline.enabled, true);
    assert.equal(pipeline.bloom.enabled, true);
    assert.equal(pipeline.bloom.renderTargetBright.width, 480);
    for (const target of [pipeline.composer.renderTarget1, pipeline.composer.renderTarget2]) {
      assert.equal(target.samples, 0);
      assert.equal(target.resolveDepthBuffer, false);
    }
    // A window resize must retain the cheaper bloom mip chain.
    pipeline.setSize(1280, 720, 1);
    assert.equal(pipeline.bloom.renderTargetBright.width, 320);
    assert.equal(pipeline.bloom.renderTargetBright.height, 180);

    pipeline.setQuality('low');
    const rendered = [];
    for (const name of ['renderPass', 'outline', 'bloom', 'output', 'grade']) {
      pipeline[name].render = () => rendered.push(name);
    }
    pipeline.render(1);
    assert.deepEqual(rendered, ['renderPass', 'output', 'grade']);
    assert.equal(pipeline.grade.renderToScreen, true);
    assert.equal(pipeline.grade.uniforms.grain.value, 0);

    pipeline.setQuality('high');
    assert.equal(pipeline.outline.enabled, true);
    assert.equal(pipeline.bloom.enabled, true);
    assert.equal(pipeline.bloom.renderTargetBright.width, 640);
    assert.equal(pipeline.composer.renderTarget1.samples, 4);
    assert.equal(pipeline.composer.renderTarget2.samples, 4);
  } finally {
    pipeline.dispose();
  }
});

test('Outline prepass never updates shadows and restores scene state after a render error', () => {
  const {pipeline, renderer} = makePipeline();
  const {outline, scene, camera} = pipeline;
  const background = new THREE.Color(0xabcdef);
  const fog = new THREE.Fog(0x123456, 1, 100);
  const override = new THREE.MeshBasicMaterial();
  scene.background = background;
  scene.fog = fog;
  scene.overrideMaterial = override;
  camera.layers.enableAll();
  const mask = camera.layers.mask;
  let clearColor = new THREE.Color(0x765432), clearAlpha = 0.7;
  Object.assign(renderer, {
    shadowMap: {autoUpdate: true, needsUpdate: true},
    getClearColor: out => out.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color, alpha) => { clearColor.set(color); clearAlpha = alpha; },
    clear: () => {},
    render: () => {
      assert.equal(renderer.shadowMap.autoUpdate, false);
      assert.equal(renderer.shadowMap.needsUpdate, false);
      assert.equal(scene.overrideMaterial, outline.normalMaterial);
      assert.equal(camera.layers.mask, 1);
      throw new Error('render interrupted');
    },
  });
  try {
    assert.throws(() => outline.render(renderer, {}, {}), /render interrupted/);
    assert.equal(scene.background, background);
    assert.equal(scene.fog, fog);
    assert.equal(scene.overrideMaterial, override);
    assert.equal(camera.layers.mask, mask);
    assert.deepEqual(renderer.shadowMap, {autoUpdate: true, needsUpdate: true});
    assert.equal(clearColor.getHex(), 0x765432);
    assert.equal(clearAlpha, 0.7);
  } finally {
    override.dispose();
    pipeline.dispose();
  }
});
