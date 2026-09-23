# dsh-inapp-browser

为 DeepSeek Harness 提供内置浏览器面板，你和 AI 可以操作同一张网页，支持多标签、点击、中文输入、滚动、拖拽、页面文字读取与截图。默认使用必应，登录资料按聊天保存。

基于本机 Edge / Chrome / Chromium，通过画面传输在 Better Sidebar 中显示网页；不接管日常已经打开的浏览器。适用于本机运行的 Harness 0.1.5-rc.2、Node.js 22.19+、Better Sidebar 0.19.1–0.19.x。截图工具需要支持图片输入的模型。

## 接口参数

以下为提供给 AI 的工具。`?` 表示可选；无参数时传 `{}`。工具自动使用当前聊天会话，不需要传入聊天 ID。坐标均为网页视口的 CSS 像素，不是侧栏图片的缩放后坐标。

| 工具 | 参数 | 功能／返回 |
|---|---|---|
| `iab_open` | `url: string`；`newTab?: boolean`；`engine?: "bing" \| "baidu" \| "google"` | 打开网址或搜索词；返回页面快照。默认当前标签、必应搜索。 |
| `iab_snapshot` | 无 | 返回网址、标题、页面文字、控件列表、视口尺寸和 `revision`。控件含位置、标签、是否在视口内等信息。 |
| `iab_screenshot` | 无 | 返回实际图片附件及视口尺寸、图片尺寸、`revision`；需要图片模型及宿主附件服务。 |
| `iab_click` | `x: number`；`y: number`；`button?: "left" \| "right" \| "middle"`；`revision?: number` | 点击坐标，默认左键；传入快照版本可拒绝导航后失效的点击。 |
| `iab_type` | `text: string` | 向已聚焦控件输入文字，支持中文。 |
| `iab_key` | `key: string`；`modifiers?: number` | 按键，例如 `Enter`、`Tab`、`Escape` 或快捷键字母。 |
| `iab_scroll` | `deltaY: number`；`deltaX?: number`；`x?: number`；`y?: number` | 滚动；正 `deltaY` 向下，默认在视口中心操作。 |
| `iab_drag` | `x: number`；`y: number`；`toX: number`；`toY: number` | 从起点拖拽到终点。 |
| `iab_wait` | `ms: number` | 等待 0–10000 毫秒；之后重新读取快照或截图。 |
| `iab_tabs` | 无 | 返回标签列表、当前标签及浏览器状态。 |
| `iab_select` | `targetId: string` | 切换到 `iab_tabs` 返回的标签 ID。 |
| `iab_close_tab` | `targetId?: string` | 关闭指定标签，默认当前标签；保留至少一个标签。 |
| `iab_back` | 无 | 后退。 |
| `iab_forward` | 无 | 前进。 |
| `iab_reload` | 无 | 刷新当前网页。 |
| `iab_dialog` | `accept: boolean`；`text?: string` | 确认或取消网页 JavaScript 弹窗，`text` 用于 prompt 输入。 |
| `iab_close` | 无 | 关闭当前聊天的浏览器进程，保留登录资料。 |

`modifiers` 为位掩码：Alt = 1、Ctrl = 2、Meta = 4、Shift = 8，可相加组合。例如全选：`iab_key({"key":"a","modifiers":2})`，随后使用 `iab_type` 输入替换文字。

截图若被模型端缩放，点击前需要换算回原始视口坐标。页面滚动、导航或布局变化后应重新观察。

可选环境变量（启动 Harness 前设置）：

| 变量 | 含义／默认值 |
|---|---|
| `DSH_IAB_BROWSER_PATH` | 浏览器可执行文件绝对路径；默认自动查找 Edge、Chrome 或 Chromium。 |
| `DSH_IAB_DATA_DIR` | 浏览器资料根目录；默认 `${DSH_HOME}/storages/dsh-inapp-browser/`。 |
| `DSH_HOME` | Harness 数据根目录；未设置时使用用户目录下的 `.dsh`。 |
| `DSH_IAB_HOME_URL` | 新会话首页；默认 `https://www.bing.com/`。 |
