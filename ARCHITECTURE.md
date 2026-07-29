# ARCHITECTURE

AI agent SDK: tool-calling, multi-session, plugin-based, dual-deploy (Electron IPC / standalone HTTP).

## Packages

```
agent-type/  → @agent-type   Pure TS type contracts. ZERO runtime except defineTool/buildTool.
src/         → @agent-sdk    SDK core: AgentClient, AgentSession, agent loop, ToolSet impls.
agent-UI/    → (app)         React frontend: AgentWidget, stores, transport, handlers, plugin UI host.
backend/     → (server)      Node.js HTTP server (raw http, no Express): AI gateway, services, transports.
electron/    → (shell)       Electron main+preload. Env vars: UAP_EXE_DIR, UAP_IS_PACKAGED, UAP_NATIVE_ROOT.
extensions/  → (source)      Plugin source code (manifest.json + 3 entry points).
plugins/     → (compiled)    Compiled plugin output from extensions/ via scripts/compile-plugins.mjs.
```

## Type Contracts (`agent-type/`)

All cross-layer shared types live here. Import via `@agent-type/<file>`. No runtime imports except `defineTool`/`buildTool`.

| File | Key exports |
|------|-------------|
| `core.ts` | `Tool<TName,TSchema,TResult>`, `ToolCall`, `ToolResult`, `Attachment`, `TokenUsage`, `AgentStreamChunk` (union: `text\|thinking\|tool_call\|tool_result\|attachment\|usage`), `AgentTurnResponse`, `AgentSessionState`, `SessionStateLike`, `ToolExecutionContext` (has `requestUserInput`, `sendMessage`, `flushPersistence`), `UserInputRequest` |
| `handler.ts` | `AgentHandler(msgs[], ctx) → Promise<AgentTurnResponse \| ReadableStream<AgentStreamChunk>>`, `HandlerContext` (tools, callTool, toolChoice, systemPrompt, signal) |
| `message.ts` | `UserMessage`, `AssistantMessage` (content, toolCalls?, thinking?, attachments?), `ToolResultMessage`, `AgentMessage` union, `ToolChoice` (`auto\|required\|none\|{type:'function',name}`) |
| `toolset.ts` | `ToolSet` interface (~20 lifecycle hooks), `ToolSetContext` (sessionId, agentName, conversationId), `ctxKey()`, `MAIN_CONVERSATION_ID`, `SystemPromptContext` (has `suppressToolSetPrompt`), `CompactionResult`, `AgentRunOutcome`, `AgentClientLike`, `AgentQueryFns` |
| `plugin.ts` | `PluginManifest` (3 entries: agentEntry/backendEntry/uiEntry), `BackendPluginHost` (defineApi/defineStream/getPluginDataDir/getAgentDir/getBackendConfig), `AgentPluginHost` (registerToolSet/apiClient/getConfig), `UiPluginHost`/`UiPluginHostInternal` (getPluginState/getSlotContext/onSlotMessage — buffered), `PluginApiClient`, `ToolCallInfo`, `StreamHandler`, `StreamConnection`, `PluginConfiguration` |
| `ui-slot/types.ts` | 7 `SlotType` values: `panel\|toolCard\|inlinePrompt\|headerBar\|toolButton\|compactToolCard\|autocomplete`. Slot declarations, `SlotContext`, `SlotDisplayContext` (sessionId/agentName/conversationId) |
| `ui-slot/protocol.ts` | Per-slot host→iframe message types |
| `ui-slot/index.ts` | Barrel |
| `vendor.ts` | `OpenAIToolParam`, `AnthropicToolParam`, `GeminiFunctionDeclaration` + message wire formats |
| `widget.ts` | `WidgetIcon`, `WidgetTheme`, `Position`, `WidgetHandler` |
| `model.ts` | `ModelMeta` (id, label, contextWindow, description) |
| `ipc-channels.ts` | `IpcChannel` union (all channel names), `typedInvoke()` |
| `defineTool.ts` | `defineTool()` (identity+freeze, no defaults), `buildTool()` (fill defaults+freeze), `ToolDef`, `TOOL_DEFAULTS`. **Only runtime code in agent-type.** |
| `index.ts` | Barrel re-exports |

### Module Augmentation

```typescript
// Third parties extend without modifying SDK source:
declare module '@agent-type/core' {
  interface AgentSessionExtension { /* custom session fields */ }
  interface SessionEntryExtension { /* custom per-entry fields */ }
  interface ToolExecutionContextExtension { /* custom tool exec context */ }
}
```

## SDK Core (`src/`)

### AgentClient (`src/client/index.ts`)
`createAgentClient(config)` → owns `SessionManager` + master tools/toolSets. API: `registerTool()`, `registerToolSet()`, `createSession()`, `getState()`. Each session gets its own `ToolManager` (per-session filtered tools).

### AgentSession (`src/client/agentSession.ts`)
Observable state: `messages`, `isLoading`, `toolStates`, `todos`, `tokenBudget`, `subAgentRegistry`. `sendMessage()` → runs agent loop. `history` (compacted LLM context) is separate from UI `messages`.

### Agent Loop (`src/tools/agentLoopCore.ts`)
```
runAgentLoopCore():
  loop:
    1. invokeHandler(msgs, ctx) → stream
    2. drainAgentStream(stream) → fires AgentStreamHooks (onTextDelta, onThinkingDelta, onFirstToolSeen, onPreExecutedResult, onAttachment)
    3. if toolCalls: execute in parallel (abortable) → append ToolResultMessage → repeat
    4. else: break
```

### System Prompt Assembly (`src/tools/agentRuntime.ts`)
`buildSystemPrompt()` folds all `onGetSystemPrompt` hooks in registration order.

### ToolSet Lifecycle (hook fire order)
```
onAttach (once per agent)
  → onInitSession → onSessionReady (session create/restore)
  → onBeforeRun (once per sendMessage)
    → [per LLM turn:] onGetSystemPrompt → onFilterTools → onBeforeInvoke
      → [per tool call:] onBeforeToolCall → execute → onAfterToolCall
    → onAfterTurn (token tracking, history compaction)
  → onAfterRun (once per run)
  → onGetState (derive session state)
onResetSession / onRemoveSession (cleanup)
onPatchToolContext (patch tool exec context before each call)
```
Sub-agent conversations: parallel hooks `onInitConversation` / `onResetConversation` / `onRemoveConversation`.

### Built-in ToolSets (`src/tools/`)

| ToolSet | Purpose |
|---------|---------|
| `file/` | read/write/replace/delete/list/search |
| `terminal/` | PTY shell create/manage |
| `subagent/` | `runAgentLoop`, `createSubAgentToolset`, `createSubAgentRegistry`, delegation nudge |
| `todo/` `plan/` | task list / plan management |
| `dynamicTool/` | register tools at runtime |
| `cron/` *(moved to `extensions/cron/`)* | scheduled tasks |
| `experience/` `memoryGraph/` `variable/` | memory stores |
| `userInput/` + `pendingInput/` | user input queuing |
| `historyProcessing/` | ToolResultCompressor, context compaction |
| `tokenBudget/` | context window management |
| `permissions/` `upgrade/` `track/` | permissions, state persistence, upgrades, usage tracking |

> **Note**: `skill/` and `mcp/` have been migrated from built-in ToolSets to independent plugins (see Plugin System).

## UI Layer (`agent-UI/`)

### Dual Transport (auto-select via `IS_ELECTRON_IPC` from `env.ts`)
`IS_ELECTRON_IPC = !!window.electronAPI?.invoke`

| Transport | Interface | HTTP impl | IPC impl |
|-----------|-----------|-----------|----------|
| `ChatTransport` | `sendAsync()` / `sendStream()` | `HttpChatTransport` (fetch) | `IpcChatTransport` (electronAPI.invoke) |
| `ApiTransport` | `get/post/put/del` | `HttpApiTransport` (fetch) | `IpcApiTransport` (electronAPI.invoke) |

Handlers (`handlers/asyncHandler.ts`, `streamHandler.ts`) implement `AgentHandler`, delegate to `ChatTransport`. Pure business logic, zero transport code.

### Plugin System (`agent-UI/plugin/`)
```
pluginSystem.ts: fetch enabled plugins → loader.ts (dynamic import agent entries)
  → host.ts: create AgentPluginHost (registerToolSet, apiClient, getConfig) → activate()
  → uiHost.ts: UiPluginHost (same-realm injection, NOT postMessage; message buffering eliminates races)
  → uiLoader.ts: iframe sandbox creation
  → discoverSlots.ts: collect standalone slot declarations from active plugins' slotDeclarations map
```

`apiClient.ts`: Pre-bound cross-environment API client. HTTP: `fetch(POST /api/plugin/<name>/<method>)`. IPC: `electronAPI.invoke('plugin:<name>:<method>')`.

### Slot System (`agent-UI/slots/`)
`SlotRegistry` with overloaded `getByType()` for type narrowing. `SlotRenderer.tsx` dispatches to correct renderer by `slotType`.

7 slot types:
- **iframe-based**: `panel`, `toolCard`, `inlinePrompt`, `headerBar`, `toolButton`
- **inline**: `compactToolCard`, `autocomplete`

Slots declared via `host.registerToolSet(toolSet, slots)` second parameter — stored independently from session state.

### Adapters (`createAdapters.ts`)
Env detector → creates HTTP or IPC adapters for: file, terminal, browser, dynamicTool, skill, mcp, upgrade. Each adapter: two impls switching on `IS_ELECTRON_IPC`.

### Session Persistence
`agents.ts` creates `asyncAgent` + `streamAgent` (dual handler pattern). `InitGate` blocks saves until restore completes.

## Backend (`backend/`)

### Entry (`index.js`)
`http.createServer()` → route dispatch by URL path → static file serving for `dist-demo/` → WebSocket (`ws`) for streams → plugin scanner bootstrap at startup. `registerIpcHandlers()` lazy-loaded only in Electron context.

### Chat Pipeline
```
POST /api/chat[/stream]
  → transports/network/chat.js        (route: parse req → call service → send resp)
    → services/chat.js                (business logic: normalize tools via toOAITools → call provider)
      → providers/customendpoint.js   (apiType-agnostic orchestrator, reads provider-config.json at call time)
        → lib/format-converters/<apiType>.js  (callAsync() + callStream())
          → fetches AI API → returns {text, thinking?, toolCalls, usage}
```

### Format Converters (`lib/format-converters/`)
One per `apiType`: `chat-completions.js`, `responses.js`, `messages.js`. Each implements `callAsync()` + `callStream()` with identical interface. `index.js` resolves `apiType` from `provider-config.json` at call time. Zero hardcoded URLs/models.

### Plugin Backend (`lib/plugin-*.js`)
```
plugin-scanner.js: scan plugins/ → load state → activate enabled via plugin-host.js
plugin-host.js:    activate/deactivate plugin backend entries
plugin-router.js:  route requests:
                    HTTP  POST /api/plugin/<name>/<method>
                    IPC   plugin:<name>:<method>
                    WS    /api/plugin/<name>/<streamName>
```

### Transports (`transports/`)
- `network/` — HTTP route handlers: chat, tools, skills, files, terminals, mcp, git, sessions, api-keys, models, model-config, proxy, ado-proxy, upgrade, chat-logs
- `ipc/` — Electron IPC handlers (same routes, `ipcMain.handle` protocol). `index.js` aggregates all registrations.

## Plugin System

### Manifest (`manifest.json`)
```json
{
  "name": "<plugin-name>",
  "agentEntry": "./agent/index.ts",    // → registerToolSet() via AgentPluginHost
  "backendEntry": "./backend/index.js", // → defineApi() / defineStream() via BackendPluginHost
  "uiEntry": "./ui/index.tsx"          // → render UI in iframe sandbox
}
```

### 3 Entry Points
| Entry | Host | Capabilities |
|-------|------|-------------|
| `agentEntry` | `AgentPluginHost` | `registerToolSet()`, `apiClient`, `getConfig()` |
| `backendEntry` | `BackendPluginHost` | `defineApi()`, `defineStream()`, `getPluginDataDir()`, `getAgentDir()`, `getBackendConfig()` |
| `uiEntry` | `UiPluginHost` | `getPluginState()`, `getSlotContext()`, `onSlotMessage()` (buffered) |

### Built-in Plugins (`built-in-plugins.json`)
`user-input`, `todo`, `token-budget`, `plan`, `terminal`, `tool-state`, `skill`, `mcp`

### UiPluginHost Communication
Same-realm direct method invocation (NOT postMessage). Message buffering eliminates race conditions between plugin load and slot rendering.

### Security
Plugin code interacts only via host API. Path access restricted — only `plugin-manager` sees `PLUGINS_DIR`.

## Deploy Matrix

| Mode | Transport | Frontend | Runtime |
|------|-----------|----------|---------|
| Electron app | IPC | agent-UI widget | Electron main+renderer |
| Standalone web | HTTP SSE | agent-UI widget | Node.js backend + browser |
| Embedded widget | in-process | AgentWidget React | Host app |

## Design Patterns

**Adapter Pattern**: Every backend service has dual adapters (Http* / Ipc*). Factory auto-selects via `IS_ELECTRON_IPC`. Consumer code transport-agnostic.

**AgentStreamChunk Protocol**: Discriminated union wraps any vendor's streaming format into one standard type. `drainAgentStream()` normalizes consumption.

**Provider Abstraction**: `customendpoint.js` reads `provider-config.json` at call time → resolves `apiType` → delegates to format converter. Zero hardcoded URLs/models.

**Module Augmentation**: `AgentSessionExtension`, `SessionEntryExtension`, `ToolExecutionContextExtension` via TS `declare module` — third parties add fields without modifying SDK source.

**Session Isolation**: AgentClient owns `SessionManager`. Each session has its own `ToolManager` (per-session filtered tools). `history` (compacted LLM context) separate from UI `messages`. Persistence via external load/save callbacks.

**System Prompt Sections**: ToolSets are iterated in registration order. Each receives a `SystemPromptContext` with accumulated parts so far. Internally-branded ToolSets may suppress other ToolSets' fragments via `suppressToolSetPrompt`.

## Constraints

| ID | Rule |
|----|------|
| C1 | `agent-type/` only `export type`/`interface` — no runtime except `defineTool`/`buildTool` |
| C2 | Cross-layer shared types must be in `agent-type/`, imported via `@agent-type` alias. SDK, backend, agent-UI must not directly reference each other's type definitions |
| C3 | No `import()` dynamic imports except plugin loaders |
| C4 | Plugin UI output = pure HTML+JS+CSS iframe sandbox |
| C5 | Non-UI layer test coverage 100%. One layer load failure must not affect others |
| C6 | Backend: raw `http.createServer()`, no Express |
| C7 | Transports → Services → Managers three-layer + Adapter pattern in backend |

