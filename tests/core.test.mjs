import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPdf} from '../src/engine/pdf.js';
import {PaperPath, PLATEN, PAPER_R, STRIKE, S_EXIT, S_BACK} from '../src/engine/geometry.js';
import {makeLayout, FORMATS, signature} from '../src/engine/ink.js';
import {Mechanism, MAX_LAG} from '../src/engine/mechanism.js';

// 1×1 baseline JPEG.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test('PDF: structure, page sizes and xref offsets are consistent', () => {
  const pages = [
    {jpeg: JPEG, width: 1, height: 1, pageWidth: FORMATS.a4.pdf[0], pageHeight: FORMATS.a4.pdf[1]},
    {jpeg: JPEG, width: 1, height: 1, pageWidth: FORMATS.wide.pdf[0], pageHeight: FORMATS.wide.pdf[1]},
  ];
  const bytes = buildPdf(pages, {title: '测试 pages'});
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /\/MediaBox \[0 0 841\.89 473\.56\]/);
  // Every xref entry must point exactly at "<id> 0 obj".
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(startxref).startsWith('xref'));
  const entries = text.slice(startxref).split('\n').slice(3).filter(l => / n $/.test(l));
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`);
  });
  // Non-ASCII title is written as UTF-16BE hex.
  assert.match(text, /\/Title <FEFF6D4B8BD5/);
});

test('Paper path: arclength-preserving, continuous, outside the platen', () => {
  for (const stiffness of [0.15, 0.6, 0.95]) {
    const path = new PaperPath(stiffness);
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0];
    path.sample(0, a);
    assert.ok(Math.abs(a[0] - STRIKE.y) < 1e-9 && Math.abs(a[1] - STRIKE.z) < 1e-9, 'printing line at s = 0');
    const ds = 0.01;
    for (let s = S_BACK - 6.5; s < 7.5; s += ds) {
      path.sample(s, a); path.sample(s + ds, b);
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // No stretching or compression of the sheet anywhere along the path.
      assert.ok(Math.abs(step - ds) < ds * 0.02, `step at s=${s.toFixed(2)} is ${step}`);
      // Never inside the platen rubber.
      const r = Math.hypot(a[0] - PLATEN.y, a[1] - PLATEN.z);
      assert.ok(r >= PLATEN.r - 1e-6, `penetrates platen at s=${s.toFixed(2)}`);
      // Never through the desk.
      assert.ok(a[0] > 0.05, `below desk at s=${s.toFixed(2)}`);
      // Unit normal.
      assert.ok(Math.abs(Math.hypot(a[2], a[3]) - 1) < 1e-3);
    }
    // Continuity across the contact/free-segment joints.
    for (const joint of [S_EXIT, S_BACK]) {
      path.sample(joint - 1e-6, a); path.sample(joint + 1e-6, b);
      assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3, 'joint continuity');
    }
  }
  assert.ok(Math.abs(PAPER_R - PLATEN.r) < 0.05);
});

test('Formats: grid fits the sheet, stays within bridge limits, PDF aspect matches', () => {
  for (const id of Object.keys(FORMATS)) {
    const L = makeLayout(id);
    assert.ok(L.cols >= 20 && L.cols <= 300, `${id} cols ${L.cols}`);
    assert.ok(L.rows >= 5 && L.rows <= 150, `${id} rows ${L.rows}`);
    assert.ok(L.marginX >= 0.35, `${id} side margin`);
    assert.ok(L.marginTop + L.rows * L.lineH <= L.H - 0.39, `${id} bottom margin`);
    const f = FORMATS[id];
    assert.ok(Math.abs(f.pdf[0] / f.pdf[1] - L.W / L.H) < 0.01 * (L.W / L.H), `${id} pdf aspect`);
    // Column centres are symmetric about the sheet centre.
    assert.ok(Math.abs(L.colX(0) + L.colX(L.cols - 1)) < 1e-9);
  }
  assert.equal(Math.round(FORMATS.wide.width / FORMATS.wide.height * 9), 16);
});

function rec(ch) { return {ch, w: 1, fg: null, bg: null, flags: 0}; }
function fakeRig() {
  const strikes = [], inked = [], replaced = [];
  const machine = {barFor: ch => ({bar: ch.charCodeAt(0) % 40, shift: false}), strike: () => 0.05};
  const sheet = {
    strikeCell: (r, c, x) => inked.push(`${r}:${c}:${x.ch}`),
    replaceCell: (r, c, x) => replaced.push(`${r}:${c}:${x ? x.ch : ''}`),
    redrawAll: () => {},
  };
  machine.strike = (bar, now, k) => { strikes.push({bar, now, k}); return 0.05 * k; };
  return {machine, sheet, strikes, inked, replaced};
}

test('Mechanism: ink appears only at contact, in typing order', () => {
  const layout = makeLayout('square');
  const rig = fakeRig();
  const m = new Mechanism({layout, machine: rig.machine, sound: null, now: 0});
  m.attachSheet(rig.sheet);
  const grid = new Array(layout.rows * layout.cols).fill(null);
  'hello'.split('').forEach((ch, i) => { grid[i] = rec(ch); });
  m.sync(grid, {r: 0, c: 5}, 0);
  assert.equal(m.queue.length, 5);
  assert.equal(rig.inked.length, 0, 'nothing inked before a strike');
  let t = 0;
  const dt = 1 / 120;
  let firstStrikeInk = null;
  while (t < 2 && rig.inked.length < 5) {
    t += dt;
    m.update(t, dt);
    if (rig.strikes.length === 1 && firstStrikeInk === null) firstStrikeInk = rig.inked.length;
  }
  assert.equal(firstStrikeInk, 0, 'ink waits for the contact delay');
  assert.deepEqual(rig.inked, ['0:0:h', '0:1:e', '0:2:l', '0:3:l', '0:4:o']);
  assert.equal(rig.strikes.length, 5);
  // Erasing an inked cell is a digital change, applied at once.
  const erased = grid.slice();
  erased[4] = null;
  m.sync(erased, {r: 0, c: 4}, t);
  assert.deepEqual(rig.replaced, ['0:4:']);
  assert.equal(signature(null), '');
});

test('Mechanism: bounded lag — a burst catches up instead of queueing for minutes', () => {
  const layout = makeLayout('a4');
  const rig = fakeRig();
  const m = new Mechanism({layout, machine: rig.machine, sound: null, now: 0});
  m.attachSheet(rig.sheet);
  const grid = new Array(layout.rows * layout.cols).fill(null);
  for (let i = 0; i < layout.cols * 20; i++) grid[i] = rec('x');
  m.sync(grid, {r: 20, c: 0}, 0);
  let t = 0;
  while (t < MAX_LAG + 0.3) { t += 1 / 60; m.update(t, 1 / 60); }
  assert.equal(m.queue.length, 0, 'queue drained');
  assert.equal(rig.inked.length, layout.cols * 20, 'every cell inked');
});
