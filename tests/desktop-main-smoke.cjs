// Test-only entry: run the unmodified packaged main module, then exercise app quit.
const {app} = require('electron');
require('../outputs/dsh-inapp-browser-desktop-0.2.0-win-x64/main.cjs');
app.whenReady().then(() => setTimeout(() => app.quit(), 8000));
