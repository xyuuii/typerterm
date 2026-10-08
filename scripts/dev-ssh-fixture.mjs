// Development fixture ONLY: a loopback SSH server with a throwaway host key
// and a random password, running a tiny fake shell (echo, prompt, colours,
// clear, long output, an alternate-screen program). It executes nothing on
// this computer. Use it to try the local bridge without touching a real device:
//
//   node scripts/dev-ssh-fixture.mjs        # prints port, user and password
//
import {randomBytes, createHash} from 'node:crypto';
import ssh2 from 'ssh2';

const {Server, utils} = ssh2;
const user = 'ink-test';
const password = process.env.FIXTURE_PASSWORD || randomBytes(9).toString('base64url');
const hostKey = utils.generateKeyPairSync('ed25519').private;
const port = Number(process.env.FIXTURE_PORT) || 0;

const PROMPT = '\x1b[32mink-test\x1b[0m@\x1b[34mfixture\x1b[0m:~$ ';
function shell(stream) {
  let line = '';
  let alt = false;
  stream.write('\x1b[1m测试 SSH 服务（本机回环，仅用于开发验证）\x1b[0m\r\n输入 help 查看命令。\r\n\r\n' + PROMPT);
  stream.on('data', data => {
    for (const ch of data.toString('utf8')) {
      if (alt) {
        if (ch === 'q' || ch === '\x03') { alt = false; stream.write('\x1b[?1049l' + PROMPT); }
        continue;
      }
      if (ch === '\r') {
        stream.write('\r\n');
        run(line.trim());
        line = '';
      } else if (ch === '\x7f') {
        if (line) { const last = Array.from(line).pop(); line = Array.from(line).slice(0, -1).join(''); stream.write(/[⺀-￿]/.test(last) ? '\b\b  \b\b' : '\b \b'); }
      } else if (ch === '\x03') {
        line = ''; stream.write('^C\r\n' + PROMPT);
      } else if (ch === '\x04') {
        stream.write('logout\r\n'); stream.exit(0); stream.end();
      } else if (ch >= ' ' || ch === '\t') {
        line += ch; stream.write(ch);
      }
    }
  });
  function run(cmd) {
    const out = s => stream.write(s.replace(/\n/g, '\r\n') + '\r\n');
    if (!cmd) { stream.write(PROMPT); return; }
    if (cmd === 'help') out('help  ls  date  colors  long  clear  top  exit');
    else if (cmd === 'ls') out('\x1b[34mdocs\x1b[0m  \x1b[34msrc\x1b[0m  notes.txt  诗.txt  \x1b[32mrun.sh\x1b[0m');
    else if (cmd === 'date') out(new Date().toString());
    else if (cmd === 'colors') out([31, 32, 33, 34, 35, 36].map(c => `\x1b[${c}m色带${c}\x1b[0m`).join(' ') + ' \x1b[7m反色\x1b[0m \x1b[1m粗体\x1b[0m');
    else if (cmd === 'long') { for (let i = 1; i <= 80; i++) out(`${String(i).padStart(3)}  这是第 ${i} 行输出 — the quick brown fox jumps over the lazy dog`); }
    else if (cmd === 'clear') stream.write('\x1b[H\x1b[2J\x1b[3J');
    else if (cmd === 'top') { alt = true; stream.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[7m fixture top — press q \x1b[0m\r\n\r\n  PID  CMD\r\n    1  ink\r\n    2  typewriter\r\n'); return; }
    else if (cmd === 'exit') { stream.write('logout\r\n'); stream.exit(0); stream.end(); return; }
    else out(`${cmd.split(' ')[0]}: command not found (fixture)`);
    stream.write(PROMPT);
  }
}

const server = new Server({hostKeys: [hostKey]}, client => {
  client.on('error', () => {});
  client.on('authentication', ctx => {
    if (ctx.method === 'password' && ctx.username === user && ctx.password === password) ctx.accept();
    else ctx.reject(['password']);
  });
  client.on('ready', () => client.on('session', accept => {
    const session = accept();
    session.on('pty', accept => accept?.());
    session.on('window-change', (accept, reject, info) => { accept?.(); console.log(`window-change ${info.cols}x${info.rows} ${info.width}x${info.height}px`); });
    session.on('shell', accept => shell(accept()));
  }));
});
server.listen(port, '127.0.0.1', () => {
  const pub = utils.parseKey(hostKey).getPublicSSH();
  console.log(`fixture ssh  127.0.0.1:${server.address().port}  user=${user}  password=${password}`);
  console.log(`host key     SHA256:${createHash('sha256').update(pub).digest('base64').replace(/=+$/, '')}`);
});
