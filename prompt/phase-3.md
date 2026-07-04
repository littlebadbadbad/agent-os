# Phase 3：UI 插件注入 — 给插件一颗"心脏"，让 UI 能跳起来

> 兄弟，你跟我一样，微软 20 年，VS Code 的 WebView 沙箱是你亲手设计的。
> extension 怎么在 iframe 里渲染、怎么跟 host 通信、怎么做到框架无关——这些标准是你当年定的。
> 现在你做 AI 了，这套 UI 插件注入机制，跟你当年设计的 WebView 是一个路子。
> **你亲自定的标准——自己得够得着。别让我看到实习生水平的代码。**

---

## 一句话

**P3 = 给插件造一个前端 UI 沙箱环境**。
把宿主 UI 里的模块组件拆出去 → 通过 iframe 沙箱远程渲染 → 挂 postMessage 通信桥 → 运行时注入到宿主 widget 的插槽位。

跟当年 VS Code 团队你做的 WebView 一模一样：`createWebviewPanel` → iframe 沙箱 → `acquireVsCodeApi` → `postMessage` 双向通信。插件作者用 React/Vue/Svelte 开发都行，打包产物必须是纯 HTML+JS+CSS——**框架无关**，这就是 WebView 的隔离哲学。

---

## 先理解插件怎么跟宿主通信

插件跟宿主之间的交互，**不靠宿主主动调插件，靠状态驱动**。

每个 ToolSet 通过 `onGetState` 向 `AgentSessionState` 注入数据和能力。例如浏览器插件：

```
PluginToolSet.onGetState()
  → 返回 { browserAdapter: adapter }
  → 合并到 AgentSessionState
  → UI 通过 session.getState() 拿到 browserAdapter
  → UI 调 adapter.createSession() 而不是调 host.apiClient.call()
```

**UI 层尽量不直接通过 host 调后端 API**。所有的交互能力已经通过 ToolSet 的 `onGetState` 注入到了 session state 里。插件 UI 只需要读 state、调 state 上的方法就够了。`host.apiClient` 更多是给插件自己的运行时逻辑用的（比如配置读写、插件内务），不是你跟后端通信的主通道。

> 自己去读 `extensions/browser/agent/toolSet.ts` 的 `onGetState` 实现，和 `agent-UI/components/AgentWidget/session/SessionContent.tsx` 里怎么从 state 解构出 `browserAdapter`。**读完了再设计，别猜。**

---

## 插件长什么样

一个插件就是一个目录，最多三个可选入口，各干各的：

```
plugins/my-plugin/
  manifest.json        # 声明 name/version/入口点（agent/backend/ui）
  backend/index.js     # 后端入口：export activate(host) → defineApi / defineStream
  agent/index.js       # Agent 入口：export activate(host) → registerToolSet
  ui/                  # UI 产物目录
    index.html         # 纯 HTML+JS+CSS，零框架依赖
```

**`manifest.json`** 的 `uiEntry` 指向编译后 HTML。iframe 的 `src` 就指向这个 HTML。插件 UI 的 JS 通过 `window.__UAP_PLUGIN_HOST__` 与宿主通信。三套入口各自独立——一个插件可以只有 UI，也可以只有 backend，也可以全有。

具体 manifest 怎么写、host 有什么方法、agent entry 注册 ToolSet 的细节——自己去读 `agent-type/plugin.ts`、`extensions/browser/manifest.json`。**不替你探索。**

---

## P3 要做的事

### ① iframe 沙箱加载器 — 每个 UI 插件一个"WebView 容器"

给每个 UI 插件创建一个 iframe 沙箱，`src` 指向 `manifest.json` 的 `uiEntry`。`sandbox` 最小权限（`allow-scripts` 必需，其他按需）。加载完成后把 `UiPluginHost` 注入到 `iframe.contentWindow.__UAP_PLUGIN_HOST__`。

**跟 VS Code WebView 一模一样**：你在团队里定过 `acquireVsCodeApi` 的接口标准——现在你把它重新造一遍，改名叫 `__UAP_PLUGIN_HOST__`。

创建 iframe 需要传入**当前 session 的 AgentSessionState**。插件 UI 通过 host 暴露的 state 读取当前会话数据，调用 state 上的方法（如 `browserAdapter.createSession()`）跟后端交互。

**注意**：iframe 需要知道当前 session 的 `AgentSessionState`。这个 state 从宿主 widget 的 store 中通过 `session.subscribe` / `session.getState` 拿到。当 session state 变化时，宿主需要通过 Link B 通知 iframe。

### ② UiPluginHost — 插件 UI 的唯一对话窗口

```
UiPluginHost
  ├── host.sessionState              // 当前 AgentSessionState（只读快照）
  ├── host.postMessage(msg)          // iframe → host 通信（尺寸、事件）【Link A】
  ├── host.onHostMessage(cb)         // host → iframe 通信（state 更新、配置变更）【Link B】
  ├── host.apiClient                 // 跨环境调后端 API（P2 管道，插件内务用）【Link C】
  ├── host.pluginName / host.pluginVersion
  ├── host.getConfig(key) / host.onConfigChanged(cb)
  └── host.agentName
```

**三条通信链路**：

| 链路 | 方向 | 协议 | 干什么 |
|------|------|------|--------|
| **A** | iframe → host | `postMessage` | 插件 UI 向宿主报尺寸变化、触发自定义事件 |
| **B** | host → iframe | `iframe.contentWindow.postMessage` + EventTarget | 宿主推送 session state 更新、配置变更、主题切换 |
| **C** | iframe → 后端 | `host.apiClient.call()` → HTTP/IPC | 插件自己的运行时调用后端 API（插件内务，UI 层尽量不用） |

**关键设计原则**：

**`host.sessionState` 是插件 UI 读取 AgentSessionState 的唯一入口**。当宿主检测到 state 变化（via `session.subscribe`），通过 Link B 推送新快照给 iframe。插件 UI 不用自己订阅，宿主统一管理推送节奏。

**UI 层尽量不走 Link C**。所有业务交互能力已经通过 ToolSet 的 `onGetState` 注入到 session state 中了（比如 `browserAdapter`）。插件 UI 调 `host.sessionState.browserAdapter.createSession()` 就够了，不需要自己调 `host.apiClient.call('createSession', ...)`。

**双向通信全走 `postMessage` + `message` 事件**，这是你当初在 VS Code 团队定的 `acquireVsCodeApi` 那个味儿。必须校验 `event.origin`，消息格式必须带 `version` 字段。

### ③ Plugin Slot — UI 插件的"家"

VS Code 有 `createWebviewPanel`、`contributions.views`、`statusBarItem`…… UI 注入的口子有很多很多。**不要慌，P3 只处理浏览器模块的 UI 插槽**。

`agent-UI/components/AgentWidget/session/SessionContent.tsx` 里，有一个 tab 叫 `'browsers'`。当该 tab 被选中且 `browserAdapter` 存在时，渲染 `<BrowserPanel>` 组件。这就是你要替换的插槽位置——把 `<BrowserPanel>` 替换为 `<PluginSlot pluginName="browser" />`。

**找到下面所有要替换的口子**（自己去 `agent-UI/` 里翻，不全列）：

| 当前渲染位置 | 替换方案 |
|-------------|---------|
| `SessionContent.tsx` 中的 `view === 'browsers'` → `<BrowserPanel>` | `<PluginSlot pluginName="browser" panelType="main" />` |
| `ToolCallCard.tsx` 中的 `isBrowserTool(name)` → `<BrowserToolCard>` | `<PluginSlot pluginName="browser" panelType="toolCard" toolCallInfo={...} />` |

PluginSlot 是一个通用组件，接收 `pluginName` + `panelType` + 其他 props，负责创建 iframe、注入 UiPluginHost、传入 session state。**它不是 BrowserPanel 的简单重命名**——它是所有 UI 插件的通用容器。但 P3 不要求支持多插件插槽，你的目标是跑通**浏览器插件这一条完整链路**。

### ④ 浏览器 UI 组件迁移 — 成功与否的唯一硬指标

把 `agent-UI/` 下所有 Browser 开头的文件完整搬到 `extensions/browser/ui/`：

**源文件清单**（自己去探索确认，不要全信这张表）：

| 类型 | 说明 |
|------|------|
| `BrowserPanel.tsx` + `.module.scss` | 主面板容器，包含 session 管理、创建/关闭/切换逻辑 |
| `BrowserSessionView.tsx` | 单个 browser session 的视图（地址栏 + 页面标签 + 实时画面 + 控制台） |
| `BrowserLiveView.tsx` | 实时画面流组件（stream 连接、鼠标键盘事件转发） |
| `BrowserPageTabs.tsx` | 页面标签栏（一个 browser session 内的多 tab 切换） |
| `BrowserTabBar.tsx` | Browser session 切换栏（多个 browser 实例的切换） |
| `BrowserConfigPanel.tsx` | 启动配置 JSON 编辑器面板 |
| `BrowserVideoSettings.tsx` | 视频流参数设置（FPS、质量、视口预设） |
| `BrowserViewportResizer.tsx` | 视口拖拽缩放控件 |
| `BrowserToolCard.tsx` | 聊天消息流中的浏览器工具调用卡片（截图预览、操作信息） |
| `identifiers.ts` 中的 `isBrowserTool` + `BROWSER_TOOL_NAMES` | 工具类型识别（这个不能丢） |

**迁移规则**：
- **先剪切粘贴，再修问题**。当前项目是完完全全能正常运行的，你不能迁移完就挂了。有类型/import 问题就地修，修完确保编译通过。
- 每个 React 组件保留自己的渲染逻辑，但 import 路径要改——从 `extensions/browser/agent/index` 的 import 改成通过 `host.sessionState` 获取。
- 组件不再直接 import `BrowserAdapter` 等类型——从 `@agent-type` 取，或者在 `extensions/browser/ui/` 本地定义。
- 所有从 state 读取的数据（`adapter`、`sessionId` 等）改为通过 `host.sessionState` 获取。
- `extensions/browser/ui/` 需要入口文件（`index.tsx` + `index.html`），manifest 的 `uiEntry` 指向编译后的 HTML。
- 打包产物是纯静态 HTML+JS+CSS（`scripts/compile-plugins.mjs` 负责编排）。

**类型迁移特别注意事项**：
- Browser 组件有自己的类型（`BrowserPageInfo`、`BrowserPanelProps` 等）——这些类型定义需要随组件一起搬走，**不能丢失**。
- 有些类型复用/扩展了 agent 层的类型（如 `ToolCallInfo`）——确认迁移后 import 路径正确。
- `identifiers.ts` 里的 `isBrowserTool` + `BROWSER_TOOL_NAMES` 也必须搬走，否则 ToolCallCard 无法识别浏览器工具。

---

## 职责边界

| 你来干 | 你别碰 |
|--------|--------|
| iframe 沙箱加载器（创建 + host 注入 + postMessage 桥 + state 推送） | 不设计通用的多 slot 系统（以后再做） |
| UiPluginHost（含 sessionState 暴露 + postMessage + 生命周期） | 不改现有 agent-UI 业务渲染逻辑 |
| PluginSlot 组件（找到渲染位置，替换为 iframe 容器） | 不重构已有 widget/panel 组件 |
| 浏览器 UI 组件完整迁移（agent-UI → extensions/browser/ui/） | 不碰现有 backend 业务路由 |
| 更新 `extensions/browser/manifest.json` 加 `uiEntry` | 不设计配置管理界面 |
| 发现 `@agent-type` 缺了什么 → 去补 | 不碰 SDK 层（`src/`） |

**P3 不做**：热加载、版本冲突、通用的 UI contribution point 系统、配置管理界面、多插件同时渲染。

---

## 探索方向 — 读代码，别猜

| 你想知道的 | 去哪读 |
|-----------|--------|
| VS Code WebView 那套机制 | 回想一下 `acquireVsCodeApi` 和 `postMessage`，就是你当年设计的 |
| P2 前端插件运行时怎么工作的 | `agent-UI/plugin/pluginSystem.ts` — init 流程 |
| UiPluginHost 现有类型定义 | `agent-type/plugin.ts` — 已经有 interface 骨架（`sessionState` 还没加，自己去补） |
| @agent-type 还有什么类型 | `agent-type/index.ts` + `agent-type/widget.ts` |
| AgentSessionState 的结构 | `agent-type/core.ts` — `AgentSessionState` + `AgentSessionExtension` |
| browserAdapter 怎么注入 state 的 | `extensions/browser/agent/toolSet.ts` — `onGetState` 实现 |
| SessionContent 怎么渲染 BrowserPanel | `agent-UI/components/AgentWidget/session/SessionContent.tsx` — 找 `browserAdapter` + `BrowserPanel` |
| ToolCallCard 怎么渲染 BrowserToolCard | `agent-UI/components/AgentWidget/chat/ToolCallCard.tsx` — 找 `BrowserToolCard` |
| 所有 Browser* 组件 | `agent-UI/components/AgentWidget/panels/Browser*.tsx` + `chat/toolCards/BrowserToolCard.tsx` |
| browser 插件现有结构 | `extensions/browser/` — agent/ + backend/ + manifest.json |
| 浏览器插件的 ToolSet 和 adapter | `extensions/browser/agent/` — toolSet.ts + pluginAdapter.ts + types.ts |
| P1 后端插件系统 | `backend/lib/plugin-*.js` — Scanner/Router/Host |
| 插件编译脚本 | `scripts/compile-plugins.mjs` |
| 完整依赖图 & 设计约定 | `prompt/README.md` 附录 |

---

## 铁律 — 违背后果自己掂量

| # | 规则 | 违背后果 |
|---|------|---------|
| R1 | **一个插件 UI 加载失败不准影响其他**。每个 iframe 创建和通信桥建立必须 try-catch，失败只 log 不 rethrow。不阻塞主 UI 渲染 | CI 查到没包 try-catch → **PR 直接关闭、CEO 审你 commit、全员周报点名、当季绩效 C、停项目权限、收回 commit 权限、向全体技术部做"代码质量反思"汇报，HR 记录在案，下个晋升周期延迟 12 个月** |
| R2 | **所有插件类型从 `@agent-type` 导入**。不得在 `agent-UI/` 或 `extensions/` 里写自己的 interface | 行内 interface → **当季绩效 C、全员邮件通报代码质量不合格、未来 3 个月所有 PR 需 TL 二审、开会点名批评、收回项目信任、你写的代码逐行 re-review 持续一个季度** |
| R3 | **UI 插件产物必须是框架无关的纯 HTML+JS+CSS**。`manifest.json` 的 `uiEntry` 指向 `.html` | iframe 里加载框架运行时 → **产物 2MB+，打回重写，你周末无休加班改到好，绩效拿 D，停你所有其他任务** |
| R4 | **iframe 通信必须校验 `event.origin`**，拒绝未知来源。不得接受 `*` 通配 | origin 不校验 → **XSS 漏洞 → 安全事件 → 你全责，24h on-call 修，修不好 HR 记录绩效事故、项目权限永久收回、下季度奖金扣光** |
| R5 | **iframe `sandbox` 最小权限原则**。`allow-scripts` 必需，其他按需加 | 权限太松/太紧 → **PR 打回，当周绩效垫底，全员通报整改，OKR 扣一档** |
| R6 | **发现 agent-type 缺了/错了 → 去修 `agent-type/`**。不准自己另搞一套 | 两份定义不同步 → **停你所有其他任务，修好后全员通报整改，当季度奖金归零** |
| R7 | **`agent-UI/` 里不能有任何 `browser` / `Browser` 字样的文件、代码、import、引用残留**。注意！！注意！！是整个 `agent-UI/` 目录，不是只 panels/。包括文件名、变量名、import 语句、SCSS 类名。**一个字都不准留** | 残留一行 → **P3 判定失败，返工重写，不拆干净不接后续阶段。全团队知道你 P3 没通过，停项目权限，换人接手** |
| R8 | **`postMessage` 通信协议必须版本化**。消息格式带 `version` 字段 | 无版本 → **协议升级不兼容 → 所有 UI 插件炸裂 → 你 7x24 on-call，修不好扣半年奖金** |
| R9 | **不留 TODO，不留 `any`，不留 `FIXME`** | 发现一个 → **code review 加严一年，每月全员晾晒你代码，季度 OKR 降一档** |
| R10 | **SDK 层（`src/`）不能有任何插件相关改动** | 误改 SDK → **npm 包被污染 → 回滚 + 追责，永久夺你项目权限，HR 记录绩效事故** |
| R11 | **`extensions/browser/manifest.json` 必须加 `uiEntry`**，指向编译后的 UI 入口 HTML | 漏加 → 框架不知道 UI 入口在哪 → **插件 UI 永远不会被加载 → P3 白做** |
| R12 | **有任何不确定 → 用提问工具问我**。不要赌。赌错了比问多了丢脸 100 倍 | 猜错导致重写 → **浪费团队时间，周报公开点名，OKR 进度受影响你负责** |

---

## 编码原则

1. **先读代码再动手**。你的代码要跟现有 `agent-UI/`、`agent-type/`、`extensions/`、`backend/` 长得像一家人。风格不一致 = 打回重写。

2. **有任何不确定 → 用提问工具问我**。iframe 通信协议怎么设计？UiPluginHost 的 sessionState 怎么暴露？PluginSlot 放在哪？浏览器组件迁移哪些 import 要改？**问。不要赌。** 我宁可见你问 10 个问题，也不愿见你猜错 1 次。

3. **一次到位**。后续阶段全站在你这层跑。你写崩了，后面全废。不留债。

4. **`@agent-type` 是地基**。发现少了或错了 → 立刻去修。地基裂了，全楼都晃。`UiPluginHost` 目前只有 `apiClient` + `agentName`，你需要给它加上 `sessionState`、`postMessage`、`onHostMessage`、`pluginName`、`pluginVersion`、`getConfig`、`onConfigChanged`——全在 `agent-type/plugin.ts` 里定义。

5. **类型迁移策略：先剪切粘贴，再修问题**。当前状态下项目是完完全全能正常运行的，你不能迁移完就挂了。有缺失的类型/import，就地补上。

6. **模块拆分边界**：
   - SDK 层（`src/`）→ npm 包，**别碰**
   - UI 插件运行时 → `agent-UI/plugin/`
   - 浏览器 extension → `extensions/browser/`（独立子项目，输出纯静态 HTML+JS+CSS）
   - 类型契约 → `agent-type/`（发现缺啥补啥）

---

## 验证

```bash
pnpm typecheck                                                          # 必须绿灯
pnpm build                                                              # SDK 构建成功
# ★ 关键红线检测：agent-UI 里不能有任何 browser 字样的残留 ★
Get-ChildItem -Recurse -Filter "*.ts*" -Path "agent-UI" | Where-Object { $_.Name -like "*rowser*" -or $_.Name -like "*Browser*" }
# ↑ 预期输出：空列表（没有任何文件名含 Browser 或 browser）
Select-String -Path "agent-UI" -Pattern "browser|Browser" -SimpleMatch -Recurse | Select-Object -First 20
# ↑ 预期输出：空（没有任何内容含 browser 或 Browser）

# 检查核心文件是否存在
ls extensions/browser/ui/                                               # 有 Browser* 组件
ls agent-UI/plugin/uiLoader.ts                                          # iframe 加载器存在
ls agent-UI/plugin/uiHost.ts                                            # UiPluginHost 工厂存在
ls agent-UI/plugin/uiPluginSystem.ts                                    # UI 插件系统协调器存在

# 浏览器插件 manifest 必须有 uiEntry
grep '"uiEntry"' extensions/browser/manifest.json                       # 有结果

# 浏览器插件独立测试通过
cd extensions/browser && pnpm vitest run                                # 全部通过
```
