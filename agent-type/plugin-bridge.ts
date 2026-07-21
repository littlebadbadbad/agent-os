/**
 * agent-type/plugin-bridge.ts — PluginBridge 类型定义
 *
 * PluginBridge 是 agent 和 UI 两层共享的可变对象，通过 host.bridge 访问。
 * Agent 侧写入方法/数据，UI 侧读取/调用——同一个引用，双向互通。
 *
 * 插件通过 module augmentation 扩展此接口来定义自己的 bridge 形状：
 *
 * ```ts
 * // extensions/my-plugin/agent/bridge.ts
 * declare module '@agent-type' {
 *   interface PluginBridge {
 *     sync(): Promise<MyType[]>;
 *   }
 * }
 * ```
 *
 * 或者更常用的方式——直接传泛型给 AgentPluginHost<MyBridge> / UiPluginHost<MyBridge>。
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PluginBridge {}
