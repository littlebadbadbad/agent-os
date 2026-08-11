/**
 * backend/lib/app-state-store.js — Persistent app state management.
 *
 * Persists app enable/disable state to a JSON file in the data directory.
 * The state file survives server restarts so that disabled apps stay disabled.
 *
 * State file location: <DATA_ROOT>/app-state.json
 *
 * Usage:
 *   import { appStateStore } from './app-state-store.js';
 *   appStateStore.load();              // read from disk
 *   appStateStore.set('browser', 'disabled');
 *   appStateStore.save();              // write to disk
 *   appStateStore.get('browser');    // 'active' | 'disabled' | undefined
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('app-state');

/**
 * Create a app state store backed by a JSON file.
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
export function createAppStateStore(stateFilePath) {
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
        log.warn(`Failed to load app state: ${err.message}`);
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
        log.warn(`Failed to save app state: ${err.message}`);
      }
    },

    /**
     * Get the persisted state for a app.
     * @param {string} id
     * @returns {string | undefined}
     */
    get(id) {
      return _state[id];
    },

    /**
     * Set the persisted state for a app.
     * Does NOT automatically persist to disk — call save() explicitly.
     * @param {string} id
     * @param {string} state
     */
    set(id, state) {
      _state[id] = state;
    },

    /**
     * Remove a app's persisted state entry.
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
