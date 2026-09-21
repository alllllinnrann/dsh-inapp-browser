const {contextBridge, ipcRenderer} = require('electron');
const desktopId = process.argv.find(arg => arg.startsWith('--iab-desktop-id='))?.split('=')[1];
// No filesystem, arbitrary IPC, or CDP exposed to the Harness renderer.
contextBridge.exposeInMainWorld('dshIabDesktop', Object.freeze({
  id: desktopId,
  layout: value => ipcRenderer.send('iab:layout', value),
}));
