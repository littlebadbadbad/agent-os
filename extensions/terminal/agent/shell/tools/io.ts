/**
 * Terminal I/O tools: read, send.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { TerminalManagerAdapter } from '../types';
import type { ReadCursor } from '../cursor';

const DEFAULT_MAX_LINES = 150;

function unescapeControlChars(payload: string): string {
  return payload
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

export function createIoTools(adapter: TerminalManagerAdapter, cursor: ReadCursor) {
  const terminalReadTool = defineTool({
    name:  'terminal_read',
    group: 'Terminal',
    description:
      'Read buffered output from a terminal. ' +
      'Omit fromOffset to auto-continue from last read position; pass 0 to re-read from start. ' +
      `Returns up to ${DEFAULT_MAX_LINES} lines by default (most recent kept when truncated).`,
    parameters: z.object({
      id: z.string().describe('Terminal id.'),
      fromOffset: z.number().int().min(0).optional()
        .describe('Byte offset override. Omit to continue from last position; 0 to re-read from start.'),
      maxLines: z.number().int().min(10).max(2_000).optional()
        .describe(`Max lines to return (default ${DEFAULT_MAX_LINES}). Most recent lines kept when truncating.`),
    }),
    execute: async ({ id, fromOffset, maxLines }, context) => {
      const effectiveOffset = fromOffset ?? cursor.getOffset(context.sessionId, id);
      const result = await adapter.readOutput(id, effectiveOffset, context.sessionId);
      cursor.advance(context.sessionId, id, result.offset);

      const limit = maxLines ?? DEFAULT_MAX_LINES;
      const lines = result.output.split('\n');
      if (lines.length > limit) {
        const skipped = lines.length - limit;
        const tail = lines.slice(-limit).join('\n');
        return {
          ...result,
          output: tail,
          truncated: true,
          linesSkipped: skipped,
          note: `Output truncated: ${skipped} earlier lines omitted. Next read will continue from offset ${result.offset}.`,
        };
      }
      return result;
    },
  });

  const terminalSendTool = defineTool({
    name:  'terminal_send',
    group: 'Terminal',
    description:
      'Write text to a terminal\'s stdin (newline appended automatically). ' +
      'Set raw=true to send bytes exactly as-is without the trailing newline (use for control sequences: \\x03=Ctrl+C, \\x04=Ctrl+D). ' +
      'Set runInBackground=true to send the command and return immediately. Check results later with terminal_wait.',
    parameters: z.object({
      id:   z.string().describe('Terminal id.'),
      text: z.string().describe('Text to send. Newline appended unless raw=true.'),
      raw: z.boolean().optional().describe(
        'Send text exactly as-is without trailing newline. Use for control bytes (\\x03=Ctrl+C) or multi-line input.',
      ),
      runInBackground: z.boolean().optional().describe(
        'When true, send the command and return immediately. ' +
        'Use terminal_wait with the terminal id to check results later. ' +
        'Ideal for long-running commands (builds, servers, installs).',
      ),
    }),
    execute: async ({ id, text, raw, runInBackground }, context) => {
      const payload = raw
        ? unescapeControlChars(text)
        : text.endsWith('\n') ? text : text + '\n';

      await adapter.sendInput(id, payload, context.sessionId);
      if (runInBackground) {
        return { started: true, terminalId: id };
      }
      return { ok: true };
    },
  });

  return [terminalReadTool, terminalSendTool] as const;
}
