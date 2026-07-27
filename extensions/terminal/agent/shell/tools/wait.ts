/**
 * Terminal waiting tools: wait (idle/exit detection), sleep (fixed delay).
 *
 * Both delegate to backend RPC operations instead of polling across the wire.
 * The wait tool additionally supports user cancellation via requestUserInput.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { TerminalManagerAdapter } from '../types';
import type { ReadCursor } from '../cursor';

export function createWaitTools(adapter: TerminalManagerAdapter, cursor: ReadCursor) {
  const terminalWaitTool = defineTool({
    name:  'terminal_wait',
    group: 'Terminal',
    description:
      'Wait for a terminal to become idle (no new output for idleMs ms) or exit, then return all output since the last read. ' +
      'A cancel prompt appears in the UI while waiting. ' +
      'If hard timeout elapses, Ctrl+C is sent automatically. ' +
      'Read cursor advances just like terminal_read.',
    parameters: z.object({
      id: z.string().describe('Terminal id.'),
      idleMs: z.number().int().min(100).max(60_000).optional().describe(
        'Output silence threshold in ms that counts as idle (default 1000). Increase for bursty commands.',
      ),
      timeoutMs: z.number().int().min(1_000).max(7_200_000).optional().describe(
        'Hard timeout in ms before Ctrl+C is sent (default 300000). Max 2 hours.',
      ),
    }),
    execute: async ({ id, idleMs = 1_000, timeoutMs = 300_000 }, context) => {
      const cancelInputId = crypto.randomUUID();
      let userCancelled = false;

      const userInputPromise = context.requestUserInput?.({
        ephemeral: true,
        type: 'confirm',
        message: `Waiting for terminal "${id}" to finish. Click OK to stop waiting and return current output.`,
      }, cancelInputId).then((v) => {
        if (v !== null && v !== undefined) {
          userCancelled = true;
          adapter.cancelWait(id, context.sessionId).catch(() => {});
        }
      });

      try {
        const result = await adapter.waitTerminal(id, { idleMs, timeoutMs }, context.sessionId);
        cursor.advance(context.sessionId, id, result.offset);
        return result;
      } catch (err) {
        // If the backend wait was cancelled, return current output.
        const snap = await adapter.readOutput(id, cursor.getOffset(context.sessionId, id), context.sessionId);
        cursor.advance(context.sessionId, id, snap.offset);
        return { ...snap, timedOut: false, reason: 'cancelled' as const };
      } finally {
        context.cancelUserInput?.(cancelInputId);
        void userInputPromise;
      }
    },
  });

//   const terminalSleepTool = defineTool({
//     name:  'terminal_sleep',
//     group: 'Terminal',
//     description: 'Pause execution for a fixed duration (ms). Delegates to the backend to avoid blocking the agent process.',
//     parameters: z.object({
//       durationMs: z.number().int().min(100).max(120_000).describe('Duration in ms (100–120,000).'),
//     }),
//     execute: async ({ durationMs }, context) => {
//       const result = await adapter.sleepTerminal(durationMs, context.sessionId);
//       return { slept: result.slept, aborted: result.aborted };
//     },
//   });

  return [
    terminalWaitTool,
    //  terminalSleepTool
  ] as const;
}
