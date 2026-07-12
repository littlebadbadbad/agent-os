/**
 * backend/lib/stream-registry.js — Shared stream connection lifecycle manager
 *
 * Provides a unified API for managing browser streaming, output
 * streaming, and chat streaming connections across both IPC and Network
 * transport layers.
 *
 * Each stream entry is a tagged object with optional cleanup(), abort
 * controller, and metadata.  The registry is transport-agnostic — it stores
 * opaque objects and provides iteration/lookup/cleanup patterns.
 *
 * Usage (transport layer):
 *   import { streamRegistry } from '../../lib/stream-registry.js';
 *   streamRegistry.set(id, { cleanup, aborted: false });
 *   streamRegistry.get(id);
 *   streamRegistry.delete(id);
 *   streamRegistry.clearAll();
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StreamEntry
 * @property {string} tag      - 'browser' | 'chat'
 * @property {() => void} [cleanup]   - Tear-down function
 * @property {AbortController} [ctrl] - Abort controller for the stream
 * @property {boolean} [aborted]       - Whether this stream has been aborted
 * @property {unknown} [meta]          - Optional metadata (e.g. sessionId, browserId)
 */

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, StreamEntry>} */
const _registry = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

export const streamRegistry = {
  /**
   * Register a new stream.
   * @param {string} id  - Unique stream identifier
   * @param {StreamEntry} entry
   */
  set(id, entry) {
    _registry.set(id, entry);
  },

  /**
   * Look up a stream entry.
   * @param {string} id
   * @returns {StreamEntry | undefined}
   */
  get(id) {
    return _registry.get(id);
  },

  /**
   * Check if a stream is registered.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return _registry.has(id);
  },

  /**
   * Remove and optionally clean up a stream.
   * @param {string} id
   * @returns {boolean} true if the entry existed and was removed
   */
  delete(id) {
    const entry = _registry.get(id);
    if (!entry) return false;
    if (!entry.aborted && entry.cleanup) {
      entry.cleanup();
    }
    _registry.delete(id);
    return true;
  },

  /**
   * Abort and remove a stream, no-op if already aborted or missing.
   * @param {string} id
   */
  abort(id) {
    const entry = _registry.get(id);
    if (!entry) return;
    entry.aborted = true;
    entry.ctrl?.abort();
    entry.cleanup?.();
    _registry.delete(id);
  },

  /**
   * Remove all streams (optionally filtered by tag), cleaning up each one.
   * @param {string} [tag]  - Optional tag to filter ('browser' | 'chat')
   */
  clearAll(tag) {
    for (const [id, entry] of _registry) {
      if (tag && entry.tag !== tag) continue;
      this.abort(id);
    }
  },

  /**
   * Return the number of registered streams (optionally filtered by tag).
   * @param {string} [tag]
   * @returns {number}
   */
  size(tag) {
    if (!tag) return _registry.size;
    let count = 0;
    for (const entry of _registry.values()) {
      if (entry.tag === tag) count++;
    }
    return count;
  },

  /**
   * Iterate over all registered stream entries.
   * @returns {IterableIterator<[string, StreamEntry]>}
   */
  entries() {
    return _registry.entries();
  },
};
