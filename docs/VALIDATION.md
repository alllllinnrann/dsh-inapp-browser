# Validation

## 0.2.2 — 2026-09-21

- Measured actual JPEG frame dimensions at DPR 1 / 1.5 / 2, compared with PNG captures. Continuous frames remain 900×600 while PNG increases to 1350×900 and 1800×1200; the earlier high-DPI streaming expectation is corrected. See CLARITY-AND-PROFILES.md.
- Actual Harness defineTool contract smoke passed with the updated Bing-first enum, default value and tool instructions. Existing explicit user-selected engines and URLs remain supported.
- Read-only profile comparison found the browser installed in web, absent in tauri. No live profile changes were made.

## 0.2.1 — 2026-09-21

- Updated single-row icon toolbar visually inspected in real native-window and Web-stream screenshots.
- 6 unit checks include default Bing search routing and opening Bing when a new browser session initializes; test browser suites override the homepage to about:blank to stay local.
- 13 Web and 13 native integration checks passed after the layout change, including coordinate mapping after automatic panel sizing, native input and pause.
- Web compatibility now uses panel-size adaptation, screen devicePixelRatio capped at 2, and JPEG quality 92. This is improved image delivery, not lossless native rendering. Native mode remains direct Chromium rendering.
- The existing 0.2.0 desktop launcher remains compatible; only the Harness plugin needs updating to 0.2.1. Live public Bing availability depends on the user's network and was not part of the local fixture tests.

## 0.2.0 — 2026-09-21

- 5 Node unit checks passed, including cancel during a wait and pause/resume invalidation of previously queued AI actions.
- 13 native integration checks passed with Electron 44.4.2 and a test Harness/Better Sidebar adapter: private pipe pairing, real WebContentsView, zero frame-stream HTTP requests, native pointer/Unicode input, AI operation of the same human-edited page, native wheel scrolling, actual viewport screenshot dimensions, tab creation/switching, explicit pause with task-cancellation callback, continued human use while paused, native child visibility plus actual OS window screenshot, persistent and isolated per-chat storage, and window-before-socket destruction with repeated cleanup. The last regression fixes the reported `TypeError: Object has been destroyed` in chat.close.
- 13 real Edge Web compatibility checks passed.
- Packaged Electron main-module smoke passed: pairs with a test HTTP Harness, creates a native page with no privileged preload, exits through app.quit, disconnects its pairing and releases sessions. The test wrapper triggers quit; an earlier attempt using webpage window.close was blocked by normal browser window-closing rules.
- The real installed Harness `defineTool` contract test passed for all 17 tools, argument validation, image attachment render output, text-only model handling, and calling the supplied live agent's `cancel` method on pause. Agent cancellation in this test is an adapter, not a live paid model turn.
- Native screenshot inspected: `outputs/native-smoke/panel.png` (actual test window including the native child view). BrowserWindow.capturePage alone omits child views, so desktopCapturer was used and only the matching test window was saved.
- GPU child processes could not initialize under the execution sandbox. Native and Edge tests ran outside it with isolated profiles beneath this project's outputs; browser security/sandbox settings were not disabled.

Remaining acceptance: installing into the user's daily Harness, actual model-driven tasks and cancellation, production-site login/CAPTCHA, audio/video formats, file-transfer flows, and macOS/Linux. No claim of measured Codex-equivalent latency. The supplied desktop is a separate Electron frontend, not a patch to the installed Tauri application.

## 0.1.0 — 2026-09-19

Baseline: Windows, Node 24.11, Microsoft Edge 153; inspected DSH desktop bundles official Harness 0.1.5-rc.2. Better Sidebar public contract checked against the current 0.19.x source. This is a release-candidate engineering validation, not a claim that every desktop build or website works.

## Automated checks

`npm test`:

- URL/search routing and rejection of executable/file URL schemes.
- Same-origin/local-host request fence, missing headers, remote clients, and DNS rebinding hostnames.
- OS-derived executable discovery.
- Queued agent operations stop after human takeover; aborted operations do not dispatch.

`npm run test:browser` launches real isolated browser processes and verifies:

- Navigation and DOM snapshots.
- Mouse focus, Chinese/Unicode input and Enter submission.
- Canvas drag and scrolling.
- Profile persistence across restart and isolation between chats.
- CDP live frames and PNG screenshots.
- Cross-origin control rejection and human takeover.
- Generated client factory mounts through a test implementation of the documented sidebar service.
- Actual clicks and text entered into the rendered streamed panel reach the separate controlled browser.

`npm run test:host` uses the **real Harness `defineTool` implementation** with isolated test service adapters. It verifies 17 tool registrations, schema validation, browser dispatch, image attachment output shape, text-only model rejection, and route disposal. The attachment store is an adapter in this test, not a paid model request.

## Not yet claimed

- Full live Tauri + Better Sidebar installation in the user's daily profile, including WebView2 stream behavior and desktop-managed plugin installation.
- Actual LLM task success or production website login/CAPTCHA success.
- macOS/Linux end-to-end execution.
- Native WebView performance, video/audio playback, file upload/download flows, browser/OS popup handling beyond page JavaScript dialogs.

The user's running application and existing plugin configuration are not changed by these tests. For the final live acceptance check, install the tgz in a compatible local Harness, open the 「浏览器」 sidebar tab, test manual text entry, then ask an image-capable model to use `iab_open` and `iab_screenshot` on a non-sensitive page.

## 0.2.3
- 真实 Edge：900×600 CSS 视口在 1/1.5/2 倍像素密度下，静止后实际收到 PNG 900×600、1350×900、1800×1200。
- 浏览器交互及面板回归 13 项通过；动态画面保留 JPEG，不宣称视频原生画质。

## 0.2.4 — Web first
- 1/1.5/2 倍密度下，持续变化期间至少收到两帧；所有交付帧均为对应设备像素尺寸的 PNG，无低清 JPEG 混入。
- 浏览器集成 15 项通过：新增 200% DPI 动态内容下容器尺寸不变、无自动 resize 请求；真实面板宽度变化仅触发一次 resize。鼠标和键盘映射继续通过。
- 前端解码后换图，图像退出 flex 尺寸计算，坐标采用已显示帧的 CSS 尺寸；限制单捕获并发和积压。
- 用户反馈 tauri 仍未显示插件，此前清单安装成功不代表桌面 UI 验收成功；后续以 Web 开发和安装为主。
- 上限约 12 帧/秒，复杂页面可能更低；视频和快速滚动不承诺原生流畅度。

- 0.2.4 已安装并核验 web profile 清单与实际包版本；仅本机运行，未引入云端或远端浏览器服务。需要重启 Harness 并刷新页面加载新版。

## 0.2.5 — 2026-09-21

- Six unit tests and fifteen real-browser smoke checks passed on Windows.
- Visually inspected the rendered panel: corrected reload icon, bordered address field. Sidebar name and initial heading are 浏览器; display selector removed, automatic high-DPI PNG retained.
- Smoke test now observes input coordinates after automatic viewport resize settles.
- Daily Harness integration was not reinstalled as part of this release.
