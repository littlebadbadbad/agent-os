/**
 * backend/lib/plugin-state-store.js — Persistent plugin state management.
 *
 * Persists plugin enable/disable state to a JSON file in the data directory.
 * The state file survives server restarts so that disabled plugins stay disabled.
 *
 * State file location: <DATA_ROOT>/plugin-state.json
 *
 * Usage:
 *   import { pluginStateStore } from './plugin-state-store.js';
 *   pluginStateStore.load();              // read from disk
 *   pluginStateStore.set('browser', 'disabled');
 *   pluginStateStore.save();              // write to disk
 *   pluginStateStore.get('browser');    // 'active' | 'disabled' | undefined
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('plugin-state');

/**
 * Create a plugin state store backed by a JSON file.
 *
 * @param {string} stateFilePath - Absolute path to the state JSON file.
 * @returns {{
 *   load: () => Record<string, string>,
 *   save: () => void,
 *   get: (id: string) => string | undefined,
 *   set: (id: string, state: string) => void,
 *   remove: (id: string) => void,
 *   getAll: () => Record<string, string>,
 * }}
 */
export function createPluginStateStore(stateFilePath) {
  /** @type {Record<string, string>} */
  let _state = {};

  return {
    /**
     * Load state from disk. Returns the parsed state object.
     * If the file doesn't exist, returns an empty object.
     * @returns {Record<string, string>}
     */
    load() {
      try {
        if (!existsSync(stateFilePath)) {
          _state = {};
          return _state;
        }
        const raw = readFileSync(stateFilePath, 'utf-8');
        _state = JSON.parse(raw);
        return _state;
      } catch (err) {
        log.warn(`Failed to load plugin state: ${err.message}`);
        _state = {};
        return _state;
      }
    },

    /**
     * Persist current state to disk.
     */
    save() {
      try {
        const lastSep = Math.max(stateFilePath.lastIndexOf('/'), stateFilePath.lastIndexOf('\\'));
        const dirPath = lastSep > 0 ? stateFilePath.substring(0, lastSep) : '';
        if (dirPath && !existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true });
        }
        writeFileSync(stateFilePath, JSON.stringify(_state, null, 2), 'utf-8');
      } catch (err) {
        log.warn(`Failed to save plugin state: ${err.message}`);
      }
    },

    /**
     * Get the persisted state for a plugin.
     * @param {string} id
     * @returns {string | undefined}
     */
    get(id) {
      return _state[id];
    },

    /**
     * Set the persisted state for a plugin.
     * Does NOT automatically persist to disk — call save() explicitly.
     * @param {string} id
     * @param {string} state
     */
    set(id, state) {
      _state[id] = state;
    },

    /**
     * Remove a plugin's persisted state entry.
     * @param {string} id
     */
    remove(id) {
      delete _state[id];
    },

    /**
     * Get all persisted state entries.
     * @returns {Record<string, string>}
     */
    getAll() {
      return { ..._state };
    },
  };
}
