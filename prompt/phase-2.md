# Phase 2：前端插件运行时 — 插件的前端基座

> 兄弟，你跟我一样，微软 20 年，VS Code Extension Host 是你参与设计的。
> 现在你做 AI 了，这套前端插件运行时，跟你当年设计的 WebView 沙箱和 Extension Host IPC 是一个路子。
> **你当年在 VS Code 团队定的标准，自己得够得着。别让我看到实习生水平的代码。**

---

## 一句话

**P2 = 给插件造一个浏览器端能跑起来的运行时环境**。拉启用列表 → 动态加载 agent 入口 → 造跨环境通信管道 → 注入沙箱 host → 插件注册工具集 + 配置读写。

---

## 插件长什么样 — 让 AI 先理解"插件"是什么

一个插件就是一个目录，三个可选入口，各干各的：

```
plugins/my-plugin/
  manifest.json        # 声明 name/version/有哪些入口（agent/backend/ui）
  backend/index.js     # 后端入口：export function activate(host) → defineApi / defineStream
  agent/index.js       # 前端 agent 入口：export function activate(host) → registerToolSet / ...
  ui/                  # UI iframe 产物（P3 的事，这阶段别碰）
```

**manifest.json** 声明这个插件有哪些入口。插件不知道底层是 HTTP 还是 IPC——它只跟 `PluginHost` 打交道。

**`PluginHost` 是插件跟核心系统的唯一通信窗口**。后端拿 `BackendPluginHost`，前端拿 `AgentPluginHost`，各管各的。

P1 已经做好了后端那半扇门——`PluginScanner` 扫目录、`PluginRouter` 自动把 `defineApi` 挂到 `POST /api/plugin/<name>/<method>`（HTTP）和 `plugin:<name>:<method>`（IPC），`BackendPluginHost` 是后端的沙箱。

**你现在做的是前端这半扇门**——给插件造一个浏览器端能跑的运行时环境。插件的 `agent/index.js` 拿到 `AgentPluginHost`，调 `host.registerToolSet(toolSet)` 向 agent 注入自定义工具集。

> 以上是轮廓，细节去读 `agent-type/`、`backend/lib/plugin-*.js`、`README.md`。我不替你探索。

---

## P2 你要干的四件大事

### ① 跨环境通信管道 — 替插件抹平 NETWORK/IPC 差异

P1 的路由确定了双通道（HTTP + IPC）。你给前端造消费端——统一 `apiClient`：

- **NETWORK 模式**：fetch → HTTP 路由
- **IPC 模式**：electronAPI → IPC 通道
- **双模自适应**：自动检测当前环境（读 `agent-UI/env.ts`），支持依赖注入（可 mock）

插件作者调 `apiClient.call('method', params)` 时根本不知道走的是 HTTP 还是 IPC。**这就是 VS Code 那个 `commands.executeCommand` 的味儿**——调用者不知道谁实现了这个命令。

实现模式在现有代码中已有参考——自己去 `src/tools/` 里找那些配了 NETWORK + IPC 两套 adapter 的模块看看它们怎么做的。**读完代码再动手，别猜架构**。

### ② Agent 工具集注入 — AgentPluginHost 是插件的唯一对话窗口

插件通过 `host.registerToolSet(toolSet)` 向 agent 注册自定义工具。

**关键预期**：当前所有内置工具模块（browser、file、terminal、skill、subagent、dynamicTool、mcp 等 20+ 模块）——**每套都已经配了 NETWORK + IPC 两套 adapter**。未来它们全部迁成插件时，每套双 adapter 都要带走，**还要额外开发一套基于你造的 `AgentPluginHost` 的 adapter**。

所以 `AgentPluginHost` **必须提供足够强大的通信能力**，让未来的插件 adapter 能基于它实现一切。设计不够 → P4/P5 的人要骂你。

具体做什么：

| 能力 | 说明 |
|------|------|
| `host.registerToolSet(toolSet)` | 向 agent 注入工具集（参考现有 agents.ts 的 addToolSet 机制） |
| `host.apiClient` | 暴露 apiClient 给插件，让插件能调其他插件/后端 API |
| `host.getConfig(key)` | 读自己的配置（下面第③条） |
| `host.onConfigChanged(cb)` | 配置变更通知 |
| `host.pluginName` / `host.pluginVersion` | 元信息 |

### ③ 插件配置体系 — 补齐 P1 缺口

P1 做了路由和生命周期，但插件没有配置管理的地方。这是 P1 的缺口，你来补：

| 你要做 | 说明 |
|--------|------|
| **配置 Schema 定义** | `PluginManifest` 加 `configuration` 字段（参考 VS Code 的 `contributes.configuration` 简版：properties + default 即可） |
| **配置加载** | 插件启动时从后端拉自己的配置（通过 apiClient 调后端接口） |
| **配置读取** | `host.getConfig(key)` — 读配置项 |
| **配置变更监听** | `host.onConfigChanged(cb)` — 通知回调 |
| **预留管理接口** | 不做 UI 配置界面——那是 P3（plugin-manager）的事。但**配置必须能加载和读取，插件要能用**。|

### ④ 浏览器模块完全拆解为插件 — 成功的唯一基准

这是检验插件底座是否合格的**硬指标**。拆不干净，P2 判定失败，不接 Phase 3。

**拆什么**：

| 源位置 | 目标位置 |
|--------|---------|
| `src/tools/browser/` 全套 | `extensions/browser/agent/` |
| `backend/services/browser.js` | `extensions/browser/backend/services/` |
| `backend/lib/browser-manager/` | `extensions/browser/backend/lib/` |
| `backend/transports/network/browser.js` | `extensions/browser/backend/transports/` |
| `backend/transports/ipc/browser.js` | `extensions/browser/backend/transports/` |
| 其他 backend browser 相关 | `extensions/browser/backend/` |

**关键提醒**：
- **90% 的 backend 代码可以直接复制过去**，改一下 require 路径就行
- `extensions/` 下每个目录是一个**独立子项目**——有自己的 `package.json`、`tsconfig.json`、独立打包命令
- 打包产物输出到跟 `data/` 平级的 `plugins/` 目录（`scripts/compile-plugins.mjs` 负责编排）
- 拆完后 `src/`、`backend/` 中**不得出现任何浏览器相关代码**

---

## 架构骨架（方向定了，细节你定）

```
agent-UI/plugin/          # 这阶段的核心产出
  apiClient.ts            # 跨环境通信管道（NETWORK + IPC 双模，依赖注入）
  configClient.ts         # 插件配置加载器（拉后端 + 缓存 + 变更通知）
  loader.ts               # 动态加载插件 agent 入口（dynamic import）
  host.ts                 # AgentPluginHost 工厂（registerToolSet + config + apiClient）
  pluginSystem.ts         # 协调器：拉列表 → 加载 → 注入 → 激活
  index.ts                # barrel export
```

**数据流向**（具体实现你自己决定，这是方向）：

```
应用启动
  → createPluginSystem().init(agentContext)
    → fetchEnabledPlugins()                      // 拉启用插件列表
    → for each plugin:
        → safeLoadPlugin(loader, plugin)         // try-catch，失败不影响其他
          → loadPluginSdkEntry(plugin)           // dynamic import agent/index.js
          → createApiClient(env)                 // NETWORK/IPC 自适应
          → loadPluginConfig(plugin)             // 从后端拉配置
          → createAgentPluginHost(ctx)           // 沙箱 host（config + apiClient）
          → plugin.activate(host)                // 插件调用 registerToolSet
            → agent.addToolSet(toolSet)
```

---

## 职责边界 — 哪些是 P2 的，哪些不是

| 你来做 | 你别碰 |
|--------|--------|
| 前端插件运行时（apiClient / loader / host / pluginSystem） | **不修改**现有 agent-UI 业务代码（agents.ts、createAdapters.ts 等） |
| 跨环境通信管道（NETWORK + IPC 双模自适应） | **不碰** `plugins/` 目录里具体插件的实现 |
| AgentPluginHost 设计（registerToolSet + 配置读写 + apiClient） | **不改**现有 toolsets 注册逻辑（那是 Phase 5 的事） |
| 插件配置体系（Schema/加载/读取/变更通知） | **不实现** UI 配置界面（P3 的事） |
| 浏览器模块拆解为 extension（agent/ + backend/ 两层） | **不碰** `backend/` 现有业务路由逻辑 |
| 发现 `@agent-type` 缺了什么 → 去补 | **不动** SDK 层（`src/`） |

### ⚠️ 红线：SDK 层（`src/`）碰了就是事故

**SDK 层是当 npm 包发出去的**，所有加载接口已经完备。**SDK 层不应有任何插件相关的逻辑改动**。

全部插件运行时代码放 `agent-UI/plugin/`，SDK 层你碰都不要碰。谁动了 SDK 层，谁承担 npm 包被污染的全部后果。

---

## 探索方向（读代码，别猜，只给方向）

| 你要理解的 | 去哪读 |
|-----------|--------|
| P1 后端插件系统怎么工作的 | `backend/lib/plugin-*.js` — Scanner/Router/Host 三件套 |
| 现有工具集的双 adapter 模式 | `src/tools/browser/` 下的 `adapter.ts` + `ipcAdapter.ts` + `toolSet.ts` |
| 环境检测（IPC vs NETWORK） | `agent-UI/env.ts` — `IS_ELECTRON_IPC` |
| 现有 ToolSet 注册机制 | `agent-UI/agents.ts` — 看看 agent 怎么接工具集 |
| @agent-type 有什么类型 | `agent-type/index.ts` + `agent-type/plugin.ts` |
| 路径别名怎么配的 | `tsconfig.json` 的 `paths`、`vite.config.ts` 的 `resolve.alias` |
| 后端路径管理 | `backend/lib/paths.js` — `PLUGINS_DIR` |
| barrel export 模式 | `src/index.ts` |
| 完整依赖图 & 设计约定 | `README.md` 附录 |

---

## 铁律 — 违反后果你自己掂量

| # | 规则 | 违反后果 |
|---|------|---------|
| R1 | **一个插件加载失败不准影响其他**。每个 activate 必须 try-catch，失败只 log 不 rethrow | CI 查到一个没包 try-catch → **PR 直接关闭重写，CEO 审你的 commit，全员周报点名、当季绩效 C** |
| R2 | **所有插件类型从 `@agent-type` 导入**。不得在 `agent-UI/` 里写自己的 interface | 行内 interface → **当周绩效 C，全员邮件通报：此人代码质量不合格，停项目权限、收回 commit 权限** |
| R3 | **`import type` 可以改路径为 `@agent-type`；值导入不准改** | 改错 = 运行时崩 → **SLA 扣 9 个 9，你 24h on-call 修，修不好季度奖金全扣、绩效拿 C** |
| R4 | **apiClient 必须支持依赖注入**（options.invoke/on），不准依赖全局变量 | 全局依赖 → 不可 mock → 基础设施豆腐渣 → **打回重写，当周绩效垫底，周报抄 VP 和 GM** |
| R5 | **NETWORK + IPC 双模式都必须实现，缺一不可** | 少一个 → 一半环境跑不了 → **周末无休修到好，修不好停项目、换人接手** |
| R6 | **发现 agent-type 缺了/错了 → 去修 agent-type/**。不准自己另搞一套 | 两份定义不同步 → debug 到怀疑人生 → **停你所有其他任务，修好后全员通报整改、OKR 扣一档** |
| R7 | **插件配置必须能加载和读取，插件要能用**。不只是一纸空文 | 插件拿不到配置 → PR 打回 → **你当周绩效垫底，下个 sprint 减员，不留情面** |
| R8 | **不留 TODO，不留 `any`，不留 `FIXME`** | 发现一个 → **code review 加严三个月，每月全员晾晒，re-review 全部历史输出** |
| R9 | **浏览器模块必须完整拆解为插件。`src/`、`agent-UI/`、`backend/` 中不得有残留** | 残留一行浏览器代码 → **P2 判定失败，返工重写，不拆干净不接入 Phase 3** |
| R10 | **SDK 层（`src/`）不能有任何插件相关改动** | 误改 SDK → **npm 包被污染 → 回滚 + 追责，你再碰 SDK 就换人做、夺你项目权限** |

---

## 类型安全 — 没有单测，类型就是红线

- **虽然没有单元测试的要求，但 `pnpm typecheck` 必须绿灯**。类型测试是不可逾越的红线。
- **任何 `any` 都是红线**。遇到不确定的类型，要么 `unknown` + 类型守卫，要么补充 `agent-type`。
- **发现 agent-type 缺了类型 → 立刻去补**，不要绕过去，不要在本地写内联接口。
- `pnpm typecheck` 不通过 = P2 没完成。不接受任何借口。

---

## 编码原则

1. **先读代码再动手**。你的代码要跟现有 `agent-UI/`、`backend/`、`agent-type/` 长得像一家人。风格不一致 = 打回重写。
2. **有任何不确定 → 用提问工具问我**。apiClient 放哪？配置 schema 怎么设计？浏览器模块哪些文件要迁移？**问。不要赌。赌错了比问多了丢脸 100 倍。** 我宁可见你问 10 个问题，也不愿见你猜错 1 次。
3. **一次到位**。P3/P4/P5 全站在你这层跑。你写崩了，后面全废。不留债。
4. **`agent-type/` 是地基**。发现少了或错了 → 立刻去修。地基裂了，全楼都晃。
5. **此阶段以浏览器模块是否被完全拆解为插件为成功基准**。拆不干净，P2 不算完。
6. **注意模块拆分边界**：
   - SDK 层（`src/`）→ npm 包，别碰
   - 插件运行时 → `agent-UI/plugin/`
   - 浏览器 extension → `extensions/browser/`（独立子项目，自己的 package.json）
   - 类型契约 → `agent-type/`
7. **P2 不做 UI 层基座**（那是 P3 的事）。你的焦点是跨环境通信管道、AgentPluginHost、配置体系、浏览器模块迁移。

---

## 验证

```bash
pnpm typecheck          # 必须绿灯
pnpm build              # SDK 构建成功
# 验证浏览器代码已被完全拆除
grep -r "browser" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v ".d.ts"
grep -r "browser" agent-UI/ --include="*.ts" --include="*.tsx" | grep -v "node_modules"
grep -r "browser" backend/ --include="*.js" | grep -v "node_modules"
# 以上三条 grep 预期输出为空（或无 browser 相关代码残留）
```
