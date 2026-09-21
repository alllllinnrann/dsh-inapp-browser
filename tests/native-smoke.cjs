const {app, BrowserWindow, ipcMain, desktopCapturer} = require('electron');
const {createServer} = require('node:http');
const {readFile, writeFile, mkdir} = require('node:fs/promises');
const {resolve, join} = require('node:path');
const {randomBytes} = require('node:crypto');
const assert = require('node:assert/strict');
const {createNativeHost} = require('../desktop/native-host.cjs');
const output = resolve(__dirname, '../outputs/native-smoke');
const runDir = join(output, 'run-' + Date.now());
app.setPath('userData', join(runDir, 'shell'));
app.on('window-all-closed', () => {}); // Keep the test alive to assert post-window IPC cleanup.
let server, manager, http, host, win;
const watchdog = setTimeout(() => { console.error('Native smoke exceeded 90 seconds'); app.exit(1); }, 90000);
const checks = [];
const ok = label => {checks.push(label); console.log('PASS', label);};
const until = async (fn, label) => {for(let i=0;i<60;i++){if(await fn()) return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+label);};
app.whenReady().then(async () => {
  const {BrowserManager} = await import('../src/browser.js');
  const {createHttpHandler} = await import('../src/http.js');
  const {build} = require('esbuild');
  manager = new BrowserManager({homePage: 'about:blank', dataDir: runDir});
  let cancelled = 0, streams = 0;
  http = createHttpHandler(manager, new Map(), {stopTask: async () => {cancelled++; return true;}});
  const fixture = await readFile(join(__dirname, 'fixture.html'));
  const client = await readFile(join(__dirname, '../lib/client.js'));
  const bundle = await build({stdin:{contents:`import * as React from 'react';import {createRoot} from 'react-dom/client';window.__ModuleLoader__={load({factory}){const p=factory(n=>{if(n==='react')return React;throw Error(n)});p.apply({effect(fn){fn()},betterSidebar:{registerTab(d){const P=d.component;createRoot(document.getElementById('app')).render(React.createElement(P,{scope:{sessionId:'native-smoke'},visible:true}));return ()=>{}},openTab(){}}})}};`,resolveDir:resolve(__dirname,'..'),loader:'js'},bundle:true,write:false,format:'iife'});
  server = createServer((req,res) => {
    if(req.url.startsWith('/dsh-inapp-browser/api/')) {if(req.url.endsWith('/stream'))streams++;return void http.handler(req,res);}
    if(req.url==='/runtime.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
    if(req.url==='/client.js'){res.setHeader('Content-Type','application/javascript');return res.end(client);}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/ui')return res.end('<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#f5f6f8}aside{position:absolute;left:24px;top:24px;width:280px;font:16px system-ui}#app{position:absolute;left:330px;right:12px;top:12px;bottom:12px;border:1px solid #ddd;border-radius:8px;overflow:hidden}</style><aside><h2>Harness 原生浏览器</h2><p>测试宿主 · 同一网页，人和 AI 共享</p><p>右侧是真实 WebContentsView，没有 JPEG 转播。</p></aside><div id="app"></div><script src="/runtime.js"></script><script src="/client.js"></script>');
    res.end(fixture);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const desktopId=randomBytes(16).toString('hex'), secret=randomBytes(32).toString('hex');
  const pipe=`\\\\.\\pipe\\dsh-iab-${desktopId}`;
  win = new BrowserWindow({width:1400,height:950,show:false,webPreferences:{preload:resolve(__dirname,'../desktop/preload.cjs'),additionalArguments:[`--iab-desktop-id=${desktopId}`],sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  host=createNativeHost({window:win,pipe,secret,dataDir:runDir});await host.listen();
  ipcMain.on('iab:layout',(event,value)=>{if(event.sender===win.webContents)host.setLayout(value)});
  const headers={'x-dsh-iab':'1','Content-Type':'application/json',Origin:base};
  const {token}=await(await fetch(base+'/dsh-inapp-browser/api/bootstrap',{method:'POST',headers})).json();headers['x-dsh-iab-token']=token;
  const call=async(method,args={})=>{const res=await fetch(base+'/dsh-inapp-browser/api/'+method,{method:'POST',headers,body:JSON.stringify({sessionId:'native-smoke',...args})});const body=await res.json();if(!res.ok)throw Error(body.error);return body};
  await call('desktopConnect',{pipe,secret,desktopId});
  await win.loadURL(base+'/ui');
  await until(()=>manager.sessions.has('native-smoke'),'native panel initialization');
  const s=await manager.get('native-smoke');
  let snap=await s.run('agent',()=>s.navigate(base));
  assert.equal(snap.title,'浏览器交互验收');assert.equal((await s.state()).mode,'native');ok('real native view created through plugin HTTP pairing + private IPC');
  await until(()=>host.chats.get('native-smoke')?.views.get(s.active)?.getBounds().width<1100,'layout');
  const wc=host.chats.get('native-smoke').views.get(s.active).webContents;
  win.showInactive(); wc.focus();
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".dsh-iab-viewport img").length'),0);
  assert.equal(streams,0);ok('native panel renders with zero screenshot-stream requests');
  snap=await s.snapshot();const field=snap.elements.find(e=>e.label==='姓名');
  wc.sendInputEvent({type:'mouseDown',x:field.x,y:field.y,button:'left',clickCount:1});
  wc.sendInputEvent({type:'mouseUp',x:field.x,y:field.y,button:'left',clickCount:1});
  await wc.insertText('原生中文输入 ✅');
  assert.equal(await s.evaluate('document.querySelector("#name").value'),'原生中文输入 ✅');
  assert.equal(s.paused,false);ok('native mouse + Unicode input reach same AI page without auto pause');
  await s.run('agent',()=>s.key({key:'Enter'}));
  await until(async()=> (await s.snapshot()).text.includes('已提交：原生中文输入 ✅'),'submit');ok('AI continues on human-edited native page');
  wc.sendInputEvent({type:'mouseWheel',x:200,y:300,deltaY:-400,canScroll:true});
  await until(async()=>await s.evaluate('scrollY')>0,'native scroll');ok('native wheel scroll');
  const shot=await s.screenshot();assert.equal(shot.data.subarray(1,4).toString(),'PNG');
  const metrics=await s.evaluate('({width:innerWidth,height:innerHeight})');assert.equal(shot.width,metrics.width);ok('on-demand screenshot uses actual native viewport dimensions');
  await mkdir(output,{recursive:true});await writeFile(join(output,'page.png'),shot.data);
  const old=s.active;await s.run('agent',()=>s.navigate(base,undefined,true));assert.notEqual(s.active,old);await s.dispatch('select',{targetId:old});assert.equal(s.active,old);ok('native multi-tab create and switch');
  const pending=s.run('agent',()=>s.wait(10000));const rejected=assert.rejects(pending,/abort/i);
  await Promise.resolve();
  await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="暂停 AI"]').click()`);
  await until(()=>s.paused,'pause');await rejected;assert.equal(cancelled,1);
  await assert.rejects(s.run('agent',()=>s.type('wrong')),/暂停/);ok('pause button interrupts wait, rejects AI operations, calls task cancellation hook');
  await s.run('human',()=>s.type('human still allowed'));ok('human browsing stays usable while AI paused');
  await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="允许 AI"]').click()`);await until(()=>!s.paused,'resume');
  await s.evaluate('scrollTo(0,0)');
  await s.evaluate('localStorage.setItem("native-persist","yes")');
  const activeView=host.chats.get('native-smoke').views.get(s.active);assert.equal(activeView.getVisible(),true);
  await new Promise(r=>setTimeout(r,300));
  const surfaces=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1400,height:950}});
  const surface=surfaces.find(source=>source.id===win.getMediaSourceId());
  if(!surface || surface.thumbnail.isEmpty())throw Error('Native window screenshot unavailable');
  await writeFile(join(output,'panel.png'),surface.thumbnail.toPNG());ok('native child view visible and actual window captured');
  // Stop panel polling before explicitly closing its browser session.
  await win.loadURL('about:blank');
  await manager.close('native-smoke');const reopened=await manager.get('native-smoke');await reopened.navigate(base);
  assert.equal(await reopened.evaluate('localStorage.getItem("native-persist")'),'yes');ok('native login-storage profile survives session restart');
  const other=await manager.get('native-other');await other.navigate(base);assert.equal(await other.evaluate('localStorage.getItem("native-persist")'),null);ok('native profiles isolated by chat');
  // Regression: the window may disappear before IPC sockets close. Cleanup must be idempotent.
  const savedChats=[...host.chats.values()];
  win.destroy();
  for(const chat of savedChats){chat.close();chat.close();}
  await manager.dispose();await new Promise(r=>setTimeout(r,100));
  assert.equal(host.chats.size,0);ok('window destroyed before socket close; repeated cleanup stays safe');
  await writeFile(join(output,'result.json'),JSON.stringify({passed:checks.length,checks,date:new Date().toISOString(),actualElectron:process.versions.electron,host:'test adapter, not live Harness'},null,2));
}).then(()=>finish(0)).catch(error=>{console.error(error.stack);finish(1)});
async function finish(code) {
  clearTimeout(watchdog);
  http?.dispose();await manager?.dispose();host?.close();
  if(win&&!win.isDestroyed())win.destroy();
  server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));app.exit(code);
}
