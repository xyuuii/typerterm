// Synthesised mechanical sound. Every buffer is computed here with modal
// synthesis (damped partials) and shaped, filtered noise; there are no
// recordings. Parameters were tuned by ear and are not measurements of a
// real machine.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

// RBJ biquad, applied in place.
function biquad(data, sr, type, freq, q = 0.707, gainDb = 0) {
  const w0 = 2 * Math.PI * freq / sr, cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'highpass': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
    default: return data;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
  return data;
}

function noise(n, seed) { const r = rng(seed); const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = r(); return d; }
function decayEnv(data, sr, attack, tau, offset = 0) {
  for (let i = 0; i < data.length; i++) {
    const t = i / sr - offset;
    data[i] *= t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / tau);
  }
  return data;
}
function mixInto(out, src, gain = 1, offsetSamples = 0) {
  for (let i = 0; i < src.length && i + offsetSamples < out.length; i++) out[i + offsetSamples] += src[i] * gain;
}
function modes(out, sr, partials, offset = 0) {
  const o = Math.round(offset * sr);
  for (const [f, amp, tau, phase = 0] of partials) {
    for (let i = o; i < out.length; i++) {
      const t = (i - o) / sr;
      out[i] += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t + phase) * Math.min(1, t / 0.0006);
    }
  }
}
function click(sr, len, seed, {hp = 1500, bp = 0, q = 1, tau = 0.0015} = {}) {
  const d = noise(Math.round(len * sr), seed);
  if (hp) biquad(d, sr, 'highpass', hp, 0.7);
  if (bp) biquad(d, sr, 'bandpass', bp, q);
  return decayEnv(d, sr, 0.0002, tau);
}
function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

const GEN = {
  strike(sr, v) {
    const r = rng(100 + v * 17);
    const out = new Float32Array(Math.round(0.2 * sr));
    // Impact through ribbon and paper on the rubber platen.
    mixInto(out, click(sr, 0.01, 11 + v, {hp: 1800, tau: 0.0011}), 0.9);
    const body = noise(Math.round(0.08 * sr), 23 + v);
    biquad(body, sr, 'bandpass', 2300 + r() * 600, 1.3);
    biquad(body, sr, 'peak', 900, 1, 6);
    mixInto(out, decayEnv(body, sr, 0.0005, 0.011 + r() * 0.003), 1.4);
    modes(out, sr, [[190 + r() * 40, 0.32, 0.022], [95, 0.12, 0.03], [3100 + r() * 300, 0.05, 0.035], [4700 + r() * 400, 0.03, 0.025], [6900, 0.015, 0.02]]);
    // Key returns and the escapement lets the carriage step.
    const k = Math.round((0.034 + r() * 0.008) * sr);
    mixInto(out, click(sr, 0.008, 51 + v, {hp: 900, bp: 1600, q: 0.9, tau: 0.003}), 0.22, k);
    const e = Math.round((0.05 + r() * 0.01) * sr);
    mixInto(out, click(sr, 0.006, 77 + v, {hp: 3000, bp: 5200, q: 1.5, tau: 0.0018}), 0.4, e);
    modes(out, sr, [[2850 + r() * 200, 0.05, 0.012]], e / sr);
    return normalize(out, 0.95);
  },
  key(sr, v) {
    const r = rng(300 + v);
    const out = new Float32Array(Math.round(0.12 * sr));
    const body = noise(Math.round(0.05 * sr), 31 + v);
    biquad(body, sr, 'bandpass', 1300 + r() * 300, 1.1);
    mixInto(out, decayEnv(body, sr, 0.0008, 0.008), 1);
    modes(out, sr, [[150 + r() * 20, 0.25, 0.016]]);
    mixInto(out, click(sr, 0.008, 61 + v, {hp: 1200, bp: 2100, q: 1, tau: 0.002}), 0.35, Math.round(0.04 * sr));
    return normalize(out, 0.6);
  },
  space(sr, v) {
    const out = new Float32Array(Math.round(0.16 * sr));
    const body = noise(Math.round(0.08 * sr), 41 + v);
    biquad(body, sr, 'bandpass', 760, 0.9);
    mixInto(out, decayEnv(body, sr, 0.001, 0.016), 1);
    modes(out, sr, [[118, 0.4, 0.03], [236, 0.1, 0.02]]);
    const e = Math.round(0.035 * sr);
    mixInto(out, click(sr, 0.006, 71 + v, {hp: 3000, bp: 5000, q: 1.4, tau: 0.002}), 0.55, e);
    modes(out, sr, [[2900, 0.06, 0.012]], e / sr);
    return normalize(out, 0.75);
  },
  escape(sr, v) {
    const out = new Float32Array(Math.round(0.05 * sr));
    mixInto(out, click(sr, 0.006, 81 + v, {hp: 3000, bp: 5400, q: 1.5, tau: 0.0016}), 1);
    modes(out, sr, [[2800 + v * 40, 0.12, 0.01]]);
    return normalize(out, 0.4);
  },
  ratchet(sr, v) {
    // Line-space pawl: two crisp clicks.
    const out = new Float32Array(Math.round(0.12 * sr));
    for (const [o, g] of [[0, 1], [0.045, 0.7]]) {
      mixInto(out, click(sr, 0.008, 91 + v + o * 100, {hp: 1500, bp: 2600, q: 1.2, tau: 0.0025}), g, Math.round(o * sr));
      modes(out, sr, [[1850 + v * 30, 0.08 * g, 0.015], [3300, 0.04 * g, 0.01]], o);
    }
    return normalize(out, 0.55);
  },
  returnSlide(sr) {
    // Lever ratchet, then the carriage runs back over the escapement rack.
    const dur = 0.42;
    const out = new Float32Array(Math.round(dur * sr));
    for (const o of [0, 0.03, 0.06]) mixInto(out, click(sr, 0.008, 5 + o * 300, {hp: 1500, bp: 2500, q: 1.2, tau: 0.002}), 0.55, Math.round(o * sr));
    const rush = noise(out.length, 7);
    biquad(rush, sr, 'bandpass', 650, 0.8);
    biquad(rush, sr, 'lowpass', 2000, 0.7);
    for (let i = 0; i < rush.length; i++) {
      const t = i / sr;
      const e = t < 0.08 ? 0 : Math.sin(Math.min(1, (t - 0.08) / (dur - 0.08)) * Math.PI);
      out[i] += rush[i] * e * 0.5;
    }
    // Pawl skipping over rack teeth: accelerating click train.
    let t = 0.09, rate = 90;
    let n = 0;
    while (t < dur - 0.03) {
      const c = click(sr, 0.004, 900 + n, {hp: 2500, bp: 4200, q: 2, tau: 0.0009});
      const env = Math.sin(Math.min(1, (t - 0.09) / (dur - 0.12)) * Math.PI);
      mixInto(out, c, 0.25 * env, Math.round(t * sr));
      t += 1 / rate; rate = Math.min(260, rate * 1.06); n++;
    }
    return normalize(out, 0.7);
  },
  returnStop(sr) {
    const out = new Float32Array(Math.round(0.3 * sr));
    const thud = noise(Math.round(0.08 * sr), 13);
    biquad(thud, sr, 'bandpass', 520, 0.9);
    mixInto(out, decayEnv(thud, sr, 0.0005, 0.02), 1);
    modes(out, sr, [[88, 0.6, 0.05], [176, 0.2, 0.04], [1420, 0.09, 0.11], [2330, 0.06, 0.09], [3710, 0.03, 0.06]]);
    mixInto(out, click(sr, 0.01, 17, {hp: 1200, tau: 0.0015}), 0.5);
    return normalize(out, 0.95);
  },
  bell(sr) {
    const out = new Float32Array(Math.round(1.6 * sr));
    const f = 2420;
    modes(out, sr, [[f, 0.5, 0.55], [f + 5, 0.3, 0.6, 1], [f * 2.32, 0.18, 0.28], [f * 4.25, 0.08, 0.14], [f * 6.63, 0.04, 0.08], [f * 0.5, 0.05, 0.3]]);
    mixInto(out, click(sr, 0.006, 3, {hp: 2000, tau: 0.001}), 0.3);
    return normalize(out, 0.7);
  },
  feed(sr) {
    // Turning the platen knob: soft detent clicks plus paper sliding.
    const dur = 0.7;
    const out = new Float32Array(Math.round(dur * sr));
    for (let t = 0.02, i = 0; t < dur - 0.04; t += 0.032 + (i % 3) * 0.004, i++) {
      mixInto(out, click(sr, 0.005, 200 + i, {hp: 1500, bp: 2400, q: 1.4, tau: 0.0018}), 0.35 * Math.sin(Math.PI * t / dur), Math.round(t * sr));
    }
    const rustle = noise(out.length, 19);
    biquad(rustle, sr, 'highpass', 2500, 0.6);
    const r = rng(5);
    let amp = 0;
    for (let i = 0; i < rustle.length; i++) {
      if (i % 220 === 0) amp = 0.4 + Math.abs(r()) * 0.6;
      rustle[i] *= amp * Math.sin(Math.PI * i / rustle.length) * 0.18;
    }
    mixInto(out, rustle, 1);
    return normalize(out, 0.55);
  },
  pull(sr) {
    const dur = 0.55;
    const out = noise(Math.round(dur * sr), 29);
    biquad(out, sr, 'bandpass', 2600, 0.5);
    biquad(out, sr, 'highpass', 900, 0.7);
    const r = rng(9);
    let amp = 1;
    for (let i = 0; i < out.length; i++) {
      if (i % 300 === 0) amp = 0.55 + Math.abs(r()) * 0.45;
      const t = i / out.length;
      out[i] *= amp * Math.pow(Math.sin(Math.PI * t), 1.5) * (1 - t * 0.4);
    }
    return normalize(out, 0.45);
  },
  chime(sr, v) {
    // Glass wind-chime: bright inharmonic partials with long decay.
    const out = new Float32Array(Math.round(2.4 * sr));
    const f = [2860, 3120, 2650, 3340][v % 4];
    modes(out, sr, [[f, 0.45, 0.9], [f * 1.003, 0.2, 1.0, 2], [f * 2.71, 0.16, 0.45], [f * 5.2, 0.06, 0.2], [f * 0.53, 0.05, 0.6]]);
    mixInto(out, click(sr, 0.004, 33 + v, {hp: 3000, tau: 0.0008}), 0.15);
    return normalize(out, 0.5);
  },
  bird(sr, v) {
    const out = new Float32Array(Math.round(0.9 * sr));
    const r = rng(500 + v);
    let t0 = 0;
    for (let n = 0; n < 2 + (v % 3); n++) {
      const len = 0.09 + Math.abs(r()) * 0.06, f0 = 3200 + r() * 600, sweep = 1400 + r() * 500;
      let phase = 0;
      const o = Math.round(t0 * sr);
      for (let i = 0; i < len * sr && o + i < out.length; i++) {
        const t = i / sr, k = t / len;
        const f = f0 + sweep * Math.sin(k * Math.PI) - k * 600;
        phase += 2 * Math.PI * f / sr;
        out[o + i] += Math.sin(phase + 0.6 * Math.sin(phase * 0.5)) * Math.sin(k * Math.PI) * 0.4;
      }
      t0 += len + 0.04 + Math.abs(r()) * 0.05;
    }
    return normalize(out, 0.3);
  },
};
const VARIANTS = {strike: 8, key: 4, space: 3, escape: 4, ratchet: 3, chime: 4, bird: 4};

function impulse(ctx) {
  const sr = ctx.sampleRate, len = Math.round(0.6 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = noise(len, 300 + ch);
    biquad(d, sr, 'lowpass', 5200, 0.6);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] *= Math.exp(-t / 0.13) * (t < 0.008 ? t / 0.008 : 1);
    }
    buf.copyToChannel(d, ch);
  }
  return buf;
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.volume = 0.8;
    this.ambientLevel = 0.5;
    this.muted = false;
    this.last = new Map();
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({latencyHint: 'interactive'});
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.002; comp.release.value = 0.12;
      this.master.connect(comp).connect(ctx.destination);
      this.dry = ctx.createGain(); this.dry.gain.value = 1;
      this.reverb = ctx.createConvolver(); this.reverb.buffer = impulse(ctx);
      this.wet = ctx.createGain(); this.wet.gain.value = 0.16;
      this.dry.connect(this.master);
      this.reverb.connect(this.wet).connect(this.master);
      this.ambient = ctx.createGain(); this.ambient.gain.value = this.ambientLevel;
      this.ambient.connect(this.master);
      this.ambient.connect(this.reverb);
      // The user's music bypasses the mechanical volume and compressor; mute still applies.
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.muted ? 0 : 1;
      this.musicBus.connect(ctx.destination);
      const sr = ctx.sampleRate;
      for (const [name, gen] of Object.entries(GEN)) {
        const n = VARIANTS[name] || 1;
        const list = [];
        for (let v = 0; v < n; v++) {
          const data = gen(sr, v);
          const buf = ctx.createBuffer(1, data.length, sr);
          buf.copyToChannel(data, 0);
          list.push(buf);
        }
        this.buffers.set(name, list);
      }
      this.startRoomTone();
      this.onVisibility = () => {
        // Keep running in a background tab while music plays.
        if (document.hidden) { if (!this.keepAwake?.()) this.ctx.suspend().catch(() => {}); }
        else this.ctx.resume().catch(() => {});
      };
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  startRoomTone() {
    // Very quiet brown-noise room tone, part of the ambient bus.
    const ctx = this.ctx, sr = ctx.sampleRate, len = sr * 4;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const r = rng(42);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * r()) / 1.02; d[i] = last * 3.2; }
    // Crossfade the loop seam.
    for (let i = 0; i < 2000; i++) { const k = i / 2000; d[len - 2000 + i] = d[len - 2000 + i] * (1 - k) + d[i] * k; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    src.connect(lp).connect(g).connect(this.ambient);
    src.start();
    this.roomTone = src;
    this.birdTimer = setInterval(() => {
      if (!this.ready || this.muted || this.ambientLevel <= 0) return;
      if (Math.random() < 0.28) this.play('bird', {bus: 'ambient', gain: 0.12 + Math.random() * 0.1, pan: -0.6 + Math.random() * 0.3, rate: 0.9 + Math.random() * 0.2});
    }, 4200);
  }
  /**
   * Plays a named sound. when: AudioContext time (defaults to now).
   * Rapid repeats of the same name are thinned to avoid machine-gunning.
   */
  play(name, {when = 0, gain = 1, rate = 0, pan = 0, bus = 'mech', minGap = 0} = {}) {
    if (!this.ready) return;
    const list = this.buffers.get(name);
    if (!list) return;
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, when || 0);
    if (minGap && t - (this.last.get(name) || 0) < minGap) return;
    this.last.set(name, t);
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate || (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    g.gain.value = gain * (0.9 + Math.random() * 0.2);
    let node = src.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
    if (bus === 'ambient') node.connect(this.ambient);
    else { node.connect(this.dry); node.connect(this.reverb); }
    src.start(t);
  }
  /** Converts a performance.now()-based time (seconds) to AudioContext time. */
  at(perfSeconds) {
    if (!this.ctx) return 0;
    return this.ctx.currentTime + Math.max(0, perfSeconds - performance.now() / 1000);
  }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setAmbient(v) { this.ambientLevel = v; if (this.ambient) this.ambient.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.03);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
  dispose() {
    clearInterval(this.birdTimer);
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    try { this.roomTone?.stop(); } catch { /* already stopped */ }
    this.ctx?.close();
  }
}
