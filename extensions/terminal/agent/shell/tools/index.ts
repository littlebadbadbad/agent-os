/**
 * Tools barrel — combines all terminal tool groups into a single factory.
 *
 * Returns `{ tools, getSystemPrompt }` consumed by the ToolSet factory.
 */

import type { TerminalManagerAdapter } from '../types';
import { createReadCursor, type ReadCursor } from '../cursor';
import { createLifecycleTools } from './lifecycle';
import { createIoTools } from './io';
import { createWaitTools } from './wait';

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
 * Create all terminal tools grouped by concern, plus a system-prompt hook.
 */
export function createTerminalTools(adapter: TerminalManagerAdapter) {
  const state: TerminalShellState = { ...defaultShellState };
  const cursor: ReadCursor = createReadCursor();

  // Eagerly fetch shell list for system-prompt enrichment.
  adapter.listShells().then((shells) => {
    if (shells.length === 0) return;
    const defaultShell = shells.find(s => s.isDefault);
    const defName = (defaultShell?.name ?? '').toLowerCase();

    state.summary = shells
      .map((s) => `${s.name}${s.isDefault ? ' [default]' : ''}`)
      .join(', ');

    if (/cmd|powershell|pwsh/.test(defName)) {
      state.osNote = 'HOST OS: Windows. Prefer pwsh or powershell; fall back to cmd.exe for legacy scripts. Avoid bash/wsl/git-bash.';
      state.shellFamilies = 'powershell/pwsh: $var,Get-*,; | cmd: %VAR%,/flag,&& | bash/zsh: $var,POSIX,&&';
    } else if (/bash|zsh|fish|^sh$/.test(defName)) {
      state.osNote = 'HOST OS: Linux/macOS. Prefer bash or zsh (fish if requested). Avoid PowerShell/cmd.exe.';
      state.shellFamilies = 'bash/zsh: $var,POSIX,&& | fish: $var,fish-builtins,; | powershell: $var,Get-*,;';
    }
  }).catch(() => {});

  const tools = [
    ...createLifecycleTools(adapter),
    ...createIoTools(adapter, cursor),
    ...createWaitTools(adapter, cursor),
  ];

  return {
    tools,
    cursor,
    getSystemPrompt: () => buildTerminalSystemPrompt(state),
  };
}
