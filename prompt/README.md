# 插件底座 + 浏览器模块迁移 — AI 执行指令集

> 本文件是给 AI 编程助手（GitHub Copilot）的精确执行指令集。
> 每条指令都对应具体文件的精确变更，按阶段编排，每个阶段可独立验证。
> **指令语言定位**：AI 可以直接逐条执行的精确操作步骤，不需要人类读者理解每个细节。

---

## 目录

| 阶段 | 文件 | 描述 |
|------|------|------|
| Phase 0 | [`phase-0.md`](./phase-0.md) | 基石 — agent-type 类型隔离 + 构建工具链 |
| Phase 1 | [`phase-1.md`](./phase-1.md) | 后端插件系统 |
| Phase 2 | [`phase-2.md`](./phase-2.md) | 前端插件系统（SDK + Agent-UI） |
| Phase 3 | [`phase-3.md`](./phase-3.md) | 插件管理器（plugin-manager） |
| Phase 4 | [`phase-4.md`](./phase-4.md) | 浏览器插件迁移 |
| Phase 5 | [`phase-5.md`](./phase-5.md) | 集成清理 + 主流程接入 |
| — | [附录](#附录) | 设计约定、错误处理、命名规范、依赖图、参考模式、验证命令 |

---

## 核心设计原则

| 编号 | 规则 | 违反后果 |
|------|------|---------|
| C1 | `agent-type/` 只能包含 `export type` / `export interface`，**不能有任何 runtime 代码**（无 `const`、`function`、`class`、`let/var`、`import ... from` 值导入） | 插件打包会包含重复代码 |
| C2 | **插件系统基础设施类型**（PluginHost、PluginManifest、ToolSet 等）**必须**定义在 `agent-type/` 中，通过 `@agent-type` 别名导入。业务工具类型（BrowserAdapter、FileAdapter 等）**不属于** agent-type | agent-type 混入业务代码 → 类型包变胖 + 职责不清晰 |
| C3 | 源文件中的类型定义**必须删除**——不能两份共存 | 导致两份定义不同步 |
| C4 | `import type { X }` 可以改为 `@agent-type`；`import { createToolSet }` 这类值导入**不能改** | 后者是 runtime 代码，仍在 SDK 中 |
| C5 | 非 UI 层单测覆盖率 100%，**一层加载失败不影响其他层** | 插件系统可靠性 |

---

## 附录

### A. 设计约定

| 编号 | 规则 |
|------|------|
| C1 | 全链路 TypeScript，禁止 `import()` 动态导入（除非是插件加载器自身） |
| C2 | 文件粒度合理，每个文件不超过 300 行（除非有充分理由） |
| C3 | 沿用 Transports → Services → Managers 三层 + Adapter 模式 |
| C4 | 非 UI 层单测覆盖率 100%，通过率 100%。**一层加载失败不影响其他层** |
| C5 | 迁移完成后 `src/`、`agent-UI/`、`backend/` 中不得出现任何浏览器代码 |
| C6 | UI 插件输出为纯 HTML+JS+CSS 的 iframe 沙箱产物 |
| C7 | 允许激进重构，以最干净的语义为准 |
| C8 | **类型隔离**：所有跨层共享类型必须定义在 `agent-type/` 下，通过 `@agent-type` 别名导入。SDK、Backend、agent-UI 三层不得直接引用彼此目录下的类型。`agent-type/` 文件只能包含 `type`/`interface` 定义，不能有任何 runtime 代码 |

### B. 错误处理模式

所有插件加载操作必须遵循以下错误处理模式：

```javascript
// 后端插件加载：失败不影响其他插件
async function safeActivate(scanner, name) {
  try {
    await scanner.activate(name);
    logger.info(`Plugin "${name}" activated`);
  } catch (err) {
    logger.error(`Failed to activate plugin "${name}":`, err.message);
    // 不重新抛出 — 其他插件继续加载
  }
}

// 前端插件加载同理
async function safeLoadPlugin(loader, plugin) {
  try {
    await loader.loadPluginSdkEntry(plugin);
  } catch (err) {
    console.warn(`Plugin "${plugin.name}" SDK entry failed:`, err.message);
    // UI 继续渲染，用户看到插件加载失败的提示
  }
}
```

### C. IPC 通道命名规范

```
格式：plugin:<pluginName>:<methodName>
示例：plugin:browser:createSession
      plugin:browser:stream:frame
      plugin:plugin-manager:list
```

HTTP 路由命名规范：

```
格式：POST /api/plugin/<pluginName>/<methodName>
示例：POST /api/plugin/browser/createSession
      POST /api/plugin/plugin-manager/list
```

WebSocket 路径规范：

```
格式：/api/plugin/<pluginName>/<streamName>
示例：/api/plugin/browser/stream
```

### D. 依赖图（完整）

```
Phase 0 ─────────────────────────────────────────────────
  0.1 agent-type/ (plugin.ts, adapter.ts, tool.ts, widget.ts, shared.ts, index.ts)
  0.2 配置 @agent-type 别名 (tsconfig, vite, vitest)
  0.3 更新所有现有 import 为 @agent-type
  0.4 scripts/compile-plugins.mjs
  0.5 extensions/ 骨架 (browser + plugin-manager)
  0.6 backend/lib/paths.js (+PLUGINS_DIR)
        │
        ├── Phase 1 ─────────────────────────────────────
        │  1.1 backend/lib/plugin-router.js
        │  1.2 backend/lib/plugin-host.js
        │  1.3 backend/lib/plugin-scanner.js
        │  1.4 backend/index.js (修改)
        │  1.5 单测 (plugin-*.test.js)
        │        │
        │        ├── Phase 3 ────────────────────────────
        │        │  3.1 plugin-manager/backend/index.js
        │        │  3.2 plugin-manager/ui/index.tsx
        │        │  3.3 plugin-manager/manifest.json
        │        │  3.4 单测
        │        │
        │        └── Phase 4 ────────────────────────────
        │           4.1 browser/agent/ (10 files)
        │           4.2 browser/backend/ (4 files)
        │           4.3 browser/ui/ (9 files)
        │           4.4 browser/manifest.json
        │           4.5 单测
        │
        └── Phase 2 ─────────────────────────────────────
           2.1 src/plugin/apiClient.ts
           2.2 agent-UI/plugin/loader.ts
           2.3 agent-UI/plugin/index.ts
           2.4 单测
                 │
                 └── Phase 5 ────────────────────────────
                    5.1 agents.ts (改造)
                    5.2 createAdapters.ts (清理)
                    5.3 backend/index.js (清理)
                    5.4 ipc/index.js (清理)
                    5.5 src/index.ts (清理导出)
                    5.6 端到端验证
```

### E. 参考模式索引

| 你要做的事 | 参考已有代码 |
|-----------|------------|
| 创建 adapter 工厂 | `src/tools/browser/adapter.ts`（apiFetch + buildWsUrl） |
| 创建 IPC adapter | `src/tools/browser/ipcAdapter.ts`（ipcInvoke + electronAPI） |
| 创建 ToolSet | `src/tools/browser/toolSet.ts`（tools + onGetState + adapter） |
| 创建工具定义 | `src/tools/browser/tools.ts`（defineTool + zod schema） |
| 后端服务函数 | `backend/services/browser.js`（getBrowser + safe accessors） |
| 后端 Manager | `backend/lib/browser-manager/index.js`（Map-based registry） |
| HTTP 路由 | `backend/transports/network/browser.js`（extract params → call service） |
| IPC handler | `backend/transports/ipc/browser.js`（channel → service） |
| 环境检测 | `agent-UI/env.ts`（IS_ELECTRON_IPC） |
| SDK 类型导出 | `src/index.ts`（barrel exports with JSDoc） |
| 类型定位 | `agent-type/`（纯类型包，零 runtime） |
| 路径别名配置 | `tsconfig.json` 的 `compilerOptions.paths` |
| Vite 别名 | `vite.config.ts` 的 `resolve.alias` |
| Vitest 别名 | `vitest.sdk.config.ts` 的 `resolve.alias` |
| 后端路径管理 | `backend/lib/paths.js`（单源 truth） |
| 流注册表 | `backend/lib/stream-registry.js`（Map + abort） |
| 单测 mock electron | `agent-UI/__tests__/chatTransport.ipc.test.ts`（vi.hoisted + mockInvoke） |
| 后端单测 | `backend/__tests__/cron.manager.test.js`（mock 文件系统） |

### F. 验证命令速查表

| 阶段 | 命令 | 预期结果 |
|------|------|---------|
| 全部 | `pnpm typecheck` | 无类型错误 |
| 全部 | `pnpm build` | SDK 构建成功 |
| Phase 0 | `node scripts/compile-plugins.mjs` | 输出 "No plugins found" |
| Phase 1 | `pnpm vitest run --config vitest.config.ts backend/__tests__/plugin-*.test.js` | 全部通过 |
| Phase 2 | `pnpm vitest run --config vitest.sdk.config.ts src/plugin/__tests__/` | 全部通过 |
| Phase 3 | `cd extensions/plugin-manager && pnpm vitest run` | 全部通过 |
| Phase 4 | `cd extensions/browser && pnpm vitest run` | 全部通过 |
| Phase 5 | `pnpm test` | 全部通过 |
| Phase 5 | `curl -s http://localhost:3001/api/plugins` | 返回插件列表 |
