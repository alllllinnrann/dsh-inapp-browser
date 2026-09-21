import { connect } from 'node:net';
import { EventEmitter } from 'node:events';

/** Private local IPC to the desktop's WebContentsViews, never a TCP debug port. */
export class NativeCDP extends EventEmitter {
  constructor(endpoint, id) {
    super(); this.native = true; this.desktopId = endpoint.desktopId;
    this.nextId = 0; this.pending = new Map(); this.buffer = ''; this.closed = false;
    this.socket = connect(endpoint.pipe);
    this.socket.setEncoding('utf8');
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('connect', () => {
        this.socket.write(JSON.stringify({hello: endpoint.secret, sessionId: id}) + '\n');
        resolve();
      });
      this.socket.once('error', reject);
    });
    // A failed connection must also reject commands already waiting for readiness.
    this.ready.catch(() => {});
    this.socket.on('error', e => this.fail(e));
    this.socket.on('close', () => this.fail(new Error('原生桌面浏览器已断开。请重新启动桌面端。')));
    this.socket.on('data', data => {
      this.buffer += data.toString();
      if (this.buffer.length > 48 * 1024 * 1024) return this.socket.destroy(new Error('Native message too large'));
      let at;
      while ((at = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1);
        let packet; try { packet = JSON.parse(line); } catch { continue; }
        if (packet.id) {
          const pending = this.pending.get(packet.id); if (!pending) continue;
          this.pending.delete(packet.id); clearTimeout(pending.timer);
          packet.error ? pending.reject(new Error(packet.error.message)) : pending.resolve(packet.result);
        } else this.emit('event', packet);
      }
    });
  }
  async send(method, params = {}, sessionId, timeout = 15000) {
    await this.ready;
    if (this.closed) throw new Error('Native browser connection closed');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      this.socket.write(JSON.stringify({id, method, params, sessionId}) + '\n');
    });
  }
  fail(error) {
    if (this.closed) return; this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  async close() {
    if (!this.closed) await this.send('Browser.close', {}, undefined, 1500).catch(() => {});
    this.socket.destroy(); this.fail(new Error('Native browser disposed'));
  }
}

export function validateDesktopEndpoint(value) {
  if (!value || typeof value.pipe !== 'string' || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)
    || typeof value.desktopId !== 'string' || !/^[a-f0-9]{32}$/.test(value.desktopId)) throw new Error('Invalid desktop pairing');
  // Only our random, local Windows named pipes / Unix sockets; no UNC remote pipes.
  const windows = /^\\\\\.\\pipe\\dsh-iab-[a-f0-9]{32}$/;
  const unix = /^\/[^\0\r\n]*\/dsh-iab-[a-f0-9]{32}\.sock$/;
  if (!(process.platform === 'win32' ? windows : unix).test(value.pipe)) throw new Error('Invalid local desktop pipe');
  return {pipe: value.pipe, secret: value.secret, desktopId: value.desktopId};
}
