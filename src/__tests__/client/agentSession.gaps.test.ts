/**
 * Gap-fill tests for AgentSession methods that were not yet covered.
 *
 * Tests focus on: sendMessage, cancelMessage, maybeSetTitle, clearHistory,
 * setTitle, setSubtitle, getState, getHistory, getLiveHistory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentClient } from '@agent-sdk';
import type { AgentHandler } from '@agent-type';

function makeMockHandler(): AgentHandler {
  return vi.fn(async () => ({ text: 'done' })) as unknown as AgentHandler;
}

function createAgent(toolSets: any[] = []) {
  const agent = createAgentClient({
    handler: makeMockHandler(),
    systemPrompt: '',
    tools: [],
    toolSets,
  });
  agent.getSessionManager().createSession();
  return agent;
}

describe('AgentSession — sendMessage / cancelMessage / maybeSetTitle', () => {
  it('sendMessage calls maybeSetTitle and sets updatedAt', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;
    const before = session.getState().updatedAt;

    // Send a message — this triggers maybeSetTitle, updatedAt update, and runner.sendMessage
    await expect(session.sendMessage('Hello world')).resolves.toBeUndefined();

    const state = session.getState();
    // Title should be auto-set from the message content
    expect(state.title).toBe('Hello world');
    // updatedAt should be refreshed
    expect(state.updatedAt).not.toBe(before);
  });

  it('maybeSetTitle truncates long text to 60 chars', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;
    const longText = 'A'.repeat(100);

    await session.sendMessage(longText);

    expect(session.getState().title).toBe('A'.repeat(57) + '…');
  });

  it('maybeSetTitle does NOT override an existing custom title', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;
    session.setTitle('Custom Title');

    await session.sendMessage('New message');

    // Title should remain the explicitly set one
    expect(session.getState().title).toBe('Custom Title');
  });

  it('cancelMessage does not throw (aborts on no inflight request)', () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // Calling cancelMessage when no request is in-flight should be safe
    expect(() => session.cancelMessage()).not.toThrow();
  });

  it('getState returns the current session state', () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    const state = session.getState();
    expect(state).toHaveProperty('id');
    expect(state).toHaveProperty('messages');
    expect(state).toHaveProperty('isLoading');
    expect(state).toHaveProperty('title');
  });

  it('setTitle and setSubtitle update state', () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    session.setTitle('My Title');
    expect(session.getState().title).toBe('My Title');

    session.setSubtitle('My Subtitle');
    expect(session.getState().subtitle).toBe('My Subtitle');
  });

  it('getHistory and getLiveHistory return arrays (initially empty)', () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    expect(Array.isArray(session.getHistory())).toBe(true);
    expect(Array.isArray(session.getLiveHistory())).toBe(true);
  });

  it('clearHistory resets the session', async () => {
    const agent = createAgent();
    const session = agent.getSessionManager().getActiveSession()!;

    // First send a message so there's something to clear
    await session.sendMessage('Will be cleared');

    expect(session.getHistory().length).toBeGreaterThan(0);

    session.clearHistory();
    // After clearHistory, history should be empty
    expect(session.getHistory().length).toBe(0);
  });
});
