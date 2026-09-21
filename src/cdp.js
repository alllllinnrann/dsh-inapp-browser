import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

/** CDP over anonymous OS pipes: no debugging port, WebSocket server or external dependency. */
export class PipeCDP extends EventEmitter {
  constructor(executable, profile) {
    super();
    this.pending = new Map(); this.nextId = 0; this.buffer = Buffer.alloc(0); this.closed = false;
    this.child = spawn(executable, [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=1280,800', 'about:blank',
    ], {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true});
    this.lastError = '';
    this.child.stderr.on('data', bytes => { this.lastError = (this.lastError + bytes.toString()).slice(-2000); });
    this.child.stdio[3].on('error', error => this.fail(error));
    this.child.stdio[4].on('data', bytes => this.receive(bytes));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code) => this.fail(new Error(`浏览器进程已退出 (${code})。请检查浏览器是否可启动，以及插件资料目录是否被另一个 Harness 实例占用。 ${this.lastError.slice(-500)}`)));
  }
  receive(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > 40 * 1024 * 1024) return this.fail(new Error('CDP message too large'));
    let split;
    while ((split = this.buffer.indexOf(0)) !== -1) {
      const text = this.buffer.subarray(0, split).toString();
      this.buffer = this.buffer.subarray(split + 1);
      if (!text) continue;
      let message;
      try { message = JSON.parse(text); } catch { continue; }
      if (message.id) {
        const waiting = this.pending.get(message.id);
        if (!waiting) continue;
        this.pending.delete(message.id); clearTimeout(waiting.timer);
        message.error ? waiting.reject(new Error(message.error.message)) : waiting.resolve(message.result);
      } else this.emit('event', message);
    }
  }
  send(method, params = {}, sessionId, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error('Browser connection closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      this.child.stdio[3].write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
    });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  async close() {
    const exited = new Promise(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode) return resolve();
      this.child.once('exit', resolve);
    });
    if (!this.closed) await this.send('Browser.close', {}, undefined, 1500).catch(() => {});
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
    clearTimeout(timer);
    if (this.child.exitCode === null && !this.child.signalCode) this.child.kill();
    this.fail(new Error('Browser disposed'));
  }
}
