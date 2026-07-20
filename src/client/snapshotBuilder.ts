import { MAIN_CONVERSATION_ID } from '@agent-sdk/tools/toolSet';
import type { ToolSet, ToolSetContext } from '@agent-type';
import type { SessionManager, SessionEntryData } from './sessionManager.types';
import { collectSnapshotData } from '@agent-sdk/tools/sharedStateCollector';

export type SnapshotBuilderDeps = {
  sessionMgr: Pick<SessionManager, 'getState'>;
  agentId: string;
  getAllToolSets: () => readonly ToolSet[];
};

export function createSnapshotBuilder(deps: SnapshotBuilderDeps) {
  const { sessionMgr, agentId, getAllToolSets } = deps;

  return function buildSnapshot(sessionId: string): SessionEntryData {
    const entry = sessionMgr
      .getState()
      .sessions.find((s) => s.id === sessionId);
    if (!entry) throw new Error(`Session "${sessionId}" not found`);
    const session = entry.session;

    // Collect contributions from all ToolSets (config-time + runtime-registered).
    const snapshotCtx: ToolSetContext = { sessionId, agentName: agentId, conversationId: MAIN_CONVERSATION_ID };
    const toolSetData = collectSnapshotData(getAllToolSets(), snapshotCtx);

    return {
      id: sessionId,
      title: entry.title,
      subtitle: entry.subtitle || undefined,
      updatedAt: entry.updatedAt,
      messages: session.getHistory(),
      liveHistory: session.getLiveHistory(),
      ...toolSetData,
    };
  };
}
