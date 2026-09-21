import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, number, browserCandidates } from '../src/platform.js';
import { trustedRequest } from '../src/http.js';
import { BrowserSession } from '../src/browser.js';
import { EventEmitter } from 'node:events';

test('new browser session navigates to Bing instead of staying blank', async () => {
  const cdp = new EventEmitter(); const calls = [];
  cdp.send = async (method, params) => {
    calls.push([method, params]);
    if (method === 'Target.getTargets') return {targetInfos: [{type:'page',targetId:'page1',url:'about:blank'}]};
    if (method === 'Target.attachToTarget') return {sessionId:'session1'};
    return {};
  };
  await new BrowserSession('home-test', cdp).init();
  assert.ok(calls.some(([method, params]) => method === 'Page.navigate' && params.url === 'https://www.bing.com/'));
});

test('URLs vs search, Chinese encoding, blocked executable schemes', () => {
  assert.equal(normalizeUrl('抖音'), 'https://www.bing.com/search?q=%E6%8A%96%E9%9F%B3');
  assert.equal(normalizeUrl(''), 'https://www.bing.com/');
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('localhost:3000/a'), 'http://localhost:3000/a');
  assert.match(normalizeUrl('a b', 'bing'), /bing\.com/);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,abc', 'https://a:b@example.com']) assert.throws(() => normalizeUrl(value));
  assert.throws(() => number(NaN, 0, 100, 'x'));
  assert.throws(() => number(-1, 0, 100, 'x'));
});

test('request fence rejects remote origins, DNS rebinding, missing headers', () => {
  const req = () => ({socket: {remoteAddress: '127.0.0.1', localPort: 3080}, headers: {host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'x-dsh-iab': '1', 'sec-fetch-site': 'same-origin'}});
  assert.equal(trustedRequest(req()), true);
  const remote = req(); remote.socket.remoteAddress = '192.168.1.4'; assert.equal(trustedRequest(remote), false);
  const origin = req(); origin.headers.origin = 'https://evil.example'; assert.equal(trustedRequest(origin), false);
  const host = req(); host.headers.host = 'evil.example:3080'; assert.equal(trustedRequest(host), false);
  const missing = req(); delete missing.headers['x-dsh-iab']; assert.equal(trustedRequest(missing), false);
  const site = req(); site.headers['sec-fetch-site'] = 'cross-site'; assert.equal(trustedRequest(site), false);
});

test('browser discovery derives from OS environment, not author machine paths', () => {
  const paths = browserCandidates('win32', {ProgramFiles: 'Z:/Applications'});
  assert.equal(paths.length, 2); assert.ok(paths.every(p => p.includes('Applications')));
  assert.ok(browserCandidates('linux', {}).includes('/usr/bin/chromium'));
});

test('takeover stops queued agent actions, keeps human actions usable, abort stops dispatch', async () => {
  const s = new BrowserSession('test', new EventEmitter()); let release;
  const first = s.run('agent', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); let ran = false;
  const queued = s.run('agent', () => { ran = true; });
  s.paused = true; release(); await first;
  await assert.rejects(queued, /暂停/); assert.equal(ran, false);
  assert.equal(await s.run('human', () => 'ok'), 'ok');
  s.paused = false;
  const abort = new AbortController(); abort.abort();
  await assert.rejects(s.run('agent', () => { ran = true; }, abort.signal));
  assert.equal(ran, false);
});

test('pause interrupts waits and invalidates old queued work even after resume', async () => {
  const s = new BrowserSession('pause-test', new EventEmitter());
  const running = s.run('agent', () => s.wait(10000));
  await Promise.resolve();
  let clicked = false;
  const queued = s.run('agent', () => { clicked = true; });
  s.setPaused(true); s.setPaused(false);
  await assert.rejects(running, /abort/i);
  await assert.rejects(queued, /暂停/);
  assert.equal(clicked, false);
  assert.equal(await s.run('human', () => 'still usable'), 'still usable');
  assert.equal(await s.run('agent', () => 'new task'), 'new task');
});
