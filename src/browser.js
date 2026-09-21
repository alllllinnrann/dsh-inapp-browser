import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PipeCDP } from './cdp.js';
import { NativeCDP, validateDesktopEndpoint } from './native-cdp.js';
import { defaultDataDir, findBrowser, normalizeUrl, number, HOME_PAGE } from './platform.js';

const snapshotExpression = `(() => {
  const visible = e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="textbox"],[contenteditable="true"]')].filter(visible).slice(0,180).map(e=>{
    const r=e.getBoundingClientRect();
    return {role:e.getAttribute('role')||e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.innerText||e.getAttribute('placeholder')||e.getAttribute('title')||'').trim().slice(0,180),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),inViewport:r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth,disabled:!!e.disabled};
  });
  return {url:location.href,title:document.title,width:innerWidth,height:innerHeight,text:(document.body?.innerText||'').slice(0,16000),elements,frames:[...document.querySelectorAll('iframe')].map(e=>({title:e.title,src:e.src})).slice(0,15)};
})()`;

export class BrowserSession extends EventEmitter {
  constructor(id, cdp, homePage = HOME_PAGE) {
    super(); this.id = id; this.cdp = cdp; this.targets = new Map(); this.active = null;
    this.width = 1280; this.height = 800; this.paused = false; this.frame = null; this.revision = 0;
    this.homePage = normalizeUrl(homePage); this.pixelRatio = 1;
    this.frameEpoch = 0; this.sharpTimer = null; this.sharpPending = false;
    this.frameDirty = false; this.lastCapture = 0;
    this.queue = Promise.resolve(); this.lastUsed = Date.now(); this.streamCount = 0; this.pauseEpoch = 0;
    cdp.on('event', event => this.onEvent(event));
    cdp.on('closed', () => this.emit('state', {error: '浏览器已关闭，请关闭此浏览器会话后重新打开。'}));
  }
  async init() {
    await this.cdp.send('Browser.getVersion', {}, undefined, 25000);
    await this.cdp.send('Target.setDiscoverTargets', {discover: true});
    const {targetInfos} = await this.cdp.send('Target.getTargets');
    const page = targetInfos.find(t => t.type === 'page' && t.url === 'about:blank');
    const id = page?.targetId || (await this.cdp.send('Target.createTarget', {url: 'about:blank'})).targetId;
    await this.select(id);
    // Dedicated plugin profiles keep login data, not restored startup tabs (e.g. Edge first-run pages).
    for (const target of targetInfos) if (target.type === 'page' && target.targetId !== id) await this.cdp.send('Target.closeTarget', {targetId: target.targetId});
    if (this.homePage !== 'about:blank') await this.send('Page.navigate', {url: this.homePage});
    return this;
  }
  onEvent({method, params, sessionId}) {
    if (method === 'IAB.viewportChanged' && sessionId === this.targets.get(this.active)) {
      this.width = params.width; this.height = params.height; this.revision++;
      this.emit('state', {width: this.width, height: this.height, revision: this.revision});
    }
    if (method === 'Page.screencastFrame') {
      void this.cdp.send('Page.screencastFrameAck', {sessionId: params.sessionId}, sessionId).catch(() => {});
      if (sessionId === this.targets.get(this.active)) {
        // Chromium can emit duplicate frames (including during a screenshot).
        // They must not overwrite a sharp still or continually postpone it.
        if (this.lastStreamImage === params.data) return;
        this.lastStreamImage = params.data;
        // Screencast is only an invalidation signal. Never display its lower-
        // resolution JPEG alongside device-pixel screenshots.
        this.scheduleSharpFrame();
      }
    }
    if (method === 'Page.frameNavigated' && !params.frame.parentId && sessionId === this.targets.get(this.active)) {
      this.frameEpoch++; this.revision++; this.frame = null;
      this.emit('state', {url: params.frame.url, revision: this.revision});
    }
    if (method === 'Page.javascriptDialogOpening') {
      this.dialog = {message: params.message, type: params.type}; this.emit('state', {dialog: this.dialog});
    }
    if (method === 'Page.javascriptDialogClosed') { this.dialog = null; this.emit('state', {dialog: null}); }
    if (method === 'Target.targetInfoChanged' && params.targetInfo.targetId === this.active) {
      this.emit('state', {url: params.targetInfo.url, title: params.targetInfo.title});
    }
    if (method === 'Target.targetCreated' && params.targetInfo.type === 'page' && params.targetInfo.openerId) {
      void this.run('human', () => this.select(params.targetInfo.targetId)).catch(() => {});
    }
  }
  send(method, params, timeout) {
    this.actionSignal?.throwIfAborted();
    return this.cdp.send(method, params, this.targets.get(this.active), timeout);
  }
  run(actor, fn, signal) {
    const epoch = this.pauseEpoch;
    const execute = async () => {
      signal?.throwIfAborted();
      if (actor === 'agent' && (this.paused || epoch !== this.pauseEpoch)) throw new Error('用户已暂停 AI 并终止当前浏览器任务。停止操作，不要重试或用其他工具绕过暂停；等待用户的新指令。');
      this.lastUsed = Date.now();
      const controller = actor === 'agent' ? new AbortController() : null;
      this.activeAgent = controller;
      this.actionSignal = controller ? (signal ? AbortSignal.any([signal, controller.signal]) : controller.signal) : undefined;
      try { return await fn(); } finally { this.activeAgent = null; this.actionSignal = undefined; }
    };
    const next = this.queue.then(execute, execute); this.queue = next.catch(() => {}); return next;
  }
  setPaused(value) {
    this.paused = value;
    if (value) { this.pauseEpoch++; this.activeAgent?.abort(new Error('用户已暂停 AI，当前浏览器任务已终止。')); }
    this.emit('state', {paused: value});
    return {paused: value, message: value ? '浏览器任务已暂停；已发出的单步动作可能仍会完成。' : '已允许新的 AI 浏览器操作。'};
  }
  async select(targetId) {
    this.frameEpoch++; this.lastStreamImage = null; clearTimeout(this.sharpTimer); this.sharpTimer = null;
    if (!this.cdp.native && this.active && this.targets.has(this.active)) await this.send('Page.stopScreencast').catch(() => {});
    if (!this.targets.has(targetId)) {
      const {sessionId} = await this.cdp.send('Target.attachToTarget', {targetId, flatten: true});
      this.targets.set(targetId, sessionId);
    }
    this.active = targetId; this.revision++; this.frame = null;
    await this.send('Page.enable'); await this.send('Runtime.enable');
    if (this.cdp.native) {
      await this.cdp.send('Target.activateTarget', {targetId});
      const size = await this.evaluate('({width:innerWidth,height:innerHeight})'); this.width = size.width; this.height = size.height;
    } else await this.send('Emulation.setDeviceMetricsOverride', {width: this.width, height: this.height, deviceScaleFactor: this.pixelRatio, mobile: false});
    if (this.streamCount) await this.startStream();
    this.emit('state', await this.state());
  }
  async state() {
    const {targetInfos} = await this.cdp.send('Target.getTargets');
    const tabs = targetInfos.filter(t => t.type === 'page').map(t => ({id: t.targetId, title: t.title || '新标签', url: t.url}));
    return {tabs, active: this.active, paused: this.paused, mode: this.cdp.native ? 'native' : 'stream', desktopId: this.cdp.desktopId, width: this.width, height: this.height, revision: this.revision, dialog: this.dialog || null, ...tabs.find(t => t.id === this.active)};
  }
  async startStream() {
    await this.send('Page.startScreencast', {format: 'jpeg', quality: 80, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1});
    this.scheduleSharpFrame();
  }
  scheduleSharpFrame() {
    this.frameDirty = true;
    if (!this.streamCount || this.cdp.native || this.closed) return;
    if (this.sharpTimer || this.sharpPending || this.displayChanging) return;
    this.sharpTimer = setTimeout(() => {
      this.sharpTimer = null;
      void this.publishSharpFrame();
    }, Math.max(0, 80 - (Date.now() - this.lastCapture)));
    this.sharpTimer.unref?.();
  }
  async publishSharpFrame() {
    if (this.sharpPending || this.displayChanging || !this.streamCount || this.closed) return;
    const epoch = this.frameEpoch, revision = this.revision;
    const sessionId = this.targets.get(this.active), width = this.width, height = this.height;
    this.sharpPending = true; this.frameDirty = false; this.lastCapture = Date.now();
    try {
      // One capture at a time, latest state only; pixel density never switches.
      const {data} = await this.cdp.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false}, sessionId);
      if (this.closed || !this.streamCount || epoch !== this.frameEpoch || revision !== this.revision || sessionId !== this.targets.get(this.active)) return;
      this.frame = {image: data, mimeType: 'image/png', width, height, revision, seq: Date.now()};
      this.emit('frame', this.frame);
    } catch { /* Keep the live frame if the page is closing or navigating. */ }
    finally { this.sharpPending = false; if (this.frameDirty) this.scheduleSharpFrame(); }
  }
  async subscribe(frame, state) {
    if (this.cdp.native) throw new Error('此会话使用原生桌面视图，请在配对的桌面启动器中打开。');
    this.on('frame', frame); this.on('state', state); this.streamCount++;
    const off = () => {
      this.off('frame', frame); this.off('state', state); this.streamCount = Math.max(0, this.streamCount - 1);
      if (!this.streamCount) { this.frameEpoch++; clearTimeout(this.sharpTimer); this.sharpTimer = null; void this.send('Page.stopScreencast').catch(() => {}); }
    };
    try {
      state(await this.state());
      if (this.streamCount === 1) await this.startStream();
      else if (this.frame) frame(this.frame);
    } catch (error) { off(); throw error; }
    return off;
  }
  async evaluate(expression) {
    const value = await this.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || 'Page evaluation failed');
    return value.result.value;
  }
  async navigate(value, engine, newTab = false) {
    const url = normalizeUrl(value, engine);
    if (newTab) {
      const {targetId} = await this.cdp.send('Target.createTarget', {url: 'about:blank'}); await this.select(targetId);
    }
    const result = await this.send('Page.navigate', {url});
    if (result.errorText) throw new Error(result.errorText);
    await this.wait(1200);
    return this.snapshot();
  }
  async wait(ms = 500) {
    number(ms, 0, 10000, 'milliseconds'); await delay(ms, undefined, {signal: this.actionSignal}); return {waited: ms};
  }
  async snapshot() { return {...await this.evaluate(snapshotExpression), revision: this.revision}; }
  async screenshot() {
    const {data} = await this.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    return {data: Buffer.from(data, 'base64'), width: this.width, height: this.height};
  }
  point(x, y) { return {x: number(x, 0, this.width, 'x'), y: number(y, 0, this.height, 'y')}; }
  async mouse(args) {
    const allowed = ['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'];
    if (!allowed.includes(args.type)) throw new Error('Invalid mouse event');
    const button = args.button || 'left';
    if (!['left', 'right', 'middle', 'none'].includes(button)) throw new Error('Invalid mouse button');
    const point = this.point(args.x, args.y);
    await this.send('Input.dispatchMouseEvent', {
      ...point, type: args.type, button: args.type === 'mouseWheel' ? 'none' : button,
      buttons: number(args.buttons ?? 0, 0, 7, 'buttons'), modifiers: number(args.modifiers ?? 0, 0, 15, 'modifiers'),
      ...(args.type === 'mouseWheel' ? {deltaX: number(args.deltaX || 0, -10000, 10000, 'deltaX'), deltaY: number(args.deltaY || 0, -10000, 10000, 'deltaY')} : {clickCount: args.type === 'mouseMoved' ? 0 : number(args.clickCount ?? 1, 1, 3, 'clickCount')}),
    });
    return {ok: true};
  }
  async click(args) {
    if (args.revision !== undefined && args.revision !== this.revision) throw new Error('页面已导航，请重新截图或读取页面后再点击。');
    await this.mouse({...args, type: 'mousePressed', buttons: args.button === 'right' ? 2 : 1});
    await this.mouse({...args, type: 'mouseReleased', buttons: 0}); return {ok: true};
  }
  async type(text) {
    if (typeof text !== 'string' || text.length > 20000) throw new Error('Text must contain at most 20000 characters');
    await this.send('Input.insertText', {text}); return {ok: true};
  }
  async key(args) {
    if (typeof args.key !== 'string' || args.key.length > 40) throw new Error('Invalid key');
    const special = {Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, ' ': 32};
    const keyCode = special[args.key] || (args.key.length === 1 ? args.key.toUpperCase().charCodeAt(0) : 0);
    const params = {key: args.key, modifiers: number(args.modifiers || 0, 0, 15, 'modifiers'), windowsVirtualKeyCode: keyCode};
    await this.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', ...params});
    if (args.key === 'Enter') await this.send('Input.dispatchKeyEvent', {type: 'char', text: '\r', ...params});
    await this.send('Input.dispatchKeyEvent', {type: 'keyUp', ...params}); return {ok: true};
  }
  async drag(args) {
    this.point(args.x, args.y); this.point(args.toX, args.toY);
    await this.mouse({type: 'mousePressed', x: args.x, y: args.y, buttons: 1});
    try {
      for (let i = 1; i <= 12; i++) {
        await this.mouse({type: 'mouseMoved', x: args.x + (args.toX - args.x) * i / 12, y: args.y + (args.toY - args.y) * i / 12, buttons: 1});
        await delay(15);
      }
    } finally {
      // Release a held button even if pause interrupted the drag.
      await this.cdp.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: args.toX, y: args.toY, button: 'left', buttons: 0, clickCount: 1}, this.targets.get(this.active)).catch(() => {});
    }
    return {ok: true};
  }
  async resize(width, height, pixelRatio = 1) {
    if (this.cdp.native) throw new Error('原生网页随面板自动调整尺寸，请拖动侧栏或窗口边缘。');
    const nextWidth = Math.round(number(width, 240, 2560, 'width')), nextHeight = Math.round(number(height, 160, 1600, 'height'));
    const nextRatio = number(pixelRatio, 1, 2, 'pixelRatio');
    if (nextWidth === this.width && nextHeight === this.height && nextRatio === this.pixelRatio) return this.state();
    this.displayChanging = true;
    try {
    this.frameEpoch++; this.lastStreamImage = null; clearTimeout(this.sharpTimer); this.sharpTimer = null;
    this.width = Math.round(number(width, 240, 2560, 'width')); this.height = Math.round(number(height, 160, 1600, 'height'));
    this.pixelRatio = number(pixelRatio, 1, 2, 'pixelRatio');
    await this.send('Emulation.setDeviceMetricsOverride', {width: this.width, height: this.height, deviceScaleFactor: this.pixelRatio, mobile: false});
    this.revision++; if (this.streamCount) { await this.send('Page.stopScreencast'); await this.startStream(); }
    return this.state();
    } finally { this.displayChanging = false; if (this.streamCount) this.scheduleSharpFrame(); }
  }
  async history(direction) {
    const history = await this.send('Page.getNavigationHistory');
    const next = history.entries[history.currentIndex + direction];
    if (next) await this.send('Page.navigateToHistoryEntry', {entryId: next.id});
    return {ok: true};
  }
  async dispatch(method, args) {
    switch (method) {
      case 'open': return this.navigate(args.url, args.engine, args.newTab);
      case 'snapshot': return this.snapshot();
      case 'state': return this.state();
      case 'click': return this.click(args);
      case 'mouse': return this.mouse(args);
      case 'type': return this.type(args.text);
      case 'key': return this.key(args);
      case 'drag': return this.drag(args);
      case 'scroll': return this.mouse({type: 'mouseWheel', x: args.x ?? this.width / 2, y: args.y ?? this.height / 2, deltaX: args.deltaX || 0, deltaY: args.deltaY ?? 500});
      case 'resize': return this.resize(args.width, args.height, args.pixelRatio);
      case 'back': return this.history(-1);
      case 'forward': return this.history(1);
      case 'reload': await this.send('Page.reload'); return {ok: true};
      case 'wait': return this.wait(args.ms);
      case 'select': {
        const state = await this.state();
        if (!state.tabs.some(t => t.id === args.targetId)) throw new Error('Unknown tab');
        await this.select(args.targetId); return this.state();
      }
      case 'closeTab': {
        const before = await this.state();
        const target = args.targetId || this.active;
        if (!before.tabs.some(t => t.id === target)) throw new Error('Unknown tab');
        await this.cdp.send('Target.closeTarget', {targetId: target}); this.targets.delete(target);
        if (target === this.active) {
          this.active = null;
          const remaining = before.tabs.find(t => t.id !== target);
          await this.select(remaining?.id || (await this.cdp.send('Target.createTarget', {url: this.homePage})).targetId);
        }
        return this.state();
      }
      case 'dialog': await this.send('Page.handleJavaScriptDialog', {accept: args.accept === true, promptText: String(args.text || '')}); return {ok: true};
      default: throw new Error('Unknown browser command');
    }
  }
  async close() { this.closed = true; this.frameEpoch++; clearTimeout(this.sharpTimer); this.sharpTimer = null; await this.cdp.close(); this.removeAllListeners(); }
}

export class BrowserManager {
  constructor(options = {}) { this.options = {homePage: process.env.DSH_IAB_HOME_URL, ...options}; this.sessions = new Map(); this.pending = new Map(); this.closed = false; }
  connectDesktop(endpoint) {
    const checked = validateDesktopEndpoint(endpoint);
    if (this.desktop && this.desktop.desktopId !== checked.desktopId) throw new Error('已有桌面端连接，请先关闭原桌面端或重启 Harness。');
    if (this.sessions.size || this.pending.size) throw new Error('请先关闭已打开的浏览器会话，再连接桌面端。');
    this.desktop = checked;
  }
  async disconnectDesktop(id) {
    if (this.desktop?.desktopId !== id) return;
    const keys = [...this.sessions].filter(([, s]) => s.cdp.native).map(([key]) => key);
    await Promise.allSettled(keys.map(key => this.close(key)));
    this.desktop = null;
  }
  async get(id) {
    if (this.closed) throw new Error('Browser plugin disposed');
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Valid sessionId required');
    if (this.sessions.has(id)) return this.sessions.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.sessions.size + this.pending.size >= (this.options.maxSessions || 4)) throw new Error('已达到同时打开的浏览器会话上限（4）。请先使用工具或面板关闭一个会话。');
    const opening = (async () => {
      const desktop = this.desktop;
      const executable = desktop ? null : await findBrowser(this.options.executable);
      const profile = join(resolve(this.options.dataDir || defaultDataDir()), 'profiles', createHash('sha256').update(id).digest('hex').slice(0,24));
      await mkdir(profile, {recursive: true});
      const session = new BrowserSession(id, desktop ? new NativeCDP(desktop, id) : new PipeCDP(executable, profile), this.options.homePage);
      try { await session.init(); if (this.closed) throw new Error('Browser plugin disposed'); }
      catch (error) { await session.close(); throw error; }
      this.sessions.set(id, session); return session;
    })();
    this.pending.set(id, opening);
    try { return await opening; } finally { this.pending.delete(id); }
  }
  async close(id) {
    const session = this.sessions.get(id) || await this.pending.get(id)?.catch(() => undefined);
    this.sessions.delete(id); if (session) await session.close();
  }
  async dispose() {
    this.closed = true; await Promise.allSettled([...this.pending.values()]);
    await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)));
  }
}
