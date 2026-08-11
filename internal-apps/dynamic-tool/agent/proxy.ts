/**
 * internal-apps/dynamic-tool/agent/proxy.ts — Per-tool proxy factory and proxy store
 */

import { z } from 'zod';
import { buildTool } from '@agent-type/defineTool';
import type { Tool, AgentClientLike } from '@agent-type';
import type { DynamicToolEntry, DynamicToolAdapter, DynamicToolSerializableContext } from './types';

export function createProxyTool(entry: DynamicToolEntry, adapter: DynamicToolAdapter): Tool {
  return buildTool({
    name: entry.name,
    description: entry.description,
    parameters: z.object({}).passthrough(),
    execute: async (args, ctx) => {
      if (entry.runtime === 'frontend') {
        if (!entry.implementation) {
          throw new Error(`Tool "${entry.name}" has no implementation \u2014 cannot execute.`);
        }
        const fn = new Function('args', 'context', entry.implementation);
        return (fn as (a: unknown, c: unknown) => unknown)(args, ctx);
      }
      const serializableCtx: DynamicToolSerializableContext = {
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        conversationId: ctx.conversationId,
      };
      return adapter.executeTool(entry.name, args as Record<string, unknown>, serializableCtx);
    },
  });
}

type ProxyEntry = {
  proxy: Tool;
  removeFnByAgent: Map<AgentClientLike, () => void>;
};

export function createProxyStore(adapter: DynamicToolAdapter) {
  const proxies = new Map<string, ProxyEntry>();
  const agents = new Set<AgentClientLike>();

  function register(entry: DynamicToolEntry): void {
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
    for (const [, pe] of proxies) {
      pe.removeFnByAgent.set(agent, agent.registerTool(pe.proxy));
    }
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
