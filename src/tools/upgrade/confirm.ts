/**
 * Confirm function type and default implementations for upgrade prompts.
 *
 * Used in lifecycle hooks (e.g. `onSessionReady`) where the tool execution
 * context — and therefore `context.requestUserInput` — is not available.
 *
 * Supply the appropriate adapter when constructing the UpgradeToolSet, or
 * let `autoConfirm()` pick the right default for the current runtime.
 */

// ── Type ──────────────────────────────────────────────────────────────────────

/**
 * Presents a yes/no confirmation to the user.
 * Returns `true` for yes, `false` for no, `null` if cancelled or unavailable.
 */
export type UpgradeConfirmFn = (message: string) => Promise<boolean | null>;

// ── Browser ───────────────────────────────────────────────────────────────────

/**
 * Wraps `window.confirm` for browser environments.
 * Returns `null` when `window` is not available.
 */
export const defaultBrowserConfirm: UpgradeConfirmFn = (message) =>
  Promise.resolve(
    typeof window !== 'undefined' ? window.confirm(message) : null,
  );

// ── Node / terminal ───────────────────────────────────────────────────────────

/**
 * Prompts on stdin/stdout using Node's `readline`.
 * Returns `null` when readline is unavailable (e.g. non-interactive stdin).
 */
export async function defaultTerminalConfirm(
  message: string,
): Promise<boolean | null> {
  try {
    // @ts-ignore — readline is a Node.js built-in; @types/node is intentionally
    // excluded from the browser tsconfig, but this branch only runs in Node.
    const { createInterface } = await import('readline');
    // @ts-ignore — same reason: process.stdin/stdout are Node.js globals.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<boolean | null>((resolve) => {
      rl.question(`${message} (y/n) `, (answer: string) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        resolve(a === 'y' || a === 'yes');
      });
    });
  } catch {
    return null;
  }
}

// ── Auto-detect ───────────────────────────────────────────────────────────────

/**
 * Returns the best confirm function for the current runtime:
 * - Browser environments (`window` defined): `defaultBrowserConfirm`
 * - Node / terminal: `defaultTerminalConfirm`
 */
export function autoConfirm(): UpgradeConfirmFn {
  return typeof window !== 'undefined'
    ? defaultBrowserConfirm
    : defaultTerminalConfirm;
}
