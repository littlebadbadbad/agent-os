# @uap/agent-sdk — Architecture

AI agent SDK: tool-calling, multi-session, plugin system, dual-deploy (Electron IPC / standalone HTTP).

## Monorepo

```
agent-type/   # Pure TS type contracts (ZERO runtime except defineTool/buildTool)
src/          # SDK core: AgentClient, ToolSet impls, agent loop
agent-UI/     # React frontend: AgentWidget, stores, transport, handlers
backend/      # Node.js HTTP server (raw http, no Express): AI gateway, services, transports
electron/     # Electron shell: main.ts + preload IPC bridge
demo/         # Reference app
plugins/      # Discoverable plugins (manifest.json + 3 entry points)
extensions/   # Feature extensions (browser/Playwright)
workspace/    # Sandbox workspace for tools
```

## Layers

### 1. Type Contracts (`agent-type/`) — `@agent-type`
Pure TS, no runtime imports except `defineTool`/`buildTool` (identity+freeze / fill-defaults+freeze).

| File | Key types |
|------|-----------|
| `core.ts` | `Tool`, `ToolCall`, `ToolResult`, `Attachment`, `TokenUsage`, `ToolDescriptor`, `AgentStreamChunk` (discriminated union: text\|thinking\|tool_call\|tool_result\|attachment\|usage), `AgentTurnResponse`, `AgentSessionState`, `SessionEntryData` |
| `handler.ts` | `AgentHandler(msg[], ctx) → Promise<AgentTurnResponse \| ReadableStream<AgentStreamChunk>>`, `HandlerContext` (tools, callTool, toolChoice, systemPrompt, signal) |
| `message.ts` | `UserMessage`, `AssistantMessage` (content, toolCalls?, thinking?, attachments?), `ToolResultMessage`, `AgentMessage` union, `ToolChoice` |
| `toolset.ts` | `ToolSet` lifecycle hooks (below), `ToolSetContext` (sessionId, agentName, conversationId), `AgentClientLike`, `AgentQueryFns`, `SystemPromptContext`, `CompactionResult`, `AgentRunOutcome` |
| `plugin.ts` | `PluginManifest`, `BackendPluginHost`, `AgentPluginHost`, `UiPluginHost`, `PluginApiClient`, `StreamConnection`, `PluginConfiguration` |
| `vendor.ts` | `OpenAIToolParam`, `AnthropicToolParam`, `GeminiFunctionDeclaration` + message wire formats |
| `widget.ts` | `WidgetIcon`, `WidgetTheme`, `Position`, `WidgetHandler` |
| `defineTool.ts` | `defineTool()`, `buildTool()` — **only runtime code in agent-type** |

### 2. SDK Core (`src/`) — `@agent-sdk`

**AgentClient** (`src/client/index.ts`): `createAgentClient(config)` → manages master tools/toolSets, session lifecycle. Exposes `registerTool()`, `registerToolSet()`, `createSession()`, `getState()`. Owns `SessionManager` + per-session `ToolManager`.

**AgentSession** (`src/client/agentSession.ts`): observable state (messages, isLoading, toolStates, todos, tokenBudget, subAgentRegistries). `sendMessage()` → runs agent loop. Maintains `history` (compacted LLM context) separate from UI messages.

**Agent Loop** (`src/tools/agentLoopCore.ts` + `agentLoop.ts` + `agentRuntime.ts`):
- `runAgentLoopCore()` — turn-by-turn: invokeHandler → drain stream → execute tool calls (parallel, abortable) → append results → repeat until no tool calls or maxTurns.
- `drainAgentStream()` — consumes `ReadableStream<AgentStreamChunk>`, fires `AgentStreamHooks` (onTextDelta, onThinkingDelta, onFirstToolSeen, onPreExecutedResult, onAttachment).
- `buildSystemPrompt()` — folds all `onGetSystemPrompt` hooks; section-aware sorting/dedup by `sectionId`+`sectionPriority`; cached via `SystemPromptCache`.

**ToolSets** (`src/tools/`):

| ToolSet | Purpose |
|---------|---------|
| `file/` | read/write/replace/delete/list/search — HTTP or IPC adapters |
| `terminal/` | PTY shell create/manage |
| `subagent/` | `runAgentLoop`, `createSubAgentToolset`, `createSubAgentRegistry`, delegation nudge |
| `todo/` `plan/` | task list / plan management |
| `skill/` + `skillManager/` | dynamic skill loading |
| `dynamicTool/` | register tools at runtime |
| `mcp/` | MCP server integration |
| `cron/` | scheduled tasks |
| `toolSearch/` | semantic tool discovery (defers non-core tools behind `tool_search`) |
| `experience/` `memoryGraph/` `variable/` | memory stores |
| `userInput/` + `pendingInput/` | user input queuing |
| `historyProcessing/` | ToolResultCompressor, context compaction |
| `tokenBudget/` | context window management |
| `permissions/` `toolStateToolSet/` `upgrade/` `track/` | permissions, state persistence, upgrades, usage tracking |

### 3. UI Layer (`agent-UI/`)

**Transport** (dual-mode, auto-select via `IS_ELECTRON_IPC` from `env.ts`):
- `transport/chatTransport.ts` — `ChatTransport`: `sendAsync()` / `sendStream()`. HttpChatTransport (fetch) or IpcChatTransport (window.electronAPI.invoke).
- `transport/apiTransport.ts` — generic REST: get/post/put/del, same dual-mode.

**Handlers** (`handlers/`): `asyncHandler.ts` / `streamHandler.ts` — implement `AgentHandler`, delegate to `chatTransport`. Pure business logic, zero transport code.

**Plugin System** (`plugin/`): `pluginSystem.ts` fetches enabled plugins → `loader.ts` dynamic-imports agent entries → `host.ts` creates `AgentPluginHost` (registerToolSet, apiClient, getConfig) → calls `activate()`.

**Stores**: `providerStore.ts` (selected provider/model), `providerConfigStore.ts`, `sessionStore.ts`.

**Adapters** (`createAdapters.ts`): env detector → creates HTTP or IPC adapters for file, terminal, browser, cron, dynamicTool, skill, mcp, upgrade. Each adapter: two impls switching on `IS_ELECTRON_IPC`.

### 4. Backend (`backend/`)

**Entry** (`index.js`): raw `http.createServer()`, route dispatch by URL path, static file serving for `dist-demo/`, WebSocket via `ws` for streams, plugin scanner bootstrap at startup. `registerIpcHandlers()` lazy-loaded only in Electron context.

**Chat Pipeline**:
```
POST /api/chat[/stream]
  → transports/network/chat.js (route: parse req → call service → send resp)
    → services/chat.js (business logic: normalize tools → call provider)
      → providers/customendpoint.js (apiType-agnostic orchestrator)
        → lib/format-converters/{chat-completions|responses|messages}.js
          → fetches AI API, returns {text, thinking?, toolCalls, usage}
```

**Format Converters** (`lib/format-converters/`): one per apiType. Each implements `callAsync()` + `callStream()` with identical interface. `index.js` resolves apiType from provider-config.json at call time. Zero hardcoded URLs/models.

**Services** (`services/`): `chat.js` (AI orchestration), `system.js` (health, version, public key), `model-config.js`. Pure business logic, zero transport code.

**Lib** (`lib/`): `http.js`, `paths.js`, `proxy.js`, `logger.js`, `store.js`, `oai.js` (OpenAI format utils), `http-client.js`, `key-store.js`+`key-encryption.js`+`rsa.js` (API key mgmt), `sessions.js`, `git.js`, `shell-manager/` (PTY), `file-sandbox/`, `mcp-manager/`, `cron-manager/`, `skill-store/`, `stream-registry.js`, `toolEnv.js`, `plugin-scanner.js`+`plugin-router.js`+`plugin-host.js`+`plugin-config-store.js`+`plugin-state-store.js`.

**Transports** (`transports/`):
- `network/` — HTTP route handlers: chat, tools, skills, files, terminals, cron, mcp, git, sessions, api-keys, models, model-config, proxy, ado-proxy, upgrade, chat-logs
- `ipc/` — Electron IPC handlers (same routes, `ipcMain.handle` protocol). `index.js` aggregates all registrations.

### 5. Plugin System

3 entry points per plugin (`manifest.json`): `agentEntry` (register ToolSet), `backendEntry` (defineApi/defineStream), `uiEntry` (render UI).

- **Backend**: `plugin-scanner.js` scans `plugins/` → loads state → activates enabled via `plugin-host.js`. `plugin-router.js` routes: HTTP `POST /api/plugin/<name>/<method>`, IPC `plugin:<name>:<method>`, WS `/api/plugin/<name>/<streamName>`.
- **Frontend**: `plugin/pluginSystem.ts` fetches enabled list → loads agent entries → activates via `AgentPluginHost`.
- **Security**: plugin code only interacts via host API; path access restricted (only plugin-manager sees PLUGINS_DIR).

## Deploy Matrix

| Mode | Transport | Frontend | Runtime |
|------|-----------|----------|---------|
| Electron app | IPC | agent-UI widget | Electron main+renderer |
| Standalone web | HTTP SSE | agent-UI widget | Node.js backend + browser |
| Embedded widget | in-process | AgentWidget React | Host app |

## Key Design Patterns

**Adapter Pattern**: Every backend service has dual adapters (Http* / Ipc*). Factory auto-selects via `IS_ELECTRON_IPC`. Consumer code transport-agnostic.

**ToolSet Lifecycle** (hook fire order):
```
onAttach (once per agent)
  → onInitSession → onSessionReady (session create/restore)
  → onBeforeRun (once per sendMessage)
    → [per LLM turn:] onGetSystemPrompt → onFilterTools → onBeforeInvoke
      → [per tool call:] onBeforeToolCall → execute → onAfterToolCall
    → onAfterTurn (per turn: token tracking, history compaction)
  → onAfterRun (once per run)
  → onGetState (derive session state)
onResetSession / onRemoveSession (cleanup)
onPatchToolContext (patch tool exec context before each call)
```
Sub-agent conversations have parallel hooks: `onInitConversation` / `onResetConversation` / `onRemoveConversation`.

**Session Management**: AgentClient owns `SessionManager`. Each session has its own `ToolManager` (per-session filtered tools). Persistence via external load/save callbacks. `history` (compacted LLM context) separate from UI `messages`.

**Module Augmentation**: `AgentSessionExtension`, `SessionEntryExtension`, `ToolExecutionContextExtension` use TS `declare module` — third parties add fields without modifying SDK source.

**Stream Chunk Protocol**: `AgentStreamChunk` discriminated union wraps any vendor's streaming format into one standard type.

**Provider Abstraction**: `customendpoint.js` reads `provider-config.json` at call time → resolves `apiType` → delegates to format converter. Zero hardcoded URLs/models.

**System Prompt Sections**: ToolSets with `sectionId` are sorted by `sectionPriority` (ascending) and deduplicated (lowest priority wins per section). ToolSets without `sectionId` inject unconditionally. `SystemPromptCache` caches `cacheable` sections per session.

