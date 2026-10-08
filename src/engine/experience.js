// Orchestrates the scene, the terminal and the machine.
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Terminal} from '@xterm/xterm';
import {ToonPipeline} from './toon.js';
import {createRoom, ROOM} from './room.js';
import {createTypewriter} from './typewriter.js';
import {LiveSheet, StackSheet} from './paper.js';
import {PaperPath, PAPER_R, S_BACK, S_EXIT, STRIKE} from './geometry.js';
import {makeLayout, renderPage, pageText, FORMATS, PAPER_COLORS} from './ink.js';
import {PageTracker} from './pages.js';
import {Mechanism} from './mechanism.js';
import {SoundEngine} from './sound.js';
import {DemoShell} from './demo-shell.js';
import {SshSession} from './session.js';
import {canvasesToPdf} from './pdf.js';
import {Sparkles, readScreen} from './magic.js';
import {MusicPlayer} from './music.js';
import {QUALITY, renderPixelRatio, FramePacer, AutoQuality} from './performance.js';

// Each view frames a subject box (half width/height, world units) around a
// target, seen from a direction; the distance is fitted to the viewport.
const VIEWS = {
  desk: {target: [-3.4, 3.4, -1.6], dir: [0.354, 0.393, 0.847], half: [13.5, 9.4]},
  paper: {target: [0, 4.6, -1.75], dir: [0.04, 0.6, 0.8], half: [3.7, 3.1]},
  room: {target: [-4.5, 6, -1.5], dir: [0.52, 0.36, 0.78], half: [18, 11]},
};
const STACK_LIMIT = 8;

export class InkExperience {
  constructor({container, terminalElement, onInfo, onConnection, onPageArchived, quality = 'auto'}) {
    this.container = container;
    this.terminalElement = terminalElement;
    this.onInfo = onInfo || (() => {});
    this.onConnection = onConnection || (() => {});
    this.onPageArchived = onPageArchived || (() => {});
    this.mode = 'demo';
    this.motion = true;
    this.qualityMode = QUALITY[quality] ? quality : 'auto';
    this.quality = this.qualityMode === 'auto' ? 'medium' : this.qualityMode;
    this.framePacer = new FramePacer();
    this.autoQuality = new AutoQuality();
    this.formatId = 'a4';
    this.paperColor = PAPER_COLORS[0].color;
    this.platenAngle = 0;
    this.stack = [];
    this.disposed = false;
    this.lastActive = 0;
    this.info = {};
    this.baseFov = 34;
    this.magicResize = true;              // grow the grid for full-screen programs
    this.magicSize = {cols: 80, rows: 24};   // btop's minimum, the classic terminal size
    this.cursorVisible = true;
    this.alternate = false;
    this.screenCache = {};
    this.insets = {right: 0, bottom: 0};
    this.insetTarget = {right: 0, bottom: 0};
    this.sound = new SoundEngine();
  }

  async init() {
    const {container} = this;
    // ---- renderer ----------------------------------------------------------
    try {
      this.renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance'});
    } catch (err) {
      this.has3D = false;
      throw new Error('此浏览器无法创建 WebGL 上下文：' + err.message);
    }
    this.has3D = true;
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;   // soft edges come from shadow.radius
    r.shadowMap.autoUpdate = false;          // refreshed in frame(): every frame only while things move
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.2, 4000);
    this.camera.layers.enableAll();
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, {enableDamping: true, dampingFactor: 0.08, minDistance: 6, maxDistance: 44, maxPolarAngle: Math.PI * 0.47, minPolarAngle: 0.18, enablePan: true, panSpeed: 0.6, rotateSpeed: 0.7, zoomSpeed: 0.8, screenSpacePanning: true});
    this.controls.minAzimuthAngle = -1.15;
    this.controls.maxAzimuthAngle = 1.1;
    // Only an actual drag/zoom counts as the user placing the camera; a plain
    // click (e.g. on the paper to focus it) must not.
    this.controls.addEventListener('start', () => { this.orbiting = true; this.touch(); });
    this.controls.addEventListener('change', () => { if (this.orbiting && !this.userMoved) { this.userMoved = true; this.cameraTween = null; } });
    this.controls.addEventListener('end', () => { this.orbiting = false; });
    this.setView('desk', true);

    // ---- world -------------------------------------------------------------
    this.room = createRoom(this.scene, {quality: this.quality});
    this.room.setRenderer(r);
    // Wait (briefly) for the downloaded assets: cat model and framed prints.
    await Promise.race([this.room.ready, new Promise(resolve => setTimeout(resolve, 5000))]);
    this.machine = await createTypewriter();
    this.scene.add(this.machine.root);
    this.pipeline = new ToonPipeline(r, this.scene, this.camera);
    this.pipeline.setQuality(this.quality);
    this.sparkles = new Sparkles(this.scene);
    this.room.onLineColor(color => this.pipeline.setLineColor(color));
    this.room.onChime(gust => this.sound.play('chime', {bus: 'ambient', gain: 0.18 + gust * 0.25, pan: -0.7, rate: 0.98 + Math.random() * 0.06}));
    this.path = new PaperPath(0.6);

    // ---- terminal ------------------------------------------------------------
    this.layout = makeLayout(this.formatId);
    this.term = new Terminal({
      cols: this.layout.cols, rows: this.layout.rows, scrollback: 5000, allowProposedApi: true,
      fontFamily: '"Courier Prime", "Courier New", "Songti SC", "STSong", monospace', fontSize: 15, lineHeight: 1.18,
      cursorBlink: true, cursorStyle: 'underline', convertEol: false, rightClickSelectsWord: true,
      theme: {
        background: '#f6eedb', foreground: '#2b2622', cursor: '#c4563f', cursorAccent: '#f6eedb', selectionBackground: '#e9c79a',
        black: '#2b2622', red: '#a7392f', green: '#3f6b47', yellow: '#8d6a2a', blue: '#35577a', magenta: '#7a4466', cyan: '#367271', white: '#9a8f7d',
        brightBlack: '#5e5650', brightRed: '#c4483c', brightGreen: '#4f8a57', brightYellow: '#b08a3c', brightBlue: '#4c78a3', brightMagenta: '#a05f88', brightCyan: '#4d9693', brightWhite: '#d8ccb4',
      },
    });
    this.term.open(this.terminalElement);
    this.pages = new PageTracker(this.term, this.layout, {paperColor: this.paperColor, onArchive: page => this.onPageArchived(page, this.pages.archive)});
    this.mechanism = new Mechanism({layout: this.layout, machine: this.machine, sound: this.sound, now: performance.now() / 1000});
    // Things a typewriter cannot do (erasing, overwriting) happen by magic.
    this.mechanism.onMagic = (r, c) => this.magicCorrection(r, c);
    this.mechanism.onBell = () => this.room?.catReact();
    this.music = new MusicPlayer(this.sound);
    this.sound.keepAwake = () => this.music.playing;
    this.musicState = {count: 0, index: 0, title: '', playing: false, progress: 0, time: 0, duration: 0, levels: this.music.levels, level: 0, error: null, loop: 'all'};
    this.demo = new DemoShell(data => this.term.write(data), {size: () => ({cols: this.term.cols, rows: this.term.rows})});
    this.session = new SshSession({
      term: this.term,
      onStatus: s => this.onConnection(s),
      onState: (state, message) => this.sessionState(state, message),
    });
    const t = this.term;
    this.subs = [
      t.onData(data => this.input(data)),
      t.onBinary(data => { if (this.mode === 'ssh') this.session.send(Uint8Array.from(data, c => c.charCodeAt(0) & 255)); }),
      t.onWriteParsed(() => this.parsed()),
      t.onBell(() => { this.sound.play('bell', {gain: 0.5}); this.room?.catReact(); }),
      t.buffer.onBufferChange(() => this.bufferChanged()),
      t.parser.registerCsiHandler({final: 'J'}, params => {
        const p = params[0];
        if ((p === 2 || p === 3) && t.buffer.active.type === 'normal') this.clearRequested();
        return false;   // let xterm perform the erase
      }),
      // xterm does not expose cursor visibility, so follow DECTCEM ourselves.
      t.parser.registerCsiHandler({prefix: '?', final: 'h'}, params => { if (params.includes(25)) this.cursorVisible = true; return false; }),
      t.parser.registerCsiHandler({prefix: '?', final: 'l'}, params => { if (params.includes(25)) this.cursorVisible = false; return false; }),
    ];
    t.attachCustomKeyEventHandler(e => this.keyEvent(e));
    this.textarea = t.textarea;
    this.onFocus = () => { this.focused = true; this.updateOverlay(); this.emit({focused: true}); };
    this.onBlur = () => { this.focused = false; this.updateOverlay(); this.emit({focused: false}); };
    this.onCompose = e => { this.composeText = e.type === 'compositionend' ? '' : e.data || ''; this.updateOverlay(); };
    this.textarea.addEventListener('focus', this.onFocus);
    this.textarea.addEventListener('blur', this.onBlur);
    for (const ev of ['compositionstart', 'compositionupdate', 'compositionend']) this.textarea.addEventListener(ev, this.onCompose);

    // ---- first sheet -----------------------------------------------------------
    this.pages.startAtCursor();
    this.sheet = this.newSheet();
    this.sheet.setFeed(this.layout.rowV(0));
    this.mechanism.attachSheet(this.sheet);
    this.demo.welcome();

    // ---- events --------------------------------------------------------------------
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();   // glass and glowing things live on the no-outline layer
    this.onPointerDown = e => { this.down = {x: e.clientX, y: e.clientY}; this.sound.unlock(); this.touch(); };
    this.onMouseDown = e => { if (this.focused) e.preventDefault(); };   // keep terminal focus while orbiting
    this.onPointerUp = e => this.click(e);
    this.onPointerMove = e => { this.hoverEvent = e; };
    this.onPointerLeave = () => { this.hoverEvent = null; this.setHover(null); };
    r.domElement.addEventListener('pointerdown', this.onPointerDown);
    r.domElement.addEventListener('mousedown', this.onMouseDown);
    r.domElement.addEventListener('pointerup', this.onPointerUp);
    r.domElement.addEventListener('pointermove', this.onPointerMove);
    r.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    // Chrome can stop RAF entirely in a background tab. Reset on the event,
    // rather than treating time spent away as a slow frame after returning.
    this.onVisibilityChange = () => {
      this.framePacer.reset();
      this.autoQuality.reset();
      this.prev = undefined;
      this.lastShadowUpdate = -Infinity;
      this.touch();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
    this.applyQuality();
    this.emit({ready: true, mode: this.mode, format: this.formatId, cols: this.layout.cols, rows: this.layout.rows, pages: 0, quality: this.quality, qualityMode: this.qualityMode});
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---- sheets ------------------------------------------------------------------------
  newSheet() {
    const sheet = new LiveSheet(this.layout, this.paperColor, this.path, (Math.random() * 1e9) | 0);
    // Archive and PDF reuse the sheet's seed so the ink jitter matches what was on screen.
    this.pages.currentSeed = sheet.seed;
    this.machine.carriage.add(sheet.mesh);
    sheet.mesh.userData.sheet = true;
    return sheet;
  }
  sheetHasInk() { return this.mechanism.inked.some(s => s !== ''); }
  /** Make the sheet in the machine show exactly an archived page before it leaves. */
  settleSheet(page) {
    if (!page) return;
    const {rows, cols} = this.mechanism.layout;
    if (makeLayout(page.format).cols !== cols) return;
    const grid = new Array(rows * cols).fill(null);
    page.rows.forEach((row, r) => { for (const [c, rec] of row) if (r < rows && c < cols) grid[r * cols + c] = rec; });
    this.mechanism.sync(grid, null, performance.now() / 1000);
  }
  /** Feed the current sheet out, lay it on the stack and roll in a new one. */
  changeSheet({eject = true, instant = false} = {}) {
    const now = performance.now() / 1000;
    this.finishChangeNow(now);
    this.mechanism.flush(now, {sample: false});
    const old = this.sheet;
    const doEject = eject && this.sheetHasInk();
    this.change = {
      phase: doEject ? 'out' : 'in', start: now, old: doEject ? old : null,
      outFrom: old.sTop, outTo: old.layout.H + S_EXIT + 0.35,
      next: null, instant: instant || !this.motion,
    };
    if (!doEject) { old.dispose(); this.sheet = null; }
    else this.sound.play('feed', {gain: 0.55});
    this.mechanism.feedOverride = true;
    this.touch();
  }
  /** Complete an in-flight sheet change immediately. */
  finishChangeNow(now) {
    const c = this.change;
    if (!c) return;
    if (c.old) { this.toStack(c.old, now, true); c.old = null; }
    if (!c.next) {
      c.next = this.newSheet();
      this.sheet = c.next;
      this.mechanism.attachSheet(c.next);
    }
    const cursor = this.pages.cursorOnPage();
    c.next.setFeed(this.layout.rowV(cursor ? cursor.r : 0));
    this.mechanism.rowPos = cursor ? cursor.r : 0;
    this.change = null;
    this.mechanism.feedOverride = null;
    this.dirty = true;
  }
  stepChange(now, dt) {
    const c = this.change;
    if (!c) return;
    const dur = c.instant ? 0.001 : c.phase === 'out' ? 0.55 : 0.85;
    const k = Math.min(1, (now - c.start) / dur);
    const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    if (c.phase === 'out') {
      const s = c.outFrom + (c.outTo - c.outFrom) * ease;
      this.platenAngle -= (s - c.old.sTop) / PAPER_R;
      c.old.setFeed(s);
      if (k >= 1) {
        this.toStack(c.old, now, c.instant);
        c.old = null;
        c.phase = 'in';
        c.start = now;
      }
      return;
    }
    if (!c.next) {
      c.next = this.newSheet();
      this.sheet = c.next;
      c.next.setFeed(S_BACK - 1.6);
      c.from = S_BACK - 1.6;
      this.mechanism.attachSheet(c.next);
      if (!c.instant) this.sound.play('feed', {gain: 0.5, rate: 0.95});
    }
    const cursor = this.pages.cursorOnPage();
    const to = this.layout.rowV(cursor ? cursor.r : 0);
    const s = c.from + (to - c.from) * ease;
    this.platenAngle -= (s - c.next.sTop) / PAPER_R;
    c.next.setFeed(s);
    this.mechanism.rowPos = cursor ? cursor.r : 0;
    if (k >= 1) {
      this.change = null;
      this.mechanism.feedOverride = null;
      this.dirty = true;
    }
  }
  toStack(sheet, now, instant) {
    const nx = 10, ny = Math.max(6, Math.round(10 * sheet.layout.H / sheet.layout.W));
    const grid = sheet.sampleGrid(nx, ny, this.machine.carriage.position.x);
    const S = ROOM.stack;
    const jitter = (Math.random() - 0.5);
    const stackSheet = new StackSheet(this.scene, {
      canvas: sheet.snapshot(0.5), layout: sheet.layout, paperColor: sheet.paperColor, grid, nx, ny,
      target: {x: S.x + jitter * 0.4, z: S.z + (Math.random() - 0.5) * 0.4, rot: S.rot + jitter * 0.18},
      index: this.stack.length, now, instant,
    });
    stackSheet.mesh.userData.stack = true;
    this.stack.push(stackSheet);
    if (this.stack.length > STACK_LIMIT) {
      const gone = this.stack.shift();
      gone.dispose();
    }
    sheet.dispose();
    if (!instant) this.sound.play('pull', {gain: 0.6});
  }

  // ---- terminal flow -------------------------------------------------------------------
  write(data) { this.term.write(data); }
  input(data) {
    this.touch();
    if (this.mode === 'ssh') { this.session.send(new TextEncoder().encode(data)); return; }
    if (this.mode === 'connecting') return;
    this.demo.data(data);
  }
  parsed() {
    // Page accounting happens per parse so no completed page can scroll away.
    if (this.term.buffer.active.type === 'normal') {
      if (this.pendingClear) {
        this.pendingClear = false;
        this.pages.startAtCursor();
        this.settleSheet(this.clearedPage);
        this.clearedPage = null;
        this.changeSheet();
      }
      const done = this.pages.check();
      if (done) this.pageCompleted(done);
    }
    this.dirty = true;
  }
  pageCompleted(count) {
    const archive = this.pages.archive;
    const completed = archive.slice(-count);
    if (this.change) {
      // Output is outrunning the animation: lay these sheets down at once.
      for (const page of completed) this.instantStack(page);
    } else {
      // The sheet in the machine is the first completed page; any further
      // pages that filled in the same burst go straight onto the stack.
      this.settleSheet(completed[0]);
      for (const page of completed.slice(1)) this.instantStack(page);
      this.changeSheet();
    }
    this.emit({toast: {kind: 'page', page: archive[archive.length - 1]}});
  }
  instantStack(page) {
    if (!page) return;
    const canvas = renderPage(page, 0.5);
    const layout = makeLayout(page.format);
    const tmp = {layout, paperColor: page.paperColor, snapshot: () => canvas, sampleGrid: (nx, ny) => {
      const pts = new Float32Array((nx + 1) * (ny + 1) * 3);
      for (let j = 0, k = 0; j <= ny; j++) for (let i = 0; i <= nx; i++, k += 3) { pts[k] = (i / nx - 0.5) * layout.W; pts[k + 1] = 6 - j / ny * layout.H; pts[k + 2] = -2; }
      return pts;
    }, dispose() {}};
    this.toStack(tmp, performance.now() / 1000, true);
  }
  clearRequested() {
    const now = performance.now() / 1000;
    // Repeated full-screen clears (watch-style redraws) stay digital.
    if (now - (this.lastClear || -10) < 2) return;
    this.lastClear = now;
    const page = this.pages.archiveVisible('clear');
    if (page) this.emit({toast: {kind: 'page', page}});
    this.clearedPage = page;
    this.pendingClear = true;
  }
  bufferChanged() {
    const alt = this.term.buffer.active.type === 'alternate';
    const now = performance.now() / 1000;
    if (alt === this.alternate) return;
    this.alternate = alt;
    if (alt) this.enterMagic(now);
    else this.leaveMagic(now);
    this.dirty = true;
    this.emit({alternate: alt});
  }
  /**
   * A full-screen program took over (alternate buffer): the sheet in the
   * machine becomes a live screen — fed up so the whole screen is readable,
   * with magic glow where cells change.
   */
  enterMagic(now) {
    if (this.change) this.finishChangeNow(now);
    this.mechanism.flush(now, {sample: false});
    this.mechanism.paused = true;
    const {cols, rows} = this.magicSize;
    if (this.magicResize && (this.term.cols < cols || this.term.rows < rows)) {
      this.term.resize(Math.max(cols, this.term.cols), Math.max(rows, this.term.rows));
      this.sendSize();
    }
    this.sheet.enterAlt(this.term.cols, this.term.rows);
    this.altFeed = this.sheet.altBlockBottom() + S_EXIT + 0.18;
    const p = new THREE.Vector3(0, STRIKE.y + 0.4, STRIKE.z + 0.1);
    this.sparkles.spawn(p, now, {count: 36, spread: 3.2, speed: 0.9, color: 0xffd98a, size: 26});
    this.sound.play('chime', {gain: 0.45, rate: 1.1});
    this.sound.play('feed', {gain: 0.5});
    this.cameraBeforeMagic = {view: this.view, userMoved: this.userMoved, pos: this.camera.position.clone(), target: this.controls.target.clone()};
    this.frameAltScreen();
    this.lastMagicRead = 0;
  }
  /** Point the camera squarely at the screen block once it is fed up. */
  frameAltScreen() {
    const saved = this.sheet.sTop;
    this.sheet.sTop = this.altFeed;                 // frame the final position
    const f = this.sheet.altFrame(this.machine.carriage.position.x);
    this.sheet.sTop = saved;
    if (!f) { this.setView('paper'); return; }
    const dir = new THREE.Vector3(...f.normal).add(new THREE.Vector3(0, 0.12, 0)).normalize();
    this.setViewSpec({target: f.center, dir: dir.toArray(), half: [f.width / 2 + 0.35, f.height / 2 + 0.55]});
  }
  leaveMagic(now) {
    this.sheet?.exitAlt();
    this.sound.play('chime', {gain: 0.3, rate: 0.9});
    if (this.term.cols !== this.layout.cols || this.term.rows !== this.layout.rows) {
      this.term.resize(this.layout.cols, this.layout.rows);
      this.sendSize();
    }
    this.mechanism.paused = false;
    this.pages.check();
    this.mechanism.snapTo(this.pages.readGrid(false));
    const before = this.cameraBeforeMagic;
    if (!before || !before.userMoved) this.setView(before?.view || 'desk');
    else {
      // The user had placed the camera themselves: go back exactly there.
      this.viewSpec = null;
      this.cameraTween = {from: this.camera.position.clone(), to: before.pos, tf: this.controls.target.clone(), tt: before.target, start: now};
      this.userMoved = true;
    }
  }
  sendSize() {
    if (this.mode === 'ssh') this.session.resize(this.term.cols, this.term.rows, this.container.clientWidth, this.container.clientHeight);
  }
  /** Erasing/overwriting on paper: a short glow and a few sparkles. */
  magicCorrection(r, c) {
    if (!this.sheet || !this.motion) return;
    const now = performance.now() / 1000;
    this.sheet.glowCell(r, c);
    if (now - (this.lastCorrectionSpark || 0) > 0.03) {
      this.lastCorrectionSpark = now;
      const p = this.sheet.cellWorld(r, c, this.machine.carriage.position.x, new THREE.Vector3());
      this.sparkles.spawn(p, now, {count: 3, spread: 0.08, speed: 0.25, color: 0xffe2a0, size: 16, life: 0.8});
    }
  }
  syncPaper(now) {
    if (this.alternate) {
      // Live full-screen program on the sheet (≤30 reads/s, never in the
      // middle of a synchronized-output frame).
      if (!this.sheet?.alt || !this.dirty || now - this.lastMagicRead < 1 / 30) return;
      if (this.term.modes.synchronizedOutputMode) return;
      this.lastMagicRead = now;
      this.dirty = false;
      const screen = readScreen(this.term, this.screenCache);
      const b = this.term.buffer.active;
      const cursor = this.cursorVisible && b.cursorX < screen.cols ? {r: b.cursorY, c: b.cursorX} : null;
      const changed = this.sheet.altUpdate(screen, cursor);
      if (changed.length && this.motion) {
        const v = new THREE.Vector3();
        const cx = this.machine.carriage.position.x;
        const n = Math.min(changed.length, 10);
        for (let k = 0; k < n; k++) {
          const i = changed[Math.floor(Math.random() * changed.length)];
          this.sparkles.spawn(this.sheet.altCellWorld(i, cx, v), now, {count: 1, spread: 0.04, speed: 0.22, color: Math.random() < 0.6 ? 0xffd890 : 0xbfe0ff, size: 15, life: 0.9});
        }
        if (now - (this.lastMagicSound || 0) > 0.3 && changed.length > 2) {
          this.lastMagicSound = now;
          this.sound.play('chime', {gain: Math.min(0.14, 0.03 + changed.length / 2500), rate: 1.4 + Math.random() * 0.3, minGap: 0.25});
        }
      }
      return;
    }
    if (!this.dirty || this.change) return;
    this.dirty = false;
    this.mechanism.sync(this.pages.readGrid(false), this.pages.cursorOnPage(), now);
    this.updateOverlay();
  }
  updateOverlay() {
    if (!this.sheet) return;
    const cur = this.pages?.cursorOnPage(this.alternate);
    const items = [];
    if (cur && this.focused) {
      items.push({type: 'caret', r: cur.r, c: cur.c});
      if (this.composeText) items.push({type: 'compose', r: cur.r, c: cur.c, text: this.composeText});
    }
    const key = JSON.stringify(items);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.sheet.setOverlay(items);
  }
  keyEvent(e) {
    if (e.type !== 'keydown') return true;
    this.sound.unlock();
    this.touch();
    const now = performance.now() / 1000;
    const name = keyName(e);
    if (name && !e.isComposing) {
      this.machine.pressKey(name, now);
      if (name === 'SPACE') this.sound.play('space', {gain: 0.55});
      else if (name !== 'SHIFT') this.sound.play('key', {gain: 0.32, minGap: 0.02});
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      navigator.clipboard?.writeText(this.term.getSelection()).catch(() => {});
      return false;
    }
    return true;
  }
  click(e) {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.machine.keyMeshes, false)[0];
    if (hit) {
      const key = hit.object.userData.key;
      const now = performance.now() / 1000;
      this.focus();
      if (key === 'SHIFT') { this.stickyShift = !this.stickyShift; this.machine.pressKey('SHIFT', now); this.sound.play('key', {gain: 0.4}); return; }
      const map = {SPACE: ' ', RETURN: '\r', BACKSPACE: '\x7f', TAB: '\t'};
      let data = map[key] ?? key;
      if (this.stickyShift && data.length === 1) { data = SHIFTED[data] || data.toUpperCase(); this.stickyShift = false; }
      this.machine.pressKey(key === 'RETURN' ? 'SPACE' : key, now);
      if (key === 'SPACE') this.sound.play('space', {gain: 0.55});
      else if (key !== 'RETURN') this.sound.play('key', {gain: 0.32});
      this.term.input(data, true);
      return;
    }
    const meshes = [this.sheet?.mesh, ...this.stack.map(s => s.mesh)].filter(Boolean);
    const target = this.raycaster.intersectObjects([...meshes, ...this.interactiveMeshes()], false)[0];
    const what = target && this.interactive(target);
    if (what) { this.activate(what); return; }
    if (target?.object.userData.stack) this.emit({openPages: true});
    else if (target) this.focus();
  }

  // ---- things on the walls: picture slots and the music player ----------------------------
  interactiveMeshes() { return [this.room.player.card, ...this.room.slots.map(s => s.mesh)]; }
  interactive(hit) {
    if (hit.object === this.room.player.card) {
      const h = this.room.player.hit(hit.uv);
      return h && {kind: 'music', ...h, label: this.music.tracks.length ? '音乐播放器 · 点按钮控制，点空白处打开列表' : '音乐播放器 · 点击添加你的音乐'};
    }
    const slot = this.room.slots.find(s => s.mesh === hit.object);
    return slot && {kind: 'slot', id: slot.id, label: `${slot.label} · 点击换成你的图片`};
  }
  activate(what) {
    this.sound.unlock();
    if (what.kind === 'slot') { this.emit({pickImage: what.id}); return; }
    const m = this.music;
    switch (what.action) {
      case 'toggle': if (m.tracks.length) m.toggle(); else this.emit({music: 'add'}); break;
      case 'prev': m.prev(); break;
      case 'next': m.next(); break;
      case 'seek': m.seek(what.value); break;
      case 'add': this.emit({music: 'add'}); break;
      default: this.emit({music: 'open'});
    }
  }
  pointerHover(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const blockers = [this.sheet?.mesh, ...this.machine.keyMeshes].filter(Boolean);
    const hit = this.raycaster.intersectObjects([...blockers, ...this.interactiveMeshes()], false)[0];
    const what = hit && this.interactive(hit);
    this.setHover(what ? {...what, x: e.clientX, y: e.clientY} : null);
  }
  setHover(what) {
    this.room?.player.setHover(what?.kind === 'music' ? what.action : null);
    this.renderer.domElement.style.cursor = what ? 'pointer' : '';
    const key = what ? `${what.kind}:${what.id || what.action}` : '';
    if (key !== this.hoverKey || what) this.emit({hover: what ? {label: what.label, x: what.x, y: what.y} : null});
    this.hoverKey = key;
  }
  updateMusic(dt) {
    const m = this.music, st = this.musicState;
    m.sample(dt);
    st.count = m.tracks.length; st.index = m.index; st.title = m.current?.name || '';
    st.playing = m.playing; st.progress = m.progress; st.time = m.time; st.duration = m.duration;
    st.level = m.level || 0; st.error = m.error; st.loop = m.loop;
    this.room.setMusic(st);
    if (st.playing) this.touch();
  }
  /** Crop a picture to a slot (cover), show it, and return a JPEG for storage. */
  async setSlotImage(id, blob) {
    const slot = this.room.slots.find(s => s.id === id);
    if (!slot) return null;
    const bmp = await createImageBitmap(blob);
    let cw = bmp.width, ch = bmp.width / slot.aspect;
    if (ch > bmp.height) { ch = bmp.height; cw = ch * slot.aspect; }
    const scale = Math.min(1, 1600 / Math.max(cw, ch));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cw * scale)); canvas.height = Math.max(1, Math.round(ch * scale));
    canvas.getContext('2d').drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    this.room.setSlotCanvas(id, canvas);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }
  resetSlot(id) { this.room.setSlotCanvas(id, null); }
  /** The picture currently shown in a slot (image, canvas or bitmap), for thumbnails. */
  slotPicture(id) { return this.room.slots.find(s => s.id === id)?.material.map?.image || null; }
  get slots() { return this.room.slots.map(({id, label, aspect}) => ({id, label, aspect})); }

  // ---- session ------------------------------------------------------------------------------
  connect(config) {
    this.demo.reset();
    this.term.write('', () => {
      this.resetForSession();
      this.session.connect(config, {cols: this.layout.cols, rows: this.layout.rows});
    });
  }
  resetForSession() {
    // Finish the current sheet, then start the new session on a clean terminal.
    if (this.term.buffer.active.type === 'normal') {
      const page = this.pages.breakPage('session');
      if (page) this.emit({toast: {kind: 'page', page}});
      this.settleSheet(page);
    }
    this.term.reset();
    this.cursorVisible = true;
    this.pages.startAtCursor();
    this.changeSheet();
    this.composeText = '';
  }
  sessionState(state, message) {
    if (state === 'connecting') this.mode = 'connecting';
    else if (state === 'ssh') { this.mode = 'ssh'; this.focus(); this.resize(); }
    else if (state === 'closed') {
      const wasLive = this.mode !== 'demo';
      this.mode = 'demo';
      if (wasLive) {
        this.term.write('', () => {
          this.resetForSession();
          this.demo.reset();
          this.term.write(`\x1b[2m[${message || '连接已关闭'} · 回到演示模式]\x1b[0m\r\n\r\n`);
          this.demo.prompt();
        });
      }
    }
    this.emit({mode: this.mode});
  }
  verifyHost(accept) { this.session.verifyHost(accept); }
  disconnect() { this.session.disconnect(true); }

  // ---- settings -----------------------------------------------------------------------------
  setFormat(id) {
    if (!FORMATS[id] || id === this.formatId) return;
    if (this.term.buffer.active.type !== 'normal') return;
    const now = performance.now() / 1000;
    this.mechanism.flush(now, {sample: false});
    const page = this.pages.breakPage('format');
    if (page) this.emit({toast: {kind: 'page', page}});
    this.settleSheet(page);
    this.formatId = id;
    this.layout = makeLayout(id);
    this.term.resize(this.layout.cols, this.layout.rows);
    this.pages.setLayout(this.layout);
    this.pages.startAtCursor();
    // Eject with the old layout, then switch the mechanism to the new grid.
    this.changeSheet();
    this.mechanism.setLayout(this.layout);
    this.mechanism.colPos = Math.min(this.mechanism.colPos, this.layout.cols - 1);
    this.mechanism.rowPos = 0;
    this.session.resize(this.layout.cols, this.layout.rows, this.container.clientWidth, this.container.clientHeight);
    this.emit({format: id, cols: this.layout.cols, rows: this.layout.rows});
  }
  newPage() {
    if (this.term.buffer.active.type !== 'normal') return;
    this.mechanism.flush(performance.now() / 1000, {sample: false});
    const page = this.pages.breakPage('manual');
    if (page) this.emit({toast: {kind: 'page', page}});
    this.settleSheet(page);
    this.changeSheet();
  }
  setPaperColor(color) {
    this.paperColor = color;
    this.pages.paperColor = color;
    this.sheet?.setPaperColor(color);
  }
  setLight(mode) { this.room.setLight(mode); }
  setIntensity(v) { this.room.setIntensity(v); }
  setStiffness(v) { this.path.setStiffness(v); this.sheet?.layoutGeometry(); }
  setMotion(v) { this.motion = v; }
  /** Hide the parts in front of the paper (type guide, card holder, bail, ribbon). */
  setClearView(v) { this.clearView = v; this.machine?.setClearView(v); this.dirty = true; }
  setVolume(v) { this.sound.setVolume(v); }
  setAmbient(v) { this.sound.setAmbient(v); }
  setMuted(m) { this.sound.unlock(); this.sound.setMuted(m); }
  setQuality(q) {
    if (q !== 'auto' && !QUALITY[q]) return;
    this.qualityMode = q;
    this.quality = q === 'auto' ? 'medium' : q;
    this.autoQuality.reset();
    this.applyQuality();
  }
  applyQuality() {
    const q = QUALITY[this.quality];
    this.room.setShadowQuality(q.shadow);
    this.pipeline.setQuality(this.quality);
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    this.emit({quality: this.quality, qualityMode: this.qualityMode});
  }
  focus() { this.sound.unlock(); this.term.focus(); }
  blur() { this.term.blur(); }
  setView(name, instant = false) {
    const v = VIEWS[name];
    if (!v) return;
    this.view = name;
    this.setViewSpec(v, instant);
  }
  /** Frame an arbitrary subject box ({target, dir, half}). */
  setViewSpec(v, instant = false) {
    this.userMoved = false;
    if (!VIEWS[this.view] || VIEWS[this.view] !== v) this.viewSpec = v;
    else this.viewSpec = null;
    // Fit the subject into the part of the viewport not covered by panels.
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const visW = Math.max(120, w - this.insetTarget.right), visH = Math.max(120, h - this.insetTarget.bottom);
    const t = Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2);
    const dist = Math.max(v.half[1] / (t * visH / h), v.half[0] / (t * visW / h));
    const target = new THREE.Vector3(...v.target);
    const pos = new THREE.Vector3(...v.dir).normalize().multiplyScalar(dist).add(target);
    if (instant) {
      this.cameraTween = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.cameraTween = {from: this.camera.position.clone(), to: pos, tf: this.controls.target.clone(), tt: target, start: performance.now() / 1000};
    this.touch();
  }

  /**
   * Reserve screen space for a docked panel (CSS px). The camera's principal
   * point moves to the centre of the uncovered area at the same pixel scale.
   */
  setInsets({right = 0, bottom = 0} = {}) {
    if (right === this.insetTarget.right && bottom === this.insetTarget.bottom) return;
    this.insetTarget = {right, bottom};
    if (!this.userMoved) { if (this.viewSpec) this.setViewSpec(this.viewSpec); else if (this.view) this.setView(this.view); }
    this.touch();
  }
  applyInsets() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const {right, bottom} = this.insets;
    const cam = this.camera;
    if (right < 0.5 && bottom < 0.5) {
      cam.clearViewOffset();
      cam.fov = this.baseFov;
      cam.aspect = w / h;
    } else {
      const fw = w + right, fh = h + bottom;
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) * fh / h));
      cam.aspect = fw / fh;
      cam.setViewOffset(fw, fh, right, bottom, w, h);
    }
    cam.updateProjectionMatrix();
  }
  stepInsets(dt) {
    const a = 1 - Math.exp(-dt * 9);
    let changed = false;
    for (const k of ['right', 'bottom']) {
      const d = this.insetTarget[k] - this.insets[k];
      if (Math.abs(d) > 0.3) { this.insets[k] += d * a; changed = true; }
      else if (this.insets[k] !== this.insetTarget[k]) { this.insets[k] = this.insetTarget[k]; changed = true; }
    }
    if (changed) this.applyInsets();
  }
  /** Screen position (CSS px) of the printing point, for placing the IME window. */
  printPointScreen() {
    if (!this.camera) return null;
    const v = new THREE.Vector3(STRIKE.x, STRIKE.y - 0.12, STRIKE.z + 0.1).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height};
  }

  // ---- export --------------------------------------------------------------------------------
  currentPage() { return {...this.pages.currentAsPage(), seed: this.sheet?.seed ?? 7}; }
  async exportPdf(which = 'all') {
    let list;
    if (which === 'current') list = [this.currentPage()];
    else if (Array.isArray(which)) list = which;
    else {
      list = [...this.pages.archive];
      const cur = this.currentPage();
      if (cur.rows.some(r => r.length)) list.push(cur);
    }
    list = list.filter(p => p && p.rows.some(r => r.length));
    if (!list.length) throw new Error('还没有打出内容');
    const items = list.map(page => {
      const canvas = renderPage(page, 1.75);   // ≈300 dpi for A4
      const f = FORMATS[page.format];
      return {canvas, pageWidth: f.pdf[0], pageHeight: f.pdf[1]};
    });
    const blob = await canvasesToPdf(items, {title: 'INK typewriter pages'});
    download(blob, `ink-pages-${stamp()}.pdf`);
    return list.length;
  }
  exportText() {
    const list = [...this.pages.archive, this.currentPage()].filter(p => p.rows.some(r => r.length));
    const text = list.map((p, i) => `—— 第 ${i + 1} 页 · ${FORMATS[p.format].label} ——\n\n${pageText(p)}`).join('\n\n\n');
    download(new Blob([text + '\n'], {type: 'text/plain;charset=utf-8'}), `ink-pages-${stamp()}.txt`);
  }
  pageThumbnail(page, scale = 0.22) { return renderPage(page, scale); }

  // ---- loop ------------------------------------------------------------------------------------
  touch() { this.lastActive = performance.now() / 1000; }
  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.pixelRatio = renderPixelRatio(this.quality, w, h, window.devicePixelRatio);
    if (this.renderer.getPixelRatio() !== this.pixelRatio) this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.applyInsets();
    if (!this.userMoved && !this.cameraTween) { if (this.viewSpec) this.setViewSpec(this.viewSpec, true); else if (this.view) this.setView(this.view, true); }
    this.pipeline?.setSize(w, h, this.pixelRatio || 1);
    this.room?.setPixelRatio(this.pixelRatio || 1);
    this.sendSize();
  }
  emit(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) if (this.info[k] !== patch[k]) { changed = true; break; }
    if (!changed) return;
    Object.assign(this.info, patch);
    this.onInfo(patch);
  }
  frame(ms) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) {
      this.framePacer.reset();
      this.autoQuality.reset();
      this.prev = undefined;
      return;
    }
    const now = ms / 1000;
    const dt = Math.min(0.05, this.prev ? now - this.prev : 1 / 60);
    const idle = !this.alternate && !this.mechanism.busy && !this.change && !this.cameraTween && !this.orbiting && this.stack.every(s => s.done) && now - this.lastActive > 2.5 && this.insets.right === this.insetTarget.right && this.insets.bottom === this.insetTarget.bottom;
    if (!this.framePacer.shouldRender(ms, idle ? 30 : 60)) return;
    if (this.qualityMode === 'auto' && this.quality === 'medium' && this.autoQuality.sample(ms, !idle)) {
      this.quality = 'low';
      this.applyQuality();
    }
    // The shadow map depends on the sun and the casters, not on the camera:
    // Limit expensive shadow redraws independently of monitor refresh rate.
    const moving = this.mechanism.busy || this.change || this.alternate || !this.stack.every(s => s.done);
    const shadowFps = moving ? QUALITY[this.quality].shadowFps : 6;
    if (now - (this.lastShadowUpdate ?? -Infinity) >= 1 / shadowFps) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowUpdate = now;
    }
    this.prev = now;
    const t = performance.now() / 1000;
    this.stepInsets(dt);
    this.syncPaper(t);
    this.stepChange(t, dt);
    const pose = this.mechanism.update(t, dt, {motion: this.motion});
    const carriageX = -this.layout.colX(Math.max(0, Math.min(this.layout.cols - 1, pose.col)));
    if (!this.change && this.sheet && this.alternate && this.sheet.alt) {
      // Full-screen mode: keep the whole screen block fed up above the bail.
      const s = this.motion ? THREE.MathUtils.damp(this.sheet.sTop, this.altFeed, 5, dt) : this.altFeed;
      this.platenAngle -= (s - this.sheet.sTop) / PAPER_R;
      this.sheet.setFeed(s);
    } else if (!this.change && this.sheet) {
      const s = this.layout.rowV(Math.max(-0.5, pose.row));
      this.platenAngle -= (s - this.sheet.sTop) / PAPER_R;
      this.sheet.setFeed(s);
    }
    this.machine.update(t, dt, {carriageX, platenAngle: this.platenAngle, returnPull: pose.returnPull});
    for (const s of this.stack) s.step(t);
    this.sparkles.update(t, this.pixelRatio || 1);
    this.updateMusic(dt);
    if (this.hoverEvent) { this.pointerHover(this.hoverEvent); this.hoverEvent = null; }
    this.room.update(now, dt);
    if (this.cameraTween) {
      const c = this.cameraTween;
      const k = Math.min(1, (t - c.start) / 0.9), q = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(c.from, c.to, q);
      this.controls.target.lerpVectors(c.tf, c.tt, q);
      if (k >= 1) this.cameraTween = null;
    }
    this.controls.update();
    this.keepCameraInRoom();
    this.sheet?.tickGlow(dt);
    this.sheet?.flushTexture();
    this.change?.old?.flushTexture();
    this.pipeline.render(now);
    if (now - (this.lastInfo || 0) > 0.12) {
      this.lastInfo = now;
      const cur = this.pages.cursorOnPage(this.alternate);
      this.emit({page: this.pages.pageNumber, row: cur ? cur.r + 1 : 0, col: cur ? cur.c + 1 : 0, pages: this.pages.archive.length});
    }
  }
  keepCameraInRoom() {
    // Orbiting must never leave the room (walls at x = -16.5, z = -8).
    const p = this.camera.position;
    const x = THREE.MathUtils.clamp(p.x, ROOM.wallX + 1.2, 29);
    const y = THREE.MathUtils.clamp(p.y, 1.2, 33);
    const z = THREE.MathUtils.clamp(p.z, ROOM.backZ + 1.2, 38);
    if (x !== p.x || y !== p.y || z !== p.z) p.set(x, y, z);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.demo?.cancel();
    this.session?.disconnect(false);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const el = this.renderer?.domElement;
    el?.removeEventListener('pointerdown', this.onPointerDown);
    el?.removeEventListener('mousedown', this.onMouseDown);
    el?.removeEventListener('pointerup', this.onPointerUp);
    el?.removeEventListener('pointermove', this.onPointerMove);
    el?.removeEventListener('pointerleave', this.onPointerLeave);
    this.music?.dispose();
    if (this.textarea) {
      this.textarea.removeEventListener('focus', this.onFocus);
      this.textarea.removeEventListener('blur', this.onBlur);
      for (const ev of ['compositionstart', 'compositionupdate', 'compositionend']) this.textarea.removeEventListener(ev, this.onCompose);
    }
    for (const s of this.subs || []) s.dispose();
    this.pages?.dispose();
    this.term?.dispose();
    this.controls?.dispose();
    this.sheet?.dispose();
    for (const s of this.stack) s.dispose();
    this.sparkles?.dispose();
    this.machine?.dispose();
    this.room?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
    el?.remove();
    this.sound.dispose();
  }
}

const SHIFTED = {'1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '/': '?', ';': ':', "'": '"', ',': '<', '.': '>'};
function keyName(e) {
  if (e.key === ' ') return 'SPACE';
  if (e.key === 'Backspace') return 'BACKSPACE';
  if (e.key === 'Tab') return 'TAB';
  if (e.key === 'Shift') return 'SHIFT';
  if (e.key === 'Enter') return null;
  if (e.key.length === 1) {
    const lower = e.key.toLowerCase();
    for (const [base, up] of Object.entries(SHIFTED)) if (up === e.key) return base;
    return lower;
  }
  return null;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
