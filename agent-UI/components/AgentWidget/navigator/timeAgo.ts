/**
 * navigator/timeAgo.ts — Human-readable relative timestamps.
 *
 * No hardcoded fallback strings. Returns `''` when the timestamp
 * is missing or unparseable so callers can hide the time row entirely.
 */

/**
 * Format an ISO timestamp as a short relative string.
 * Returns `''` when the timestamp is missing or unparseable.
 */
export function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);

  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month ago`;
  const years = Math.floor(months / 12);
  return `${years} year ago`;
}
