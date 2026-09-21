import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {BrowserManager} from '../src/browser.js';
import {createHttpHandler} from '../src/http.js';

const output=resolve('outputs/launcher-smoke');await mkdir(output,{recursive:true});
const data=resolve(output,'run-'+Date.now());
const manager=new BrowserManager({homePage: 'about:blank', dataDir:data});const http=createHttpHandler(manager);
let finish=false, child;
const server=createServer((req,res)=>{
  if(req.url.startsWith('/dsh-inapp-browser/api/'))return void http.handler(req,res);
  if(req.url==='/finish'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({finish}));}
  res.setHeader('Content-Type','text/html');
  res.end(`<body style="font:16px system-ui"><h2>Desktop launcher smoke</h2><p>Native test page on the right.</p><script>
  window.dshIabDesktop.layout({sessionId:'launcher-test',visible:true,bounds:{x:400,y:100,width:700,height:600}});
  setInterval(async()=>{if((await(await fetch('/finish')).json()).finish)window.close()},200);
  </script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const until=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Timeout '+label)};
let stderr='';
try {
  const env={...process.env,DSH_IAB_DATA_DIR:data,DSH_IAB_DESKTOP_DATA:resolve(data,'shell')};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(resolve('outputs/dsh-inapp-browser-desktop-0.2.0-win-x64/runtime/electron.exe'),[resolve('tests/desktop-main-smoke.cjs'),`--harness=${base}`],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',d=>{stderr+=d});
  await until(()=>manager.desktop,'packaged launcher pairs');
  const s=await manager.get('launcher-test');await s.navigate(base+'/page');
  assert.equal((await s.state()).mode,'native');assert.match((await s.snapshot()).text,/Desktop launcher smoke/);
  assert.equal(await s.evaluate('typeof window.dshIabDesktop'),'undefined'); // remote content has no preload bridge
  console.log('PASS packaged launcher pairs and remote webpage has no desktop bridge');
  finish=true;
  await until(()=>child.exitCode!==null,'launcher shutdown');
  assert.equal(child.exitCode,0);assert.equal(manager.desktop,null);assert.equal(manager.sessions.size,0);
  console.log('PASS packaged launcher closes, disconnects and releases native sessions');
  await writeFile(resolve(output,'result.json'),JSON.stringify({packagedLauncher:true,paired:true,remotePreloadIsolated:true,cleanExit:true,date:new Date().toISOString()},null,2));
}catch(error){console.error(stderr);throw error;}
finally {if(child&&child.exitCode===null)child.kill();http.dispose();await manager.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));}
