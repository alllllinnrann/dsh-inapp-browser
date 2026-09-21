const {app, BrowserWindow, ipcMain, dialog, Menu} = require('electron');
const {join} = require('node:path');
const {homedir, tmpdir} = require('node:os');
const {randomBytes} = require('node:crypto');
const {createNativeHost} = require('./native-host.cjs');

const rawUrl = process.argv.find(arg => arg.startsWith('--harness='))?.slice(10) || 'http://127.0.0.1:3080';
let url;
try {
  url = new URL(rawUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error();
} catch { console.error('Harness URL must be a local HTTP address.'); app.exit(1); }
const desktopId = randomBytes(16).toString('hex'), secret = randomBytes(32).toString('hex');
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-iab-${desktopId}` : join(tmpdir(), `dsh-iab-${desktopId}.sock`);
const dataDir = process.env.DSH_IAB_DATA_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-inapp-browser');
if (process.env.DSH_IAB_DESKTOP_DATA) app.setPath('userData', process.env.DSH_IAB_DESKTOP_DATA);
let host, win, token, paired = false, quitting = false;
async function request(method, args = {}) {
  const headers = {'x-dsh-iab': '1', 'Content-Type': 'application/json', Origin: url.origin};
  if (!token) {
    const response = await fetch(url.origin + '/dsh-inapp-browser/api/bootstrap', {method: 'POST', headers, signal: AbortSignal.timeout(5000)});
    const body = await response.json(); if (!response.ok || !body.token) throw new Error('Harness 中未加载第二版浏览器插件。'); token = body.token;
  }
  headers['x-dsh-iab-token'] = token;
  const response = await fetch(url.origin + '/dsh-inapp-browser/api/' + method, {method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(8000)});
  const body = await response.json(); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body;
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({width: 1450, height: 940, minWidth: 900, minHeight: 600, show: false, title: 'Harness · 原生浏览器',
    webPreferences: {preload: join(__dirname, 'preload.cjs'), additionalArguments: [`--iab-desktop-id=${desktopId}`], contextIsolation: true, sandbox: true, nodeIntegration: false}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } });
  const restrict = (event, next) => { try { if (new URL(next).origin !== url.origin) event.preventDefault(); } catch { event.preventDefault(); } };
  win.webContents.on('will-navigate', restrict); win.webContents.on('will-redirect', restrict);
  host = createNativeHost({window: win, pipe, secret, dataDir}); await host.listen();
  ipcMain.on('iab:layout', (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    if (new URL(event.senderFrame.url).origin !== url.origin) return;
    host.setLayout(value);
  });
  try {
    await request('desktopConnect', {pipe, secret, desktopId}); paired = true;
    await win.loadURL(url.href); win.show();
  } catch (error) {
    await dialog.showMessageBox(win, {type: 'error', title: '无法连接 Harness', message: '请先启动已安装 0.2.0 插件的本机 Harness。', detail: `${error.message}\n\n默认地址：http://127.0.0.1:3080\n其他端口：启动器 --harness=http://127.0.0.1:端口\n如果已有旧浏览器会话，请先关闭该会话。`}); app.quit();
  }
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return; event.preventDefault(); quitting = true;
  // Detach while views are still alive, and release per-chat profiles.
  Promise.resolve(paired ? request('desktopDisconnect', {desktopId}).catch(() => {}) : undefined)
    .finally(() => { host?.close(); app.quit(); });
});
