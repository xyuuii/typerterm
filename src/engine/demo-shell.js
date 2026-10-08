// Local demo session. Everything here is simulated in the page: no command
// is executed anywhere. Output goes through term.write like real SSH output,
// so the paper only ever shows what xterm parsed.

const PROMPT = '\x1b[32mink\x1b[0m:\x1b[34m~\x1b[0m$ ';

export class DemoShell {
  constructor(write, {onCommand, size} = {}) {
    this.write = write;
    this.onCommand = onCommand;
    this.size = size || (() => ({cols: 80, rows: 24}));
    this.input = '';
    this.history = [];
    this.historyIndex = 0;
    this.timers = new Set();
    this.screen = false;
    this.segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', {granularity: 'grapheme'}) : null;
  }
  welcome() {
    this.write(
      '\x1b[1mINK · 墨迹\x1b[0m  打字机终端\r\n' +
      '\x1b[2m—— 演示模式 · 本页不连接任何设备 ——\x1b[0m\r\n\r\n' +
      '午后的阳光落在桌上，猫在打盹。\r\n' +
      '敲几个字试试，或者输入 \x1b[1mhelp\x1b[0m。\r\n\r\n' + PROMPT);
  }
  prompt() { this.write(PROMPT); }
  cancel() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); this.typing = false; }
  /** Forget all local state (used when a real session takes over). */
  reset() { this.cancel(); this.stopMonitor(); this.screen = false; this.input = ''; }
  later(fn, ms) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }
  data(data) {
    if (this.monitor) {
      if (data === 'q' || data === '\x03' || data === '\x1b') this.stopMonitor(true);
      return;
    }
    if (this.screen) {
      if (data === 'q' || data === '\x03') { this.screen = false; this.write('\x1b[?1049l'); this.write('全屏演示已退出。\r\n' + PROMPT); }
      return;
    }
    if (this.typing) {
      if (data === '\x03') { this.cancel(); this.write('^C\r\n' + PROMPT); }
      return;
    }
    if (data === '\x1b[A' || data === '\x1b[B') {
      if (!this.history.length) return;
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (data === '\x1b[A' ? -1 : 1)));
      this.replaceInput(this.history[this.historyIndex] || '');
      return;
    }
    if (data.startsWith('\x1b')) return;
    for (const ch of data.replace(/\r\n/g, '\r')) {
      if (ch === '\r' || ch === '\n') {
        const line = this.input;
        this.input = '';
        this.write('\r\n');
        if (line.trim()) { this.history.push(line); this.historyIndex = this.history.length; }
        this.run(line);
      } else if (ch === '\x7f' || ch === '\b') {
        if (!this.input) continue;
        const parts = this.segmenter ? [...this.segmenter.segment(this.input)].map(s => s.segment) : Array.from(this.input);
        const last = parts.pop();
        this.input = parts.join('');
        // Erase the cells the grapheme occupied (wide characters take two).
        const wide = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u.test(last);
        this.write(wide ? '\b\b  \b\b' : '\b \b');
      } else if (ch === '\x03') {
        this.input = '';
        this.write('^C\r\n' + PROMPT);
      } else if (ch === '\x0c') {
        this.write('\x1b[H\x1b[2J' + PROMPT + this.input);
      } else if (ch === '\t') {
        this.input += '    ';
        this.write('    ');
      } else if (ch >= ' ') {
        this.input += ch;
        this.write(ch);
      }
    }
  }
  replaceInput(text) {
    this.write('\r\x1b[2K' + PROMPT + text);
    this.input = text;
  }
  run(line) {
    const cmd = line.trim();
    const out = s => this.write(s.replace(/\n/g, '\r\n') + '\r\n');
    const [name, ...rest] = cmd.split(/\s+/);
    if (!cmd) { this.prompt(); return; }
    switch (name) {
      case 'help':
        out('演示命令（全部在页面内模拟）：\n' +
          '  demo     自动打一段诗，演示换行、走纸和满页出纸\n' +
          '  echo …   回显文字\n' +
          '  date     浏览器当前时间\n' +
          '  colors   ANSI 颜色在纸上的样子\n' +
          '  screen   全屏(alternate)缓冲区演示，q 退出\n' +
          '  btop     模拟的系统监视器（btop 风格，数据是假的），q 退出\n' +
          '  clear    清屏，同时换一张新纸\n' +
          '  about    关于这台打字机\n' +
          '真实设备请用本机服务版，右上角“连接 SSH”。');
        break;
      case 'demo': this.demo(); return;
      case 'echo': out(rest.join(' ')); break;
      case 'date': out(new Date().toLocaleString('zh-CN')); break;
      case 'colors':
        out([31, 32, 33, 34, 35, 36].map(c => `\x1b[${c}m■ 色带 ${c}\x1b[0m`).join('  ') + '\n\x1b[1m粗体\x1b[0m \x1b[3m斜体\x1b[0m \x1b[4m下划线\x1b[0m \x1b[7m 反色 \x1b[0m \x1b[2m暗淡\x1b[0m');
        break;
      case 'clear': this.write('\x1b[H\x1b[2J\x1b[3J'); break;
      case 'about':
        out('INK · 墨迹 —— 三渲二风格的机械打字机终端。\n' +
          '纸面文字来自 xterm 解析后的单元格，字杆击中纸面时才落墨。\n' +
          '模型是原创的通用前击式结构，不是某款实机的复刻。');
        break;
      case 'screen':
        this.screen = true;
        this.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[1;32m INK / FULL SCREEN \x1b[0m\r\n\r\n' +
          '这是 alternate 缓冲区：纸面实时刷新，\r\n不再逐字击打，也不会换纸。\r\n\r\n' +
          '\x1b[36m中文宽字符 / ANSI 颜色 / 光标定位\x1b[0m\r\n\x1b[10;4H\x1b[33m(第10行第4列)\x1b[0m\r\n\r\n   按 q 返回');
        return;
      case 'btop': case 'monitor': case 'top': case 'htop':
        this.startMonitor();
        return;
      case 'ls': case 'pwd': case 'whoami': case 'ssh': case 'vim': case 'cd': case 'cat':
        out(`${name}: 这是演示会话，没有连接设备。\n真实 SSH 请启动本机服务后连接。`);
        break;
      default:
        out(`${name}: 演示模式里没有这个命令，输入 help 看看。`);
    }
    this.onCommand?.(name);
    this.prompt();
  }
  // ---- simulated btop-style monitor (all numbers are made up) ---------------
  startMonitor() {
    this.monitor = {t: 0, cpu: Array.from({length: 240}, () => 0.2), cores: Array(8).fill(0.3), mem: 0.46, net: Array.from({length: 120}, () => 0.2), procSeed: 1};
    this.write('\x1b[?1049h\x1b[?25l\x1b[2J');
    const tick = () => {
      if (!this.monitor) return;
      this.drawMonitor();
      this.monitor.timer = setTimeout(tick, 450);
    };
    // Let the terminal settle at its full-screen size before the first frame.
    this.monitor.timer = setTimeout(tick, 120);
  }
  stopMonitor(prompt = false) {
    if (!this.monitor) return;
    clearTimeout(this.monitor.timer);
    this.monitor = null;
    this.write('\x1b[?25h\x1b[?1049l');
    if (prompt) { this.write('监视器已退出（刚才的数据都是模拟的）。\r\n'); this.prompt(); }
  }
  drawMonitor() {
    const m = this.monitor;
    const {cols, rows} = this.size();
    m.t++;
    const walk = (v, amp = 0.12) => Math.max(0.02, Math.min(0.98, v + (Math.random() - 0.5) * amp + (0.35 - v) * 0.05));
    const total = walk(m.cpu[m.cpu.length - 1], 0.18);
    m.cpu.push(total); m.cpu.shift();
    m.cores = m.cores.map(v => walk(v, 0.3));
    m.mem = Math.max(0.3, Math.min(0.85, m.mem + (Math.random() - 0.5) * 0.02));
    m.net.push(Math.max(0.02, Math.min(1, m.net[m.net.length - 1] + (Math.random() - 0.45) * 0.3))); m.net.shift();
    const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
    const heat = v => v < 0.5 ? rgb(Math.round(110 + v * 260), 220, 120) : rgb(240, Math.round(220 - (v - 0.5) * 300), 90);
    const dim = '\x1b[38;2;120;130;170m', reset = '\x1b[0m', title = '\x1b[1;38;2;255;214;140m';
    const out = [];
    const at = (r, c, text) => out.push(`\x1b[${r};${c}H${text}`);
    const box = (r0, c0, h, w, name) => {
      at(r0, c0, `${dim}╭─${title}${name}${dim}${'─'.repeat(Math.max(0, w - name.length - 4))}╮${reset}`);
      for (let r = 1; r < h - 1; r++) { at(r0 + r, c0, `${dim}│${reset}`); at(r0 + r, c0 + w - 1, `${dim}│${reset}`); }
      at(r0 + h - 1, c0, `${dim}╰${'─'.repeat(w - 2)}╯${reset}`);
    };
    out.push('\x1b[2J');
    const W = cols, cpuH = Math.max(8, Math.floor(rows * 0.36));
    box(1, 1, cpuH, W, ' cpu ');
    const note = ' 模拟数据 · 演示模式 ';
    at(1, W - 26, `${title}${note}${reset}`);
    // Braille CPU graph.
    const gw = W - 30, gh = cpuH - 3, dotsH = gh * 4;
    const series = m.cpu.slice(-gw * 2);
    for (let ry = 0; ry < gh; ry++) {
      let line = '';
      let lastColor = '';
      for (let cx = 0; cx < gw; cx++) {
        let bits = 0;
        for (const [k, side] of [[cx * 2, 0], [cx * 2 + 1, 1]]) {
          const v = series[k] ?? 0;
          const filled = Math.round(v * dotsH);
          for (let d = 0; d < 4; d++) {
            const fromTop = ry * 4 + d;
            if (fromTop >= dotsH - filled) bits |= [[1, 2, 4, 64], [8, 16, 32, 128]][side][d];
          }
        }
        const color = heat(1 - ry / gh);
        if (color !== lastColor) { line += color; lastColor = color; }
        line += String.fromCodePoint(0x2800 + bits);
      }
      at(2 + ry, 3, line + reset);
    }
    at(cpuH - 1, 3, `${dim}总占用 ${reset}${heat(total)}${String(Math.round(total * 100)).padStart(3)}%${reset}`);
    // Per-core bars.
    m.cores.forEach((v, i) => {
      const n = 14, full = Math.floor(v * n), part = Math.floor((v * n - full) * 8);
      const bar = '█'.repeat(full) + (full < n ? ' ▏▎▍▌▋▊▉'[part].trim() : '') ;
      at(2 + i, W - 25, `${dim}C${i}${reset} ${heat(v)}${bar.padEnd(n)}${reset} ${String(Math.round(v * 100)).padStart(3)}%`);
    });
    // Memory and network.
    const r1 = cpuH + 1, mh = Math.max(6, Math.floor(rows * 0.22)), half = Math.floor(W / 2);
    box(r1, 1, mh, half, ' mem ');
    const meter = (v, n) => { const f = Math.round(v * n); return heat(v) + '■'.repeat(f) + dim + '■'.repeat(n - f) + reset; };
    at(r1 + 1, 3, `已用 ${meter(m.mem, half - 18)} ${Math.round(m.mem * 160) / 10}G`);
    at(r1 + 2, 3, `缓存 ${meter(0.22 + Math.sin(m.t / 9) * 0.05, half - 18)}`);
    at(r1 + 3, 3, `交换 ${meter(0.08, half - 18)}`);
    box(r1, half + 1, mh, W - half, ' net ');
    const spark = m.net.slice(-(W - half - 4)).map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v * 8))]).join('');
    at(r1 + 2, half + 3, rgb(140, 200, 255) + spark + reset);
    at(r1 + 3, half + 3, `${dim}↓ ${reset}${(m.net[m.net.length - 1] * 12).toFixed(1)} MB/s   ${dim}↑ ${reset}${(m.net[m.net.length - 2] * 3).toFixed(1)} MB/s`);
    // Processes.
    const r2 = r1 + mh, ph = rows - r2;
    box(r2, 1, ph, W, ' proc ');
    const names = ['typewriter', 'ribbon-spool', 'platen-feed', 'cat-nap', 'sakura-petals', 'ink-daemon', 'carriage', 'furin-chime', 'tea-kettle', 'bell', 'lofi-radio', 'paper-tray'];
    at(r2 + 1, 3, `${title}${'pid'.padEnd(7)}${'name'.padEnd(18)}${'cpu%'.padStart(7)}${'mem'.padStart(9)}${reset}`);
    const procs = names.map((n, i) => ({pid: 4200 + i * 37, n, cpu: Math.abs(Math.sin(m.t / (7 + i) + i)) * (i === 0 ? 40 : 12), mem: 20 + ((i * 53) % 90)}));
    procs.sort((a, b) => b.cpu - a.cpu);
    procs.slice(0, Math.max(0, ph - 3)).forEach((p, i) => {
      const sel = i === 0 ? '\x1b[7m' : '';
      at(r2 + 2 + i, 3, `${sel}${String(p.pid).padEnd(7)}${p.n.padEnd(18)}${heat(p.cpu / 50)}${p.cpu.toFixed(1).padStart(7)}${reset}${sel}${(p.mem + 'M').padStart(9)}${reset}`);
    });
    at(rows, 3, `${dim}q 退出 · 这是页面里的模拟，不读取你的电脑${reset}`);
    this.write(out.join(''));
  }

  demo() {
    this.cancel();
    this.typing = true;
    const text = [
      '',
      '小窗',
      '',
      '风铃响了一下，',
      '阳光从窗格里漏进来，',
      '落在键盘和猫的背上。',
      '',
      'The quick brown fox jumps over the lazy dog.',
      '',
      '按键压下，字杆扬起，',
      '色带抬到纸前，小车向左走一格。',
      '到了行尾，叮——',
      '拨一下回车杆，纸就往上走一行。',
      '',
      '写满一页，纸会被抽出来，',
      '轻轻落到桌边那一摞上。',
      '',
    ].join('\r\n');
    const chars = Array.from(text);
    let i = 0;
    const tick = () => {
      if (i >= chars.length) { this.typing = false; this.write('\r\n' + PROMPT); return; }
      const ch = chars[i++];
      this.write(ch);
      const delay = ch === '\n' ? 360 : ch === '\r' ? 30 : /[，。、——]/.test(ch) ? 260 : ch === ' ' ? 90 : 95 + Math.random() * 90;
      this.later(tick, delay);
    };
    tick();
  }
}
