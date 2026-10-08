// Visual/mechanical synchronisation between the parsed terminal page and the
// sheet in the machine.
//
// xterm has already parsed everything; this module only decides *when* the
// paper shows it. New glyphs on blank cells are queued and inked at the
// moment their typebar reaches the platen. Anything else (erasing,
// overwriting, colour changes) is a digital display change and is applied at
// once. The queue is bounded: past MAX_PENDING cells or MAX_LAG seconds the
// sheet catches up immediately and the strikes are only sampled.
import {signature, isGlyph} from './ink.js';

export const MAX_LAG = 0.9;        // seconds a parsed glyph may wait for its strike
export const MAX_PENDING = 160;    // cells
const BASE_INTERVAL = 0.072;       // fastest unhurried repeat (≈14 strikes/s)
const MIN_INTERVAL = 0.022;        // fastest burst repeat (≈45 strikes/s)

export class Mechanism {
  constructor({layout, machine, sound, now = 0}) {
    this.machine = machine;
    this.sound = sound;
    this.setLayout(layout);
    this.colPos = 0; this.colVel = 0;
    this.rowPos = 0; this.rowVel = 0;
    this.targetCol = 0; this.targetRow = 0;
    this.strikeHold = -1;
    this.nextReady = now;
    this.returnStart = -10; this.returnActive = false;
    this.bellArmed = true;
    this.paused = false;
    this.leverPull = 0;
    this.sheet = null;
    this.feedOverride = null;   // {sTop} while inserting/ejecting a sheet
  }
  setLayout(layout) {
    this.layout = layout;
    const n = layout.rows * layout.cols;
    this.inked = new Array(n).fill('');
    this.inkedW = new Uint8Array(n);
    this.target = new Array(n).fill(null);
    this.queue = [];
    this.queued = new Set();
    this.pendingInk = [];
    this.cursor = null;
  }
  /** A fresh sheet: nothing is inked yet. */
  attachSheet(sheet) {
    this.sheet = sheet;
    this.inked.fill('');
    this.inkedW.fill(0);
    this.queue = [];
    this.queued.clear();
    this.pendingInk = [];
  }
  /** Make the sheet match the grid immediately, without strikes. */
  snapTo(grid) {
    this.target = grid;
    this.queue = []; this.queued.clear(); this.pendingInk = [];
    for (let i = 0; i < grid.length; i++) { this.inked[i] = signature(grid[i]); this.inkedW[i] = grid[i]?.w || 0; }
    this.sheet?.redrawAll(grid, this.layout.rows, this.layout.cols);
  }
  /** Feed in the latest parsed page. */
  sync(grid, cursor, now) {
    this.target = grid;
    this.cursor = cursor;
    if (!this.sheet) return;
    const {cols} = this.layout;
    let appended = false;
    for (let i = 0; i < grid.length; i++) {
      const rec = grid[i];
      const sig = signature(rec);
      if (sig === this.inked[i] || this.queued.has(i)) continue;
      if (this.inked[i] === '' && isGlyph(rec) && !this.paused) {
        this.queue.push({i, t: now});
        this.queued.add(i);
        appended = true;
      } else {
        // Digital change: erase/overwrite/recolour, applied at once — with a
        // little magic when ink that was already on the paper changes.
        if (this.inked[i] !== '') this.onMagic?.(Math.floor(i / cols), i % cols);
        this.sheet.replaceCell(Math.floor(i / cols), i % cols, rec, this.inkedW[i] || 1);
        this.inked[i] = sig;
        this.inkedW[i] = rec?.w || 0;
      }
    }
    if (appended && this.queue.length > 1) {
      // Keep reading order even if output arrived out of order.
      let sorted = true;
      for (let k = 1; k < this.queue.length; k++) if (this.queue[k].i < this.queue[k - 1].i) { sorted = false; break; }
      if (!sorted) this.queue.sort((a, b) => a.i - b.i);
    }
  }
  /** Ink everything that is still waiting. */
  flush(now, {sample = true} = {}) {
    if (!this.sheet) return;
    const {cols} = this.layout;
    const struck = this.queue.length;
    for (const p of this.pendingInk) this.inkNow(p.i);
    for (const q of this.queue) this.inkNow(q.i);
    this.pendingInk = [];
    if (struck && sample) {
      // Show speed, not every letter: a quick flurry of a few bars.
      const last = this.queue[this.queue.length - 1];
      const picks = Math.min(4, struck);
      for (let k = 0; k < picks; k++) {
        const q = this.queue[Math.floor((k + 0.5) * struck / picks)];
        const rec = this.target[q.i];
        const hit = rec && this.machine.barFor(rec.ch);
        if (hit) this.machine.strike(hit.bar, now + k * 0.03, 0.4, hit.shift);
        this.sound?.play('strike', {when: this.sound.at(now + k * 0.03 + 0.02), gain: 0.6});
      }
      this.targetCol = Math.min(cols - 1, (last.i % cols) + (this.target[last.i]?.w || 1));
      this.targetRow = Math.floor(last.i / cols);
    }
    this.queue = [];
    this.queued.clear();
  }
  inkNow(i) {
    const {cols} = this.layout;
    const rec = this.target[i];
    const r = Math.floor(i / cols), c = i % cols;
    if (isGlyph(rec) && this.inked[i] === '') this.sheet.strikeCell(r, c, rec);
    else this.sheet.replaceCell(r, c, rec, this.inkedW[i] || 1);
    this.inked[i] = signature(rec);
    this.inkedW[i] = rec?.w || 0;
    this.queued.delete(i);
  }
  /** Advance the mechanism. Returns the carriage/platen pose to render. */
  update(now, dt, {motion = true} = {}) {
    const {cols} = this.layout;
    // Ink that has reached the paper.
    if (this.pendingInk.length) {
      const keep = [];
      for (const p of this.pendingInk) {
        if (now >= p.at) this.inkNow(p.i); else keep.push(p);
      }
      this.pendingInk = keep;
    }
    if (!motion && (this.queue.length || this.pendingInk.length)) this.flush(now, {sample: false});
    if (this.queue.length && !this.paused) {
      const lag = now - this.queue[0].t;
      if (this.queue.length > MAX_PENDING || lag > MAX_LAG) this.flush(now);
    }
    // Where should the carriage and platen be?
    const head = this.queue[0];
    if (now < this.strikeHold) {
      // A bar is up: hold position until the escapement releases.
    } else if (head && !this.paused) {
      this.targetCol = head.i % cols;
      this.targetRow = Math.floor(head.i / cols);
    } else if (this.cursor && !this.queue.length) {
      this.targetCol = this.cursor.c;
      this.targetRow = this.cursor.r;
    }
    // Strike when positioned.
    if (head && !this.paused && now >= this.nextReady && now >= this.strikeHold &&
        Math.abs(this.colPos - this.targetCol) < 0.12 && Math.abs(this.rowPos - this.targetRow) < 0.08 && !this.feedOverride) {
      this.queue.shift();
      const rec = this.target[head.i];
      if (!isGlyph(rec)) {
        this.inkNow(head.i);
      } else {
        const backlog = this.queue.length;
        const k = Math.max(0.38, Math.min(1, 1.05 - backlog * 0.045));
        const hit = this.machine.barFor(rec.ch);
        const contact = this.machine.strike(hit.bar, now, k, hit.shift);
        this.pendingInk.push({i: head.i, at: now + contact});
        this.sound?.play('strike', {when: this.sound.at(now + contact), gain: 0.75 + 0.25 * k + (hit.shift ? 0.1 : 0), minGap: 0.012});
        const interval = Math.max(MIN_INTERVAL, BASE_INTERVAL * k - backlog * 0.002);
        this.nextReady = now + interval;
        this.strikeHold = now + contact + 0.018 * k;
        // Escapement: after release the carriage steps one letter space.
        this.escapeTo = (head.i % cols) + (rec.w || 1);
      }
    }
    if (now >= this.strikeHold && this.escapeTo !== undefined) {
      if (!this.queue.length && (!this.cursor || this.cursor.r === this.targetRow)) this.targetCol = Math.min(cols - 1, this.escapeTo);
      this.escapeTo = undefined;
    }
    return this.integrate(now, dt, motion);
  }
  integrate(now, dt, motion) {
    const {cols} = this.layout;
    const dCol = this.targetCol - this.colPos;
    // Carriage return: a long slide to the right (towards column 0).
    if (dCol < -2.5 && !this.returnActive) {
      this.returnActive = true;
      this.returnStart = now;
      this.sound?.play('returnSlide', {gain: 0.9, pan: -0.25});
    }
    let omega;
    if (this.returnActive) omega = now - this.returnStart < 0.06 ? 0 : 15;
    else if (dCol > 2.5) omega = 20;       // tab / jump: mainspring pulls it along
    else omega = dCol > 0 ? 70 : 42;       // escapement step / backspace
    if (!motion) { this.colPos = this.targetCol; this.colVel = 0; }
    else if (omega > 0) {
      [this.colPos, this.colVel] = spring(this.colPos, this.colVel, this.targetCol, omega, dt, this.returnActive ? 1.0 : 0.82);
    }
    if (this.returnActive && Math.abs(this.targetCol - this.colPos) < 0.35) {
      this.returnActive = false;
      this.colPos = this.targetCol; this.colVel = 0;
      this.sound?.play('returnStop', {gain: 0.8, pan: 0.3});
    }
    // Bell a few spaces before the right margin.
    const bellCol = cols - 8;
    if (this.bellArmed && this.colPos >= bellCol - 0.2 && this.targetCol >= bellCol) {
      this.bellArmed = false;
      this.sound?.play('bell', {gain: 0.55, pan: -0.35});
      this.onBell?.();
    } else if (this.colPos < bellCol - 3) this.bellArmed = true;
    // Line feed.
    const dRow = this.targetRow - this.rowPos;
    if (dRow > 0.5 && !this.lineFeeding) {
      this.lineFeeding = true;
      this.sound?.play('ratchet', {gain: 0.7, minGap: 0.04});
    }
    if (!motion) { this.rowPos = this.targetRow; this.rowVel = 0; }
    else [this.rowPos, this.rowVel] = spring(this.rowPos, this.rowVel, this.targetRow, this.returnActive ? 30 : 26, dt, 0.9);
    if (Math.abs(this.targetRow - this.rowPos) < 0.02) this.lineFeeding = false;
    // Return lever: pulled for the length of the slide, then springs back.
    const want = this.returnActive ? 1 : 0;
    const rate = want ? 1 / 0.07 : 1 / 0.16;
    this.leverPull = motion ? (want > this.leverPull ? Math.min(want, this.leverPull + rate * dt) : Math.max(want, this.leverPull - rate * dt)) : 0;
    return {col: this.colPos, row: this.rowPos, returnPull: this.leverPull};
  }
  get busy() { return this.queue.length > 0 || this.pendingInk.length > 0 || this.returnActive; }
}

function spring(x, v, target, omega, dt, zeta = 1) {
  // Semi-implicit damped spring, sub-stepped for stability.
  const steps = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -2 * zeta * omega * v - omega * omega * (x - target);
    v += a * h;
    x += v * h;
  }
  return [x, v];
}
