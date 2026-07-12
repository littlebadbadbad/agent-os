# Skill + MCP 完整插件迁移计划

**TL;DR** — 将 `skill` 和 `mcp` 从 SDK 核心 (`src/tools/`)、后端内置路由 (`backend/`)、UI 硬编码 (`agent-UI/components/`) 完整迁移为标准插件，遵循 browser/terminal 架构。迁移后 `src/`、`agent-UI/`、`backend/` 层零残留。**一丁点逻辑都不能变** — 先复制粘贴，再删改。

---

## 核心发现（迁移前必须理解）

| 发现 | Skill | MCP |
|------|-------|-----|
| ToolSet 位置 | `src/tools/skillManager/manager.ts` | `src/tools/mcp/manager.ts` |
| 状态暴露模式 | **旧的 `onGetState`**（不是 `onGetSymbolState`） | **无 ToolSet 状态钩子** — 使用 `McpToolsetExtension`（store/connect/disconnect 直接暴露） |
| UI 引用方式 | `SessionContent` 读 `skills` → 传 `ChatInput` slash-menu | `McpButton` 直接引用 `mcpToolset.store` 全局单例 |
| 后端位置 | `backend/services/skills.js` + `lib/skill-store/` | `backend/services/mcp.js` + `lib/mcp-manager/` |
| IPC 通道 | `skills:list/install/remove/readFile/refresh` | `mcp:list/add/remove/reconnect/disconnect/execute` |
| 路由 | `backend/transports/network/skills.js` + `ipc/skills.js` | `backend/transports/network/mcp.js` + `ipc/mcp.js` |
| 当前扩展骨架 | `extensions/skill/` 目录已创建但全部为空 | `extensions/mcp/` 目录已创建但全部为空 |
| ToolCard | `agent-UI/components/.../toolCards/SkillToolCard.tsx` 硬编码 | **(不存在)** — MCP 工具走 GenericCard |
| 适配器 | `createAdapters.ts` 中 `createSkillAdapter()` + 单例 | `createAdapters.ts` 中 `createMcpAdapter()` + 单例 |
| 状态订阅 | `SessionContent` 通过 `useSyncExternalStore` 读 `skills` | `McpButton` 通过 `mcpToolset.store.subscribe()` |

---

## Slot 设计（核心架构决策）

### Skill 插件 Slot 声明

```typescript
// extensions/skill/agent/manager.ts — onGetSymbolState
onGetSymbolState(ctx: ToolSetContext) {
  return {
    type: 'skillManager',
    skills: [...],    // SkillState[]
    managerAction: {...},  // install/remove/read/sync API
    slots: [
      // 1. inlinePrompt — 在聊天输入框上方显示 "/" slash-command 提示
      { type: 'inlinePrompt', shouldRender: (sctx) => 
          sctx.conversationId === MAIN_CONVERSATION_ID },  // 仅主 agent
      // 2. panel — sidebar 中的 Skill 管理面板
      { type: 'panel', label: 'Skills', showTab: (sctx) =>
          sctx.conversationId === MAIN_CONVERSATION_ID, order: 60 },
      // 3. toolCard — 技能管理工具的调用卡片 (install_skill 等)
      { type: 'toolCard', toolNames: SKILL_TOOL_NAMES },
      // 4. compactToolCard — 紧凑模式
      { type: 'compactToolCard', toolNames: SKILL_TOOL_NAMES },
    ],
  };
}
```

### MCP 插件 Slot 声明

```typescript
// extensions/mcp/agent/manager.ts — onGetSymbolState
onGetSymbolState(ctx: ToolSetContext) {
  return {
    type: 'mcpManager',
    // UI 需要的全部操作都通过 state 暴露，无需全局 mcpToolset 单例
    servers: [...],    // McpServerEntry[]
    connect: (id) => ..., disconnect: (id) => ..., remove: (id) => ...,
    addServer: (config) => ..., sync: () => ...,
    slots: [
      // 1. panel — sidebar 中的 MCP 管理面板（用 badge 显示连接状态）
      { type: 'panel', label: 'MCP', showTab: (sctx) =>
          sctx.conversationId === MAIN_CONVERSATION_ID, order: 40,
        badge: () => connectedCount > 0 ? `${connectedCount}` : null },
      // 2. toolCard — MCP 工具调用结果卡片（动态构建 toolNames）
      { type: 'toolCard', toolNames: [...connectedMcpToolNames] },
      // 3. compactToolCard
      { type: 'compactToolCard', toolNames: [...connectedMcpToolNames] },
    ],
  };
}
```

**关键变更**：
- **Skill 的 slash-command 菜单**：不再通过 `ChatInput` props 传递，转为 `inlinePrompt` slot + host 端组件通信模式。ChatInput 通过 `slotRegistry` 查 `inlinePrompt` slot，skill iframe 通过 `sendSlotMessage({ type: "insertSlash", text })` 写回 textarea。
- **MCP 顶栏**：用 panel tab 的 `badge` + `showTab` 控制（与 Todo 插件一致），不引入 `headerBar` slot。
- **主 agent vs subagent 区分**：通过 `SlotDisplayContext.conversationId` (`MAIN_CONVERSATION_ID` vs sub-agent conversationId) 在 `showTab`/`shouldRender` 中判断。

---

## 基础设施更改（所有 Phase 的前提）

### I1. BackendPluginHost 新增 `getAgentDir()`
- **文件**: `agent-type/plugin.ts`, `backend/lib/plugin-host.js`, `backend/lib/plugin-scanner.js`
- **模式**: 与 `getPluginDataDir()` 一致 — `plugin-host.js` 接收 `agentDir` 参数（6 个参数 → 7 个），`plugin-scanner.js` 传入 `AGENT_DIR`
- **用途**: Skill 需要 `.agent/skills/`，MCP 需要 `.agent/mcp-servers.json`

### I2. 更新 `built-in-plugins.json`
- 添加 `"skill"` 和 `"mcp"` 到内置插件列表

---

## Phase 1: Skill 插件迁移

### Step 1.1 — 创建 `extensions/skill/agent/`（从 `src/tools/skill*` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `src/tools/skill.ts` | `extensions/skill/agent/skill.ts` | **原样复制** — `defineSkill`, `Skill`, `SkillState`, `resolveSkillTools` |
| `src/tools/skillManager/types.ts` | `extensions/skill/agent/types.ts` | **复制** — `BackendSkill`, `SkillManagerAdapter`（保留接口定义） |
| `src/tools/skillManager/manager.ts` | `extensions/skill/agent/manager.ts` | **复制 + 改造**：① `SkillManagerAdapter` → 通过 `pluginAdapter` 调用 ② `onGetState` → `onGetSymbolState` ③ 添加 `PluginUiAdapter.slots` |
| `src/tools/skillManager/adapter.ts` | `extensions/skill/agent/adapter.ts` | **原样复制**（保留 HTTP adapter 作为 standalone 支持） |
| `src/tools/skillManager/ipcAdapter.ts` | `extensions/skill/agent/ipcAdapter.ts` | **原样复制**（保留 IPC adapter） |
| （新建） | `extensions/skill/agent/pluginAdapter.ts` | **新建** — 包装 `PluginApiClient` → `SkillManagerAdapter` |
| `src/tools/skillManager/index.ts` | `extensions/skill/agent/index.ts` | **复制 + 调整** — barrel export |
| （新建） | `extensions/skill/agent/activate.ts` | **新建** — 标准 plugin activate 模式：`createPluginAdapter(apiClient)` → `registerToolSet(createSkillToolset(adapter))` |

**`pluginAdapter.ts` 关键逻辑**（MCP 类似）：

```typescript
export function createSkillPluginAdapter(apiClient: PluginApiClient): SkillManagerAdapter {
  return {
    listSkills: () => apiClient.call('listSkills').then(r => (r as any).skills ?? []),
    installSkill: (input) => apiClient.call('installSkill', input),
    removeSkill: (name) => apiClient.call('removeSkill', { name }),
    readSkillFile: (skill, path) => apiClient.call('readSkillFile', { name: skill, path }),
  };
}
```

**`manager.ts` 改造要点**：
1. 顶部 `declare module '@agent-type' { interface AgentSessionExtension { skills?: ... } }` → 保留（这是标准模块增强模式）
2. `onGetState` → `onGetSymbolState`，返回类型包含 `PluginUiAdapter.slots`
3. `subscribers` → 用 `onSubscribe` 替代
4. `onStartup` 自动 `listSkills` 逻辑 → `onAttach` 触发

### Step 1.2 — 创建 `extensions/skill/backend/`（从 `backend/` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `backend/services/skills.js` | `extensions/skill/backend/services/skills.js` | **原样复制** |
| `backend/lib/skill-store/index.js` | `extensions/skill/backend/lib/skill-store/index.js` | **复制 + 适配** — AGENT_DIR 从 `host.getAgentDir()` 获取，而非 `import {AGENT_DIR}` |
| `backend/lib/skill-store/skill-fs.js` | `extensions/skill/backend/lib/skill-store/skill-fs.js` | **复制 + 适配** — AGENT_DIR 改为参数传入 |
| `backend/lib/skill-store/frontmatter.js` | `extensions/skill/backend/lib/skill-store/frontmatter.js` | **原样复制** |
| （新建） | `extensions/skill/backend/index.js` | **新建** — `activate(host)`: `defineApi('listSkills', ...)`, `defineApi('installSkill', ...)` 等 |

**`backend/index.js` 关键模式**（与 browser/terminal 一致）：

```javascript
export function activate(host) {
  const skillStore = createSkillStore(host.getAgentDir());
  
  host.defineApi('listSkills', async () => ({ skills: skillStore.listSkills() }));
  host.defineApi('installSkill', async (params) => skillStore.installSkill(params));
  host.defineApi('removeSkill', async ({ name }) => skillStore.removeSkill(name));
  host.defineApi('readSkillFile', async ({ name, path }) => skillStore.readSkillFile(name, path));
}
```

### Step 1.3 — 创建 `extensions/skill/ui/`（从 `agent-UI/components/Skill/` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `agent-UI/components/Skill/SkillManagerPanel.tsx` | `extensions/skill/ui/SkillManagerPanel.tsx` | **复制 + 适配**：不再引用全局 `skillToolset` 或 `listSkills()`，改为通过 `host.getPluginState()` 读取 + `host.apiClient.call()` 操作 |
| `agent-UI/components/Skill/SkillButton.tsx` | `extensions/skill/ui/SkillButton.tsx` | **复制 + 适配**：转为 slot-aware 组件 |
| `agent-UI/.../toolCards/SkillToolCard.tsx` | `extensions/skill/ui/SkillToolCard.tsx` | **复制 + 适配**：通过 slot host 接收 toolCallInfo |
| （新建） | `extensions/skill/ui/identifiers.ts` | **新建** — `SKILL_TOOL_NAMES`, `isSkillTool()` |
| （新建） | `extensions/skill/ui/main.tsx` | **新建** — 标准 UI iframe 入口, 按 slotType 分发 |
| （新建） | `extensions/skill/ui/index.html` | **新建** — Vite HTML entry |
| `agent-UI/components/Skill/*.module.scss` | `extensions/skill/ui/*.module.scss` | **原样复制** |

### Step 1.4 — 创建 `extensions/skill/` 基础设施

| 文件 | 动作 |
|------|------|
| `extensions/skill/manifest.json` | **新建** — id: "skill", agentEntry: "activate.js", backendEntry: "backend.cjs", uiEntry: "ui/index.html" |
| `extensions/skill/package.json` | **新建** — 参照 `extensions/todo/package.json`，scripts.build |
| `extensions/skill/tsconfig.json` | **新建** — 参照 `extensions/todo/tsconfig.json` |
| `extensions/skill/vite.ui.config.ts` | **新建** — 参照 `extensions/todo/vite.ui.config.ts` |
| `extensions/skill/scripts/build.mjs` | **新建** — 参照 `extensions/terminal/scripts/build.mjs`（含 backend 编译） |

### Step 1.5 — 从 SDK 核心移除（`src/`）

```
删除文件（按依赖顺序）：
1. src/tools/skillManager/ipcAdapter.ts    — 移到 plugin
2. src/tools/skillManager/adapter.ts       — 移到 plugin
3. src/tools/skillManager/manager.ts       — 移到 plugin
4. src/tools/skillManager/types.ts         — 移到 plugin
5. src/tools/skillManager/index.ts         — 移到 plugin
6. src/tools/skill.ts                      — 移到 plugin
7. src/tools/skillManager/                 — 空目录

修改文件：
8. src/index.ts                            — 移除 skill 相关 export 行
```

### Step 1.6 — 从 UI 层移除

```
修改文件：
1. agent-UI/agents.ts                      — 移除 import/export skillToolset/skillAdapter
2. agent-UI/createAdapters.ts              — 移除 createSkillAdapter(), export skillAdapter
3. agent-UI/api/backend.ts                 — 移除 listSkills()
4. agent-UI/api/index.ts                   — 移除 listSkills export
5. agent-UI/transport/apiTransport.ts      — 移除 skill 相关 IPC 路由映射
6. agent-UI/components/Sidebar/AIControlBar.tsx — 移除 <SkillButton />
7. agent-UI/components/AgentWidget/chat/ToolCallCard.tsx — 移除 isSkillTool 路由
8. agent-UI/.../toolCards/identifiers.ts   — 移除 SKILL_TOOL_NAMES, isSkillTool
9. agent-UI/.../toolCards/shared.tsx       — 移除 CardFamily.skill 引用
10. agent-UI/.../ChatInput.tsx             — 移除 skills prop + slash-command 菜单逻辑
11. agent-UI/.../SessionContent.tsx        — 移除 skills 读取和传递

删除文件：
12. agent-UI/components/Skill/              — 整个目录
13. agent-UI/.../toolCards/SkillToolCard.tsx
```

### Step 1.7 — 从后端移除

```
修改文件：
1. backend/index.js                        — 移除 handleSkillRoutes import + 路由调用
2. backend/transports/ipc/index.js         — 移除 registerSkillHandlers import + 调用
3. backend/lib/paths.js                    — 移除 SKILLS_DIR 相关引用（在 skill-fs.js 中定义）

删除文件：
4. backend/transports/network/skills.js
5. backend/transports/ipc/skills.js
6. backend/services/skills.js
7. backend/lib/skill-store/                — 整个目录（index.js, skill-fs.js, frontmatter.js）
8. backend/__tests__/skills.route.test.js  — 迁移到 extensions/skill/__tests__/
```

### Step 1.8 — 更新 agent-type

```
修改文件：
1. agent-type/ipc-channels.ts              — 移除 skills:* 通道
```

---

## Phase 2: MCP 插件迁移

### Step 2.1 — 创建 `extensions/mcp/agent/`（从 `src/tools/mcp/` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `src/tools/mcp/types.ts` | `extensions/mcp/agent/types.ts` | **原样复制** — `McpAdapter`, `McpServerEntry`, `McpStore` 等 |
| `src/tools/mcp/store.ts` | `extensions/mcp/agent/store.ts` | **原样复制** |
| `src/tools/mcp/manager.ts` | `extensions/mcp/agent/manager.ts` | **复制 + 重大改造**：① `McpToolsetExtension`（store/connect/disconnect/sync/addServer）→ 改为通过 `onGetSymbolState` 暴露 ② 移除 `attachedAgents` ③ 保留 `createMcpProxyTool`、`syncFromAdapter`、meta-tools 所有逻辑 |
| `src/tools/mcp/adapter.ts` | `extensions/mcp/agent/adapter.ts` | **原样复制** |
| `src/tools/mcp/ipcAdapter.ts` | `extensions/mcp/agent/ipcAdapter.ts` | **原样复制** |
| `src/tools/mcp/prompt.ts` | `extensions/mcp/agent/prompt.ts` | **原样复制** |
| （新建） | `extensions/mcp/agent/pluginAdapter.ts` | **新建** — 包装 `PluginApiClient` → `McpAdapter` |
| `src/tools/mcp/index.ts` | `extensions/mcp/agent/index.ts` | **复制 + 调整** — barrel export |
| （新建） | `extensions/mcp/agent/activate.ts` | **新建** — 标准 plugin activate 模式 |

**`manager.ts` 改造核心**：
当前 MCP ToolSet 返回的是 `ToolSet & McpToolsetExtension`，其中 `.store`/`.connect()`/`.disconnect()` 直接暴露给 UI。迁移后：

```typescript
// 改造前: UI 直接引用 mcpToolset.store, mcpToolset.connect(), mcpToolset.sync()
// 改造后: ToolSet 只通过 onGetSymbolState 暴露状态
onGetSymbolState(ctx) {
  return {
    type: 'mcpManager',
    servers: store.getAll(),
    connect: (id) => ...,
    disconnect: (id) => ...,
    remove: (id) => ...,
    addServer: (config) => ...,
    sync: () => syncFromAdapter(),
    slots: [
      { type: 'panel', label: 'MCP Servers', showTab: ...,
        badge: () => connectedCount > 0 ? `${connectedCount}` : null },
      { type: 'toolCard', toolNames: [...] },
      { type: 'compactToolCard', toolNames: [...] },
    ],
  };
}
```

### Step 2.2 — 创建 `extensions/mcp/backend/`（从 `backend/` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `backend/services/mcp.js` | `extensions/mcp/backend/services/mcp.js` | **原样复制** |
| `backend/lib/mcp-manager/index.js` | `extensions/mcp/backend/lib/mcp-manager/index.js` | **复制 + 适配** — AGENT_DIR 从 `host.getAgentDir()` 获取 |
| `backend/lib/mcp-manager/http-transport.js` | `extensions/mcp/backend/lib/mcp-manager/http-transport.js` | **原样复制** |
| `backend/lib/mcp-manager/sse-transport.js` | `extensions/mcp/backend/lib/mcp-manager/sse-transport.js` | **原样复制** |
| `backend/lib/mcp-manager/transport-utils.js` | `extensions/mcp/backend/lib/mcp-manager/transport-utils.js` | **原样复制** |
| （新建） | `extensions/mcp/backend/index.js` | **新建** — `activate(host)`: defineApi 注册所有 MCP API |

### Step 2.3 — 创建 `extensions/mcp/ui/`（从 `agent-UI/components/MCP/` 复制 + 适配）

| 源文件 | 目标文件 | 动作 |
|--------|---------|------|
| `agent-UI/components/MCP/McpManagerPanel.tsx` | `extensions/mcp/ui/McpManagerPanel.tsx` | **复制 + 适配**：不再引用 `mcpToolset.something()`，改为从 `host.getPluginState()` 读取，通过 `host.apiClient.call()` 操作 |
| `agent-UI/components/MCP/McpButton.tsx` | `extensions/mcp/ui/McpButton.tsx` | **复制 + 适配**：转为 slot-aware |
| （新建） | `extensions/mcp/ui/McpToolCard.tsx` | **新建** — MCP 工具的 toolCard slot 渲染 |
| （新建） | `extensions/mcp/ui/identifiers.ts` | **新建** — `MCP_TOOL_NAMES`, `isMcpTool()` |
| （新建） | `extensions/mcp/ui/main.tsx` | **新建** — 按 slotType 分发 (headerBar, panel, toolCard, compactToolCard) |
| （新建） | `extensions/mcp/ui/index.html` | **新建** |
| `agent-UI/components/MCP/*.module.scss` | `extensions/mcp/ui/*.module.scss` | **原样复制** |

### Step 2.4 — 创建 `extensions/mcp/` 基础设施

| 文件 | 动作 |
|------|------|
| `extensions/mcp/manifest.json` | **新建** — id: "mcp" |
| `extensions/mcp/package.json` | **新建** |
| `extensions/mcp/tsconfig.json` | **新建** |
| `extensions/mcp/vite.ui.config.ts` | **新建** |
| `extensions/mcp/scripts/build.mjs` | **新建** |

### Step 2.5 — 从 SDK 核心移除

```
删除文件：
1. src/tools/mcp/ipcAdapter.ts
2. src/tools/mcp/adapter.ts
3. src/tools/mcp/manager.ts
4. src/tools/mcp/store.ts
5. src/tools/mcp/types.ts
6. src/tools/mcp/prompt.ts
7. src/tools/mcp/index.ts
8. src/tools/mcp/                           — 空目录

修改文件：
9. src/index.ts                             — 移除 MCP 相关 export 行
```

### Step 2.6 — 从 UI 层移除

```
修改文件：
1. agent-UI/agents.ts                       — 移除 import/export mcpToolset/mcpAdapter
2. agent-UI/createAdapters.ts               — 移除 createMcpAdapter(), export mcpAdapter
3. agent-UI/components/Sidebar/AIControlBar.tsx — 移除 <McpButton />
4. agent-UI/.../ToolCallCard.tsx            — 移除 MCP 硬编码路由（如果有）
5. agent-UI/.../identifiers.ts              — 移除 MCP_TOOL_NAMES（如果有）

删除文件：
6. agent-UI/components/MCP/                 — 整个目录
```

### Step 2.7 — 从后端移除

```
修改文件：
1. backend/index.js                         — 移除 handleMcpRoutes, startupReconnect import + 路由调用
2. backend/transports/ipc/index.js          — 移除 registerMcpHandlers import + 调用

删除文件：
3. backend/transports/network/mcp.js
4. backend/transports/ipc/mcp.js
5. backend/services/mcp.js
6. backend/lib/mcp-manager/                 — 整个目录
```

### Step 2.8 — 更新 agent-type

```
修改文件：
1. agent-type/ipc-channels.ts               — 移除 mcp:* 通道
```

---

## Phase 3: 清理 + 验证

### Step 3.1 — 全局搜索零残留

```
搜索 "skill" (case-insensitive) 在:
  - src/**/*.ts             → 应只搜到 defineSkill 已经在 plugin 中
  - agent-UI/**/*.{ts,tsx}  → 应只搜到 // 注释提及"skill"或 slot 相关
  - backend/**/*.js         → 应零结果
  - agent-type/**/*.ts      → 应零结果（IPC 通道已移除）
  - data/*.json             → 检查 session 数据中残留

搜索 "mcp" (case-insensitive) 同上
```

### Step 3.2 — 验证顺序

| 顺序 | 验证项 | 命令 |
|------|--------|------|
| 1 | 插件编译 | `node scripts/compile-plugins.mjs` — skill 和 mcp 编译成功 |
| 2 | SDK 类型检查 | `tsc --noEmit` |
| 3 | SDK 构建 | `pnpm build` (或 `vite build`) |
| 4 | 后端测试 | `pnpm test:backend` — 全部通过（需删除/更新 skills.route.test.js） |
| 5 | SDK 测试 | `pnpm test:sdk` — 全部通过 |
| 6 | UI 测试 | `pnpm test:ui` — 全部通过 |
| 7 | 后端启动 | `node backend/index.js` — plugin-scanner 正确加载 skill/mcp 插件 |
| 8 | 功能验证 | 手动：Skill/MCP 面板显示正常、连接正常工具可用 |

---

## 已确认的决策

| 问题 | 决策 |
|------|------|
| `defineSkill()` / `Skill` / `SkillState` | **完全随 plugin 迁移** → `extensions/skill/agent/skill.ts` |
| ChatInput slash-command | **Host 端组件 + slot 消息** — ChatInput 通过 slotRegistry 查 inlinePrompt slot，skill iframe 通过 `sendSlotMessage({ type: "insertSlash", text })` 写回 textarea |
| MCP 顶栏 | **用 panel tab 的 badge + showTab 控制** — 与 Todo 插件一致，tab 按钮显示状态徽章，panel 内容在 iframe 中自定义。不引入 headerBar slot |
| MCP ToolCard | **onGetSymbolState 动态构建** — 每次 sync 后重新生成 toolNames |
| 测试迁移 | **直接迁移到 plugin** — 复制到 `extensions/skill/__tests__/`，删除原 `backend/__tests__/skills.route.test.js` |

---

## 相关文件汇总

### 创建的新文件（~60 个）

| 目录 | 文件 |
|------|------|
| `extensions/skill/` | manifest.json, package.json, tsconfig.json, scripts/build.mjs, vite.ui.config.ts, vite-env.d.ts |
| `extensions/skill/agent/` | activate.ts, index.ts, types.ts, adapter.ts, ipcAdapter.ts, manager.ts, pluginAdapter.ts, skill.ts, prompt.ts |
| `extensions/skill/backend/` | index.js, services/skills.js, lib/skill-store/index.js, lib/skill-store/skill-fs.js, lib/skill-store/frontmatter.js |
| `extensions/skill/ui/` | index.html, main.tsx, SkillManagerPanel.tsx, SkillButton.tsx, SkillToolCard.tsx, identifiers.ts, *.module.scss |
| `extensions/mcp/` | manifest.json, package.json, tsconfig.json, scripts/build.mjs, vite.ui.config.ts, vite-env.d.ts |
| `extensions/mcp/agent/` | activate.ts, index.ts, types.ts, adapter.ts, ipcAdapter.ts, manager.ts, pluginAdapter.ts, store.ts, prompt.ts |
| `extensions/mcp/backend/` | index.js, services/mcp.js, lib/mcp-manager/index.js, http-transport.js, sse-transport.js, transport-utils.js |
| `extensions/mcp/ui/` | index.html, main.tsx, McpManagerPanel.tsx, McpButton.tsx, McpToolCard.tsx, identifiers.ts, *.module.scss |

### 修改的现有文件（~25 个）

| 文件 | 变更 |
|------|------|
| `agent-type/plugin.ts` | +`getAgentDir(): string` |
| `agent-type/ipc-channels.ts` | -skills:* -mcp:* 通道 |
| `backend/lib/plugin-host.js` | +`agentDir` 参数 + `getAgentDir()` |
| `backend/lib/plugin-scanner.js` | 传入 `AGENT_DIR` |
| `built-in-plugins.json` | +"skill", +"mcp" |
| `backend/index.js` | -skill -mcp routes |
| `backend/transports/ipc/index.js` | -skill -mcp handlers |
| `src/index.ts` | -skill -mcp exports |
| `agent-UI/agents.ts` | -skillToolset -mcpToolset -adapters |
| `agent-UI/createAdapters.ts` | -skill -mcp adapters |
| `agent-UI/api/backend.ts` | -listSkills |
| `agent-UI/api/index.ts` | -listSkills export |
| `agent-UI/transport/apiTransport.ts` | -skill routes |
| `agent-UI/components/Sidebar/AIControlBar.tsx` | -SkillButton -McpButton |
| `agent-UI/.../ChatInput.tsx` | -skills prop -slash-menu |
| `agent-UI/.../SessionContent.tsx` | -skills |
| `agent-UI/.../ToolCallCard.tsx` | -skill -mcp hardcoded routes |
| `agent-UI/.../toolCards/identifiers.ts` | -SKILL_TOOL_NAMES -isSkillTool |
| `agent-UI/.../toolCards/shared.tsx` | -skill -mcp CardFamily |

### 删除的文件（~20 个）

| 层 | 文件 |
|----|------|
| SDK | `src/tools/skill.ts`, `src/tools/skillManager/*`, `src/tools/mcp/*` |
| UI | `agent-UI/components/Skill/*`, `agent-UI/components/MCP/*`, `agent-UI/.../toolCards/SkillToolCard.tsx` |
| Backend | `backend/services/skills.js`, `backend/services/mcp.js`, `backend/lib/skill-store/*`, `backend/lib/mcp-manager/*`, `backend/transports/network/skills.js`, `backend/transports/network/mcp.js`, `backend/transports/ipc/skills.js`, `backend/transports/ipc/mcp.js` |

---

## 执行顺序（按依赖关系）

```
I1. BackendPluginHost.getAgentDir()   — 前置，无依赖
I2. built-in-plugins.json 更新         — 无依赖
       │
       ├── Phase 1A: Skill agent 层创建    ─── 依赖 I1
       ├── Phase 1B: Skill backend 层创建  ─── 依赖 I1
       ├── Phase 1C: Skill UI 层创建       ─── 依赖 I1
       │
       ├── Phase 2A: MCP agent 层创建     ─── 依赖 I1
       ├── Phase 2B: MCP backend 层创建   ─── 依赖 I1
       ├── Phase 2C: MCP UI 层创建        ─── 依赖 I1
       │
       ├── Phase 1D-1G: 删除 SDK/UI/Backend 残留 — 依赖 1A-1C 完成
       ├── Phase 2D-2G: 删除 SDK/UI/Backend 残留 — 依赖 2A-2C 完成
       │
       └── Phase 3: 清理 + 验证           ─── 依赖所有 Phase 完成
```

Phase 1A/1B/1C 和 Phase 2A/2B/2C 可以并行执行，因为不互相依赖。
