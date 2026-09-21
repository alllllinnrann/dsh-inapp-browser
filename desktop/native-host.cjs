const {WebContentsView, session} = require('electron');
const {createServer} = require('node:net');
const {createHash, timingSafeEqual} = require('node:crypto');
const {join} = require('node:path');

// The agent can address only this socket's chat pages, never the Harness page.
function createNativeHost({window, pipe, secret, dataDir}) {
  const chats = new Map(), sockets = new Set();
  let layout = null;
  const safeUrl = url => url === 'about:blank' || /^https?:\/\//i.test(url);
  function disposeView(view) {
    // BrowserWindow destruction may precede pipe-close and destroys child views.
    // Each resource can therefore already be gone, independently of the others.
    try { if (!window.isDestroyed()) window.contentView.removeChildView(view); } catch {}
    try { if (!view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload: false}); } catch {}
  }
  function show() {
    if (window.isDestroyed()) return;
    for (const chat of chats.values()) for (const [id, view] of chat.views) {
      const visible = !!layout?.visible && layout.sessionId === chat.id && chat.active === id;
      view.setVisible(visible);
      if (visible) {
        const [winWidth, winHeight] = window.getContentSize();
        const b = layout.bounds;
        const x = Math.max(0, Math.min(winWidth - 1, Math.round(b.x)));
        const y = Math.max(0, Math.min(winHeight - 1, Math.round(b.y)));
        const width = Math.max(1, Math.min(winWidth - x, Math.round(b.width)));
        const height = Math.max(1, Math.min(winHeight - y, Math.round(b.height)));
        const old = view.getBounds();
        if (old.x !== x || old.y !== y || old.width !== width || old.height !== height) {
          view.setBounds({x, y, width, height});
          chat.event('IAB.viewportChanged', {width, height}, id);
        }
      }
    }
  }
  function setLayout(value) {
    if (!value || typeof value.sessionId !== 'string') return;
    if (!value.visible) {
      if (layout?.sessionId === value.sessionId) layout = null;
    } else {
      if (!value.bounds || !['x','y','width','height'].every(k => Number.isFinite(value.bounds[k]))) return;
      layout = value;
    }
    show();
  }
  async function createChat(id, socket) {
    if (chats.has(id)) throw new Error('此聊天已连接桌面浏览器。');
    const hash = createHash('sha256').update(id).digest('hex').slice(0, 24);
    const storage = session.fromPath(join(dataDir, 'profiles-native', hash));
    // OS/device permissions remain explicit; no silent grants to remote sites.
    storage.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const chat = {id, socket, views: new Map(), active: null, nextId: 0};
    chat.event = (method, params, sessionId) => {
      if (!socket.destroyed) socket.write(JSON.stringify({method, params, sessionId}) + '\n');
    };
    chat.info = (id, view) => ({targetId: id, type: 'page', title: view.webContents.getTitle(), url: view.webContents.getURL() || 'about:blank'});
    chat.make = async url => {
      if (!safeUrl(url)) throw new Error('只支持 HTTP/HTTPS 页面。');
      const targetId = `page-${++chat.nextId}`;
      const view = new WebContentsView({webPreferences: {session: storage, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false}});
      window.contentView.addChildView(view); view.setBounds({x: 0, y: 0, width: 1280, height: 800}); view.setVisible(false);
      chat.views.set(targetId, view);
      const wc = view.webContents;
      wc.on('will-navigate', (event, next) => { if (!safeUrl(next)) event.preventDefault(); });
      wc.on('will-redirect', (event, next) => { if (!safeUrl(next)) event.preventDefault(); });
      wc.setWindowOpenHandler(({url: next}) => {
        if (safeUrl(next)) void chat.make(next).then(newId => {
          chat.event('Target.targetCreated', {targetInfo: {...chat.info(newId, chat.views.get(newId)), openerId: targetId}});
        }).catch(() => {});
        return {action: 'deny'};
      });
      await wc.loadURL('about:blank');
      wc.debugger.attach('1.3');
      wc.debugger.on('message', (_event, method, params) => chat.event(method, params, targetId));
      const info = () => chat.event('Target.targetInfoChanged', {targetInfo: chat.info(targetId, view)});
      wc.on('page-title-updated', info); wc.on('did-navigate', info); wc.on('did-navigate-in-page', info);
      if (url !== 'about:blank') void wc.loadURL(url).catch(() => {});
      return targetId;
    };
    chat.close = () => {
      if (chat.closed) return;
      chat.closed = true;
      const views = [...chat.views.values()];
      chat.views.clear();
      if (chats.get(id) === chat) chats.delete(id);
      for (const view of views) disposeView(view);
    };
    chat.command = async (method, params, targetId) => {
      switch (method) {
        case 'Browser.getVersion': return {product: `Electron/${process.versions.electron}`};
        case 'Target.setDiscoverTargets': return {};
        case 'Target.getTargets': return {targetInfos: [...chat.views].map(([id, view]) => chat.info(id, view))};
        case 'Target.createTarget': return {targetId: await chat.make(params.url)};
        case 'Target.attachToTarget':
          if (!chat.views.has(params.targetId)) throw new Error('Unknown tab');
          return {sessionId: params.targetId};
        case 'Target.activateTarget':
          if (!chat.views.has(params.targetId)) throw new Error('Unknown tab');
          chat.active = params.targetId; show(); return {};
        case 'Target.closeTarget': {
          const view = chat.views.get(params.targetId);
          if (!view) throw new Error('Unknown tab');
          chat.views.delete(params.targetId); disposeView(view); return {success: true};
        }
        case 'Browser.close': chat.close(); return {};
      }
      const view = chat.views.get(targetId);
      if (!view) throw new Error('Unknown page session');
      // Do not expose the global Electron/Chromium Target or Browser domains.
      if (!/^(Page|Runtime|Input|Emulation)\./.test(method)) throw new Error('Unsupported page command');
      if (method === 'Page.navigate' && !safeUrl(params.url)) throw new Error('Unsupported URL');
      return view.webContents.debugger.sendCommand(method, params);
    };
    chats.set(id, chat); return chat;
  }
  const server = createServer(socket => {
    sockets.add(socket); let pending = '', chat, chain = Promise.resolve();
    const timer = setTimeout(() => { if (!chat) socket.destroy(); }, 5000); timer.unref();
    socket.setEncoding('utf8');
    socket.on('data', data => {
      pending += data;
      if (pending.length > 1024 * 1024) return socket.destroy();
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        let packet; try { packet = JSON.parse(line); } catch { socket.destroy(); return; }
        // Preserve handshake order, but allow dialog resolution beside in-flight evaluate.
        if (!chat && packet.hello) {
          chain = chain.then(async () => {
            if (typeof packet.hello !== 'string' || packet.hello.length !== secret.length || !timingSafeEqual(Buffer.from(packet.hello), Buffer.from(secret))) throw new Error('Invalid pairing');
            if (typeof packet.sessionId !== 'string' || !packet.sessionId || packet.sessionId.length > 200) throw new Error('Invalid chat');
            chat = await createChat(packet.sessionId, socket); clearTimeout(timer);
          }).catch(() => socket.destroy());
        } else void chain.then(async () => {
          try {
            if (!chat || !Number.isInteger(packet.id)) throw new Error('Pair desktop first');
            const result = await chat.command(packet.method, packet.params || {}, packet.sessionId);
            if (!socket.destroyed) socket.write(JSON.stringify({id: packet.id, result}) + '\n');
          } catch (error) { if (!socket.destroyed) socket.write(JSON.stringify({id: packet.id, error: {message: error.message}}) + '\n'); }
        });
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); chat?.close(); sockets.delete(socket); });
  });
  return {server, setLayout, chats, async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); }); },
    close() { for (const socket of sockets) socket.destroy(); for (const chat of [...chats.values()]) chat.close(); server.close(); }};
}
module.exports = {createNativeHost};
