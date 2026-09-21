# Architecture and compatibility

## 0.2.0 native desktop path

`desktop/main.cjs` is a standalone Electron frontend to a running local Harness. It pairs through the plugin's authenticated same-origin HTTP route and offers a random authenticated local named pipe. `src/native-cdp.js` implements the CDP transport over that pipe. `desktop/native-host.cjs` owns isolated per-chat WebContentsViews and translates the small Target/Browser command subset into view management; page commands use Electron's debugger transport. The Harness renderer is never exposed as an agent target.

The preload exposes only a layout function and a desktop ID, not arbitrary IPC or Node. The native page has no preload, runs sandboxed with Node disabled, and is positioned over the sidebar viewport. Native interaction is handled directly by Chromium. State polling is metadata only; screenshots are requested only by the screenshot tool/button. Closing the window disconnects native sessions without shutting down the user's Harness service. Web mode retains its streaming backend.

Both modes now use explicit pause only. Pause sets an epoch to invalidate previously queued AI actions even if quickly resumed, aborts active cancellable waits/drags, and requests `agent.cancel({kind:'user'}, {keepInbox:false})` using the live registry or last tool execution's agent. If unavailable, the UI explicitly asks the user to stop the chat too. Already-dispatched page events cannot be undone. Resuming only permits new operations.

## Package boundaries

- `src/index.js`: DSH host plugin. Declares `tools` and `webServer` dependencies; registers 16 text tools and one image tool when `llm` and `attachments` are available.
- `src/browser.js`: chat-scoped session manager; persistent, hashed profiles; serialized operations and human takeover gate.
- `src/cdp.js`: Node anonymous-pipe CDP transport. Launches a discovered local browser. Does not attach to or copy the user's daily browser profile. No public debugging endpoint, no WebSocket dependency.
- `src/http.js`: same-host loopback-only control and NDJSON frame stream; randomized process token; no CORS opt-in; request size cap; frame backpressure keeps the latest frame instead of accumulating frames.
- `src/client.cjs`: React consumer of `betterSidebar.registerTab`. Built into the official `window.__ModuleLoader__.load({id,factory})` protocol by `scripts/build.mjs`.

## Why a streamed viewport

The inspected desktop is a Tauri shell. An npm plugin cannot assume it has Electron's native `WebContentsView` or that the desktop exposes child-WebView creation and CDP control. A streamed viewport plus input forwarding works without patching the desktop executable, and is also usable in the ordinary local web UI. The target website is loaded in a top-level Chromium page, not an iframe. Frame rates depend on painting, viewport size and machine performance; no fixed FPS is promised.

The implementation does not disable Chromium's sandbox, certificate validation or web security. It does not implement CAPTCHA bypass or browser fingerprint spoofing.

## Better Sidebar integration

Uses the public service only: `registerTab`, `openTab`, `scope.sessionId`, `visible`, and the disposer returned by registration. All registration lives inside `ctx.effect`; unloading removes the descriptor, style and polling loop. The panel's styles use the `dsh-iab-` namespace. The browser does not rewrite document layout or intercept the sidebar's built-in file/browser links.

The `dsh.client.inject` entry ensures Better Sidebar's client package is loaded; the exported `inject = ['betterSidebar']` waits for the service. The peer dependency intentionally pins the supported minor series; do not assume compatibility with future pre-release APIs. No runtime value imports from Better Sidebar or duplicated React copy are shipped.

References checked 2026-09-19:

- https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/docs/external-plugin-guide.md
- https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/src/client/service.ts
- https://github.com/dsh-tauri/deepseek-harness-desktop
- Installed official `@deepseek-ai/dsh-tools`, `dsh-tool-fs` and `dsh-client-modules` at 0.1.5-rc.2 for the tool, image-attachment and client-loader contracts.

## Resource and control lifecycle

One browser process per active chat (maximum four), one persistent profile per chat, multiple pages per process. Closing a tab keeps at least one page; closing the session terminates only its own child process. Host unloading closes all owned processes. Plainly hiding the sidebar stops frame delivery, not the agent's browsing task. Browser data is not deleted automatically.

Human input does not pause automatically. Only the UI exposes pause/resume; no agent tool can clear the gate. Text-only models receive a clear error for the image tool instead of a misleading claim to have inspected a screenshot.

## Distribution

`npm pack` is the portable install artifact. Source ZIP is for GitHub/review. Chromium is discovered from standard OS paths or an environment override; it is neither copied from the author's machine nor bundled in the archive. Tests may refer to a test runtime through an environment variable; that code is excluded from the install archive.
