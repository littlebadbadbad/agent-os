/**
 * Shell discovery helpers.
 *
 * Probes the host OS for available interactive shells and exposes the
 * IS_WIN constant so other modules don't need to re-derive it.
 */

import { spawnSync }  from 'child_process';
import { existsSync } from 'fs';
import { join }       from 'path';

export const IS_WIN = process.platform === 'win32';

// Full path to the `where` utility so it is found even when
// %SystemRoot%\System32 is not in the process PATH.
const WHERE_EXE = IS_WIN
  ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
  : 'which';

// Well-known Windows shell locations used as existsSync fallbacks when
// `where` fails (restricted PATH, non-standard environments, etc.).
const WIN_FALLBACK_SHELLS = [
  { name: 'powershell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
  { name: 'pwsh',       path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
];

/**
 * Probe the current host for available interactive shells.
 * Returns an array of { name, path, isDefault } objects.
 * Uses `where` (Windows) / `which` (Unix) so only actually-installed shells
 * are returned.
 *
 * @returns {{ name: string; path: string; isDefault: boolean }[]}
 */
export function listAvailableShells() {
  const defaultShell = IS_WIN
    ? 'cmd.exe'
    : (process.env.AGENT_SHELL ?? process.env.SHELL ?? 'bash');

  const candidates = IS_WIN
    ? ['cmd.exe', 'pwsh', 'powershell', 'bash', 'wsl']
    : [...new Set(['bash', 'zsh', 'fish', 'sh', process.env.SHELL].filter(Boolean))];

  const results = [];
  for (const shell of candidates) {
    try {
      const r = spawnSync(WHERE_EXE, [shell], {
        stdio:       'pipe',
        encoding:    'utf-8',
        timeout:     2000,
        windowsHide: true,
      });
      if (r.status === 0) {
        const resolvedPath = r.stdout.trim().split(/\r?\n/)[0].trim();
        if (resolvedPath) {
          // On Windows, `where bash` resolves to C:\Windows\System32\bash.exe
          // which is a WSL launcher, not a native bash binary.  It does not
          // inherit Windows environment variables (including PROMPT_COMMAND)
          // and behaves nothing like a POSIX bash shell.  Skip it here — the
          // `wsl` candidate already represents that entry point.
          if (IS_WIN && shell === 'bash' && /[/\\][Ss]ystem32[/\\]/i.test(resolvedPath)) {
            continue;
          }
          results.push({
            name:      shell,
            path:      resolvedPath,
            isDefault: shell === defaultShell || resolvedPath === defaultShell,
          });
        }
      }
    } catch {
      // shell not found — skip
    }
  }

  // cmd.exe is always available on Windows even if `where` fails
  if (IS_WIN && !results.some(s => s.name === 'cmd.exe')) {
    results.unshift({
      name:      'cmd.exe',
      path:      'C:\\Windows\\System32\\cmd.exe',
      isDefault: true,
    });
  }

  // Add known Windows shells that `where` missed (restricted PATH etc.).
  if (IS_WIN) {
    for (const fb of WIN_FALLBACK_SHELLS) {
      if (!results.some(s => s.name === fb.name)) {
        try {
          if (existsSync(fb.path)) {
            results.push({ name: fb.name, path: fb.path, isDefault: false });
          }
        } catch { /* fs error — skip */ }
      }
    }
  }

  return results;
}
