// Local same-origin bridge: serves the built front end (dist/) and a
// WebSocket at /terminal that connects to a user-chosen SSH host via ssh2.
// Listens on 127.0.0.1 only. Protocol: docs/PROTOCOL.md.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import ssh2 from 'ssh2';

const {Client} = ssh2;
const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const OUTPUT_PAUSE = 256 * 1024;      // unacknowledged output that pauses SSH reads
const OUTPUT_RESUME = 64 * 1024;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const INPUT_FRAME_LIMIT = 64 * 1024;
const INPUT_PENDING_LIMIT = 256 * 1024;
const MAX_SESSIONS = 8;

const sameSecret = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const intIn = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
/** OpenSSH-style SHA256 fingerprint of the raw public key blob. */
export const fingerprintOf = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

export async function createBridge({port = 0, token = randomBytes(24).toString('base64url'), webRoot = defaultRoot} = {}) {
  const sessions = new Set();
  let expectedHost = '', origin = '';

  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== expectedHost) { res.writeHead(403); res.end('Host rejected'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', CSP);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, origin).pathname); } catch { res.writeHead(400); res.end(); return; }
    const base = path.resolve(webRoot);
    const filename = path.resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (filename !== base && !filename.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const s = await stat(filename);
      if (!s.isFile()) throw new Error('not a file');
      const data = await readFile(filename);
      res.setHeader('Content-Type', MIME[path.extname(filename)] || 'application/octet-stream');
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('未找到前端文件。请先运行 npm run build（或直接 npm start）。');
    }
  });

  const wss = new WebSocketServer({noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false});
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/terminal' || req.headers.host !== expectedHost || req.headers.origin !== origin || sessions.size >= MAX_SESSIONS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', ws => {
    sessions.add(ws);
    let conn = null, channel = null, verify = null, verifyTimer = null;
    let authenticated = false, started = false, closed = false;
    let pending = 0, inputPending = 0, approvedKey = null, pendingHostKey = null;
    const send = m => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(authTimer);
      clearTimeout(verifyTimer);
      if (verify) { const cb = verify; verify = null; cb(false); }
      channel?.destroy();
      conn?.destroy();
      sessions.delete(ws);
    };
    const fail = message => { send({type: 'error', message}); ws.close(1008, 'Session rejected'); cleanup(); };
    const authTimer = setTimeout(() => fail('本地访问口令验证超时'), 10000);
    authTimer.unref();
    ws.on('error', cleanup);
    ws.on('close', cleanup);

    // SSH output → browser, paused while too much is unacknowledged.
    const output = data => {
      if (ws.readyState !== WebSocket.OPEN) return;
      pending += data.length;
      if (pending > OUTPUT_LIMIT || ws.bufferedAmount > OUTPUT_LIMIT) { fail('输出缓冲区达到上限，会话已断开'); return; }
      ws.send(data, {binary: true}, err => { if (err) cleanup(); });
      if (pending >= OUTPUT_PAUSE) { channel?.pause(); channel?.stderr.pause(); }
    };

    ws.on('message', (raw, isBinary) => {
      if (closed) return;
      if (isBinary) {
        // Raw terminal input from xterm onData/onBinary.
        if (!authenticated || !channel) { fail('会话尚未连接'); return; }
        if (raw.length > INPUT_FRAME_LIMIT) { fail('单次输入超过 64 KB'); return; }
        inputPending += raw.length;
        if (inputPending > INPUT_PENDING_LIMIT) { fail('待处理输入达到上限'); return; }
        channel.write(raw, err => {
          inputPending = Math.max(0, inputPending - raw.length);
          if (closed) return;
          if (err) { fail('发送终端输入失败'); return; }
          send({type: 'input_ack', bytes: raw.length});
        });
        return;
      }
      let m;
      try { m = JSON.parse(raw.toString()); } catch { fail('无效控制消息'); return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) { fail('无效控制消息'); return; }
      if (!authenticated) {
        if (m.type !== 'connect' || typeof m.token !== 'string' || !sameSecret(m.token, token)) { fail('本地访问口令不正确'); return; }
        authenticated = true;
        clearTimeout(authTimer);
      }
      if (m.type === 'connect') {
        if (started) { fail('此会话已提交连接'); return; }
        started = true;
        const allowed = ['type', 'token', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'cols', 'rows'];
        if (Object.keys(m).some(k => !allowed.includes(k)) ||
            typeof m.host !== 'string' || m.host.length < 1 || m.host.length > 253 || /[\s\x00-\x1f]/.test(m.host) ||
            typeof m.username !== 'string' || m.username.length < 1 || m.username.length > 128 || /[\x00-\x1f]/.test(m.username) ||
            !intIn(m.port, 1, 65535) || !intIn(m.cols, 20, 300) || !intIn(m.rows, 5, 150)) {
          fail('设备地址、端口、用户名或终端尺寸无效');
          return;
        }
        const useKey = typeof m.privateKey === 'string' && m.privateKey.length > 0;
        if (useKey ? m.privateKey.length > 65536 : (typeof m.password !== 'string' || m.password.length > 4096)) { fail('认证信息无效'); return; }
        if (m.passphrase !== undefined && (typeof m.passphrase !== 'string' || m.passphrase.length > 4096)) { fail('私钥口令无效'); return; }
        conn = new Client();
        conn.on('error', err => {
          if (closed) return;
          send({type: 'error', message: `SSH 连接失败：${err.message}`});
          ws.close(1011, 'SSH error');
          cleanup();
        });
        conn.on('close', () => {
          if (closed) return;
          send({type: 'closed', message: 'SSH 会话已关闭'});
          ws.close(1000, 'SSH closed');
          cleanup();
        });
        conn.on('ready', () => {
          if (closed) return;
          conn.shell({term: 'xterm-256color', cols: m.cols, rows: m.rows, width: 0, height: 0}, (err, stream) => {
            if (closed) { stream?.destroy(); return; }
            if (err) { fail(`创建终端失败：${err.message}`); return; }
            channel = stream;
            send({type: 'connected'});
            stream.on('data', output);
            stream.stderr.on('data', output);
            stream.on('error', e => fail(`终端错误：${e.message}`));
            stream.on('close', () => {
              send({type: 'closed', message: '远端终端已退出'});
              ws.close(1000, 'Shell closed');
              cleanup();
            });
          });
        });
        const config = {
          host: m.host, port: m.port, username: m.username,
          readyTimeout: 90000, keepaliveInterval: 15000, keepaliveCountMax: 3,
          // The user checks the fingerprint of the real host key. Once
          // approved, the raw key is pinned for this session (rekeys too).
          hostVerifier(key, callback) {
            if (closed) { callback(false); return; }
            if (approvedKey) { callback(key.equals(approvedKey)); return; }
            pendingHostKey = Buffer.from(key);
            verify = callback;
            send({type: 'hostkey', fingerprint: fingerprintOf(key)});
            verifyTimer = setTimeout(() => { verify = null; callback(false); fail('主机指纹确认超时'); }, 60000);
            verifyTimer.unref();
          },
        };
        if (useKey) { config.privateKey = m.privateKey; if (m.passphrase) config.passphrase = m.passphrase; }
        else config.password = m.password;
        try { conn.connect(config); } catch (err) { fail(`无法发起 SSH：${err.message}`); }
        delete m.token; delete m.password; delete m.privateKey; delete m.passphrase;
      } else if (m.type === 'verify') {
        if (typeof m.accept !== 'boolean' || !verify) { fail('没有待确认的主机指纹'); return; }
        clearTimeout(verifyTimer);
        const cb = verify;
        verify = null;
        if (m.accept) approvedKey = pendingHostKey;
        pendingHostKey = null;
        cb(m.accept);
        if (!m.accept) {
          send({type: 'closed', message: '已取消主机指纹确认'});
          ws.close(1000, 'Host rejected');
          cleanup();
        }
      } else if (m.type === 'resize') {
        if (!channel || !intIn(m.rows, 5, 150) || !intIn(m.cols, 20, 300) || !intIn(m.width, 0, 10000) || !intIn(m.height, 0, 10000)) { fail('终端尺寸无效'); return; }
        channel.setWindow(m.rows, m.cols, m.height, m.width);
      } else if (m.type === 'ack') {
        if (!intIn(m.bytes, 0, pending)) { fail('输出确认无效'); return; }
        pending -= m.bytes;
        if (pending < OUTPUT_RESUME) { channel?.resume(); channel?.stderr.resume(); }
      } else {
        fail('未知控制消息');
      }
    });
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  expectedHost = `127.0.0.1:${address.port}`;
  origin = `http://${expectedHost}`;
  return {
    server, wss, token, url: origin,
    async close() {
      for (const s of [...sessions]) s.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const bridge = await createBridge({port: Number(process.env.INK_PORT) || 0});
  console.log(`\nINK · 墨迹  本机 SSH 桥接\n\n  打开：${bridge.url}\n  本地访问口令：${bridge.token}\n\n仅监听本机回环地址。按 Ctrl+C 退出。\n`);
  let quitting = false;
  const stop = async () => { if (quitting) return; quitting = true; await bridge.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
