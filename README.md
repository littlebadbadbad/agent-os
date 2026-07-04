 @uap/agent-sdk

一个框架无关的前端 AI Agent SDK，提供完整的对话管理、工具调用、多会话、流式渲染等能力。可嵌入任何 Web 应用，开箱即用地展示一个可拖拽的悬浮 AI 面板。

---

# 目录

- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [createAgentClient 详解](#createagentclient-详解)
  - [配置项一览](#配置项一览)
  - [handler — AI 处理函数](#handler--ai-处理函数)
  - [HandlerContext — 上下文对象](#handlercontext--上下文对象)
  - [非流式响应 vs 流式响应](#非流式响应-vs-流式响应)
  - [公开 API 方法](#公开-api-方法)
- [工具系统 (Tool)](#工具系统-tool)
  - [defineTool — 定义单个工具](#definetool--定义单个工具)
  - [ToolSet — 工具集合](#toolset--工具集合)
  - [registerTool / registerToolSet](#registertool--registertoolset)
- [内置工具集](#内置工具集)
  - [createTodoTools — 任务清单](#createtodotools--任务清单)
  - [createFileTools — 文件操作](#createfiletools--文件操作)
  - [createTerminalTools — 终端管理](#createterminaltools--终端管理)
- [技能系统 (Skill)](#技能系统-skill)
  - [defineSkill — 定义技能](#defineskill--定义技能)
  - [loadSkill / unloadSkill](#loadskill--unloadskill)
  - [技能提及语法](#技能提及语法)
- [令牌追踪与自动摘要](#令牌追踪与自动摘要)
  - [TokenBudgetConfig](#tokenbudgetconfig)
  - [自动历史压缩](#自动历史压缩)
- [多会话管理 (SessionManager)](#多会话管理-sessionmanager)
  - [会话持久化](#会话持久化)
- [子代理 (Sub-Agent)](#子代理-sub-agent)
- [UI 渲染](#ui-渲染)
  - [默认悬浮面板](#默认悬浮面板)
  - [自定义 renderUI](#自定义-renderui)
- [消息格式转换](#消息格式转换)
- [类型速查](#类型速查)
- [架构总览](#架构总览)

---

# 核心概念

| 概念 | 说明 |
|------|------|
| **AgentClient** | 由 `createAgentClient` 创建，是整个 SDK 的根对象，管理工具、技能、多会话 |
| **AgentHandler** | 开发者提供的函数，接收会话历史 + 上下文，调用 AI API，返回结构化响应 |
| **Tool** | 一个有名称、参数 Schema（Zod）和 `execute` 函数的可调用工具 |
| **ToolSet** | 多个工具 + 会话生命周期钩子的捆绑包 |
| **Skill** | 工具 + 系统提示片段 + 生命周期钩子，表示一种可插拔的能力 |
| **AgentSession** | 一次独立对话，拥有自己的消息历史、工具状态、Todo 列表 |
| **SessionManager** | 管理所有 AgentSession 的列表，追踪当前活跃会话 |

---

# 快速开始

```bash
pnpm add @uap/agent-sdk zod zod-to-json-schema
```

```ts
import { createAgentClient } from '@uap/agent-sdk';
import type { AgentHandler } from '@uap/agent-sdk';

// 1. 实现 handler — 调用你的 AI 后端
const handler: AgentHandler = async (messages, context) => {
  const res = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: context.toOpenAIMessages(messages),
      tools:    context.toOpenAITools(),
    }),
  });
  return res.json(); // AgentTurnResponse
};

// 2. 创建 agent
const agent = createAgentClient({ handler });

// 3. 渲染悬浮面板
agent.render();
```

---

# createAgentClient 详解

`createAgentClient` 是整个 SDK 的入口工厂函数，返回一个 `AgentClient` 实例。

```ts
import { createAgentClient } from '@uap/agent-sdk';

const agent = createAgentClient(config: AgentClientConfig);
```

## 配置项一览

```ts
type AgentClientConfig = {
  // ── 必填 ─────────────────────────────────────────────────────────────────
  handler: AgentHandler;          // AI 处理函数（唯一必填项）

  // ── 标识与提示 ────────────────────────────────────────────────────────────
  id?: string;                    // 实例唯一 ID，用于 localStorage 持久化球的位置
  systemPrompt?: string;          // 每轮都注入给 AI 的系统提示

  // ── 工具控制 ─────────────────────────────────────────────────────────────
  toolChoice?: ToolChoice;        // 默认 'auto'，可设为 'none' | 'required' | { name }
  tools?: Tool[];                 // 初始化时注册的工具列表
  toolSets?: ToolSet[];           // 初始化时注册的工具集
  skills?: Skill[];               // 初始化时加载的技能列表

  // ── 对话行为 ─────────────────────────────────────────────────────────────
  maxAgentTurns?: number;         // 每条用户消息最多执行的 AI 轮次，默认 10
  enableAttachments?: boolean;    // 是否显示附件按钮，默认 true

  // ── Token 管理 ────────────────────────────────────────────────────────────
  tokenTracker?: TokenBudgetConfig | TokenTracker;

  // ── 终端面板 ─────────────────────────────────────────────────────────────
  terminalAdapter?: TerminalManagerAdapter;

  // ── UI 渲染 ───────────────────────────────────────────────────────────────
  renderUI?: (sessionManager: SessionManager, container: HTMLElement) => () => void;

  // ── 多会话与持久化 ────────────────────────────────────────────────────────
  initialSessions?: SessionEntryData[];
  onSessionsChange?: (sessions: SessionEntryData[]) => void;
};
```

## handler — AI 处理函数

`handler` 是 `createAgentClient` 唯一的必填配置，类型为：

```ts
type AgentHandler = (
  messages: AgentMessage[],
  context: HandlerContext,
) => Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;
```

每当用户发送消息或 AI 完成一轮工具调用后，SDK 都会调用 `handler`，传入：

- **`messages`** — 完整的对话历史（包含最新的用户消息）
- **`context`** — 包含工具描述符、格式转换方法等的上下文对象

handler 必须返回：
- `AgentTurnResponse` — 一次性结构化响应（非流式）
- `ReadableStream<AgentStreamChunk>` — 流式响应

## HandlerContext — 上下文对象

```ts
type HandlerContext = {
  // 已注册工具的描述符（vendor-agnostic JSON Schema）
  readonly tools: readonly ToolDescriptor[];

  // 直接执行工具（可选，通常由 SDK 内部处理）
  readonly callTool: (call: ToolCall) => Promise<ToolResult>;

  // 工具选择模式
  readonly toolChoice: ToolChoice;

  // 来自 createAgentClient({ systemPrompt }) 的系统提示
  readonly systemPrompt?: string;

  // abort 信号，用于取消正在进行的请求
  readonly signal?: AbortSignal;

  // ── 便捷的格式转换方法 ─────────────────────────────────────────────────

  // 将工具描述符格式化为各厂商的 API 格式
  readonly toOpenAITools:    () => OpenAIToolParam[];
  readonly toAnthropicTools: () => AnthropicToolParam[];
  readonly toGeminiTools:    () => GeminiFunctionDeclaration[];

  // 将消息历史转换为各厂商的消息格式（含多模态附件）
  readonly toOpenAIMessages:    (messages: readonly AgentMessage[]) => OpenAIMessage[];
  readonly toAnthropicMessages: (messages: readonly AgentMessage[]) => AnthropicMessage[];
  readonly toGeminiMessages:    (messages: readonly AgentMessage[]) => GeminiContent[];
};
```

### 完整的 OpenAI handler 示例

```ts
import type { AgentHandler } from '@uap/agent-sdk';

export const handler: AgentHandler = async (messages, context) => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages:   context.toOpenAIMessages(messages),
      tools:      context.toOpenAITools(),
      toolChoice: context.toolChoice,
      system:     context.systemPrompt,
    }),
    signal: context.signal,
  });
  return response.json(); // 后端直接返回 AgentTurnResponse
};
```

### 完整的 Anthropic streaming handler 示例

```ts
export const streamHandler: AgentHandler = async (messages, context) => {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify({
      messages: context.toAnthropicMessages(messages),
      tools:    context.toAnthropicTools(),
    }),
    signal: context.signal,
  });

  // 返回 ReadableStream<AgentStreamChunk>，SDK 自动处理流式渲染
  return convertSSEToAgentStream(response.body!);
};
```

## 非流式响应 vs 流式响应

### 非流式 — `AgentTurnResponse`

```ts
type AgentTurnResponse = {
  text: string;                    // AI 的文字回复
  thinking?: string;               // 思考过程（可选，显示在折叠块中）
  toolCalls?: ToolCall[];          // AI 请求执行的工具
  followUpText?: string;           // 工具执行完后追加的文字
  usage?: TokenUsage;              // Token 用量
};
```

### 流式 — `ReadableStream<AgentStreamChunk>`

流式响应由若干 chunk 组成，SDK 在消费流时实时渲染：

```ts
type AgentStreamChunk =
  | { type: 'text';        delta: string }          // 文字增量
  | { type: 'thinking';    delta: string }          // 思考过程增量
  | { type: 'tool_call';   call: ToolCall }         // 触发工具调用（SDK 执行）
  | { type: 'tool_result'; call: ToolCall; result: ToolResult } // 已执行的工具（仅展示）
  | { type: 'attachment';  attachment: Attachment } // 二进制附件（如生成的图片）
  | { type: 'usage';       usage: TokenUsage };     // Token 用量
```

## 公开 API 方法

`createAgentClient` 的返回值提供以下方法：

```ts
type AgentClient = {
  // ── UI ──────────────────────────────────────────────────────────────────
  render(container?: HTMLElement): void;  // 挂载悬浮面板到 DOM

  // ── 会话管理 ────────────────────────────────────────────────────────────
  getSessionManager(): SessionManager;
  createSession(data?: Partial<SessionEntryData>): AgentSession;
  removeSession(id: string): void;
  setActiveSession(id: string): void;
  getSessionSnapshot(id?: string): SessionEntryData; // 获取可序列化快照

  // ── 无头（Headless）消息 API ─────────────────────────────────────────────
  sendMessage(text: string, attachments?: Attachment[]): Promise<void>;
  cancelMessage(): void;
  clearHistory(): void;
  getMessages(): Message[];
  isLoading(): boolean;
  subscribe(fn: () => void): () => void; // 订阅活跃会话的状态变化

  // ── 工具管理（运行时动态注册） ─────────────────────────────────────────
  registerTool(tool: Tool): void;
  registerToolSet(toolSet: ToolSet): void;
  disableGroup(group: string): void;
  enableGroup(group: string): void;

  // ── 技能管理 ────────────────────────────────────────────────────────────
  loadSkill(skill: Skill): Promise<void>;
  unloadSkill(name: string): Promise<void>;
  getSkills(): SkillState[];
  subscribeSkills(fn: () => void): () => void;

  // ── Token 追踪 ───────────────────────────────────────────────────────────
  setTokenTracker(tracker: TokenTracker | TokenBudgetConfig): void;
  getTokenTracker(): TokenTracker | undefined;
};
```

---

# 工具系统 (Tool)

工具是 AI 可以调用的函数，由 `defineTool` 定义，使用 [Zod](https://zod.dev/) 描述参数结构。

## defineTool — 定义单个工具

```ts
import { z } from 'zod';
import { defineTool } from '@uap/agent-sdk';

const getWeather = defineTool({
  name: 'get_weather',
  description: '获取指定城市的当前天气。',
  group: 'Utilities',            // 可选，用于 UI 分组显示
  parameters: z.object({
    city: z.string().describe('城市名称，例如 "北京"'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ city, unit }, context) => {
    // context.sessionId 当前会话 ID
    // context.signal    AbortSignal，可监听取消
    const data = await fetchWeatherApi(city, unit);
    return data;
  },
});
```

`defineTool` 是纯类型帮助函数，返回冻结的工具对象，支持完整的 TypeScript 类型推断。

## ToolSet — 工具集合

`ToolSet` 在工具基础上增加了**会话生命周期钩子**，用于在会话创建/重置/销毁时管理状态。

```ts
import type { ToolSet } from '@uap/agent-sdk';

const myToolSet: ToolSet = {
  name: 'my-tools',
  tools: [tool1, tool2],

  // 会话创建时调用（可恢复持久化数据）
  onInitSession(sessionId, entryData) { /* ... */ },

  // 会话历史清空时调用
  onResetSession(sessionId) { /* ... */ },

  // 会话被删除时调用（释放资源）
  onRemoveSession(sessionId) { /* ... */ },

  // 向会话状态贡献数据切片（合并进 AgentSessionState）
  onGetState(sessionId) {
    return { todos: getItems(sessionId) };
  },

  // 订阅状态变化，返回取消订阅函数
  onSubscribe(sessionId, fn) {
    subscribers.get(sessionId)?.add(fn);
    return () => subscribers.get(sessionId)?.delete(fn);
  },
};
```

## registerTool / registerToolSet

工具可在运行时动态注册，新工具会自动同步到所有已存在的会话：

```ts
const agent = createAgentClient({ handler });

// 运行时注册单个工具
agent.registerTool(getWeather);

// 运行时注册工具集
agent.registerToolSet(myToolSet);

// 按 group 批量启用/禁用
agent.disableGroup('File Management');
agent.enableGroup('File Management');
```

---

# 内置工具集

## createTodoTools — 任务清单

提供 `todo_write` 和 `todo_read` 两个工具，让 AI 在对话中管理结构化任务列表。每个会话有独立的 Todo 状态，UI 面板自动展示。

```ts
import { createTodoTools, createAgentClient } from '@uap/agent-sdk';

const agent = createAgentClient({
  handler,
  toolSets: [createTodoTools()],
});
```

`TodoItem` 结构：

```ts
type TodoItem = {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'blocked';
  priority?: 'low' | 'medium' | 'high';
};
```

## createFileTools — 文件操作

通过 `FileAdapter` 抽象层提供 9 个文件操作工具，适配任何后端（HTTP、OPFS、Electron fs 等）：

| 工具名 | 功能 |
|--------|------|
| `get_workspace_root` | 获取当前工作区根目录 |
| `set_workspace_root` | 设置工作区根目录 |
| `read_file` | 读取文件（支持指定行范围，自动分页） |
| `write_file` | 创建或覆盖文件 |
| `str_replace` | 精确的单次子字符串替换 |
| `delete_file` | 删除文件 |
| `move_file` | 移动 / 重命名文件 |
| `list_dir` | 列出目录内容 |
| `search_files` | 按 glob 模式和/或内容正则搜索文件 |

使用内置的 HTTP 适配器连接 SDK 后端：

```ts
import { createFileTools, createHttpFileAdapter } from '@uap/agent-sdk';

const fileTools = createFileTools(
  createHttpFileAdapter({ baseUrl: '/api' })
);

const agent = createAgentClient({
  handler,
  tools: [...fileTools],
});
```

自定义 `FileAdapter` 接口：

```ts
type FileAdapter = {
  getWorkspaceRoot(): Promise<WorkspaceRootResult>;
  setWorkspaceRoot(args: { path: string }): Promise<WorkspaceRootResult>;
  readFile(args: { path: string; startLine?: number; endLine?: number }): Promise<ReadFileResult>;
  writeFile(args: { path: string; content: string }): Promise<WriteFileResult>;
  strReplace(args: { path: string; oldStr: string; newStr: string }): Promise<StrReplaceResult>;
  deleteFile(args: { path: string }): Promise<DeleteFileResult>;
  moveFile(args: { sourcePath: string; destinationPath: string }): Promise<MoveFileResult>;
  listDir(args: { path: string }): Promise<ListDirResult>;
  searchFiles(args: { pattern?: string; contentPattern?: string }): Promise<SearchFilesResult>;
};
```

## createTerminalTools — 终端管理

通过 `TerminalManagerAdapter` 抽象层提供 5 个终端工具，让 AI 可以创建和操作后端 Shell 会话：

| 工具名 | 功能 |
|--------|------|
| `terminal_list` | 列出所有活跃终端 |
| `terminal_create` | 创建新 Shell（支持指定 shell 类型、标签、工作目录） |
| `terminal_read` | 读取终端输出（支持增量轮询） |
| `terminal_send` | 向终端 stdin 写入文本 |
| `terminal_remove` | 关闭并删除终端 |

```ts
import { createTerminalTools, createHttpTerminalAdapter } from '@uap/agent-sdk';

const terminalAdapter = createHttpTerminalAdapter({ baseUrl: '/api' });
const terminalTools   = createTerminalTools(terminalAdapter);

const agent = createAgentClient({
  handler,
  tools: [...terminalTools],
  terminalAdapter, // 同时传入 adapter 以在面板显示终端标签页
});
```

---

# 技能系统 (Skill)

Skill 是**工具 + 系统提示片段 + 生命周期**的完整能力包，是工具的上层抽象，用于按功能模块组织和分发 AI 能力。

## defineSkill — 定义技能

```ts
import { defineSkill } from '@uap/agent-sdk';

const webSearchSkill = defineSkill({
  name: 'web-search',
  description: 'Web 搜索与页面获取能力',
  version: '1.0.0',
  tools: [searchTool, fetchPageTool],
  systemPrompt:
    '你具备网络搜索能力。\n' +
    '- 使用 search_web 进行关键字查询。\n' +
    '- 使用 fetch_page 读取指定 URL 的内容。',
  // 可选：异步初始化（如连接搜索服务）
  setup: async () => {
    await searchService.connect();
    return async () => searchService.disconnect(); // 返回清理函数
  },
});
```

`Skill` 完整类型：

```ts
type Skill = {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  readonly tools: readonly Tool[] | (() => readonly Tool[]);
  readonly systemPrompt?: string;
  // 异步初始化，可返回清理函数
  readonly setup?: () => Promise<(() => void | Promise<void>) | void>;
};
```

## loadSkill / unloadSkill

```ts
// 在 createAgentClient 时一次性加载（不调用 setup()）
const agent = createAgentClient({
  handler,
  skills: [webSearchSkill],
});

// 运行时异步加载（会调用 setup()）
await agent.loadSkill(webSearchSkill);

// 卸载技能（调用 setup 返回的清理函数）
await agent.unloadSkill('web-search');

// 订阅技能状态变化
const unsub = agent.subscribeSkills(() => {
  console.log(agent.getSkills()); // SkillState[]
});
```

## 技能提及语法

用户消息中可以用 `/技能名` 语法精确控制本轮对话中激活哪些技能的系统提示：

```
用户消息: "帮我搜索最新的 TypeScript 5.8 特性 /web-search"
 SDK 会解析 /web-search 并只注入该技能的系统提示片段
```

未提及任何技能时，所有已加载技能的系统提示都会注入。

---

# 令牌追踪与自动摘要

## TokenBudgetConfig

在 `createAgentClient` 传入 `tokenTracker` 以启用 Token 追踪：

```ts
const agent = createAgentClient({
  handler,
  // 推荐：每个会话独立追踪
  tokenTracker: {
    maxTokens: 128_000,          // 模型上下文窗口大小
    warningThreshold: 0.75,      // 75% 时触发警告，默认值
    summarizationThreshold: 0.85 // 85% 时触发自动摘要，默认值
  },
});
```

也可以使用 `createTokenTracker` 创建共享实例：

```ts
import { createTokenTracker } from '@uap/agent-sdk';

const tracker = createTokenTracker(
  { maxTokens: 128_000 },
  {
    onWarning: (state) => console.warn('Token 用量警告', state.usageRatio),
    onSummarizationNeeded: (state) => console.log('即将压缩历史'),
  }
);

const agent = createAgentClient({ handler, tokenTracker: tracker });
```

`TokenBudgetState` 状态结构：

```ts
type TokenBudgetState = {
  maxTokens: number;
  totalPromptTokens: number;     // 累计 Prompt Token（用于成本核算）
  totalCompletionTokens: number; // 累计 Completion Token
  totalTokens: number;
  lastPromptTokens: number;      // 最近一轮的 Prompt Token（反映当前上下文压力）
  usageRatio: number;            // lastPromptTokens / maxTokens，范围 [0, 1]
  turnCount: number;
  warning: boolean;
  shouldSummarize: boolean;
};
```

## 自动历史压缩

当 `usageRatio >= summarizationThreshold` 时，SDK 自动调用 `summarizeHistory`，将旧消息压缩为摘要锚点，保留最近几条对话，对话可无限延伸：

```ts
import { summarizeHistory, estimateTokens } from '@uap/agent-sdk';

// 也可手动调用（例如在自定义 headless 循环中）
const { messages, savedTokens } = await summarizeHistory(history, {
  handler,                    // 使用同一个 handler 来生成摘要
  keepRecentMessages: 4,      // 保留最近 4 条消息，其余压缩
});
```

---

# 多会话管理 (SessionManager)

`createAgentClient` 内部维护一个 `SessionManager`，管理多个平行会话，每个会话拥有独立的消息历史、工具状态、Todo 列表。

```ts
const mgr = agent.getSessionManager();

// 获取完整状态快照
const { sessions, activeSessionId } = mgr.getState();

// 创建新会话
const newSession = agent.createSession({ title: '新对话' });

// 切换活跃会话
agent.setActiveSession(newSession.id);

// 删除会话
agent.removeSession(newSession.id);

// 订阅会话列表或活跃会话的任何变化
const unsub = agent.subscribe(() => {
  const messages = agent.getMessages();
  // 刷新 UI...
});
```

`AgentSession` 的完整接口：

```ts
type AgentSession = {
  getState(): AgentSessionState;
  subscribe(fn: () => void): () => void;
  sendMessage(text: string, attachments?: Attachment[]): Promise<void>;
  cancelMessage(): void;
  clearHistory(): void;
  getHistory(): AgentMessage[]; // 原始 LLM 消息（用于序列化）
};
```

`AgentSessionState` 包含：

```ts
type AgentSessionState = {
  id: string;
  agentId: string | undefined;
  title: string;
  messages: Message[];           // 渲染后的 UI 消息（含流式气泡）
  isLoading: boolean;
  toolStates: ToolStateEntry[];  // 所有工具的启用/禁用状态
  skills: SkillState[];          // 所有技能的状态
  tokenBudget?: TokenBudgetState;
  todos: readonly TodoItem[];
  terminalAdapter?: TerminalManagerAdapter;
  enableAttachments: boolean;
};
```

## 会话持久化

`onSessionsChange` 回调在任何会话数据变化后触发（流式 Token 期间防抖 ~500ms），接收完整的可序列化快照：

```ts
createAgentClient({
  handler,
  // 从 localStorage 恢复上次的会话
  initialSessions: JSON.parse(localStorage.getItem('sessions') ?? '[]'),
  // 每次变化时保存
  onSessionsChange: (sessions) =>
    localStorage.setItem('sessions', JSON.stringify(sessions)),
});
```

---

# 子代理 (Sub-Agent)

子代理允许父 AI 将子任务委托给另一个独立的 AI 实例，每个子代理在隔离的上下文中运行完整的 Agentic Loop。

## defineSubAgent — 定义子代理工具

```ts
import { defineSubAgent } from '@uap/agent-sdk';

const researcherAgent = defineSubAgent({
  name: 'researcher_agent',
  description: '深度网络研究。提供明确的任务，返回书面摘要报告。',
  handler: myHandler,
  tools: [searchTool, fetchPageTool],
  maxTurns: 8,
});

// 注册为普通工具
agent.registerTool(researcherAgent);
```

当父 AI 调用 `researcher_agent` 时，SDK 在后台运行一个完整的 Agentic Loop（最多 `maxTurns` 轮），并将最终文字响应作为工具结果返回给父 AI。

## runAgentLoop — 直接运行 Agentic Loop

```ts
import { runAgentLoop } from '@uap/agent-sdk';

const result = await runAgentLoop({
  task: '总结最近一周关于 AI 的新闻',
  handler: myHandler,
  tools: [searchTool],
  maxTurns: 10,
  signal: abortSignal,
  onUsage: (usage) => console.log(usage),
});

// result: { output: string; turns: number; toolCallCount: number }
```

子代理可以嵌套——子代理的 `tools` 列表中可以包含其他子代理工具，从而实现递归任务分解。

---

# UI 渲染

## 默认悬浮面板

调用 `agent.render()` 后，SDK 挂载一个可拖拽的悬浮球 + 聊天面板（基于 React），包含：

- 📋 多会话标签页切换
- 💬 流式对话（含思考过程折叠块）
- 🔧 工具调用结果内联展示
- ✅ Todo 列表面板
- 🖥️ 终端管理面板（配置 `terminalAdapter` 后显示）
- 📊 Token 使用进度条（配置 `tokenTracker` 后显示）

使用 `createDefaultUIRenderer` 自定义外观：

```ts
import { createDefaultUIRenderer } from '@uap/agent-sdk';

const agent = createAgentClient({
  handler,
  renderUI: createDefaultUIRenderer({
    icon: '🤖',               // emoji、纯文本或 DOM/SVG 元素
    panelSize: { width: 520, height: 680 },
    theme: {
      primaryColor:     '#0078d4', // 主色调（球背景、面板头部渐变）
      primaryDarkColor: '#005fa3', // 渐变终止色
      primaryDeepColor: '#003a6e', // 标题文字最深色
      primaryLightColor:'#50e6ff', // 悬停/发光效果
      primaryPaleColor: '#e6f3fb', // 内容区背景淡色
      contentTextColor: '#1a2f38', // 输入框、消息气泡文字色
    },
  }),
});

agent.render(); // 挂载到 document.body
// 或挂载到指定容器
agent.render(document.getElementById('agent-container')!);
```

## 自定义 renderUI

完全跳过默认 React 面板，用任何框架构建自己的 UI：

```ts
const agent = createAgentClient({
  handler,
  renderUI: (sessionManager, container) => {
    // 纯 JS 示例
    const render = () => {
      const { sessions, activeSessionId } = sessionManager.getState();
      const session = sessions.find(s => s.id === activeSessionId);
      const messages = session?.session.getState().messages ?? [];
      container.innerHTML = messages
        .map(m => `<div class="${m.role}">${m.content}</div>`)
        .join('');
    };
    render();
    // 订阅所有状态变化
    const unsub = sessionManager.subscribe(render);
    // 返回清理函数
    return unsub;
  },
});
```

---

# 消息格式转换

SDK 提供独立的纯函数用于消息格式转换，可在任何场景（如自定义 headless handler）中使用：

```ts
import { toOpenAIMessages, toAnthropicMessages, toGeminiMessages } from '@uap/agent-sdk';

// 转换为 OpenAI Chat Completions messages[] 格式
const openaiMessages = toOpenAIMessages(agentMessages);

// 转换为 Anthropic Messages API messages[] 格式
const anthropicMessages = toAnthropicMessages(agentMessages);

// 转换为 Google Gemini contents[] 格式
const geminiContents = toGeminiMessages(agentMessages);
```

这些函数正确处理多模态附件（图片、文件），会根据目标平台的规范进行转换。

---

# 类型速查

| 类型 | 来源 | 说明 |
|------|------|------|
| `AgentHandler` | `@uap/agent-sdk` | AI 处理函数类型 |
| `AgentClientConfig` | `@uap/agent-sdk` | `createAgentClient` 配置 |
| `AgentClient` | `@uap/agent-sdk` | `createAgentClient` 返回值 |
| `AgentSession` | `@uap/agent-sdk` | 单次会话实例 |
| `AgentSessionState` | `@uap/agent-sdk` | 会话状态快照 |
| `AgentSessionConfig` | `@uap/agent-sdk` | `createAgentSession` 配置（底层） |
| `SessionManager` | `@uap/agent-sdk` | 多会话管理器 |
| `SessionEntryData` | `@uap/agent-sdk` | 可序列化会话数据 |
| `HandlerContext` | `@uap/agent-sdk` | handler 的第二个参数 |
| `AgentTurnResponse` | `@uap/agent-sdk` | 非流式 handler 返回值 |
| `AgentStreamChunk` | `@uap/agent-sdk` | 流式 chunk 联合类型 |
| `Tool` | `@uap/agent-sdk` | 工具定义类型 |
| `ToolSet` | `@uap/agent-sdk` | 工具集类型 |
| `Skill` | `@uap/agent-sdk` | 技能类型 |
| `SkillState` | `@uap/agent-sdk` | 技能运行时状态 |
| `TokenTracker` | `@uap/agent-sdk` | Token 追踪器实例 |
| `TokenBudgetConfig` | `@uap/agent-sdk` | Token 预算配置 |
| `TokenBudgetState` | `@uap/agent-sdk` | Token 预算状态 |
| `SubAgentDefinition` | `@uap/agent-sdk` | 子代理定义 |
| `SubAgentResult` | `@uap/agent-sdk` | 子代理执行结果 |
| `FileAdapter` | `@uap/agent-sdk` | 文件操作适配器接口 |
| `TerminalManagerAdapter` | `@uap/agent-sdk` | 终端管理适配器接口 |
| `AgentMessage` | `@uap/agent-sdk` | LLM 消息（含 user/assistant/tool） |
| `Attachment` | `@uap/agent-sdk` | 多模态附件（URL 或 base64 data） |
| `WidgetTheme` | `@uap/agent-sdk` | 面板主题配置 |
| `WidgetIcon` | `@uap/agent-sdk` | 悬浮球图标 |
| `TodoItem` | `@uap/agent-sdk` | 任务清单条目 |

---

# 架构总览

```
createAgentClient(config)
│
├─ AgentClientConfig
│   ├─ handler: AgentHandler          ← 唯一必填；调用 AI API
│   ├─ tools / toolSets / skills      ← 初始化工具能力
│   ├─ systemPrompt / toolChoice      ← AI 行为控制
│   ├─ tokenTracker                   ← Token 追踪 & 自动摘要
│   ├─ terminalAdapter                ← 终端面板
│   ├─ renderUI / theme / icon        ← UI 定制
│   └─ initialSessions + onSessionsChange ← 持久化
│
├─ SessionManager
│   └─ AgentSession[]
│       ├─ messages (UI 渲染层)
│       ├─ history  (LLM 原始消息)
│       ├─ toolStates[]               ← 工具启用/禁用
│       ├─ skills[]                   ← 加载的技能状态
│       ├─ tokenBudget                ← Token 进度
│       └─ todos[]                    ← 任务列表
│
├─ Tool Registry (masterTools)
│   ├─ defineTool → Tool
│   ├─ createTodoTools → ToolSet
│   ├─ createFileTools → Tool[]
│   └─ createTerminalTools → Tool[]
│
├─ Skill Registry (masterDynamicSkills)
│   └─ defineSkill → Skill
│
└─ Agentic Loop (per user message)
    ├─ handler(messages, HandlerContext)
    │   └─ HandlerContext.toOpenAIMessages / toOpenAITools / ...
    ├─ [if tool_calls] → executeToolCall → Tool.execute
    ├─ [if streaming]  → drain ReadableStream<AgentStreamChunk>
    ├─ [if sub-agent]  → runAgentLoop (nested)
    └─ [if token > threshold] → summarizeHistory → compress history
```

---

# 开发与调试

本项目使用 **nodeenv**（Python 包）管理项目本地 Node.js 环境，不依赖系统全局 nvm/node/pnpm。

## 首次克隆

```bash
# 一行命令搞定一切：创建 nodeenv 环境 + 安装 pnpm + 安装依赖
bootstrap.cmd

# 激活 nodeenv 环境（每次打开新终端都需要执行）
.nodeenv\Scripts\Activate.ps1

# 之后就可以用本地 pnpm 了
pnpm start
```

`bootstrap.cmd` 会自动：
1. 安装 nodeenv（如果尚未安装）
2. 创建 `.nodeenv/` 虚拟环境（Node.js v26.3.0、npm 11.6.0）
3. 在 nodeenv 内全局安装 pnpm 10.6.5
4. 执行 `pnpm install` 安装项目依赖

激活后，`node`、`npm`、`pnpm` 均指向 `.nodeenv/` 中的本地版本，
完全不依赖系统 nvm 或全局 Node.js。

## 日常开发

```bash
 启动 demo（前端 + 后端）
pnpm start

 仅构建 SDK
pnpm build

 类型检查
pnpm typecheck

 运行测试
pnpm test

 构建单文件 exe（pkg）
pnpm build:exe

 构建 Electron 桌面应用
pnpm build:electron
```

## 更新 Node.js 版本

编辑 `.node-version` 中的版本号，然后重新运行 `bootstrap.cmd`。

## 底层机制

| 文件 | 作用 |
|------|------|
| `bootstrap.cmd` | 零依赖入口 — 自动安装 nodeenv，创建 `.nodeenv/` 虚拟环境，安装 pnpm，执行 `pnpm install` |
| `.node-version` | 声明项目所需的 Node.js 版本（供 nodeenv 使用） |
| `scripts/runtime.mjs` | 提供 `buildEnv()` 和 `run()`，构建脚本自动注入 `node_modules/.bin/` 到 PATH |

后端默认运行在 `http://localhost:3001`，提供以下服务：

- `POST /api/chat` — 非流式 AI 对话
- `POST /api/chat/stream` — SSE 流式 AI 对话
- `/api/files/*` — 文件操作（`createHttpFileAdapter` 对应的 HTTP 端点）
- `/api/terminals/*` — 终端管理（`createHttpTerminalAdapter` 对应的 HTTP 端点）
