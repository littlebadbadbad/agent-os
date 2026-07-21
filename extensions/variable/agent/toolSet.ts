import { MAIN_CONVERSATION_ID } from '@agent-type';
import type { ToolSet, ToolSetContext, SessionEntryData } from '@agent-type';
import type { AgentMessage } from '@agent-type';
import type { ToolResult } from '@agent-type';
import type { SerializedVariable, VariableEntry } from './types';

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** JSON variables to restore for this session. */
    variables?: SerializedVariable[];
  }
}

import {
  getSessionStore,
  deleteSessionStore,
  buildStoreRef,
  serializeVariables,
  restoreVariables,
} from './store';
import { resolveArguments } from './resolve';
import { interceptResult } from './intercept';
import { createVariableTools } from './tools';
import { jsonTypeOf } from './json-expand';

export type VariableToolSetOptions = {
  autoStoreThreshold?: number;
};

const DEFAULT_THRESHOLD = 16_000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderSystemPromptEntry(e: VariableEntry): string {
  const kindLabel = e.kind === 'attachment'
    ? (e.attachment.source === 'data' ? e.attachment.mimeType : 'image/url')
    : jsonTypeOf(e.value);
  const parts = [e.handle, kindLabel, formatSize(e.size)];
  if (e.name) parts.push(`"${e.name}"`);
  parts.push(`[${e.source === 'user' ? 'user upload' : `tool: ${e.toolName ?? 'unknown'}`}]`);
  return parts.join('  ');
}

export function createVariableToolSet(options: VariableToolSetOptions = {}): ToolSet {
  const threshold = options.autoStoreThreshold ?? DEFAULT_THRESHOLD;
  const tools = createVariableTools((sessionId) => getSessionStore(sessionId));

  return {
    name: 'variable',
    coreTools: ['var_write', 'var_expand', 'var_read_path'],
    tools: [...tools],

    onResolveToolArgs(ctx: ToolSetContext, toolName: string, args: Record<string, unknown>) {
      // Variable tools receive handles as intentional input — resolving them
      // would corrupt the handle before the tool can look it up in the store.
      if (toolName.startsWith('var_')) return args;
      return resolveArguments(getSessionStore(ctx.sessionId), args);
    },

    onToolResult(ctx: ToolSetContext, toolName: string, result: ToolResult) {
      if (toolName.startsWith('var_')) return result;
      return interceptResult(getSessionStore(ctx.sessionId), toolName, result, threshold);
    },

    onBeforeRun(ctx: ToolSetContext, history: readonly AgentMessage[]) {
      const lastUserMsg = [...history].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg || lastUserMsg.role !== 'user' || !lastUserMsg.attachments?.length) return;

      const store = getSessionStore(ctx.sessionId);
      if (ctx.conversationId === MAIN_CONVERSATION_ID) {
        // Only auto-store attachments from the main conversation to avoid
        // cluttering the store with sub-agent data.
        for (const attachment of lastUserMsg.attachments) {
          store.store(
            { kind: 'attachment', attachment },
            {
              source: 'user',
              name: attachment.source === 'data' ? attachment.name : undefined,
            },
          );
        }
      }
    },

    onGetSystemPrompt(ctx: ToolSetContext) {
      const store = getSessionStore(ctx.sessionId);
      const entries = store.list();
      if (!entries.length) return undefined;

      const lines = entries.map(renderSystemPromptEntry).join('\n');
      const hasAttachments = entries.some((e) => e.kind === 'attachment');
      return (
        `## Variable Store\n` +
        `${lines}\n\n` +
        `Usage rules:\n` +
        `- Pass handles directly as tool args — the runtime auto-resolves them. Never read a var just to forward it.\n` +
        `- Append a JSON path to target a nested field: \`$var:xxxx.a.b[0]\` resolves to that value inline.\n` +
        `- Interpolate inside strings: \`"result: $var:xxxx.field"\`.\n` +
        `- Use \`var_expand\` / \`var_read_path\` only when you must inspect or reason about the content.` +
        (hasAttachments
          ? `\n- Forward attachment handles to sub-agents via \`attachment_handles\` without reading them.`
          : '')
      );
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const store = getSessionStore(ctx.sessionId);
      return { variables: serializeVariables(store) };
    },

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData) {
      if (entryData?.variables?.length) {
        const store = getSessionStore(ctx.sessionId);
        restoreVariables(store, entryData.variables);
      }
    },

    onRemove(ctx: ToolSetContext) {
      deleteSessionStore(ctx.sessionId);
    },

    onReset(ctx: ToolSetContext) {
      const store = getSessionStore(ctx.sessionId);
      store.clear();
    },

    onGetSymbolState(ctx: ToolSetContext) {
      const store = getSessionStore(ctx.sessionId);
      return {
        variables: store.list(),
        variableStore: buildStoreRef(store),
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void) {
      const store = getSessionStore(ctx.sessionId);
      return store.subscribe(fn);
    },
  };
}
