/**
 * Shared utility for formatting JavaScript evaluation results and errors.
 * Used by BrowserConsole for inline REPL evaluation.
 */

const RESULT_PREFIX = '\u2713';
const ERROR_PREFIX = '\u2717';

export function formatEvalResult(result: unknown): string {
  if (result === undefined) return `${RESULT_PREFIX} undefined`;
  if (result === null) return `${RESULT_PREFIX} null`;
  if (typeof result === 'object') {
    return `${RESULT_PREFIX} ${JSON.stringify(result, null, 2)}`;
  }
  return `${RESULT_PREFIX} ${String(result)}`;
}

export function formatEvalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${ERROR_PREFIX} ${message}`;
}
