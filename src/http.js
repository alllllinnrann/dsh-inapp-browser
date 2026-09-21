import { randomBytes, timingSafeEqual } from 'node:crypto';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
export function trustedRequest(req) {
  if (!loopback(req.socket.remoteAddress)) return false;
  if (req.headers['x-dsh-iab'] !== '1') return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    if (Number(host.port || 80) !== req.socket.localPort) return false;
    if (req.headers.origin && req.headers.origin !== host.origin) return false;
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
    return true;
  } catch { return false; }
}

async function readJson(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('JSON body required');
  let size = 0; const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Request body exceeds 64 KiB');
    parts.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(parts).toString() || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Object required');
  return result;
}

export function json(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(value));
}

export function createHttpHandler(manager, activity = new Map(), hooks = {}) {
  const token = randomBytes(32).toString('hex');
  const streams = new Set();
  const validToken = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const handler = async (req, res) => {
    if (!trustedRequest(req)) return json(res, 403, {error: '仅允许本机 Harness 页面访问浏览器插件。'});
    if (req.method !== 'POST') return json(res, 405, {error: 'POST required'});
    const method = new URL(req.url, 'http://localhost').pathname.split('/').pop();
    if (method === 'bootstrap') return json(res, 200, {token});
    if (!validToken(req.headers['x-dsh-iab-token'])) return json(res, 401, {error: '浏览器连接已过期，请重新连接。'});
    try {
      const args = await readJson(req);
      if (method === 'desktopConnect') { manager.connectDesktop(args); return json(res, 200, {ok: true}); }
      if (method === 'desktopDisconnect') { await manager.disconnectDesktop(args.desktopId); return json(res, 200, {ok: true}); }
      if (method === 'activity') return json(res, 200, {items: [...activity].map(([sessionId, stamp]) => ({sessionId, stamp}))});
      if (method === 'closeSession') { await manager.close(args.sessionId); activity.delete(args.sessionId); return json(res, 200, {ok: true}); }
      const session = await manager.get(args.sessionId);
      if (method === 'state') return json(res, 200, {...await session.state(), ...hooks.agentState?.(args.sessionId)});
      if (method === 'pause') {
        // Never wait behind page navigation/evaluation: stopping must remain responsive.
        const result = session.setPaused(args.paused === true);
        if (session.paused) {
          try { result.taskStopped = await hooks.stopTask?.(args.sessionId) || false; }
          catch (error) { result.stopError = error.message; result.taskStopped = false; }
        }
        return json(res, 200, {...result, ...hooks.agentState?.(args.sessionId)});
      }
      if (method === 'dialog') {
        // A modal may be blocking an in-flight page evaluation; resolving it must not queue behind that evaluation.
        await session.dispatch('dialog', args);
        const state = await session.state(); session.emit('state', state); return json(res, 200, state);
      }
      if (method === 'stream') {
        res.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'});
        res.flushHeaders(); streams.add(res);
        let blocked = false, latestFrame, latestState, off, ended = false;
        const write = value => {
          if (ended || res.destroyed) return;
          if (blocked) {
            if (value.kind === 'frame') latestFrame = value;
            else latestState = {...latestState, ...value, value: {...latestState?.value, ...value.value}};
            return;
          }
          blocked = !res.write(JSON.stringify(value) + '\n');
        };
        res.on('drain', () => { blocked = false; const state = latestState; latestState = null; if (state) write(state); const frame = latestFrame; latestFrame = null; if (frame) write(frame); });
        const heart = setInterval(() => write({kind: 'heartbeat'}), 15000); heart.unref();
        const cleanup = () => { ended = true; clearInterval(heart); off?.(); streams.delete(res); };
        res.once('close', cleanup);
        try {
          off = await session.subscribe(value => write({kind: 'frame', value}), value => write({kind: 'state', value: {...value, ...hooks.agentState?.(args.sessionId)}}));
          if (ended) off();
        } catch (error) { write({kind: 'state', value: {error: error.message}}); res.end(); }
        return;
      }
      if (method === 'screenshot') {
        const shot = await session.run('human', () => session.screenshot());
        return json(res, 200, {image: shot.data.toString('base64'), width: shot.width, height: shot.height});
      }
      const allowed = new Set(['open', 'snapshot', 'state', 'click', 'mouse', 'type', 'key', 'drag', 'scroll', 'resize', 'back', 'forward', 'reload', 'wait', 'select', 'closeTab', 'dialog']);
      if (!allowed.has(method)) return json(res, 404, {error: 'Unknown command'});
      json(res, 200, await session.run('human', () => session.dispatch(method, args)));
    } catch (error) { json(res, 400, {error: error.message}); }
  };
  return {handler, dispose() { for (const res of streams) res.end(); streams.clear(); }};
}
