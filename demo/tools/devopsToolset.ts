/**
 * devopsToolset — Single ToolSet that bundles all DevOps demo tools and provides
 * a comprehensive system prompt explaining the tool usage mechanism.
 *
 * Usage:
 *   import { devopsToolset } from './tools/devopsToolset';
 *   agent.registerToolSet(devopsToolset);
 */

import type { ToolSet } from "@agent-sdk";
import type { Tool } from "@agent-type";
import * as nav from "./navigationTools";
import * as wiCore from "./workitemCoreTools";
import * as wiDialog from "./workitemDialogTools";
import * as wiCreate from "./workitemCreateFormTools";
import * as drawer from "./drawerTools";
import * as drawerEdit from "./drawerEditTools";
import * as drawerComment from "./drawerCommentTools";
import * as batch from "./batchEditTools";

// Export named groups for direct import convenience
export {
  nav,
  wiCore,
  wiDialog,
  wiCreate,
  drawer,
  drawerEdit,
  drawerComment,
  batch,
};

/** Collect all Tool objects from domain modules into a flat array. */
function collectTools(): readonly Tool[] {
  const mods = [nav, wiCore, wiDialog, wiCreate, drawer, drawerEdit, drawerComment, batch];
  return mods.flatMap((mod) =>
    Object.values(mod).filter(
      (v): v is Tool =>
        typeof v === "object" && v !== null && "name" in v && "execute" in v,
    ),
  );
}

/**
 * Build the system-prompt fragment. Injected before every LLM call.
 * Guides the agent through the async state machine, identity, and workflows.
 */
function buildSystemPrompt(): string {
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
  referenceName: "Custom.f145ff4d-...",  // ADO 字段引用名
  name: "AI 使用程度",                    // 中文显示名
  isPicklist: true|false,                // true = 下拉/选择字段，有固定可选值
  isIdentity: true|false,                // true = 人员选择器，值来自 members[]
  allowedValues: ["选项A", "选项B"],      // isPicklist=true 时才有，所有可选值
}
\`\`\`

**具体的取值规则：**
- **isPicklist=true** → 值**必须**从 \`allowedValues[]\` 中选择一项，不允许编造。如果 allowedValues 为空数组，手动调用 \`get_field_options(workItemType, referenceName)\` 补全。
- **isIdentity=true** → 值**必须**来自 \`get_metadata()\` 的 \`members[].displayName\`。
- **都不是（自由文本）** → 可任意输入。

⚠️ **\`get_metadata()\` 已经自动获取了 picklist 字段的 allowedValues。但是如果有多个 workItemType，不同 type 的 allowedValues 可能不同，可手动用 \`get_field_options\` 确认。**

### ⚙️ 日常操作流程

#### 🔍 查找工作项 (最常用)

⚠️ **重要：[type] 参数对应 UI 上方的 type tab（Bug/Task/PBI 等按钮），点击后页面上只显示该类型的工作项。这是精确查找的基础。**

用户意图 → type 传值：
- 用户说"找 task / 所有任务" → type: "Task"
- 用户说"找 bug" → type: "Bug"
- 用户说"找 PBI / Product Backlog Item" → type: "Product Backlog Item"
- 不传 type = 显示全部类型（全部混合在一起，不可取）

**始终先传 type，再传其他筛选条件**。例子：

\`\`\`
// ⚠️ 参数名是 collection / project（不是 collectionId / projectId），
//    值可以传 id 或名称子串（如 "MetaHospital"、"uMetaOS"）
navigate_to({
  collection: "MetaHospital",  // 选 collection（id或名称子串）
  project: "uMetaOS",          // 选 project（id或名称子串）
  type: "Task",                // ⚡ 必须传 type！点上方 Task type tab，只显示 Task
  assignee: "张三",            // members[].displayName
  state: "Active",             // 状态筛选
  priority: "1",               // 1=最高
  text: "登录失败",             // 标题/ID搜索
  iterationPath: "Sprint 10",
})
// → 自动完成 collection→project→type→filter 全流程，返回 totalCount
// 读结果: get_state().items[]  // items 里全是 type:"Task"
\`\`\`

⚠️ **不要分步操作！** navigate_to 一步到位：navigate_to({collection:"...", project:"...", type:"Task", ...})。
不需要先 devops_get_app_state() 再一步步手动操作。更不要在混合类型列表中手动翻页——传 type 一下就精确了。

#### ➕ 创建工作项 (批量)
\`\`\`
// 批量创建 3 个 Bug:
open_create({dialogId:"c1", defaultType:"Bug"})
open_create({dialogId:"c2", defaultType:"Bug"})
open_create({dialogId:"c3", defaultType:"User Story"})

// 并行设置字段 (dialogId 不同，可以同时调)
create_form_set_fields({dialogId:"c1", title:"登录页样式异常", state:"New", assignedTo:"张三", priority:"2", completedWork:"2"})
create_form_set_fields({dialogId:"c2", title:"注册页按钮失效", state:"New", assignedTo:"李四", priority:"1"})

// 设置自定义字段 — 值必须从 metadata 的 allowedValues 中选
create_form_set_custom_field({dialogId:"c1", fieldRef:"Custom.f145ff4d-...", value:"Level 3 (AI 主导, AI>70%)"})

// 并行提交
create_form_submit({dialogId:"c1"})
create_form_submit({dialogId:"c2"})
\`\`\`

#### ✏️ 编辑工作项 (少量, ≤5个) — 走弹窗编辑流程
\`\`\`
// 同时打开多个编辑弹窗
open_dialog({dialogId:"d1", itemId:101})
open_dialog({dialogId:"d2", itemId:102})

// 切换到编辑 tab
dialog_switch_tab({dialogId:"d1", tab:"edit"})

// 批量设置字段
dialog_edit_set_fields({dialogId:"d1", state:"Resolved", assignedTo:"王五", completedWork:"4"})

// 设置自定义字段 — 值必须从 metadata 的 allowedValues 中选
dialog_edit_set_custom_field({dialogId:"d1", fieldRef:"Custom.f145ff4d-...", value:"Level 3 (AI 主导, AI>70%)"})

// 保存并关闭
dialog_edit_save({dialogId:"d1"})
close_dialog({dialogId:"d1"})
\`\`\`

⚠️ **向后兼容：** \`devops_drawer\` 系列工具名（如 \`open_drawer\`、\`drawer_switch_tab\`）仍然可用，但建议优先使用 \`devops_dialog\` 系列。两者的 dialogId 体系完全互通。

#### 🔥 批量编辑工作项 (5+ 个) — 用 batch_update，不要逐个打开编辑弹窗！
\`\`\`
// 批量设置 53 个 Task 的 AI 使用程度 (一行搞定，比逐个打开弹窗快 50 倍)
batch_update({
  items: [{id: 64776}, {id: 64777}, {id: 64778}, ...],  // 全部要改的 itemId
  field: "Custom.f145ff4d-...",                          // 自定义字段的 referenceName
  value: "Level 3 (AI 主导, AI>70%)",                    // 必须来自 allowedValues
})

// ⚠️ 适用场景：
//   - 批量设置/修改任意字段（标准字段用 "state"/"assignedTo"/"priority"，自定义字段用 "Custom.xxx"）
//   - 5 个以上的工作项需要同一操作时，必须用 batch_update
//   - 处理结果会返回每个 item 的 success/fail 详情
\`\`\`

#### 💬 添加评论
\`\`\`
open_dialog({dialogId:"d1", itemId:101})
dialog_switch_tab({dialogId:"d1", tab:"comments"})
// 自动加载评论列表
dialog_add_comment({dialogId:"d1", text:"已在最新版本修复"})
\`\`\`

#### 🗑 删除工作项
\`\`\`
open_dialog({dialogId:"d1", itemId:101})
delete_workitem({dialogId:"d1", confirm:true})  // confirm=true 直接删除
\`\`\`

#### 📄 浏览大量结果
\`\`\`
// 先 navigate 定位 + type 锁定（只显示该类型）
navigate_to({collection:"...", project:"...", type:"Task", state:"Active"})

// 然后看 totalCount —— 如果还太多，加精确筛选条件
get_state()  // 看 totalCount, items[]

// 如果结果仍然超过一两页，先加更精确的筛选再考虑翻页！
set_page({page:1})           // 翻页（0-based）
set_page_size({pageSize:100}) // 改每页条数（20/50/100/200，自动回到第0页）
expand_cap()                  // 展开上限 (x5)
\`\`\`

### 📋 规则速查

| 规则 | 说明 |
|------|------|
| **工时单位** | 1U=4h，数字字符串如 "2"=8h。工时对应的是 completedWork 字段 |
| **下拉字段** | isPicklist=true 的字段，值必须来自 allowedValues（get_metadata 已自动获取） |
| **人员字段** | isIdentity=true 的字段，值必须来自 members[].displayName |
| **精确匹配** | 所有下拉/选择字段的值，必须与 allowedValues 中的某项完全一致，不允许编造 |
| **dialogId** | 全局唯一字符串；批量同阶段可并行调用 |
| **并行策略** | 不同 dialogId 的同一阶段操作可以同时调 |
| **批量编辑** | 5 个以上工作项 → 用 batch_update；≤5 个 → 走弹窗编辑（devops_dialog_* 工具） |
| **弹窗操作** | open_dialog / close_dialog / dialog_switch_tab / dialog_edit_set_fields / dialog_edit_save（旧 devops_drawer_* 工具名仍兼容） |
| **失败处理** | set_fields/save/batch_update 返回 success/error，检查后再继续 |`.trim();
}

/**
 * DevOps ToolSet — register via agent.registerToolSet(devopsToolset).
 */
export const devopsToolset: ToolSet = {
  name: "devops-demo",
  description:
    "Azure DevOps 工作项管理：查找/创建/编辑/删除/评论/批量操作 + Sprint/构建/Git/测试/发布视图。",
  tools: collectTools,
  onGetSystemPrompt: () => buildSystemPrompt(),
};


