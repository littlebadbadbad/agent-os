/**
 * extensions/cron/backend/cron-manager/human.js
 *
 * Cron expression -> human-readable string.
 * Thin wrapper around cronstrue with a safe no-throw fallback.
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
