// Background music from the user's own files: a playlist kept in IndexedDB,
// one <audio> element routed through Web Audio for the visualiser, the
// turntable and the floating player. Mute applies to music too.
import {putMedia, deleteMedia, listMedia} from './media-store.js';

const id = () => `music-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const stripExt = name => name.replace(/\.[a-z0-9]{2,5}$/i, '');

export class MusicPlayer {
  constructor(sound) {
    this.sound = sound;
    this.tracks = [];            // {id, name, blob, url}
    this.index = 0;
    this.loop = 'all';           // 'all' | 'one'
    this.volume = 0.7;
    this.listeners = new Set();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => {
      if (this.loop === 'one') { this.audio.currentTime = 0; this.audio.play().catch(() => {}); }
      else this.next();
    });
    for (const ev of ['play', 'pause', 'loadedmetadata', 'durationchange']) this.audio.addEventListener(ev, () => this.changed());
    this.audio.addEventListener('error', () => {
      if (!this.audio.src) return;
      this.error = `无法播放“${this.current?.name || ''}”：浏览器不支持这个音频格式`;
      this.changed();
    });
    this.levels = new Float32Array(32);
  }
  get current() { return this.tracks[this.index] || null; }
  get playing() { return !this.audio.paused && !!this.audio.src; }
  get progress() { return this.audio.duration ? this.audio.currentTime / this.audio.duration : 0; }
  get time() { return this.audio.currentTime || 0; }
  get duration() { return this.audio.duration || 0; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this); }

  /** Restore the saved playlist (does not start playing). */
  async restore() {
    const saved = await listMedia('music');
    this.tracks = saved.map(r => ({id: r.id, name: r.name, blob: r.blob, url: null}));
    if (this.tracks.length) this.select(0, false);
    this.changed();
  }
  /** Add files chosen by the user; returns how many were accepted. */
  async add(files) {
    const list = [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name));
    const first = this.tracks.length;
    for (const f of list) {
      const t = {id: id(), name: stripExt(f.name), blob: f, url: null};
      this.tracks.push(t);
      await putMedia({id: t.id, kind: 'music', name: t.name, type: f.type, blob: f, order: Date.now() + this.tracks.length});
    }
    if (list.length && (!this.audio.src || first === 0)) this.select(first, true);
    this.changed();
    return list.length;
  }
  async remove(trackId) {
    const i = this.tracks.findIndex(t => t.id === trackId);
    if (i < 0) return;
    const [t] = this.tracks.splice(i, 1);
    if (t.url) URL.revokeObjectURL(t.url);
    await deleteMedia(trackId);
    if (i === this.index) {
      const was = this.playing;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      if (this.tracks.length) this.select(Math.min(i, this.tracks.length - 1), was);
    } else if (i < this.index) this.index--;
    this.changed();
  }
  select(i, play = true) {
    if (!this.tracks.length) return;
    this.index = (i + this.tracks.length) % this.tracks.length;
    const t = this.current;
    t.url ||= URL.createObjectURL(t.blob);
    this.error = null;
    this.audio.src = t.url;
    if (play) this.play();
    this.changed();
  }
  /** Must be called from a user gesture the first time (audio unlock). */
  play() {
    if (!this.tracks.length) return;
    if (!this.audio.src) { this.select(this.index, true); return; }
    this.connect();
    this.audio.play().catch(err => { if (err.name !== 'AbortError') { this.error = '浏览器阻止了自动播放，请再点一次播放'; this.changed(); } });
  }
  pause() { this.audio.pause(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  next() { if (this.tracks.length) this.select(this.index + 1, true); }
  prev() {
    if (!this.tracks.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.select(this.index - 1, true);
  }
  seek(frac) { if (this.audio.duration) this.audio.currentTime = frac * this.audio.duration; }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.setTargetAtTime(v, this.gain.context.currentTime, 0.05); else this.audio.volume = v; }
  setLoop(mode) { this.loop = mode; this.changed(); }

  connect() {
    this.sound.unlock();
    const ctx = this.sound.ctx;
    if (!ctx || this.source) return;
    try {
      this.source = ctx.createMediaElementSource(this.audio);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      this.audio.volume = 1;
      this.source.connect(this.analyser).connect(this.gain).connect(this.sound.musicBus);
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (err) {
      console.warn('music: Web Audio routing unavailable, playing directly', err);
    }
  }
  /** Smoothed loudness per band (0..1), log-spaced; also `level` overall. */
  sample(dt) {
    const L = this.levels;
    if (!this.analyser || !this.playing) {
      for (let i = 0; i < L.length; i++) L[i] *= Math.exp(-dt * 6);
      this.level = (this.level || 0) * Math.exp(-dt * 6);
      return L;
    }
    this.analyser.getByteFrequencyData(this.bins);
    const n = this.bins.length;
    let total = 0;
    for (let i = 0; i < L.length; i++) {
      const a = Math.floor(Math.pow(i / L.length, 1.9) * n * 0.7) + 1, b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / L.length, 1.9) * n * 0.7) + 1);
      let s = 0;
      for (let k = a; k < b; k++) s += this.bins[k];
      const v = s / (b - a) / 255;
      L[i] = Math.max(v, L[i] * Math.exp(-dt * 7));
      total += v;
    }
    this.level = total / L.length;
    return L;
  }
  dispose() {
    this.audio.pause();
    for (const t of this.tracks) if (t.url) URL.revokeObjectURL(t.url);
    this.source?.disconnect();
  }
}
