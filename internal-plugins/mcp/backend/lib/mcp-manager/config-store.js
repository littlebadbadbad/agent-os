/**
 * MCP Server Configuration Persistence
 *
 * Reads/writes server configurations to `.agent/mcp-servers.json`.
 * Pure data layer — no connection logic.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} ServerConfig
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {'streamable-http'|'legacy-sse'|'stdio'} transport
 * @property {Record<string,string>} [headers]
 * @property {string} [headersEncrypted]
 * @property {string[]} [includeTools]
 * @property {boolean} [useProxy]
 * @property {boolean} enabled
 */

/**
 * @typedef {object} ConfigStore
 * @property {() => readonly ServerConfig[]} getAll
 * @property {(name:string) => ServerConfig|undefined} get
 * @property {(cfg:ServerConfig) => void} save
 * @property {(name:string) => void} remove
 * @property {() => void} persist
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a config store backed by a JSON file on disk.
 *
 * @param {string} agentDir - Absolute path to the `.agent/` directory.
 * @returns {ConfigStore}
 */
export function createConfigStore(agentDir) {
  try { mkdirSync(agentDir, { recursive: true }); } catch { /* ignore */ }

  const CONFIG_FILE = join(agentDir, 'mcp-servers.json');

  /** @type {Map<string, ServerConfig>} */
  const configs = new Map();

  // Hydrate from disk
  try {
    if (existsSync(CONFIG_FILE)) {
      /** @type {ServerConfig[]} */
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
      for (const cfg of saved) {
        configs.set(cfg.name, cfg);
      }
    }
  } catch { /* ignore corrupted file */ }

  function persist() {
    const serializable = [...configs.values()].map(
      ({ id, name, url, transport, headers, headersEncrypted, includeTools, useProxy, enabled }) =>
        ({ id, name, url, transport, headers, headersEncrypted, includeTools, useProxy, enabled }),
    );
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(serializable, null, 2), 'utf8');
    } catch (err) {
      console.warn('[mcp] failed to persist mcp-servers.json:', err.message);
    }
  }

  return {
    getAll: () => [...configs.values()],
    get: (name) => configs.get(name),
    save(cfg) {
      configs.set(cfg.name, cfg);
      persist();
    },
    remove(name) {
      configs.delete(name);
      persist();
    },
    persist,
  };
}
