# 清晰度与配置调查 — 2026-09-21

## 实测，不只是检查参数

本地 Edge、900×600 CSS 视口，直接读取真实 Page.screencastFrame 的 JPEG 尺寸，并与 Page.captureScreenshot PNG 对比：

| devicePixelRatio | 连续 JPEG | 按需 PNG |
|---|---|---|
| 1 | 900×600 | 900×600 |
| 1.5 | 900×600 | 1350×900 |
| 2 | 900×600 | 1800×1200 |

测试脚本：tests/clarity-smoke.mjs；结果：outputs/clarity/result.json。

因此 0.2.1 设置 deviceScaleFactor 和 maxWidth/maxHeight 并未让连续画面获得高 DPI 像素。高 DPI 屏幕放大 CSS 分辨率 JPEG 时会模糊，JPEG 本身也有损。此前“高清适配”措辞过于乐观。Web 并非不能显示高清，而是我们选择的持续画面传输通道没有交付足够像素。

原生 WebContentsView 无此编码/缩放链路。Web 后续可尝试静止时补一张高 DPI 无损 PNG，保留动态帧的响应速度；这还未实现，不应宣称已解决。

## 本机配置（只读调查，没有同步或覆盖）

- `~/.dsh/profiles/web/package.json`：安装 dsh-inapp-browser 0.2.1、Better Sidebar 0.19.1，同时还有旧 dsh-builtin-browser。
- `~/.dsh/profiles/tauri/package.json`：原社区桌面端使用的独立 profile；有 Better Sidebar，没有 dsh-inapp-browser。
- 本项目 Electron 启动器没有独立插件清单，只连接 --harness 指定的本机服务，默认 3080。它使用哪个插件版本，取决于该服务启动时选用的 profile。
- 调查时 3080 对本插件 bootstrap 请求返回 405，3081–3083 未连通；Tauri 的运行日志也记录启动了 3080。仅看端口不能保证连到 web profile。

不要把源码目录、安装 profile 和 Electron 运行时目录混为一谈。修改源码不会自动升级 profile；安装到 web 不会同步到 tauri。安装进 Tauri 也不会自动获得 Electron 原生视图。

## 搜索修正（0.2.2）

已安装 0.2.1 的 normalizeUrl 后端默认是 Bing。不能仅凭页面是百度就认定这个默认值仍为百度：AI 可能显式传 engine=baidu、直接传百度 URL，或调用另一套 browser_* / 搜索工具。

0.2.2 将 iab_open 的 engine 枚举首项改为 bing，声明 default=bing，并明确提示搜索时传纯关键词，除非用户要求，否则不要构造百度 URL。仍尊重用户明确指定的其他搜索引擎。不改写用户直接输入的网址。

建议统一使用：web profile 后端 + 本项目原生桌面启动器 + iab_* 工具。普通 Web 页面也可连接相同后端，但浏览器视图依然是兼容传输模式。原社区 Tauri 是另一条启动链路，不要把二者视为同一个桌面客户端。

## 后续修正：0.2.4
0.2.3 的静态补帧造成清晰度频繁切换，现改为仅交付全分辨率 PNG，CDP JPEG 仅用作页面变化信号。图片绝对定位并预解码，避免其内在尺寸影响布局。Web 优先；tauri 清单安装成功但用户确认 UI 未显示，不能称桌面端已验收。
