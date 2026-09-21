import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

export function browserCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [
    ...[env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
      .flatMap(root => [join(root, 'Microsoft/Edge/Application/msedge.exe'), join(root, 'Google/Chrome/Application/chrome.exe')]),
  ];
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge'];
}

export async function findBrowser(override = process.env.DSH_IAB_BROWSER_PATH) {
  const paths = override ? [override] : browserCandidates();
  for (const path of paths) {
    if (!isAbsolute(path)) continue;
    try { await access(path, constants.F_OK); return path; } catch {}
  }
  throw new Error('未找到 Edge / Chrome / Chromium。请安装其一，或用 DSH_IAB_BROWSER_PATH 指定浏览器可执行文件的绝对路径。');
}

export function defaultDataDir() {
  return process.env.DSH_IAB_DATA_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-inapp-browser');
}

export const HOME_PAGE = 'https://www.bing.com/';
export function normalizeUrl(value, engine = 'bing') {
  const text = String(value || '').trim();
  if (!text) return HOME_PAGE;
  if (text === 'about:blank') return text;
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    if (url.username || url.password) throw new Error('请在页面中登录，不要在网址里放入密码。');
    return url.href;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text)) return normalizeUrl(`http://${text}`);
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?$/i.test(text)) return normalizeUrl(`https://${text}`);
  if (/^[a-z][\w+.-]*:/i.test(text)) throw new Error('只支持 HTTP/HTTPS 网页地址。');
  const search = {baidu: 'https://www.baidu.com/s?wd=', bing: 'https://www.bing.com/search?q=', google: 'https://www.google.com/search?q='};
  return (search[engine] || search.bing) + encodeURIComponent(text);
}

export function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be ${min}..${max}`);
  return value;
}
