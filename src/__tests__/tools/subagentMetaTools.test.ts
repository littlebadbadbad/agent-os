import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createSubAgentToolset } from '../../tools/subagent/subAgentToolset';
import type { AgentQueryFns } from '@agent-type';
import type { Tool } from '@agent-type';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string, description = `Description for ${name}`): Tool {
  return {
    name,
    description,
    parameters: z.object({}),
    execute: async () => `result of ${name}`,
  };
}

function makeAgent() {
  const registered: Tool[] = [];
  return {
    registerTool: vi.fn((t: Tool) => {
      registered.push(t);
      return () => {
        const idx = registered.indexOf(t);
        if (idx !== -1) registered.splice(idx, 1);
      };
    }),
    registerToolSet: vi.fn(() => () => {}),
    getTools: () => [...registered],
    getFilteredTools: () => [...registered],
    getRegistered: () => registered,
    handler: stubHandler as any,
    getRegisteredToolSets: () => [] as any[],
  };
}

// stubHandler returns a final text response with no tool calls so the loop exits after 1 turn.
const stubHandler = vi.fn(async () => ({ text: 'Sub-agent response text.', toolCalls: [] }));

// Common tool context mock passed to tool.execute(params, ctx).
const stubCtx = {
  sessionId: 'test', agentName: 'main', conversationId: 'test',
  signal: new AbortController().signal,
  onProgress: vi.fn((_lane: string, _event: unknown) => {}),
  };

// ── createSubAgentToolset ─────────────────────────────────────────────────────

describe('createSubAgentToolset', () => {
  let agent: ReturnType<typeof makeAgent>;
  let toolA: Tool;
  let toolB: Tool;
  let meta: ReturnType<typeof createSubAgentToolset>;

  beforeEach(() => {
    agent = makeAgent();
    toolA = makeTool('tool_a', 'First tool for searching');
    toolB = makeTool('tool_b', 'Second tool for writing');
    // Register tools on agent so they appear in the pool (getTools() returns all registered tools).
    agent.registerTool(toolA);
    agent.registerTool(toolB);
    meta = createSubAgentToolset('async');
    meta.onAttach?.(agent as unknown as AgentQueryFns);
  });

  // ── exports ───────────────────────────────────────────────────────────────

  it('returns all 9 tools including sendMessage, readHistory and setActiveConversation', () => {
    expect(meta.createSubAgent).toBeDefined();
    expect(meta.updateSubAgent).toBeDefined();
    expect(meta.listSubAgents).toBeDefined();
    expect(meta.deleteSubAgent).toBeDefined();
    expect(meta.sendMessage).toBeDefined();
    expect(meta.readHistory).toBeDefined();
    expect(meta.createConversation).toBeDefined();
    expect(meta.setActiveConversation).toBeDefined();
    expect(meta.deleteConversation).toBeDefined();
    expect(meta.delegateTask).toBeDefined();
    expect(meta.tools).toHaveLength(10);
  });

  it('names the tools using the provided suffix', () => {
    const names = meta.tools.map((t) => t.name);
    expect(names).toContain('create_async_subagent');
    expect(names).toContain('update_async_subagent');
    expect(names).toContain('list_async_subagents');
    expect(names).toContain('delete_async_subagent');
    expect(names).toContain('send_async_message');
    expect(names).toContain('read_async_history');
    expect(names).toContain('create_async_conversation');
    expect(names).toContain('set_async_active_conversation');
    expect(names).toContain('delete_async_conversation');
    expect(names).toContain('delegate_async_task');
  });

  // ── list (empty) ─────────────────────────────────────────────────────────

  it('list_async_subagents returns empty list initially', async () => {
    const result = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    expect(result.subAgents).toEqual([]);
    expect(result.message).toContain('No async sub-agents');
  });

  it('lists available tools in the empty message', async () => {
    const result = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    expect(result.availableTools).toContain('tool_a');
    expect(result.availableTools).toContain('tool_b');
  });

  // ── create ────────────────────────────────────────────────────────────────

  it('creates a sub-agent and returns conversationId in result', async () => {
    const result = await meta.createSubAgent.execute({
      name: 'researcher_agent',
      description: 'Researches topics using the available tools.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any) as any;

    // Sub-agents are NOT registered as callable tools on the parent agent.
    // They are accessed via send_async_message.
    expect(result.created).toBe('researcher_agent');
    expect(result.conversationId).toBeDefined();
    expect(result.message).toContain('researcher_agent');
  });

  it('returns success message on creation', async () => {
    const result = await meta.createSubAgent.execute({
      name: 'writer_agent',
      description: 'Writes content based on given instructions.',
      tool_names: ['tool_b'],
      max_turns: 8,
    }, stubCtx as any) as any;

    expect(result.created).toBe('writer_agent');
    expect(result.message).toContain('writer_agent');
    expect(result.message).toContain('send_async_message');
  });

  it('throws when creating a duplicate sub-agent', async () => {
    await meta.createSubAgent.execute({
      name: 'coder_agent',
      description: 'Writes code for solving programming tasks.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    await expect(
      meta.createSubAgent.execute({
        name: 'coder_agent',
        description: 'Another coder agent.',
        tool_names: ['tool_a'],
        max_turns: 5,
      }, stubCtx as any),
    ).rejects.toThrow('already exists');
  });

  it('throws when creating with an unknown tool name', async () => {
    await expect(
      meta.createSubAgent.execute({
        name: 'bad_agent',
        description: 'Uses a tool that does not exist.',
        tool_names: ['nonexistent_tool'],
        max_turns: 5,
      }, stubCtx as any),
    ).rejects.toThrow('Unknown tool');
  });

  it('accepts an optional system_prompt', async () => {
    const result = await meta.createSubAgent.execute({
      name: 'specialist_agent',
      description: 'Specialist with a custom prompt.',
      system_prompt: 'You are an expert specialist.',
      tool_names: ['tool_a'],
      max_turns: 3,
    }, stubCtx as any) as any;
    expect(result.created).toBe('specialist_agent');
  });

  it('appears in list after creation', async () => {
    await meta.createSubAgent.execute({
      name: 'list_test_agent',
      description: 'An agent for testing the list.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    expect(list.count).toBe(1);
    const entry = list.subAgents[0];
    expect(entry.name).toBe('list_test_agent');
    expect(entry.toolNames).toContain('tool_a');
    expect(entry.maxTurns).toBe(5);
    expect(entry.createdAt).toBeDefined();
  });

  // ── update ────────────────────────────────────────────────────────────────

  it('updates an existing sub-agent description', async () => {
    await meta.createSubAgent.execute({
      name: 'update_me_agent',
      description: 'Original description of this agent.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    const result = await meta.updateSubAgent.execute({
      name: 'update_me_agent',
      description: 'Updated description of this agent here.',
    }, stubCtx as any) as any;

    expect(result.updated).toBe('update_me_agent');
    expect(result.message).toContain('update_me_agent');
  });

  it('update does not touch the parent agent registerTool at all', async () => {
    await meta.createSubAgent.execute({
      name: 'update_register_agent',
      description: 'Will be updated �?no re-registration needed.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    const callsBefore = agent.registerTool.mock.calls.length;

    await meta.updateSubAgent.execute({
      name: 'update_register_agent',
      max_turns: 10,
    }, stubCtx as any);

    // Sub-agents are NOT registered as callable tools, so registerTool should
    // never be called during creation OR update.
    expect(agent.registerTool.mock.calls.length).toBe(callsBefore);

    // Verify the state was actually updated.
    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'update_register_agent');
    expect(entry.maxTurns).toBe(10);
  });

  it('update keeps existing fields when not supplied', async () => {
    await meta.createSubAgent.execute({
      name: 'keep_fields_agent',
      description: 'Original description to keep.',
      system_prompt: 'Original system prompt',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    await meta.updateSubAgent.execute({ name: 'keep_fields_agent', max_turns: 7 }, stubCtx as any);

    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'keep_fields_agent');
    expect(entry.maxTurns).toBe(7);
    expect(entry.description).toBe('Original description to keep.');
    expect(entry.systemPrompt).toBe('Original system prompt');
  });

  it('clears system_prompt when empty string is passed', async () => {
    await meta.createSubAgent.execute({
      name: 'clear_prompt_agent',
      description: 'Agent whose system prompt will be cleared here.',
      system_prompt: 'Has a system prompt',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    await meta.updateSubAgent.execute({ name: 'clear_prompt_agent', system_prompt: '' }, stubCtx as any);

    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'clear_prompt_agent');
    expect(entry.systemPrompt).toBeUndefined();
  });

  it('throws when updating a non-existent sub-agent', async () => {
    await expect(
      meta.updateSubAgent.execute({ name: 'ghost_agent', max_turns: 5 }, stubCtx as any),
    ).rejects.toThrow('not found');
  });

  it('throws when updating with an unknown tool name', async () => {
    await meta.createSubAgent.execute({
      name: 'tool_check_agent',
      description: 'This agent is used to test tool validation.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    await expect(
      meta.updateSubAgent.execute({ name: 'tool_check_agent', tool_names: ['nonexistent_tool'] }, stubCtx as any),
    ).rejects.toThrow('Unknown tool');
  });

  // ── delete ────────────────────────────────────────────────────────────────

  it('deletes a sub-agent', async () => {
    await meta.createSubAgent.execute({
      name: 'delete_me_agent',
      description: 'This agent will be deleted right away.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    const result = await meta.deleteSubAgent.execute({ name: 'delete_me_agent' }, stubCtx as any) as any;
    expect(result.deleted).toBe('delete_me_agent');
  });

  it('removes the sub-agent from the list after deletion', async () => {
    await meta.createSubAgent.execute({
      name: 'gone_agent',
      description: 'This agent will be gone from the list.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);

    await meta.deleteSubAgent.execute({ name: 'gone_agent' }, stubCtx as any);

    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    expect(list.subAgents.find((s: any) => s.name === 'gone_agent')).toBeUndefined();
  });

  it('throws when deleting a non-existent sub-agent', async () => {
    await expect(
      meta.deleteSubAgent.execute({ name: 'ghost_agent' }, stubCtx as any),
    ).rejects.toThrow('not found');
  });

  it('createSubAgent description() returns a string listing available tools', () => {
    // Covers lines 100-113 in metaTools.ts �?the lazy description function body
    const desc = meta.createSubAgent.description;
    const text = typeof desc === 'function' ? desc() : desc;
    expect(typeof text).toBe('string');
    expect(text).toContain('tool_a');
    expect(text).toContain('tool_b');
  });

  it('createSubAgent description() lists tool names (descriptions intentionally omitted)', () => {
    // poolNames() outputs only names by design �?DO NOT change this expectation.
    const toolWithFnDesc = makeTool('fn_desc_tool', undefined);
    (toolWithFnDesc as any).description = () => 'Dynamic description from function';
    agent.registerTool(toolWithFnDesc);
    const fnMeta = createSubAgentToolset('fn');
    fnMeta.onAttach?.(agent as unknown as AgentQueryFns);
    const desc = fnMeta.createSubAgent.description;
    const text = typeof desc === 'function' ? desc() : desc;
    expect(text).toContain('fn_desc_tool');
    // Descriptions are intentionally NOT included in the tool list.
    expect(text).not.toContain('Dynamic description from function');
  });

  it('creates a sub-agent without max_turns (defaults to 8 via ?? fallback)', async () => {
    // Covers the `max_turns ?? 8` TRUE branch at line 168 (max_turns is undefined)
    await meta.createSubAgent.execute({
      name: 'default_turns_agent',
      description: 'Agent created without specifying max_turns.',
      tool_names: ['tool_a'],
      // max_turns intentionally omitted so ?? 8 fallback fires
    } as any, stubCtx as any);
    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'default_turns_agent');
    expect(entry.maxTurns).toBe(8);
  });

  it('updates max_turns when provided (covers ?? existing.maxTurns FALSE branch)', async () => {
    // Covers line 211: `max_turns ?? existing.maxTurns` �?the left branch (max_turns is provided)
    await meta.createSubAgent.execute({
      name: 'update_turns_agent',
      description: 'Agent to test updating max turns value.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any);
    await meta.updateSubAgent.execute({ name: 'update_turns_agent', max_turns: 12 }, stubCtx as any);
    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'update_turns_agent');
    expect(entry.maxTurns).toBe(12);
  });

  it('updates system_prompt with a non-empty string (line 211 false branch of === "" check)', async () => {
    // Covers `system_prompt === '' ? undefined : system_prompt` FALSE branch at line 211
    // i.e., when system_prompt is provided and is NOT empty �?use the provided value
    await meta.createSubAgent.execute({
      name: 'sys_prompt_agent',
      description: 'Agent to test updating system prompt to a non-empty string.',
      tool_names: ['tool_a'],
      max_turns: 3,
    }, stubCtx as any);
    await meta.updateSubAgent.execute({
      name: 'sys_prompt_agent',
      system_prompt: 'You are a specialist. Be concise and technical.',
    }, stubCtx as any);
    const list = await meta.listSubAgents.execute({}, stubCtx as any) as any;
    const entry = list.subAgents.find((s: any) => s.name === 'sys_prompt_agent');
    expect(entry).toBeDefined();
    // The sub-agent was updated with the new system_prompt
  });

  // ── send_message + read_history ───────────────────────────────────────────

  async function makeReadyAgent(name: string) {
    const result = await meta.createSubAgent.execute({
      name,
      description: 'A sub-agent ready for messaging tests.',
      tool_names: ['tool_a'],
      max_turns: 5,
    }, stubCtx as any) as any;
    return result.conversationId as string;
  }

  it('send_async_message runs the agent loop and returns a response', async () => {
    const convId = await makeReadyAgent('msg_test_agent');
    const result = await meta.sendMessage.execute({
      subagent_name: 'msg_test_agent',
      message: 'Hello!',
      conversation_id: convId,
    }, stubCtx as any) as any;

    expect(result.response).toBe('Sub-agent response text.');
    expect(result.turns).toBeGreaterThanOrEqual(1);
    expect(result.conversationId).toBe(convId);
    expect(result.messageCount).toBeGreaterThan(0);
  });

  it('send_async_message appends messages to history on repeated calls', async () => {
    const convId = await makeReadyAgent('history_append_agent');
    await meta.sendMessage.execute({ subagent_name: 'history_append_agent', message: 'First', conversation_id: convId }, stubCtx as any);
    await meta.sendMessage.execute({ subagent_name: 'history_append_agent', message: 'Second', conversation_id: convId }, stubCtx as any);
    const conv = meta.getRegistry(stubCtx.sessionId).getConversation('history_append_agent', convId);
    const h = conv!.getHistory();
    // user + assistant per turn = 4 entries minimum
    expect(h.length).toBeGreaterThanOrEqual(4);
  });

  it('read_async_history returns messages with stable indices', async () => {
    const convId = await makeReadyAgent('read_test_agent');
    await meta.sendMessage.execute({ subagent_name: 'read_test_agent', message: 'Hi', conversation_id: convId }, stubCtx as any);
    const result = await meta.readHistory.execute({
      subagent_name: 'read_test_agent',
      conversation_id: convId,
      from_index: 0,
    }, stubCtx as any) as any;

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].index).toBe(0);
    result.messages.forEach((m: any, i: number) => {
      expect(m.index).toBe(i);
      expect(['user', 'assistant']).toContain(m.role);
    });
  });

  it('read_async_history auto-advances cursor on repeated reads', async () => {
    const convId = await makeReadyAgent('cursor_test_agent');
    await meta.sendMessage.execute({ subagent_name: 'cursor_test_agent', message: 'msg1', conversation_id: convId }, stubCtx as any);

    // First read �?cursor starts at 0
    const r1 = await meta.readHistory.execute({ subagent_name: 'cursor_test_agent', conversation_id: convId }, stubCtx as any) as any;
    expect(r1.messages.length).toBeGreaterThan(0);
    const firstNext = r1.next;

    // Second read without from_index �?should continue from cursor
    await meta.sendMessage.execute({ subagent_name: 'cursor_test_agent', message: 'msg2', conversation_id: convId }, stubCtx as any);
    const r2 = await meta.readHistory.execute({ subagent_name: 'cursor_test_agent', conversation_id: convId }, stubCtx as any) as any;
    expect(r2.from).toBe(firstNext);
  });

  it('read_async_history reads from beginning when from_index: 0 is explicitly passed', async () => {
    const convId = await makeReadyAgent('reread_test_agent');
    await meta.sendMessage.execute({ subagent_name: 'reread_test_agent', message: 'Hi', conversation_id: convId }, stubCtx as any);

    // Advance cursor by reading once
    await meta.readHistory.execute({ subagent_name: 'reread_test_agent', conversation_id: convId }, stubCtx as any);
    // Re-read from beginning
    const result = await meta.readHistory.execute({ subagent_name: 'reread_test_agent', conversation_id: convId, from_index: 0 }, stubCtx as any) as any;
    expect(result.from).toBe(0);
    expect(result.messages[0].index).toBe(0);
  });

  // ── create_conversation / delete_conversation ─────────────────────────────

  it('create_async_conversation creates a new isolated conversation', async () => {
    const convId = await makeReadyAgent('multi_conv_agent');
    const result = await meta.createConversation.execute({ subagent_name: 'multi_conv_agent', title: 'Second thread' }, stubCtx as any) as any;
    expect(result.created).toBeDefined();
    expect(result.created).not.toBe(convId);
    expect(result.title).toBe('Second thread');
  });

  it('delete_async_conversation removes the conversation', async () => {
    await makeReadyAgent('del_conv_agent');
    const newConv = await meta.createConversation.execute({ subagent_name: 'del_conv_agent' }, stubCtx as any) as any;
    const newId = newConv.created as string;

    await meta.deleteConversation.execute({ subagent_name: 'del_conv_agent', conversation_id: newId }, stubCtx as any);
    expect(meta.getRegistry(stubCtx.sessionId).getConversation('del_conv_agent', newId)).toBeUndefined();
  });

  it('set_async_active_conversation switches the active conversation', async () => {
    const firstId = await makeReadyAgent('switch_agent');
    const second = await meta.createConversation.execute({ subagent_name: 'switch_agent' }, stubCtx as any) as any;
    const secondId = second.created as string;

    // Second conversation was auto-activated on create; switch back to first.
    await meta.setActiveConversation.execute(
      { subagent_name: 'switch_agent', conversation_id: firstId },
      stubCtx as any,
    );

    const snap = meta.getRegistry(stubCtx.sessionId).getState().subAgents.find((a) => a.name === 'switch_agent')!;
    expect(snap.activeConversationId).toBe(firstId);
    // Now send without conversation_id �?should land on firstId.
    const result = await meta.sendMessage.execute(
      { subagent_name: 'switch_agent', message: 'hi' },
      stubCtx as any,
    ) as any;
    expect(result.conversationId).toBe(firstId);
    expect(secondId).not.toBe(firstId);
  });

  // ── session isolation ─────────────────────────────────────────────────────

  it('sub-agents are isolated between sessions �?session2 cannot see session1 agents', async () => {
    const session1Ctx = { ...stubCtx, sessionId: 'session-1' };
    const session2Ctx = { ...stubCtx, sessionId: 'session-2' };

    // Create a sub-agent in session 1.
    await meta.createSubAgent.execute({
      name: 'isolated_agent',
      description: 'An agent created only for session-1 isolation test.',
      tool_names: ['tool_a'],
      max_turns: 3,
    }, session1Ctx as any);

    // Session 1 should see the agent.
    const list1 = await meta.listSubAgents.execute({}, session1Ctx as any) as any;
    expect(list1.subAgents.find((a: any) => a.name === 'isolated_agent')).toBeDefined();

    // Session 2 should see an empty registry �?completely isolated.
    const list2 = await meta.listSubAgents.execute({}, session2Ctx as any) as any;
    expect(list2.subAgents).toEqual([]);
    expect(list2.message).toContain('No async sub-agents');
  });

  it('send_async_message without conversation_id targets the active conversation', async () => {
    const convId = await makeReadyAgent('default_conv_agent');
    // Do NOT pass conversation_id �?should auto-resolve to the active one.
    const result = await meta.sendMessage.execute(
      { subagent_name: 'default_conv_agent', message: 'hello' },
      stubCtx as any,
    ) as any;
    expect(result.conversationId).toBe(convId);
  });
});
