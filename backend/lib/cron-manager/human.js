/**
 * Cron expression → human-readable string.
 *
 * Thin wrapper around cronstrue that provides a safe no-throw fallback.
 * cronstrue covers the full POSIX cron matrix: every-N-minutes, hourly,
 * daily, weekly, monthly, step ranges, lists, and composite combinations.
 */

import { toString as cronToString } from 'cronstrue';

/**
 * Convert a 5-field cron expression to a human-readable English description.
 * Falls back to the raw expression if cronstrue cannot parse it.
 *
 * @param {string} expr  e.g. "0 9 * * 1" (Monday at 09:00)
 * @returns {string}
 */
export function cronToHuman(expr) {
  try {
    return cronToString(expr, { use24HourTimeFormat: true });
  } catch {
    return expr;
  }
}
