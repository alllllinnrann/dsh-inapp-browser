import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Optional test-only resolution into an existing packaged Harness. Never used in the shipped plugin.
if (process.env.DSH_TEST_MODULES) registerHooks({resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') return {url: pathToFileURL(join(process.env.DSH_TEST_MODULES, '@deepseek-ai/dsh-tools/lib/index.js')).href, shortCircuit: true};
  return next(specifier, context);
}});
process.env.DSH_IAB_HOME_URL = 'about:blank';
process.env.DSH_IAB_DATA_DIR = resolve('outputs/smoke/host-' + Date.now());
const entry = process.env.DSH_TEST_PLUGIN_ENTRY ? pathToFileURL(resolve(process.env.DSH_TEST_PLUGIN_ENTRY)).href : new URL('../src/index.js', import.meta.url).href;
const {apply, inject} = await import(entry);
assert.deepEqual(inject, ['tools', 'webServer']);
const tools = new Map(), routes = [], disposers = [];
let acceptsImage = true, imageSaved = false, cancelled = false;
const ctx = {
  tools: {register(tool) {assert.ok(!tools.has(tool.name)); tools.set(tool.name, tool);}},
  webServer: {register(route) {routes.push(route);return () => routes.splice(routes.indexOf(route),1);}},
  effect(fn) {const off=fn();if(typeof off==='function')disposers.push(off);},
  inject(keys, fn) {assert.deepEqual(keys,['attachments','llm']);fn(ctx);},
  llm: {async resolveModelInfo() {return {inputModalities:acceptsImage?['text','image']:['text']};}},
  attachments: {async saveImage({data,mediaType,name}) {
    assert.equal(data.subarray(1,4).toString(),'PNG');imageSaved=true;
    return {attachmentId:'smoke-image',mediaType,name,bytes:data.length,width:1280,height:800};
  }},
};
apply(ctx);assert.equal(tools.size,17);assert.equal(routes[0].path,'/dsh-inapp-browser/api');
const fixture = await readFile(new URL('./fixture.html',import.meta.url));
const server=createServer((req,res)=>{if(req.url.startsWith('/dsh-inapp-browser/api/'))return void routes[0].handler(req,res);res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const exec={agent:{id:'host-contract',cancel(reason,options){assert.equal(reason.kind,'user');assert.equal(options.keepInbox,false);cancelled=true;},session:{requestHeader:()=>({config:{provider:'test',model:'test'}})},options:{}},signal:new AbortController().signal};
const call=(name,args={})=>tools.get(name).execute(args,exec);
try {
  const snap=await call('iab_open',{url:`http://127.0.0.1:${server.address().port}`});
  assert.equal(snap.title,'浏览器交互验收');
  await assert.rejects(call('iab_click',{x:'bad',y:20}));
  const image=await call('iab_screenshot');assert.ok(imageSaved);
  const rendered=tools.get('iab_screenshot').output.render({},image);
  assert.equal(rendered[1].type,'image');assert.equal(rendered[1].attachment.attachmentId,'smoke-image');
  acceptsImage=false;await assert.rejects(call('iab_screenshot'),/图片输入/);
  const click=snap.elements.find(e=>e.label==='提交');await call('iab_click',{x:click.x,y:click.y});
  const text=tools.get('iab_snapshot').output.render({},await call('iab_snapshot'));
  assert.match(text[0].text,/已提交/);
  const base=`http://127.0.0.1:${server.address().port}`,headers={'x-dsh-iab':'1','Content-Type':'application/json',Origin:base};
  const {token}=await (await fetch(base+'/dsh-inapp-browser/api/bootstrap',{method:'POST',headers})).json();headers['x-dsh-iab-token']=token;
  const pause=value=>fetch(base+'/dsh-inapp-browser/api/pause',{method:'POST',headers,body:JSON.stringify({sessionId:'host-contract',paused:value})});
  const paused=await pause(true);assert.equal(paused.status,200);assert.equal((await paused.json()).taskStopped,true);assert.equal(cancelled,true);await assert.rejects(call('iab_close'),/暂停/);assert.equal((await pause(false)).status,200);
  console.log('PASS actual Harness defineTool registration, argument validation, browser dispatch, image block protocol, text-only model guard, takeover close guard, route lifecycle');
  await mkdir(resolve('outputs/smoke'),{recursive:true});await writeFile(resolve('outputs/smoke/host-result.json'),JSON.stringify({tools:[...tools.keys()],actualDefineTool:true,imageAttachmentContract:true},null,2));
} finally {
  await call('iab_close');for(const dispose of disposers.reverse())dispose();assert.equal(routes.length,0);
  server.closeAllConnections();await new Promise(r=>server.close(r));
}
