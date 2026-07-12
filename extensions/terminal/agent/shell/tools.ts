/**
 * extensions/terminal/agent/shell/tools.ts — Terminal tool definitions
 *
 * Defines 7 tools: terminal_list, terminal_create, terminal_read, terminal_send,
 * terminal_remove, terminal_wait, terminal_sleep.
 *
 * Moved from agent/tools.ts during plugin restructuring (Phase 1).
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { TerminalManagerAdapter } from './types';

// ── Shell state (shared with toolSet for system-prompt injection) ─────────────

export type TerminalShellState = {
  summary: string;
  osNote: string;
  shellFamilies: string;
};

const defaultShellState: TerminalShellState = {
  summary: 'leave blank to use the host default',
  osNote: '',
  shellFamilies: 'powershell: $var,Get-*,; | cmd: %VAR%,/flag,&& | bash/zsh: $var,POSIX,&&',
};

export function buildTerminalSystemPrompt(state: TerminalShellState): string {
  const lines = ['## Terminal'];
  if (state.osNote) lines.push(state.osNote);
  lines.push(`Shell syntax for terminal_send: ${state.shellFamilies}`);
  lines.push('Use terminal_wait (auto idle-detection) instead of polling with terminal_read.');
  return lines.join('\n');
}

/**
 * Create terminal management tools.
 *
 * Returns `{ tools, getSystemPrompt }` — the toolSet uses `getSystemPrompt` to
 * inject OS/shell guidance into the system prompt without cluttering tool descriptions.
 */
export function createTerminalTools(adapter: TerminalManagerAdapter) {
  const state: TerminalShellState = { ...defaultShellState };

  // ── Internal setup ──────────────────────────────────────────────────────
  // Per-session per-terminal read cursor.  Key: `${sessionId}:${terminalId}`.
  const readCursors = new Map<string, number>();

  // Eagerly fetch shell list for system-prompt enrichment and terminal_create description.
  adapter.listShells().then((shells) => {
    if (shells.length === 0) return;
    const defaultShell = shells.find(s => s.isDefault);
    const defName = (defaultShell?.name ?? '').toLowerCase();

    state.summary = shells
      .map((s) => `${s.name}${s.isDefault ? ' [default]' : ''}`)
      .join(', ');

    if (/cmd|powershell|pwsh/.test(defName)) {
      state.osNote = 'HOST OS: Windows. Prefer pwsh or powershell; fall back to cmd.exe for legacy scripts. Avoid bash/wsl/git-bash — incompatible path separators.';
      state.shellFamilies = 'powershell/pwsh: $var,Get-*,; | cmd: %VAR%,/flag,&& | bash/zsh: $var,POSIX,&&';
    } else if (/bash|zsh|fish|^sh$/.test(defName)) {
      state.osNote = 'HOST OS: Linux/macOS. Prefer bash or zsh (fish if requested). Avoid PowerShell/cmd.exe.';
      state.shellFamilies = 'bash/zsh: $var,POSIX,&& | fish: $var,fish-builtins,; | powershell: $var,Get-*,;';
    }
  }).catch(() => {});

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  function buildTools() {
    const terminalListTool = defineTool({
      name:  'terminal_list',
      group: 'Terminal',
      description: 'List active terminal instances.',
      parameters: z.object({}),
      execute: async (_, context) => ({
        terminals: await adapter.listTerminals({ sessionId: context.sessionId }),
      }),
    });

    const terminalCreateTool = defineTool({
      name:  'terminal_create',
      group: 'Terminal',
      description: () =>
        `Open a new shell terminal and return its id. Available shells: ${state.summary}. ` +
        'Reuse an existing terminal (terminal_list) when possible.',
      parameters: z.object({
        shell: z.string().optional().describe(
          'Shell executable, e.g. "pwsh", "bash", "cmd.exe". Supports inline args: "wsl -d Ubuntu". Defaults to host default.',
        ),
        label: z.string().optional().describe('Human-readable label for the terminal tab.'),
        cwd: z.string().optional().describe(
          'Working directory, e.g. "/home/user/project" or "D:\\\\myapp". Defaults to backend cwd.',
        ),
      }),
      execute: async ({ shell, label, cwd }, context) =>
        adapter.createTerminal({ shell, label, cwd, sessionId: context.sessionId }),
    });

    const DEFAULT_MAX_LINES = 150;

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
        const cursorKey = `${context.sessionId}:${id}`;
        const effectiveOffset = fromOffset ?? readCursors.get(cursorKey) ?? 0;
        const result = await adapter.readOutput(id, effectiveOffset, context.sessionId);
        // Always advance the cursor to the latest position.
        readCursors.set(cursorKey, result.offset);

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
        'Set runInBackground=true to send the command and return immediately — check results later with terminal_wait.',
      parameters: z.object({
        id:   z.string().describe('Terminal id.'),
        text: z.string().describe('Text to send. Newline appended unless raw=true.'),
        raw: z.boolean().optional().describe(
          'Send text exactly as-is without trailing newline. Use for control bytes (\\x03=Ctrl+C) or multi-line input.',
        ),
        runInBackground: z.boolean().optional().describe(
          'When true, send the command and return immediately without waiting. ' +
          'Use terminal_wait with the terminal id to check results later. ' +
          'Ideal for long-running commands (builds, servers, installs).',
        ),
      }),
      execute: async ({ id, text, raw, runInBackground }, context) => {
        // Default: treat text as a command line - append \n so the shell executes it.
        // raw=true opts out for control sequences or precise stdin writes.
        let payload = raw ? text : (text.endsWith('\n') ? text : text + '\n');
        if (raw) {
          // LLMs write escape sequences as JSON-literal strings (e.g. the 4 chars \x03).
          // Unescape them so the actual control bytes reach the terminal.
          payload = payload
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t');
        }
        await adapter.sendInput(id, payload, context.sessionId);
        if (runInBackground) {
          // Return immediately — caller checks with terminal_wait later.
          return { started: true, terminalId: id };
        }
        return { ok: true };
      },
    });

    const terminalRemoveTool = defineTool({
      name:        'terminal_remove',
      group:       'Terminal',
      description: 'Kill and remove a terminal instance.',
      parameters:  z.object({
        id: z.string().describe('Terminal id to remove.'),
      }),
      execute: async ({ id }, context) => {
        await adapter.removeTerminal(id, context.sessionId);
        return { removed: id };
      },
    });

    const terminalSleepTool = defineTool({
      name:  'terminal_sleep',
      group: 'Terminal',
      description: 'Pause execution for a fixed duration (ms).',
      parameters: z.object({
        durationMs: z.number().int().min(100).max(120_000).describe('Duration in ms (100–120,000).'),
      }),
      execute: async ({ durationMs }, context) => {
        const started = Date.now();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, durationMs);
          context.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        return { slept: Date.now() - started, aborted: context.signal?.aborted ?? false };
      },
    });

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
        const sessionId  = context.sessionId;
        const cursorKey  = `${sessionId}:${id}`;
        const fromOffset = readCursors.get(cursorKey) ?? 0;
        const pollMs     = Math.min(Math.floor(idleMs / 2), 250);
        const deadline   = Date.now() + timeoutMs;

        let lastActivityAt = Date.now();
        let lastOffset     = fromOffset;

        const cancel = { triggered: false };

        const cancelInputId = crypto.randomUUID();
        const userInputPromise = context.requestUserInput?.({
          ephemeral: true,
          type: 'confirm',
          message: `Waiting for terminal "${id}" to finish. Click OK to stop waiting and return current output.`,
        }, cancelInputId).then((v) => {
          if (v !== null && v !== undefined) cancel.triggered = true;
        });

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (cancel.triggered || context.signal?.aborted) {
            const snap = await adapter.readOutput(id, fromOffset, sessionId);
            readCursors.set(cursorKey, snap.offset);
            const reason = cancel.triggered ? 'cancelled' as const : 'aborted' as const;
            return { ...snap, timedOut: false, reason };
          }

          const now = Date.now();
          if (now >= deadline) {
            // Send Ctrl+C and give the process a moment to react.
            await adapter.sendInput(id, '\x03', sessionId).catch(() => {});
            await sleep(300);
            const snap = await adapter.readOutput(id, fromOffset, sessionId);
            readCursors.set(cursorKey, snap.offset);
            context.cancelUserInput?.(cancelInputId);
            void userInputPromise;
            return { ...snap, timedOut: true, reason: 'timeout' as const };
          }

          const snap = await adapter.readOutput(id, lastOffset, sessionId);

          if (snap.output.length > 0) {
            lastActivityAt = Date.now();
            lastOffset     = snap.offset;
          }

          if (!snap.running) {
            const full = await adapter.readOutput(id, fromOffset, sessionId);
            readCursors.set(cursorKey, full.offset);
            context.cancelUserInput?.(cancelInputId);
            void userInputPromise;
            return { ...full, timedOut: false, reason: 'exited' as const };
          }

          if (Date.now() - lastActivityAt >= idleMs) {
            const full = await adapter.readOutput(id, fromOffset, sessionId);
            readCursors.set(cursorKey, full.offset);
            context.cancelUserInput?.(cancelInputId);
            void userInputPromise;
            return { ...full, timedOut: false, reason: 'idle' as const };
          }

          await sleep(pollMs);
        }
      },
    });

    return [
      terminalListTool,
      terminalCreateTool,
      terminalReadTool,
      terminalSendTool,
      terminalRemoveTool,
      terminalSleepTool,
      terminalWaitTool,
    ] as const;
  }

  return {
    tools: buildTools(),
    getSystemPrompt: () => buildTerminalSystemPrompt(state),
  };
}
