import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { BrowserManager } from '../src/browser.js';
import { createHttpHandler } from '../src/http.js';
import { build } from 'esbuild';

const output = resolve('outputs/smoke'); await mkdir(output, {recursive: true});
const dataDir = resolve(output, 'run-' + Date.now());
const manager = new BrowserManager({homePage: 'about:blank', dataDir});
const viewer = new BrowserManager({homePage: 'about:blank', dataDir: resolve(dataDir, 'viewer')});
const http = createHttpHandler(manager);
const fixture = await readFile(new URL('./fixture.html', import.meta.url));
const client = await readFile(new URL('../lib/client.js', import.meta.url));
const bundle = await build({stdin: {contents: `import * as React from 'react';import {createRoot} from 'react-dom/client'; window.__ModuleLoader__={load({factory}){const plugin=factory(name=>{if(name==='react')return React;throw Error(name)});const ctx={effect(fn){fn()},betterSidebar:{registerTab(d){const P=d.component;createRoot(document.getElementById('app')).render(React.createElement(P,{scope:{sessionId:'smoke'},visible:true}));return ()=>{}},openTab(){}}};plugin.apply(ctx)}};`, resolveDir: process.cwd(), loader: 'js'}, bundle: true, write: false, format: 'iife'});
const ui = `<!doctype html><html><meta charset="utf-8"><style>html,body,#app{height:100%;margin:0}#app{max-width:1000px;margin:auto}</style><div id="app"></div><script src="/runtime.js"></script><script src="/client.js"></script></html>`;
const server = createServer((req,res) => {
  if (req.url.startsWith('/dsh-inapp-browser/api/')) return void http.handler(req,res);
  if (req.url === '/ui') {res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(ui);}
  if (req.url === '/runtime.js') {res.setHeader('Content-Type','application/javascript'); return res.end(bundle.outputFiles[0].contents);}
  if (req.url === '/client.js') {res.setHeader('Content-Type','application/javascript'); return res.end(client);}
  res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(fixture);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const ok = label => {checks.push(label);console.log('PASS',label)};
const until = async (fn, label) => {for(let i=0;i<40;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timeout '+label)};
try {
  const s = await manager.get('smoke');
  const snap = await s.navigate(base);
  assert.equal(snap.title,'浏览器交互验收'); ok('real browser navigation and snapshot');
  const name = snap.elements.find(e=>e.label==='姓名'); await s.click(name); await s.type('中文输入 ✅'); await s.key({key:'Enter'});
  await until(async()=> (await s.snapshot()).text.includes('已提交：中文输入 ✅'),'form'); ok('mouse focus, Unicode text, Enter submit');
  const rect = await s.evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+5,y:r.y+40,toX:r.x+200,toY:r.y+50}})()`);
  await s.drag(rect); assert.match((await s.snapshot()).text,/拖拽成功/); ok('real mouse drag on canvas');
  await s.dispatch('scroll',{deltaY:550}); await until(async()=>await s.evaluate('scrollY')>0,'scroll'); ok('wheel scroll');
  await s.evaluate('scrollTo(0,0)');
  await s.evaluate(`localStorage.setItem('persist','yes')`);
  await manager.close('smoke'); const reopened=await manager.get('smoke'); await reopened.navigate(base);
  assert.equal(await reopened.evaluate(`localStorage.getItem('persist')`),'yes'); ok('profile persists after browser restart');
  const other=await manager.get('other'); await other.navigate(base);
  assert.equal(await other.evaluate(`localStorage.getItem('persist')`),null); await manager.close('other'); ok('chat profiles isolated');
  let frames=0;const off=await reopened.subscribe(()=>frames++,()=>{});await until(()=>frames>0,'stream');off();ok('live CDP frame stream');
  const png=await reopened.screenshot();assert.equal(png.data.subarray(1,4).toString(),'PNG'); await writeFile(resolve(output,'page.png'),png.data);ok('PNG screenshot');
  const headers={'x-dsh-iab':'1','Content-Type':'application/json',Origin:base};
  const bootstrap=await fetch(base+'/dsh-inapp-browser/api/bootstrap',{method:'POST',headers});const {token}=await bootstrap.json();headers['x-dsh-iab-token']=token;
  const evil=await fetch(base+'/dsh-inapp-browser/api/snapshot',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify({sessionId:'smoke'})}); assert.equal(evil.status,403);ok('cross-origin control rejected');
  const pause=await fetch(base+'/dsh-inapp-browser/api/pause',{method:'POST',headers,body:JSON.stringify({sessionId:'smoke',paused:true})});assert.equal(pause.status,200);
  await assert.rejects(reopened.run('agent',()=>reopened.type('wrong')),/暂停/);ok('explicit pause blocks agent');
  const view=await viewer.get('ui'); await view.resize(1280,800,2); await view.navigate(base+'/ui');
  await until(async()=>await view.evaluate(`!!document.querySelector('.dsh-iab-viewport img')?.src`),'UI frame');
  const buttons=await view.evaluate(`Array.from(document.querySelectorAll('button')).map(e=>e.getAttribute('aria-label'))`);assert.ok(buttons.includes('允许 AI'));ok('client module mounts in sidebar contract and renders live frame');
  // Actual CDP clicks in the embedded image must reach the separate real page.
  await reopened.evaluate('scrollTo(0,0)');await new Promise(r=>setTimeout(r,300));
  await until(async()=> Math.abs((await view.evaluate(`document.querySelector('.dsh-iab-viewport').getBoundingClientRect().width`))-reopened.width)<2,'auto viewport');
  await new Promise(r=>setTimeout(r,400));
  const field=(await reopened.snapshot()).elements.find(e=>e.label==='姓名');
  const mapped=await view.evaluate(`(()=>{const r=document.querySelector('.dsh-iab-viewport img').getBoundingClientRect(),s=Math.min(r.width/${reopened.width},r.height/${reopened.height});return {x:r.x+(r.width-${reopened.width}*s)/2+${field.x}*s,y:r.y+(r.height-${reopened.height}*s)/2+${field.y}*s}})()`);
  await view.click(mapped);await new Promise(r=>setTimeout(r,200));await view.type('通过内嵌面板');
  await until(async()=>await reopened.evaluate(`document.querySelector('#name').value`)==='通过内嵌面板','panel text');ok('embedded mouse coordinate mapping and input forwarding');
  await view.key({key:'Enter'});await until(async()=>(await reopened.snapshot()).text.includes('已提交：通过内嵌面板'),'panel submit');ok('embedded keyboard forwarding');
  // High-DPI changing content must not resize the containing flex panel.
  const dimensions = await view.evaluate(`(()=>{const r=document.querySelector('.dsh-iab-viewport').getBoundingClientRect();return {width:r.width,height:r.height}})()`);
  const originalResize = reopened.resize.bind(reopened); let resizes = 0; reopened.resize = async (...args) => {resizes++; return originalResize(...args);};
  for(let i=0;i<12;i++){
    await reopened.evaluate(`document.body.style.background='rgb(${220+i},245,250)'`); await new Promise(r=>setTimeout(r,110));
    const actual=await view.evaluate(`(()=>{const r=document.querySelector('.dsh-iab-viewport').getBoundingClientRect();return {width:r.width,height:r.height}})()`);assert.deepEqual(actual,dimensions);
  }
  assert.equal(resizes,0,'content updates must not trigger viewport resize');
  assert.ok(await view.evaluate(`document.querySelector('.dsh-iab-viewport img').src.startsWith('data:image/png')`));
  ok('high DPI animation keeps PNG quality and stable layout without resize feedback');
  await view.evaluate(`document.querySelector('#app').style.maxWidth='800px'`);
  await until(()=>reopened.width===800,'explicit panel resize');
  await new Promise(r=>setTimeout(r,400));assert.equal(resizes,1,'one actual panel size change should resize once');
  ok('intentional panel resize converges once');
  await writeFile(resolve(output,'panel.png'),(await view.screenshot()).data);
  await writeFile(resolve(output,'result.json'),JSON.stringify({passed:checks.length,checks,date:new Date().toISOString()},null,2));
} finally {
  http.dispose();await viewer.dispose();await manager.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
