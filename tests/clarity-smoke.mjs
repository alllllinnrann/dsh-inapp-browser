import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {BrowserManager} from '../src/browser.js';
const output=resolve('outputs/clarity');await mkdir(output,{recursive:true});
const manager=new BrowserManager({homePage:'about:blank',dataDir:resolve(output,'run-'+Date.now())});
const html=await readFile(new URL('./fixture.html',import.meta.url));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
function jpegSize(base64){const b=Buffer.from(base64,'base64');for(let i=2;i<b.length;){if(b[i++]!==255)continue;let marker=b[i++];if(marker===216||marker===217)continue;const len=b.readUInt16BE(i);if([192,193,194].includes(marker))return {width:b.readUInt16BE(i+5),height:b.readUInt16BE(i+3)};i+=len;}throw Error('Missing JPEG dimensions');}
try{
 const s=await manager.get('clarity');await s.navigate(`http://127.0.0.1:${server.address().port}`);
 const results=[];
 for(const dpr of [1,1.5,2]){
  await s.resize(900,600,dpr);let last;
  const listener=event=>{if(event.method==='Page.screencastFrame')last=event.params;};s.cdp.on('event',listener);
  let displayed; const frames=[]; const off=await s.subscribe(f=>{displayed=f;frames.push(f);},()=>{});
  for(let i=0;i<8;i++){await s.evaluate(`document.body.style.background='rgb(${240+i},245,250)'`);await new Promise(r=>setTimeout(r,80));}
  const movingFrames=frames.length; assert.ok(movingFrames>=2,'continuous changes must not starve capture');
  const deadline=Date.now()+5000; while(displayed?.mimeType!=='image/png' && Date.now()<deadline) await new Promise(r=>setTimeout(r,50));
  assert.equal(displayed?.mimeType,'image/png','settled frame must be lossless PNG');
  for(const f of frames){assert.equal(f.mimeType,'image/png','no low quality fallback');const b=Buffer.from(f.image,'base64');assert.equal(b.readUInt32BE(16),Math.round(900*dpr));assert.equal(b.readUInt32BE(20),Math.round(600*dpr));}
  const pixels=Buffer.from(displayed.image,'base64');
  assert.equal(pixels.readUInt32BE(16),Math.round(900*dpr));assert.equal(pixels.readUInt32BE(20),Math.round(600*dpr));
  off();s.cdp.off('event',listener);if(!last)throw Error('No actual screencast frames');
  const shot=await s.screenshot();
  results.push({requestedDpr:dpr,dom:await s.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})'),stream:jpegSize(last.data),displayed:{width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20)},png:{width:shot.data.readUInt32BE(16),height:shot.data.readUInt32BE(20)},metadata:last.metadata});
 }
 console.log(JSON.stringify(results,null,2));await writeFile(resolve(output,'result.json'),JSON.stringify(results,null,2));
}finally{await manager.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));}
