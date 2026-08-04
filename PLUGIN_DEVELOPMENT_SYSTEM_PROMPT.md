## Plugin Development

A plugin is a self-contained capability module. The platform loads plugins from `plugins/<plugin-id>/` — each directory is a flat, self-contained deployable. Three optional layers: **agent** (tools + lifecycle), **backend** (Node.js services), **UI** (iframe sandbox).

---

### Installed Plugin Shape

```
plugins/<plugin-id>/
  manifest.json           # PluginManifest
  activate.js             # Agent entry (optional) — bundled ES module
  backend.cjs             # Backend entry (optional) — bundled CommonJS
  ui/
    index.html            # UI entry (optional) — HTML shell that loads ui/*.js
    *.js, *.css           # Bundled UI assets
```

All entry files are **pre-compiled, self-contained bundles**. The platform never sees TypeScript, `node_modules`, or build tooling.

---

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "...",
  "agentEntry": "activate.js",
  "backendEntry": "backend.cjs",
  "uiEntry": "ui/index.html"
}
```

- `id`: kebab-case, globally unique. Used for IPC channels, data directories, routing.
- `agentEntry`, `backendEntry`, `uiEntry`: paths relative to the plugin root. All optional.

---

### Entry Point Signatures

All three entries export a single `activate` function.

#### Agent Entry (`activate.js`)

```typescript
import type { AgentPluginHost, ToolSet, PluginSlotDeclaration } from '@agent-type';

export function activate(host: AgentPluginHost): void {
  host.registerToolSet(myToolSet, mySlotDeclarations);
}
```

`AgentPluginHost` surface:

| Member | Type | Description |
|--------|------|-------------|
| `registerToolSet(ts, slots?)` | `() => () => void` | Register ToolSet + optional slots; returns unregister fn |
| `bridge` | `PluginBridge` (generic) | Mutable shared object — agent writes methods, UI reads/calls them |
| `apiClient` | `PluginApiClient` | Pre-bound backend client — `apiClient.call<T>(method, params?)` |
| `getConfig<T>(key)` | `T` | Read plugin config, dot-separated key |
| `onConfigChanged(cb)` | `() => () => void` | Subscribe to config changes |
| `pluginId` | `string` | Plugin identifier (manifest `id`) |
| `pluginName` | `string` | Display name (manifest `name`) |
| `pluginVersion` | `string` | SemVer (manifest `version`) |
| `agentName` | `string` | Agent name (`"main"` or sub-agent name) |
| `getSelectedModel()` | `ModelMeta` | Current AI model metadata |
| `getTools()` | `readonly Tool[]` | All master tools on this agent |
| `getRegisteredToolSets()` | `readonly ToolSet[]` | All ToolSets on this agent |

#### Backend Entry (`backend.cjs`)

```typescript
import type { BackendPluginHost } from '@agent-type';

export function activate(host: BackendPluginHost): void {
  host.defineApi('doThing', async (params) => {
    return { ok: true, output: String(params.input) };
  });
}
```

`BackendPluginHost` surface:

| Member | Type | Description |
|--------|------|-------------|
| `defineApi(method, handler)` | `void` | Register API callable via `apiClient.call(method, params)` |
| `defineStream(name, handler)` | `void` | Register streaming endpoint via `apiClient.connectStream(name, params)` |
| `getPluginDataDir()` | `string` | Writable directory, created on activation, scoped to this plugin |
| `getAgentDir()` | `string \| null` | Project `.agent/` directory, may be null |
| `getBackendConfig<T>(key)` | `T` | System config. Known keys: `"proxy"` → `ProxyConfig` |
| `logger` | `Logger` | Structured logger (`.info`, `.ok`, `.warn`, `.error`, `.debug`) |
| `services` | `PluginServiceRegistry` | `.register<T>(name, impl)` / `.resolve<T>(name)` — inter-plugin comm |

#### UI Entry (`ui/index.html`)

The browser creates a sandboxed iframe pointing to this HTML. The platform injects `window.__UAP_PLUGIN_HOST__` before load.

```typescript
import type { UiPluginHost, SlotHostMessage } from '@agent-type';

declare global {
  interface Window {
    __UAP_PLUGIN_HOST__?: UiPluginHost;
  }
}

const host = await waitForHost(); // poll until defined, timeout 10s
const slotCtx = host.getSlotContext(); // { type, slotId }
```

`UiPluginHost` surface:

| Member | Type | Description |
|--------|------|-------------|
| `bridge` | `PluginBridge` | Same reference as `AgentPluginHost.bridge` |
| `apiClient` | `PluginApiClient` | Direct backend calls |
| `getSlotContext()` | `SlotContext` | Current slot type + id |
| `onSlotMessage(cb)` | `() => () => void` | Host→iframe messages (buffered, no races) |
| `getPluginState()` | `[SessionStateLike, TState] \| undefined` | Session + toolset state |
| `getConfig<T>(key)` | `T` | Plugin config |
| `pluginId` / `pluginName` / `pluginVersion` | `string` | Plugin identity |

---

### Defining Tools (`defineTool` from `@agent-type/defineTool`)

```typescript
import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';

const myTool = defineTool({
  name: 'my_tool',                     // snake_case, unique within plugin
  group: 'My Plugin',                  // UI grouping
  description: 'What this tool does.', // LLM reads this
  parameters: z.object({
    input: z.string().describe('LLM-visible description'),
    count: z.number().int().positive().default(1),
  }),
  isReadOnly: false,                   // default false — true for side-effect-free queries
  isDestructive: false,                // default false — true for delete/uninstall/etc.
  execute: async ({ input, count }) => {
    return { result: `processed ${input} × ${count}` };
  },
});
```

Rules:
- Every Zod field must have `.describe()` — the LLM reads these as parameter docs.
- `execute` receives **Zod-validated, typed** arguments.
- Return values are JSON-serialized and shown to the LLM. Keep under ~10KB.
- Return `{ ok: true/false, error?: string }` from mutation tools.

---

### ToolSet

A `ToolSet` is a plain object bundling tools + lifecycle hooks.

```typescript
import type { ToolSet, ToolSetContext, SystemPromptContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';

const MY_SYMBOL = Symbol('my-plugin');

const toolSet: ToolSet = {
  symbol: MY_SYMBOL,
  name: 'my-plugin-manager',
  coreTools: ['list_items'],             // always visible to the model
  tools: [myTool, listTool],             // or () => readonly Tool[] for lazy resolution

  // ── Lifecycle hooks (all optional) ─────────────────────────────────────
  onAttach(agent) { /* capture agent reference; return cleanup fn */ },

  onInit(ctx, entryData?) { /* scope created/restored; init per-scope maps */ },
  onReady(ctx, helpers)  { /* scope wired; helpers.sendMessage(), helpers.injectToolResult() */ },
  onReset(ctx)           { /* history cleared */ },
  onRemove(ctx)          { /* scope removed; release resources */ },

  onInterceptMessage(ctx, msg, isLoading) { /* return { intercepted: true } to claim */ },
  onBeforeRun(ctx, history)              { /* before agent loop starts */ },

  onGetSystemPrompt(ctx, promptCtx, toolSets) { /* return string appended to system prompt */ },
  onFilterTools(ctx, tools)                  { /* return subset visible this turn */ },
  onBeforeInvoke(ctx)                        { /* return AgentMessage[] to prepend */ },
  onResolveToolArgs(ctx, toolName, args)     { /* transform args before validation */ },
  onPatchToolContext(ctx, signal)            { /* return partial ToolExecutionContext */ },
  onBeforeToolExecute(ctx, name, tool, args, execCtx) { /* permission; return { allow: false, result } to block */ },
  onToolResult(ctx, toolName, result)        { /* transform/post-process result */ },
  onAfterTurn(ctx, history, usage, signal, handler) { /* token tracking, compaction */ },
  onAfterRun(ctx, outcome)                   { /* outcome: completed|max-turns|aborted|error */ },

  onGetState(ctx, stateCtx?)       { /* derive session state */ },
  onBuildSnapshot(ctx)             { /* serialize for persistence */ },
  onSubscribe(ctx, fn)             { /* subscribe to state changes; return unsubscribe */ },
};
```

Hooks fire in registration order. `ctx` is `ToolSetContext { sessionId, agentName, conversationId }`. Use `ctxKey(ctx)` from `@agent-type` as a Map key for per-scope state.

---

### Slot Declarations

Passed as the second argument to `host.registerToolSet(toolSet, slots)`. Discriminated union on `type`:

```typescript
const slots: readonly PluginSlotDeclaration[] = [
  // Full sidebar tab
  { type: 'panel', label: 'My Panel', icon: '🔧', showTab: (ctx) => true },

  // Tool result card in chat (iframe)
  { type: 'toolCard', toolNames: ['my_tool', 'list_items'] },

  // Inline pill in chat (no iframe)
  { type: 'compactToolCard', toolNames: ['my_tool', 'list_items'], getDescriptor: (info: ToolCallInfo) => ({ icon: '🔧', label: info.name, summary: info.name, status: info.status }) },

  // Button in the AIControlBar → opens dropdown panel
  { type: 'toolButton', label: 'My Plugin', icon: '🔧', showBtn: () => true },

  // Full-width bar above tabs
  { type: 'headerBar' },

  // Inline prompt area
  { type: 'inlinePrompt' },

  // Floating draggable window (app launcher)
  { type: 'app', icon: '🔧', label: 'My App', defaultWidth: 800, defaultHeight: 600 },

  // ChatInput autocompletion
  { type: 'autocomplete', prefix: '/', getItems: () => [{ id: 'x', label: '/x', description: '...', insertText: '/x ' }] },
];
```

Rules:
- `toolCard` and `compactToolCard` must be paired — same `toolNames`.
- `showTab` / `showBtn` / `shouldRender` receive `SlotDisplayContext { sessionId, agentName, conversationId }`. Filter by `agentName === 'main'` when the slot only applies to the primary agent.
- `compactToolCard.getDescriptor(info: ToolCallInfo)` returns `{ icon, label, summary, status }`.
- `PanelSlotDeclaration.containingHeight` / `containingWidth` set iframe sizing hints.

---

### Adapter Pattern (Agent ↔ Backend)

Decouple the ToolSet from the transport layer with a typed adapter interface:

```typescript
// Adapter interface — the ToolSet depends ONLY on this, never on apiClient directly
interface MyAdapter {
  doThing(input: string): Promise<{ ok: boolean; output: string }>;
  listItems(): Promise<{ items: string[] }>;
}

// Adapter implementation — wraps the pre-bound apiClient
function createAdapter(apiClient: PluginApiClient): MyAdapter {
  return {
    doThing: (input) => apiClient.call('doThing', { input }),
    listItems: () => apiClient.call('listItems'),
  };
}
```

---

### Bridge Pattern (Agent ↔ UI)

For UI-to-agent calls, use the shared `host.bridge`:

```typescript
// Agent populates bridge during activate():
host.bridge.refresh = async () => adapter.listItems();
host.bridge.doThing = async (input: string) => adapter.doThing(input);

// UI calls bridge directly — same object reference, no serialization:
const items = await host.bridge.refresh();
```

---

### PluginApiClient

Pre-bound per-plugin instance. Available as `host.apiClient` in all three layers.

```typescript
interface PluginApiClient {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  connectStream(streamName: string, params?: Record<string, unknown>): PluginStreamClient;
}
```

`connectStream` returns:

```typescript
interface PluginStreamClient {
  callbacks: { onData(chunk: unknown): void; onEnd(): void; onError(err: Error): void };
  subscribe(): StreamSubscription; // call after setting callbacks
}
```

---

### Backend Streaming

```typescript
host.defineStream('liveOutput', (params, io) => ({
  subscribe: () => {
    const timer = setInterval(() => {
      if (!io.isConnected()) { clearInterval(timer); return; }
      io.sendJSON({ chunk: 'data' });
      // io.sendBinary(uint8Array) for binary frames
    }, 1000);
    io.onClose(() => clearInterval(timer));
    return { unsubscribe: () => { clearInterval(timer); io.close(); } };
  },
}));
```

Always call `io.close()` when the stream ends — otherwise the client hangs.

---

### Inter-Plugin Services (Backend)

```typescript
// Producer plugin:
host.services.register('my-plugin', { doThing, listItems });

// Consumer plugin:
const svc = host.services.resolve<{ doThing(input: string): Promise<{ ok: boolean }> }>('my-plugin');
if (svc) await svc.doThing('hello');
```

---

### Design Rules

1. **No `any`, `unknown`, `as` casts.** Define explicit interfaces. Narrow with type guards (`typeof v === 'string'`).
2. **Tool names are `snake_case`**, unique within the plugin.
3. **Every Zod field has `.describe()`** — the LLM reads these.
4. **Adapter method names match backend API method names** exactly.
5. **`toolCard` and `compactToolCard` slots always paired** — same `toolNames`.
6. **Mutation tools return `{ ok: boolean, error?: string }`** — the LLM uses `ok` to decide next steps.
7. **Plugins depend only on `@agent-type`** — never import from `agent-UI/`, `backend/`, `src/`, or `electron/`.
8. **Use `Object.assign(host.bridge, methods)`** to populate the bridge — never reassign `host.bridge`.
9. **No giant modules.** Split adapter, toolset, tools, and activation into separate files.
10. **No duplicated logic.** The adapter is the single source of truth for backend communication.
