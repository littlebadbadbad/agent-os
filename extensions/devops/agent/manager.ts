/**
 * extensions/devops/agent/manager.ts — DevOps ToolSet factory
 *
 * Creates the DevOps ToolSet and app slot declaration.
 *
 * Architecture:
 *   - Manager receives the shared `host.bridge` reference, passes it to
 *     tool factories so tools capture the SAME object that the UI will
 *     populate at slot mount time.
 *   - UI calls `populateDevopsBridge(host.bridge)` to fill in real
 *     handler implementations. Tools see them immediately because they
 *     share the same object reference.
 *   - If a tool is called before the UI mounts, bridge method calls
 *     produce a natural runtime error — no stubs needed.
 */

import type { ToolSet, Tool, PluginSlotDeclaration } from '@agent-type';
import type { DevOpsAdapter, DevOpsBridge } from './types';
import {
  createNavigationTools,
  createWorkitemCoreTools,
  createWorkitemDialogTools,
  createWorkitemCreateFormTools,
  createDrawerTools,
  createDrawerEditTools,
  createDrawerCommentTools,
  createBatchEditTools,
} from './tools';

// ── Symbol ───────────────────────────────────────────────────────────────────

export const DEVOPS_MANAGER_SYMBOL = Symbol("devops-manager");

// ── ToolSet factory ───────────────────────────────────────────────────────────

export function createDevopsToolset(
  adapter: DevOpsAdapter,
  /** The shared `host.bridge` reference — UI populates it at slot mount time. */
  bridge: DevOpsBridge,
): {
  toolSet: ToolSet;
  slotDeclarations: readonly PluginSlotDeclaration[];
} {
  function buildSystemPrompt(): string {
    return buildDevopsSystemPrompt();
  }

  const toolSet: ToolSet = {
    symbol: DEVOPS_MANAGER_SYMBOL,
    name: 'devops',
    description: 'Azure DevOps 工作项管理：查找/创建/编辑/删除/评论/批量操作 + Sprint/构建/Git/测试/发布视图。',
    tools: () => collectTools(bridge, adapter),
    onGetSystemPrompt: () => buildSystemPrompt(),
  };

  const slotDeclarations: readonly PluginSlotDeclaration[] = [
    {
      type: 'app',
      icon: '\u2699\uFE0F',
      label: 'Azure DevOps',
      shouldRender: () => true,
      order: 50,
      defaultWidth: 1200,
      defaultHeight: 800,
      resizable: true,
      minimizable: true,
    },
  ];

  return { toolSet, slotDeclarations };
}

// ── Tool collection ───────────────────────────────────────────────────────────

type ToolFactory = (bridge: DevOpsBridge) => Tool[];

function collectTools(bridge: DevOpsBridge, _adapter: DevOpsAdapter): readonly Tool[] {
  const factories: ToolFactory[] = [
    createNavigationTools,
    createWorkitemCoreTools,
    createWorkitemDialogTools,
    createWorkitemCreateFormTools,
    createDrawerTools,
    createDrawerEditTools,
    createDrawerCommentTools,
    createBatchEditTools,
  ];
  return factories.flatMap((factory) => factory(bridge));
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildDevopsSystemPrompt(): string {
  return `
## DevOps 工具使用指南

### ⚠️ 重要：参数命名（LLM 常见错误）
\`navigate_to\` 的参数名叫 \`collection\` 和 \`project\`（不是 \`collectionId\` / \`collectionName\` / \`projectId\` / \`projectName\`）。
值可以传 id（如 \`"e0be6cd3-..."\`）或名称子串（如 \`"MetaHospital"\`）。

### 🎯 核心原则

1. **一步到位，不拆分** — \`navigate_to\` 已经包含 collection→project→view→type→filter 全流程，**不准分步操作**。直接一步传所有参数。
2. **batch 优先** — 设置字段始终用 \`_set_fields()\` 批量接口，不要用单字段工具。批量编辑 10+ 个工作项用 \`batch_update\`，不要逐个打开弹窗。
3. **并行处理** — 批量操作时，同阶段的工具调用可以并行（先全 open → 全 set_fields → 全 submit）。
4. **精确匹配** — 所有下拉/选择字段（isPicklist=true）的值，必须来自该字段的 allowedValues，不允许猜测或编造。
5. **先查后设** — 遇到不熟悉的字段，先用 get_metadata() 查类型，看到 isPicklist=true 就用 get_field_options() 取值列表，再从中选择。
6. **弹窗优先于后台 API** — ≤5 个工作项的编辑，走弹窗（open_dialog → edit → save → close_dialog）保证所见即所得。6+ 个工作项的批量更新才用 batch_update。

### 📡 异步数据流

\`\`\`
登录 → collections 加载 → 选 collection → projects 加载 → 选 project →
WorkItemsPage 挂载 → supportLoading=false → metadata 就绪
\`\`\`

**检查当前位置**: \`devops_get_app_state()\` 返回当前登录用户（currentUser）、已选 collection/project、当前视图
**加载元数据**: 等到 \`get_state().supportLoading === false\` 后调 \`devops_workitems_get_metadata()\`（全程只调一次)
**读取筛选结果**: \`get_state().items[]\` 包含当前过滤条件下的工作项列表

### 🆔 用户与元数据

\`devops_get_app_state().currentUser\` → { displayName, id, uniqueName }
\`get_metadata()\` 一次调用获取所有引用数据:
| 字段 | 来自 metadata | 用途 | 性质 |
|------|---------------|------|------|
| type | types[].name | 切换 type tab | 系统字段 |
| assignee | members[].displayName | 指派给 | 系统字段 |
| iteration | iterations[].path | 迭代路径 | 系统字段 |
| area | areas[].path | 区域路径 | 系统字段 |
| 自定义字段 | customFields[] | 见下方"自定义字段发现流程" | — |

### 🔍 自定义字段发现流程（关键！）

\`get_metadata()\` 返回的 \`customFields[]\` 每个对象包含以下属性。**根据这些属性决定如何取值：**

\`\`\`
{
  referenceName: "Custom.f145ff4d-...",
  name: "AI 使用程度",
  isPicklist: true|false,
  isIdentity: true|false,
  allowedValues: ["选项A", "选项B"],
}
\`\`\`

**具体的取值规则：**
- **isPicklist=true** → 值**必须**从 \`allowedValues[]\` 中选择一项，不允许编造。
- **isIdentity=true** → 值**必须**来自 \`get_metadata()\` 的 \`members[].displayName\`。
- **都不是（自由文本）** → 可任意输入。

### ⚙️ 日常操作流程

#### 🔍 查找工作项 (最常用)

⚠️ **重要：[type] 参数对应 UI 上方的 type tab（Bug/Task/PBI 等按钮），点击后页面上只显示该类型的工作项。**

始终先传 type，再传其他筛选条件。

#### 🔥 批量编辑工作项 (5+ 个)
用 batch_update，不要逐个打开编辑弹窗。

#### 💬 添加评论 / 🗑 删除工作项
通过弹窗操作：open_dialog → dialog_switch_tab → dialog_add_comment / delete_workitem

#### 📄 浏览大量结果
先 navigate 定位 + type 锁定 → 看 totalCount → 加筛选或翻页

### 🔧 其他视图
- Sprint: navigate_to({view:"sprints"}) → 看团队 → 迭代 → 容量/工作项
- Git: navigate_to({view:"git"}) → 选仓库 → 查看文件/PR/分支/提交
- Builds: navigate_to({view:"builds"}) → 看定义/运行 → 排队/看制品
- Tests: navigate_to({view:"tests"}) → 测试计划 → 套件/运行 → 用例/结果
- Releases: navigate_to({view:"releases"}) → 发布定义 → 发布/环境流水线
`.trim();
}
