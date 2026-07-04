# Phase 1：后端插件系统 — 插件的运行时基座

> 兄弟，你跟我一样，微软 20 年，VS Code Extension Host 是你参与设计的。
> 现在你做 AI 了，这套插件底座的设计哲学跟你当年设计 VS Code 插件系统是一个路子。
> **别让我看到实习生水平的代码。**

---

## 一句话

**后端插件系统 = 插件的运行时容器**。扫目录 → 读 manifest → 动态 import → 注入沙箱 host → 自动路由注册。

Phase 0 给你准备了类型契约（`@agent-type`）。Phase 1 你要把这些类型实现成活的东西。

---

## 插件长什么样（读个轮廓就行，细节自己探索）

一个插件是一个目录，结构大致这样：

```
plugins/my-plugin/
  manifest.json           # 声明 name/version/有哪些入口
  backend/index.js        # 后端入口: export function activate(host) { ... }
  agent/index.js          # SDK 入口（Phase 2 的事）
  ui/                     # UI iframe 产物（Phase 3+ 的事）
```

**manifest.json** 的核心：声明这个插件有哪几个入口。

插件后端入口收到一个 `BackendPluginHost`——这是插件跟核心系统的**唯一通信窗口**：

```javascript
export function activate(host) {
  host.defineApi({ methodName: handler });     // 注册后端 API → 自动挂到 HTTP + IPC
  host.defineStream('name', handler);          // 注册流通道 → 自动挂到 WS + IPC
  host.getPluginPath('data');                  // 拿到自己的数据目录
}
```

**核心设计**：插件作者调用 `defineApi` 后，框架自动把方法挂到 HTTP 路由和 IPC 通道上。插件作者根本不需要知道请求是怎么来的。这是 VS Code 的 `vscode.commands.registerCommand` 那个味儿。

---

## P1 职责边界

| 你来干 | 你别碰 |
|--------|--------|
| 插件加载基座（Scanner/Host/Router） | 不实现具体业务插件 |
| 自动路由注册（HTTP/IPC/WS） | 不碰现有的 backend 业务路由 |
| 生命周期管理（激活/反激活/状态持久化） | 不重构已有代码 |
| 错误隔离（一个炸了不影响其他的） | 不写 UI 相关代码 |
| 完整单测 | 不碰已有的 transports/services |

**P1 不做**：热加载、依赖解析、版本冲突。那是 Phase 3 插件管理器的事。

---

## 架构骨架（你来填充血肉）

你要创造三个核心模块：

```
PluginScanner
  ├── 扫 plugins/ 目录 → 读 manifest.json
  ├── 按状态逐个 activate/deactivate
  ├── bootstrap() 是启动入口：loadState → scan → activate
  └── 把 match 接口暴露给 HTTP server

PluginRouter
  ├── registerApi(name, methods) → 自动生成命名路由
  ├── registerStream(name, handler) → 自动注册流通道
  ├── unregisterPlugin(name) → 清理该插件全部注册
  └── matchHttpRoute / matchIpcChannel / matchWsPath

createPluginHost(pluginName, manifest, router)
  ├── 创建沙箱 host 对象
  ├── defineApi → 委托给 router
  └── 安全控制：pluginsDir 只对 plugin-manager 放行
```

**路由协议**（保持这个格式，别创新）：

| 传输层 | 格式 |
|--------|------|
| HTTP | `POST /api/plugin/<name>/<method>` |
| IPC | `plugin:<name>:<method>` |
| WebSocket | `/api/plugin/<name>/<stream>` |

**backend/index.js 改动**：
- 创建全局 `pluginRouter` + `pluginScanner`
- 请求处理链插入插件路由匹配
- WS upgrade 链插入插件流匹配
- `bootstrap()` 在 HTTP 服务器启动前调用

---

## 探索方向（读代码，别猜）

- **读 `backend/` 现有代码**：路由怎么走的？IPC handler 怎么注册的？WS upgrade 怎么处理的？测试风格长什么样？
- **读 `backend/lib/paths.js`**：路径管理方式，然后加上 `PLUGINS_DIR`
- **读 `backend/index.js`**：启动流程和路由链，找到在哪里插入插件路由
- **读 `backend/__tests__/`**：看 `vi.mock` + 临时文件系统的测试模式

读完了你再决定 PluginRouter 用什么数据结构、PluginScanner 的状态文件放哪、bootstrap 的具体顺序。**我给了你框架，你决定细节。**

---

## 铁律（违反后果你自己体会）

| # | 规则 | 违反了会怎样 |
|---|------|-------------|
| R1 | **一个插件 activate 失败不能阻止其他插件加载**。每个 activate 必须 try-catch，失败只 log 不 rethrow | CI 查到一个没包 try-catch → 整个 PR 直接关闭，重写 |
| R2 | **类型必须从 `@agent-type` 导入**，不能自己写内联类型 | code review 发现 `interface PluginHost` 在 backend 里 → 当周绩效 C |
| R3 | **manifest 必须用 `import()` 动态加载**，不能用 `require()` | 用了 require → 构建兼容性炸了 → 你全责 |
| R4 | **路径必须用 `PLUGINS_DIR` 常量**，不能硬编码 `'../plugins/'` | 硬编码 → 换环境就炸 → -1 个亿 |
| R5 | **后端代码用 CommonJS 风格**（`require`/`module.exports`），跟 `backend/` 现有文件一致 | 混入 ESM → `require is not defined` → 项目不可用 |
| R6 | **`getPluginPath('pluginsDir')` 只对 plugin-manager 放行**，其他返回 undefined | 权限越界 → 恶意插件读到整个目录 → 安全事件 |
| R7 | **bootstrap() 必须在 HTTP 服务器启动前完成** | 顺序错了 → 请求来了插件没加载 → 500 伺候 |

---

## 测试要求

- 参考 `backend/__tests__/` 的现有风格（`vi.mock` + 临时文件系统）
- 必须覆盖：路由注册/匹配/清理、多插件隔离、沙箱权限、状态持久化、bootstrap 顺序、错误隔离
- **覆盖率 100%，通过率 100%** — 少一个测试点就当没写完

---

## 编码原则

1. **先读代码再动手** — 你的代码要跟现有 backend 代码长得像一家人。
2. **有疑问就问，不要赌** — 不确定格式？不确定哪个文件怎么改？用提问工具问我。**赌错了比问多了丢脸 100 倍。**
3. **一次到位** — 不留 TODO，不留 `any`，不留 `FIXME`。Phase 3/4/5 全站在你这层跑。**你写崩了，后面全废。**
4. **发现 Phase 0 的类型少了或错了** — 去修 `agent-type/`，不要自己另搞一套。

---

## 验证

```bash
pnpm vitest run --config vitest.config.ts backend/__tests__/plugin-*.test.js
pnpm test -- --config vitest.config.ts
pnpm typecheck
node backend/index.js &
curl -s localhost:3001/api/plugin/unknown/method | grep -q '"error"'
kill %1
```
