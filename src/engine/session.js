// Browser side of the local SSH bridge (protocol: docs/PROTOCOL.md).
// Raw SSH output bytes go to xterm.write; an `ack` is sent only after xterm
// has parsed them (write callback), which drives the bridge's flow control.

const INPUT_CHUNK = 16384, INPUT_WINDOW = 65536, INPUT_LIMIT = 1048576;

export class SshSession {
  constructor({term, onStatus, onState}) {
    this.term = term;
    this.onStatus = onStatus;   // ({type, message, fingerprint})
    this.onState = onState;     // ('connecting' | 'ssh' | 'closed', message)
    this.ws = null;
    this.epoch = 0;
    this.connected = false;
    this.inputQueue = []; this.inputBytes = 0; this.inFlight = 0;
  }
  static available() { return location.hostname === '127.0.0.1'; }
  connect(config, {cols, rows}) {
    if (!SshSession.available()) {
      this.onStatus({type: 'error', message: '请打开本机服务实际打印的 127.0.0.1 地址。'});
      return;
    }
    this.disconnect(false);
    const epoch = ++this.epoch;
    this.onState('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/terminal`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const live = () => ws === this.ws && epoch === this.epoch;
    ws.onopen = () => {
      if (!live()) { ws.close(); return; }
      ws.send(JSON.stringify({type: 'connect', ...config, cols, rows}));
      // Credentials are not kept after they have been sent.
      for (const k of ['token', 'password', 'privateKey', 'passphrase']) delete config[k];
    };
    ws.onmessage = event => {
      if (!live()) return;
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        this.term.write(bytes, () => {
          if (live() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: 'ack', bytes: bytes.byteLength}));
        });
        return;
      }
      let m;
      try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'hostkey') this.onStatus({type: 'hostkey', message: '请核对主机指纹', fingerprint: m.fingerprint});
      else if (m.type === 'input_ack') {
        if (Number.isInteger(m.bytes) && m.bytes > 0 && m.bytes <= this.inFlight) { this.inFlight -= m.bytes; this.pump(); }
      } else if (m.type === 'connected') {
        this.connected = true;
        this.onState('ssh');
        this.onStatus({type: 'connected', message: 'SSH 已连接'});
      } else if (m.type === 'error') {
        this.onStatus({type: 'error', message: m.message});
      } else if (m.type === 'closed') {
        this.onStatus({type: 'closed', message: m.message});
        this.finish(m.message || 'SSH 会话已关闭');
      }
    };
    ws.onerror = () => { if (live()) this.onStatus({type: 'error', message: '本机服务连接失败，请确认服务仍在运行。'}); };
    ws.onclose = () => { if (live()) this.finish('连接已关闭'); };
  }
  finish(message) {
    const was = this.ws;
    this.ws = null;
    this.epoch++;
    this.connected = false;
    this.inputQueue = []; this.inputBytes = 0; this.inFlight = 0;
    try { was?.close(); } catch { /* ignore */ }
    this.onState('closed', message);
  }
  send(bytes) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.inputBytes + this.inFlight + bytes.length > INPUT_LIMIT) {
      this.onStatus({type: 'error', message: '待发送输入超过 1 MB，请分次粘贴。'});
      return;
    }
    for (let i = 0; i < bytes.length; i += INPUT_CHUNK) this.inputQueue.push(bytes.slice(i, i + INPUT_CHUNK));
    this.inputBytes += bytes.length;
    this.pump();
  }
  pump() {
    while (this.ws?.readyState === WebSocket.OPEN && this.inputQueue.length && this.inFlight < INPUT_WINDOW) {
      const chunk = this.inputQueue.shift();
      this.inputBytes -= chunk.length;
      this.inFlight += chunk.length;
      this.ws.send(chunk);
    }
  }
  resize(cols, rows, width = 0, height = 0) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({type: 'resize', cols, rows, width: Math.round(width), height: Math.round(height)}));
    }
  }
  verifyHost(accept) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({type: 'verify', accept}));
  }
  disconnect(notify = true) {
    if (!this.ws) return;
    if (notify) this.finish('已断开连接');
    else { const ws = this.ws; this.ws = null; this.epoch++; this.connected = false; this.inputQueue = []; this.inputBytes = 0; this.inFlight = 0; try { ws.close(); } catch { /* ignore */ } }
  }
}
