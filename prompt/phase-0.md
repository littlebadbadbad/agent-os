# Phase 0：地基 — agent-type，插件体系的"vscode 模块"

> 兄弟，你是个有 30 年 JS/TS 开发经验的老兵，在微软干了 20 年，深度参与过 VS Code 的 Extension Host 设计。
> 这是微软内部一个新项目的插件前置改造阶段。你的任务是**打好地基**，后面 5 个阶段全站在这个地基上盖楼。
> 别让我失望。

---

## 一句话

**`agent-type/` = 插件开发的类型契约层**，类似 VS Code 的 `vscode` npm 包。

所有跨层共享的插件基础设施类型（PluginHost、ToolSet、Widget 等）**只能**放这里，通过 `@agent-type` 别名导入。SDK、Backend、agent-UI 三层**谁都不准自己维护副本**。

---

## 插件机制概览（给个轮廓，你自己探索细节）

项目正在引入**三方插件体系**，让外部代码以插件形式挂载到 agent 运行时中：

- 一个插件 = `manifest.json` + 最多 3 个入口（agent `/ backend `/ UI）
- 插件运行在**宿主注入的 sandbox 环境**中，通过 PluginHost 接口与核心通信
- 后端插件通过 `defineApi / defineStream` 暴露能力，前端通过 `apiClient.call / connectStream` 消费
- 插件可以注册 ToolSet，向 agent 注入自定义工具
- 插件间互不感知，一个挂了不影响其他

**P0 不需要实现这套机制**。P0 只是把**描述这套机制所需的类型契约**定义清楚。

`agent-type/` 的定位：以后每个插件都会 `import type { PluginManifest, AgentPluginHost } from '@agent-type'`，就像 VS Code 插件 `import * as vscode from 'vscode'`。

具体有哪些类型、怎么组织、分几个文件 —— **你自己探索 workspace 决定**。去读 `src/tools/toolSet.ts`、`src/types.ts`、`backend/`、`agent-UI/`，看看现有的架构长什么样，然后以你认为最干净的方式设计。

---

## 顶层约束（这是地基，偏了全楼倒）

| # | 规则 | 为什么这是死罪 |
|---|------|---------------|
| R1 | `agent-type/` **只能有 `export type` / `export interface`**。零 `const`、零 `function`、零 `class`、零 `let/var`、零 `import ... from`（值导入） | 插件打包会把 runtime 代码重复打进每个插件 → **build 产物膨胀 + 类型包职责不纯**。查到一条，重写 |
| R2 | `agent-type/` **不能 import 项目内任何其他模块**。只能 import 三方库，或者内部文件互相引用 | 一旦 agent-type 引了项目内代码 → **循环依赖 + 依赖图上卷**。查到一条，整个 PR 打回 |
| R3 | **所有人都可以引用 `@agent-type`，但 `agent-type/` 不能引用任何人**（除了三方 dep） | R2 的另一种表述。单向依赖是底线 |
| R4 | 类型从源文件搬走后，**源文件的原定义必须删干净** | 两份定义不同步 → **运行时诡异 bug，debug 到死**。查到一条，当周绩效 C |
| R5 | `import type { X }` 可以改路径；`import { createToolSet }` 这类值导入**绝对不改** | 值导入改路径 = 运行时炸。**炸一次 - 1 个亿** |
| R6 | **业务类型（BrowserAdapter / FileAdapter / CronJob 等）不许进 agent-type** | agent-type 只放**插件作者写插件时需要用的通用类型**。业务类型放进来 → 类型包变胖 + 职责模糊 |

验证方式（你自己跑）：

```bash
# R1: 无 runtime export
grep -rn "^export " agent-type/ --include="*.ts" | grep -v "export type"   # → 空
# R4: 源类型删干净
grep "type ToolSet\b" src/tools/toolSet.ts          # → 空
grep "interface Position\|type WidgetIcon" src/types.ts  # → 空
# R6: 业务类型没被误搬
grep "interface BrowserAdapter" src/tools/browser/types.ts  # → 有结果（原地不动）
```

---

## 你的任务概要

### 要做的事（两类）

**① 搬运** — 把现有散落在各处的插件基础设施类型搬到 `agent-type/`：
- `src/tools/toolSet.ts` → ToolSet 及相关 11 个 type/interface（含 JSDoc）
- `src/types.ts` → Widget 相关 4 个 type/interface（Position, WidgetIcon, WidgetTheme, WidgetHandler）
- 改所有引用的 import 路径为 `@agent-type`
- `src/index.ts` 的 barrel export 改为 `from '@agent-type'`

**② 新建** — 根据插件机制设计，编写全新的插件宿主/通信/生命周期类型：
- PluginManifest, BackendPluginHost, AgentPluginHost, UiPluginHost
- StreamHandler, StreamConnection, StreamCallbacks, StreamSubscription
- PluginApiClient, PluginMethod, ActivatedBackendPlugin, PluginState
- 以及你觉得插件体系还需要什么类型（**留给你自由发挥**）

### 配套工作

- 配置 `@agent-type` 别名（`tsconfig.json` / `vite.config.ts` / `vitest.sdk.config.ts`）
- 创建 `scripts/compile-plugins.mjs`（插件编译脚本，参考 `compile-electron.mjs`）
- 创建 `extensions/` 骨架（browser + plugin-manager 的 manifest / package.json / tsconfig）
- `backend/lib/paths.js` 追加 `PLUGINS_DIR`

### ⚠️ 重要的心态

当前项目架构**运行非常稳定**，你的搬运不能搞出任何幺蛾子：

- 类型定义要**完整复制**（含 JSDoc），不能改语义
- 改了 import 路径后 `pnpm typecheck` 必须绿灯
- `pnpm build` 必须成功
- `node scripts/compile-plugins.mjs` 跑完输出 "No plugins found"
- **不要顺手重构**，不要改业务逻辑，不要碰你没被要求碰的文件

---

## 工作方式

1. **先探索** — 自己去读 `src/tools/toolSet.ts`、`src/types.ts`、`backend/lib/paths.js`、`scripts/compile-electron.mjs`、现有的 `tsconfig.json` / `vite.config.ts` / `vitest.sdk.config.ts`。搞懂现有架构再动手。
2. **有疑问就问** — 任何不确定的事（比如"这个类型算不算插件基础设施""这个 import 要不要改""这个文件结构合不合理"），直接用 `vscode_askQuestions` 工具问我。**不要猜，不要赌**。
3. **一次到位** — 搬就搬干净，别留 TODO、别留 `any`、别留 "FIXME"。后面 5 个阶段全依赖你打的地基。**地基裂了，后面全废**。
