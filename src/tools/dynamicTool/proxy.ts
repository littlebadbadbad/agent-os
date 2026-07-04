/**
 * proxy.ts — Per-tool proxy factory and proxy store
 *
 * A "proxy tool" is a live `Tool` registered on an agent that delegates
 * execution back through the adapter.  Every persisted dynamic tool gets
 * exactly one proxy registered per attached agent.
 *
 * `createProxyStore()` owns the Map<name, proxy-entry> and exposes helpers
 * used by `toolTools.ts` (register / unregister) and by `toolSet.ts`
 * (buildOnAttach — wires an agent into the proxy map).
 */

import { z } from 'zod';
import { buildTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';
import type { AgentClientLike } from '@agent-type';
import type { DynamicToolEntry, DynamicToolAdapter, DynamicToolSerializableContext } from './types';

// ── Proxy tool factory ────────────────────────────────────────────────────────

/**
 * Build a single live `Tool` that proxies calls to the adapter (backend) or
 * evaluates the implementation directly (frontend).
 */
export function createProxyTool(entry: DynamicToolEntry, adapter: DynamicToolAdapter): Tool {
  return buildTool({
    name:        entry.name,
    description: entry.description,
    parameters:  z.object({}).passthrough(),
    execute: async (args, ctx) => {
      if (entry.runtime === 'frontend') {
        // Frontend tools execute their implementation directly in the browser
        // as an AsyncFunction, receiving the full execution context.
        if (!entry.implementation) {
          throw new Error(`Tool "${entry.name}" has no implementation — cannot execute (no implementation).`);
        }
        // eslint-disable-next-line no-new-func
        const fn = new Function('args', 'context', entry.implementation);
        return (fn as (a: unknown, c: unknown) => unknown)(args, ctx);
      }

      // Backend tools are executed server-side via the adapter.
      const serializableCtx: DynamicToolSerializableContext = {
        sessionId:      ctx.sessionId,
        agentName:      ctx.agentName,
        conversationId: ctx.conversationId,
      };
      return adapter.executeTool(entry.name, args as Record<string, unknown>, serializableCtx);
    },
  });
}

// ── Proxy store ───────────────────────────────────────────────────────────────

type ProxyEntry = {
  proxy: Tool;
  /** Cleanup fn per attached agent. */
  removeFnByAgent: Map<AgentClientLike, () => void>;
};

/**
 * Create a proxy store that tracks live proxies + agent attachments.
 *
 * Returns three functions:
 * - `register(entry)` — upsert the proxy for `entry` on all attached agents
 * - `unregister(name)` — remove the proxy from all agents and delete the entry
 * - `buildOnAttach(agent)` — wire a new agent into the store: registers all
 *   current proxies on it and returns a cleanup callback.
 */
export function createProxyStore(adapter: DynamicToolAdapter) {
  const proxies = new Map<string, ProxyEntry>();
  const agents  = new Set<AgentClientLike>();

  function register(entry: DynamicToolEntry): void {
    // Clean up any previous proxy for this name (update scenario).
    unregister(entry.name);
    const proxy = createProxyTool(entry, adapter);
    const removeFnByAgent = new Map<AgentClientLike, () => void>();
    for (const agent of agents) {
      removeFnByAgent.set(agent, agent.registerTool(proxy));
    }
    proxies.set(entry.name, { proxy, removeFnByAgent });
  }

  function unregister(name: string): void {
    const pe = proxies.get(name);
    if (!pe) return;
    for (const rm of pe.removeFnByAgent.values()) rm();
    proxies.delete(name);
  }

  function buildOnAttach(agent: AgentClientLike): () => void {
    agents.add(agent);
    // Register all current proxies on the newly attached agent.
    for (const [, pe] of proxies) {
      pe.removeFnByAgent.set(agent, agent.registerTool(pe.proxy));
    }
    // Cleanup: remove this agent's proxy registrations.
    return () => {
      agents.delete(agent);
      for (const pe of proxies.values()) {
        pe.removeFnByAgent.get(agent)?.();
        pe.removeFnByAgent.delete(agent);
      }
    };
  }

  return { register, unregister, buildOnAttach };
}
