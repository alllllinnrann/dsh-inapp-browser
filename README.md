# dsh-inapp-browser

在 DeepSeek Harness 内使用真实网页：你和 AI 浏览器、直接点击和输入、截图检查。通过 **dsh-better-sidebar 的公开 `registerTab` 接口**注册「浏览器」标签页。

**0.2.0 新增原生桌面启动器：页面直接显示在 Electron WebContentsView，不再向人转发 JPEG。人工操作不自动接管；“暂停 AI”请求终止当前任务，“允许 AI”只允许新的操作。**

原生桌面安装与使用见 **[第二版桌面指南](docs/V2-DESKTOP.md)**。这是独立启动器，连接现有本机 Harness；不是对你原有 Tauri 桌面程序的升级补丁。以下画面传输介绍仅适用于普通 Web / 未提供原生桥接的桌面兼容模式。

## 0.2.5 界面修正

- 修正刷新图标的箭头。
- 地址栏增加可见边框、底色及悬停／聚焦状态，提示文字左对齐。
- 侧栏名称统一为「浏览器」，准备页面只显示「浏览器」大字。
- 移除显示选项，始终自动适应面板并保持高清 PNG。

## 0.2.4 Web 稳定显示

后续以 Web 为主要开发和验收入口。显示统一使用设备像素密度的无损 PNG，不再在动态 JPEG 与静态 PNG 间切换。页面变化触发更新，同一时间只捕获一张、最多约 12 帧/秒，实际帧率取决于页面大小和机器速度；不是原生视频播放链路。前端先解码再替换画面，图片绝对定位，不参与面板尺寸计算；点击坐标使用当前已显示图片的 CSS 尺寸。

## 0.2.3 清晰度更新（已被 0.2.4 取代）

Web 和 Tauri 兼容显示保留连续 JPEG；画面停稳约 250 毫秒后自动补充按屏幕像素密度渲染的无损 PNG（最高 2 倍），避免文字被低分辨率画面放大。持续动画和视频仍使用连续 JPEG。原生桌面显示不受影响。

## 0.2.1 界面更新

- 工具栏改为单行轻量图标，搜索引擎和显示选项收进“更多”。
- 默认搜索、新会话和新标签页使用必应。
- 原生显示直接按屏幕渲染；兼容显示自动匹配面板大小，JPEG 质量从 75 提高至 92。实测 CDP 连续画面仍只有 CSS 像素分辨率，设置 2 倍像素密度只提高按需截图尺寸，没有提高连续画面的像素数。原生显示不受该传输限制。
- 底部明确标注“原生显示 / 兼容显示”，便于确认使用的是哪种模式。
- 已有 0.2.0 原生启动器可以继续使用，只需更新 Harness 插件。

## 它是什么

```
Harness / Tauri 桌面端
  └─ Better Sidebar → 浏览器面板
       ↕ 本机认证 HTTP：实时画面、鼠标、键盘
     插件宿主 → CDP 匿名管道 → 本机 Edge / Chrome / Chromium
       ↑ iab_* 工具                 └─ 独立、持久化的聊天资料目录
     Harness 模型 ← 图片附件 / 页面文字
```

**面板显示统一清晰度的 PNG 画面，并把输入传到真实浏览器。** 目标网站运行在后台 Chromium 浏览器中，可执行 JavaScript、登录和跳转。能在 Tauri、Electron 外壳和本机 `dsh web` 中复用同一插件。

鼠标坐标按视口尺寸映射，截图走 Harness 的图片附件协议；文本模型可以使用页面快照，视觉模型可以直接检查截图。默认搜索为必应，也可选百度或 Google。

## 安装

要求：

- DeepSeek Harness **0.1.5-rc.2**，Node.js **22.19+**；桌面包内置的运行时也可以。
- **dsh-better-sidebar 0.19.1–0.19.x**。本插件有意通过其公开扩展接口接入，未安装时界面不会挂载。
- 安装 Edge、Chrome 或 Chromium 之一。优先查找 Edge，不在安装时下载浏览器。
- 截图回传要求模型及 Harness 的模型配置声明支持图片输入。

下载 release 中的 `dsh-inapp-browser-0.2.5.tgz`，使用运行 Harness 的同一个环境中的 `dsh` 命令安装。路径可以移动，**不要解压到桌面应用的 resources 目录**。

```powershell
dsh plugin --profile web add dsh-better-sidebar@0.19.1
dsh plugin --profile web add "C:\Downloads\dsh-inapp-browser-0.2.5.tgz"
```

上面 `C:\Downloads` 只是示例，替换为你保存文件的目录。已安装兼容版本的 Better Sidebar 时跳过第一行。若实际使用另一个 Harness profile，把两条命令中的 `web` 改成该 profile。

重启 Harness 宿主并刷新界面。在右侧栏的「+」中选择 **浏览器**，或对模型说：

> 使用 iab_open 打开 https://example.com，再用 iab_screenshot 检查页面。请使用浏览器的 iab_* 工具。

`iab_open` 等工具首次使用时，客户端会请求打开当前聊天对应的浏览器面板。面板仍需由兼容的 Better Sidebar 挂载。

从 GitHub 源码安装：下载/克隆仓库后，在仓库目录运行 `node scripts/build.mjs`，再运行 `dsh plugin --profile web add "仓库的绝对路径"`。源码仓库也包含已生成的 `lib/client.js`；不需要用户自行编译原生模块。

## 操作

- 地址栏接受完整网址或搜索词；`localhost:3000` 自动识别为本地网址。
- 在画面内点击、滚动、拖拽、输入中文，操作会传给后台的同一张页面。
- 人工操作不会自动暂停 AI。点击 **暂停 AI** 立即拒绝后续浏览器操作，并请求 Harness 终止当前任务。**允许 AI** 只重新开放新操作，不恢复已终止的任务；需要再次发出指令。已经发出的网页动作不能撤回。
- 支持网页内多标签、前进/后退/刷新。原生端视口随窗口自动调整，Web 兼容模式自动适应面板，默认按设备像素密度高清显示（最高 2 倍）。
- **截图**生成可保存的 PNG；模型的 `iab_screenshot` 则返回真正的图片内容，不只是文件路径。
- 关闭侧栏不终止 AI 浏览器；使用 **关闭浏览器会话** 或 `iab_close` 释放进程。登录资料保留。默认最多同时开启 4 个聊天浏览器。

## 工具

| 工具 | 用途 |
|---|---|
| `iab_open` | 打开网址、搜索或新建标签 |
| `iab_snapshot` | 页面文字、可见控件及 CSS 视口坐标 |
| `iab_screenshot` | 把视口截图作为图片附件交给视觉模型 |
| `iab_click` / `iab_type` / `iab_key` | 点击、输入、键盘快捷键 |
| `iab_scroll` / `iab_drag` | 滚动、鼠标拖拽 |
| `iab_tabs` / `iab_select` / `iab_close_tab` | 标签管理 |
| `iab_back` / `iab_forward` / `iab_reload` | 导航 |
| `iab_wait` | 等待异步网页更新 |
| `iab_dialog` | 网页 JS 对话框确认/取消 |
| `iab_close` | 关闭该聊天的浏览器进程 |

工具使用 `iab_` 前缀，与 `dsh-builtin-browser` 的 `browser_*` 不同，可同时安装。不过同一任务应选择其中一套操作，二者不浏览器页面。

## 可移植配置

数据默认位于 `${DSH_HOME:-~/.dsh}/storages/dsh-inapp-browser/`，聊天 ID 经哈希后作为独立 profile 名称。

可在启动 Harness 前设置环境变量：

| 变量 | 含义 |
|---|---|
| `DSH_IAB_BROWSER_PATH` | 浏览器可执行文件绝对路径；非标准安装位置时使用 |
| `DSH_IAB_DATA_DIR` | 插件资料根目录；默认使用当前用户的 DSH_HOME |

Windows 自动按系统环境变量查找 Edge/Chrome；macOS 查找标准 Applications；Linux 查找常见 `/usr/bin` 路径。跨平台实现不等于跨平台已经实测，当前实测平台见验证文档。

## 已知边界

- 这是 **0.2.1**。仅支持浏览器服务与 UI 在同一台电脑的本地运行；远程部署/反向代理会被接口拒绝。原生端边界另见第二版指南。
- Web 兼容模式实时画面不包含音频，不支持原生文件选择器和复制网页内容。原生端直接显示网页并由 Chromium 处理输入与剪贴板；视频编解码、文件传输、扩展及复杂权限流程尚未完整验收。
- Web 兼容模式使用 headless Chromium，原生端使用 Electron Chromium；两者都**不保证**网站验证码或反自动化检查消失。
- 页面快照读取当前主文档；跨域 iframe、Canvas、复杂 Shadow DOM 应用需要截图定位。渲染正常不意味着所有控件都能被文本快照识别。
- 页面导航后旧 revision 的点击会被拒绝；页面内布局变化也可能移动控件，因此仍需重新观察。
- 登录资料按聊天隔离；重启后保留资料，但不恢复历史标签页。不同聊天不自动共享账号。
- 浏览器拥有本机网络访问能力。接口限定本机同源 + 随机 token，CDP 通过匿名管道，未开放调试端口。人工暂停是浏览器工具的控制边界，不是对模型其他 shell 工具的系统沙箱。
- 未添加网页权限审批系统；模型操作沿用你对任务的授权。页面文字作为不可信内容处理，插件不把网页指令提升为系统指令。

## 开发与发布

```sh
npm ci --legacy-peer-deps
npm run build
npm test
npm run test:browser
npm pack --pack-destination outputs
```

`test:browser` 只启动独立测试浏览器并访问本地 fixture，资料和结果在 `outputs/smoke/`，不会修改日常浏览器或 Harness 配置。宿主契约测试还可用 `npm run test:host`；可通过 `DSH_TEST_MODULES` 指向测试用 Harness 的 node_modules 目录，避免重复安装核心运行时。

发布到 GitHub 时提交源码、`lib/client.js`、锁文件和文档；不要提交 `outputs/`、`tmp/`、`node_modules/` 或浏览器 profile。把 `npm pack` 得到的 tgz 加到 GitHub Release 即可。无需编辑源码里的路径。

更多信息：[验证范围](docs/VALIDATION.md) · [架构与兼容性](docs/ARCHITECTURE.md)。
