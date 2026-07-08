/**
 * Sub-Agent Conversation I/O Tool Definitions
 *
 * Tools for sending messages to, reading history from, and managing
 * conversations of sub-agents.
 *
 * Extracted from `metaTools.ts` — each factory function accepts a dependency
 * bag rather than capturing closure state, making the tools testable in
 * isolation.
 */

import { z } from "zod";
import { defineTool } from '@agent-type/defineTool';
import type { Tool } from '@agent-type';
import type { Attachment } from '@agent-type';
import type { SubAgentRegistry } from './registryTypes';
import { isDataAttachment, isUrlAttachment } from "../messages/attachment";
import { resolveConvId } from './subAgentHelpers';

// ── Dependencies ──────────────────────────────────────────────────────────────

export type ConvToolDeps = {
  suffix: string;
  withVariables: boolean;
  getRegistry: (sessionId: string) => SubAgentRegistry;
  scrollbackCursors: Map<string, number>;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createConvTools(deps: ConvToolDeps): Tool[] {
  const { suffix, withVariables, getRegistry, scrollbackCursors } = deps;

  // ── send_<suffix>_message ─────────────────────────────────────────────────

  const sendMessage = defineTool({
    name: `send_${suffix}_message`,
    group: "Sub-Agents",
    description:
      `Send a message to a ${suffix} sub-agent and return its response. History is auto-preserved.` +
      (withVariables
        ? ` Also forwards variable handles (\`attachment_handles\`) as attachments.`
        : ""),
    parameters: z.object({
      subagent_name: z.string().describe("Name of the sub-agent"),
      message: z.string().min(1).describe("Message text to send"),
      conversation_id: z
        .string()
        .optional()
        .describe("Target conversation ID (omit for active)"),
      attachment_handles: z
        .array(z.unknown())
        .optional()
        .describe(
          withVariables
            ? 'Variable handles ($var:xxxx) to forward as attachments to the sub-agent.'
            : "Requires the variable ToolSet. Leave empty if not in use.",
        ),
    }),
    execute: async (
      { subagent_name, message, conversation_id, attachment_handles },
      context,
    ) => {
      const { sessionId, signal } = context;
      const registry = getRegistry(sessionId);
      const convId = resolveConvId(registry, subagent_name, conversation_id);
      // By the time execute runs, the variable ToolSet's onResolveToolArgs hook
      // has already resolved any "$var:xxxxxxxx" handle strings to their backing
      // Attachment objects.  Filter to only valid Attachment shapes so stray
      // non-resolved values (e.g. when the variable ToolSet is absent) are dropped.
      const attachments = attachment_handles?.filter(
        (h): h is Attachment =>
          isDataAttachment(h as Attachment) || isUrlAttachment(h as Attachment),
      );
      const result = await registry.sendMessage(
        subagent_name,
        convId,
        message,
        {
          sessionId,
          signal,
          ...(attachments?.length && { attachments }),
        },
      );
      const conv = registry.getConversation(subagent_name, convId);
      return {
        response: result.output,
        turns: result.turns,
        toolCallCount: result.toolCallCount,
        conversationId: convId,
        messageCount: conv?.getHistory().length ?? 0,
      };
    },
  });

  // ── read_<suffix>_history ─────────────────────────────────────────────────

  const readHistory = defineTool({
    name: `read_${suffix}_history`,
    group: "Sub-Agents",
    description:
      `Read conversation history from a ${suffix} sub-agent. Cursor auto-advances.`,
    parameters: z.object({
      subagent_name: z.string().describe("Name of the sub-agent"),
      conversation_id: z
        .string()
        .optional()
        .describe("Target conversation (omit for active)"),
      from_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Start index. Omit to auto-continue from last read. Pass 0 for beginning.",
        ),
      max_messages: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max messages to return"),
    }),
    execute: async (
      { subagent_name, conversation_id, from_index, max_messages },
      context,
    ) => {
      const { sessionId } = context;
      const registry = getRegistry(sessionId);
      const convId = resolveConvId(registry, subagent_name, conversation_id);
      const cursorKey = `${sessionId}:${subagent_name}:${convId}`;
      const effectiveFrom =
        from_index ?? scrollbackCursors.get(cursorKey) ?? 0;
      const messages = registry.readHistory(
        subagent_name,
        convId,
        effectiveFrom,
        max_messages,
      );
      const nextCursor =
        messages.length > 0
          ? messages[messages.length - 1].index + 1
          : effectiveFrom;
      scrollbackCursors.set(cursorKey, nextCursor);
      return {
        subAgent: subagent_name,
        conversationId: convId,
        messages,
        from: effectiveFrom,
        next: nextCursor,
        totalFetched: messages.length,
      };
    },
  });

  // ── create_<suffix>_conversation ──────────────────────────────────────────

  const createConversation = defineTool({
    name: `create_${suffix}_conversation`,
    group: "Sub-Agents",
    description: `Create a new conversation for a ${suffix} sub-agent. Becomes active immediately.`,
    parameters: z.object({
      subagent_name: z.string().describe("Name of the sub-agent"),
      title: z
        .string()
        .optional()
        .describe("Human-readable title (auto-generated if omitted)"),
    }),
    execute: async ({ subagent_name, title }, context) => {
      const registry = getRegistry(context.sessionId);
      const conv = registry.createConversation(subagent_name, { title });
      const state = conv.getState();
      return {
        created: state.id,
        subAgent: subagent_name,
        title: state.title,
        message:
          `Conversation "${state.title}" (id: ${state.id}) created for "${subagent_name}" and set as active. ` +
          `Use send_${suffix}_message with this conversation_id to start chatting.`,
      };
    },
  });

  // ── set_<suffix>_active_conversation ──────────────────────────────────────

  const setActiveConversation = defineTool({
    name: `set_${suffix}_active_conversation`,
    group: "Sub-Agents",
    description: `Switch the active conversation for a ${suffix} sub-agent.`,
    parameters: z.object({
      subagent_name: z.string().describe("Name of the sub-agent"),
      conversation_id: z
        .string()
        .describe("ID of the conversation to make active"),
    }),
    execute: async ({ subagent_name, conversation_id }, context) => {
      getRegistry(context.sessionId).setActiveConversation(
        subagent_name,
        conversation_id,
      );
      return {
        active: conversation_id,
        subAgent: subagent_name,
        message:
          `Conversation "${conversation_id}" is now active for "${subagent_name}". ` +
          `send_${suffix}_message will target this conversation unless you pass an explicit conversation_id.`,
      };
    },
  });

  // ── delete_<suffix>_conversation ──────────────────────────────────────────

  const deleteConversation = defineTool({
    name: `delete_${suffix}_conversation`,
    group: "Sub-Agents",
    description: `Delete a conversation from a ${suffix} sub-agent.`,
    parameters: z.object({
      subagent_name: z.string().describe("Name of the sub-agent"),
      conversation_id: z.string().describe("ID of the conversation to delete"),
    }),
    execute: async ({ subagent_name, conversation_id }, context) => {
      const { sessionId } = context;
      // Purge the cursor entry for this conversation before deleting it.
      scrollbackCursors.delete(
        `${sessionId}:${subagent_name}:${conversation_id}`,
      );
      getRegistry(sessionId).deleteConversation(subagent_name, conversation_id);
      return {
        deleted: conversation_id,
        subAgent: subagent_name,
        message: `Conversation "${conversation_id}" deleted from sub-agent "${subagent_name}".`,
      };
    },
  });

  return [
    sendMessage,
    readHistory,
    createConversation,
    setActiveConversation,
    deleteConversation,
  ];
}
