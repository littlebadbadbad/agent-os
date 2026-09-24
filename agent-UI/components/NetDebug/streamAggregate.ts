/**
 * streamAggregate.ts — pure display model over a stream's incremental
 * aggregates (see NetStreamAggregate in store/netLog.ts).
 *
 * Detection rules (per the user's spec):
 *   - every chunk was a plain string   → 'plain-string': auto-concatenated text;
 *   - every chunk was a JSON object    → 'json-field': offer each string-valued
 *     top-level key whose values can be concatenated (e.g. LLM token deltas);
 *   - anything mixed / binary / other  → 'raw': no aggregate view.
 *
 * Total and allocation-light: it only reads the aggregate counters and the
 * field map, never the raw chunks.
 */

import type { NetStreamAggregate } from '../../store/netLog';

export type StreamAggregateMode = 'plain-string' | 'json-field' | 'raw';

export interface StreamAggregateView {
  readonly mode: StreamAggregateMode;
  /** Concatenated text for 'plain-string' mode. */
  readonly text?: string;
  /** Selectable JSON field names (insertion order) for 'json-field' mode. */
  readonly fields?: readonly string[];
  /** Field with the most content — the sensible default selection. */
  readonly defaultField?: string;
  /** True when the store capped the underlying content (100k chars / 24 keys). */
  readonly truncated: boolean;
}

export function computeStreamAggregate(agg: NetStreamAggregate): StreamAggregateView {
  const total = agg.textChunks + agg.jsonChunks + agg.otherChunks;
  if (total === 0 || agg.otherChunks > 0) return { mode: 'raw', truncated: agg.truncated };

  if (agg.textChunks === total) {
    return { mode: 'plain-string', text: agg.text, truncated: agg.truncated };
  }

  if (agg.jsonChunks === total && agg.fields.size > 0) {
    const fields: string[] = [];
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, value] of agg.fields) {
      fields.push(key);
      if (value.length > bestLen) {
        bestLen = value.length;
        best = key;
      }
    }
    return { mode: 'json-field', fields, defaultField: best, truncated: agg.truncated };
  }

  return { mode: 'raw', truncated: agg.truncated };
}

/** Concatenated text for the selected JSON field ('' when missing). */
export function fieldValue(agg: NetStreamAggregate, field: string): string {
  return agg.fields.get(field) ?? '';
}
