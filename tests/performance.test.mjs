import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderPixelRatio, FramePacer, AutoQuality} from '../src/engine/performance.js';

test('Rendering fits a fixed pixel budget even on 4K and Retina displays', () => {
  for (const [quality, budget] of [['high', 4000000], ['medium', 1600000], ['low', 900000]]) {
    const ratio = renderPixelRatio(quality, 3840, 2160, 2);
    assert.ok(3840 * 2160 * ratio ** 2 <= budget + 1);
  }
  assert.equal(renderPixelRatio('medium', 800, 600, 1), 1);
  assert.equal(renderPixelRatio('medium', 1280, 720, 2), 1.25);
});

test('High-refresh monitors render 60 active / 30 idle fps without halving slow displays', () => {
  for (const displayHz of [30, 60, 120, 144, 165, 240]) {
    for (const target of [30, 60]) {
      const pacer = new FramePacer();
      let frames = 0;
      for (let n = 0; n < displayHz * 5; n++) if (pacer.shouldRender(n * 1000 / displayHz, target)) frames++;
      assert.ok(Math.abs(frames - Math.min(displayHz, target) * 5) <= 1, `${displayHz} Hz / ${target}: ${frames}`);
    }
  }
});

test('Returning to active rendering or a visible tab renders immediately', () => {
  const pacer = new FramePacer();
  assert.equal(pacer.shouldRender(0, 30), true);
  assert.equal(pacer.shouldRender(5, 30), false);
  assert.equal(pacer.shouldRender(6, 60), true);
  pacer.reset();
  assert.equal(pacer.shouldRender(10000, 60), true);
  assert.equal(pacer.shouldRender(10002, 60), false);
});

test('Slightly early Chrome RAF timestamps do not introduce dropped 60 Hz frames', () => {
  const pacer = new FramePacer();
  for (let n = 0; n < 300; n++) {
    const now = n * 1000 / 60 - (n > 0 && n % 7 === 0 ? 1.8 : 0);
    assert.equal(pacer.shouldRender(now, 60), true, `frame ${n}`);
  }
});

test('Automatic quality reacts to sustained slow rendering, not idle throttling or one stall', () => {
  const monitor = new AutoQuality();
  let downgrade = false;
  for (let n = 0; n < 190; n++) downgrade ||= monitor.sample(n * 1000 / 60 + (n > 100 ? 100 : 0), true);
  assert.equal(downgrade, false);
  monitor.reset();
  for (let n = 0; n <= 95; n++) downgrade ||= monitor.sample(n * 1000 / 30, true);
  assert.equal(downgrade, true);
  monitor.reset();
  for (let n = 0; n < 100; n++) assert.equal(monitor.sample(n * 100, false), false);
});
