/**
 * MCP Crypto Config Store — Transparent at-rest encryption for server headers.
 *
 * Wraps config-store.js and encrypts the `headers` field (which contains
 * auth tokens like `Authorization: Bearer <token>`) before persisting
 * to disk. Uses the host's AES-256-GCM encryption service.
 *
 * Security model:
 *   - Headers are encrypted with AES-256-GCM (authenticated encryption).
 *   - The master key lives at `.agent/.key` (0o600, never committed).
 *   - Defends against accidental exposure (backups, screenshots, CI artifacts).
 *   - Does NOT protect against a targeted attacker with filesystem access
 *     who can read both `.agent/.key` and `mcp-servers.json`.
 *
 * Persisted format:
 *   When encryption is enabled, the `headers` field becomes:
 *     "headersEncrypted": "<base64: iv(16) || authTag(16) || ciphertext>"
 *   The plain `headers` field is removed from persisted data.
 *   On load, `headersEncrypted` is decrypted back into `headers`.
 *
 * Backward compatibility:
 *   - If no encrypt/decrypt pair is provided, headers are stored in plaintext.
 *   - If a config has plain `headers` (no `headersEncrypted`), it's loaded
 *     as-is and encrypted on the next save (one-time migration).
 */

/**
 * @typedef {import('./config-store.js').ServerConfig} ServerConfig
 */

/**
 * @typedef {object} CryptoOps
 * @property {(plaintext:string) => string} encrypt
 * @property {(encoded:string) => string|null} decrypt
 */

/**
 * @typedef {object} CryptoConfigStore
 * @property {() => readonly ServerConfig[]} getAll
 * @property {(name:string) => ServerConfig|undefined} get
 * @property {(cfg:ServerConfig) => void} save
 * @property {(name:string) => void} remove
 * @property {() => void} persist
 */

/**
 * Create a config store with transparent header encryption.
 *
 * @param {import('./config-store.js').ConfigStore} store - The underlying plain config store.
 * @param {CryptoOps|null} cryptoOps - Encrypt/decrypt functions, or null for plaintext mode.
 * @returns {CryptoConfigStore}
 */
export function createCryptoConfigStore(store, cryptoOps) {
  const hasCrypto = cryptoOps !== null && cryptoOps.encrypt && cryptoOps.decrypt;

  // ══════════════════════════════════════════════════════════════════════════
  //  Internal helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Encrypt headers if crypto is available.
   * @param {Record<string,string>|undefined} headers
   * @returns {{headersEncrypted?:string}|Record<string,never>}
   */
  function encryptHeaders(headers) {
    if (!hasCrypto || !headers || Object.keys(headers).length === 0) {
      return {};
    }
    const json = JSON.stringify(headers);
    try {
      return { headersEncrypted: cryptoOps.encrypt(json) };
    } catch {
      // Fall back to plaintext on encryption failure
      return { headers };
    }
  }

  /**
   * Decrypt headers if `headersEncrypted` field exists.
   * Returns the decrypted headers object, or the original plain `headers`.
   * @param {ServerConfig} cfg
   * @returns {Record<string,string>}
   */
  function decryptHeaders(cfg) {
    // Already has plain headers (unencrypted or already decrypted)
    if (cfg.headers && Object.keys(cfg.headers).length > 0) {
      return cfg.headers;
    }

    // Try to decrypt if we have encrypted data and crypto
    if (hasCrypto && cfg.headersEncrypted) {
      try {
        const json = cryptoOps.decrypt(cfg.headersEncrypted);
        if (json) {
          return JSON.parse(json);
        }
      } catch { /* decrypt failed — treat as no headers */ }
    }

    return {};
  }

  /**
   * Process a raw config from disk: decrypt headers, remove encrypted field.
   * @param {ServerConfig} raw
   * @returns {ServerConfig}
   */
  function hydrateConfig(raw) {
    const headers = decryptHeaders(raw);
    const { headersEncrypted, headers: _h, ...rest } = raw;
    return { ...rest, headers };
  }

  /**
   * Prepare a config for persistence: encrypt headers, remove plaintext.
   * @param {ServerConfig} cfg
   * @returns {{headersEncrypted?:string, headers?:Record<string,string>}&Omit<ServerConfig,'headersEncrypted'>}
   */
  function dehydrateConfig(cfg) {
    const { headersEncrypted: _enc, headers, ...rest } = cfg;
    if (!hasCrypto) {
      // Plaintext mode — store headers as-is
      return { ...rest, headers };
    }
    // Encrypt headers for at-rest storage
    return { ...rest, ...encryptHeaders(headers) };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Public API — same shape as ConfigStore
  // ══════════════════════════════════════════════════════════════════════════

  return {
    /** Hydrate all persisted configs. */
    getAll() {
      return store.getAll().map(hydrateConfig);
    },

    /** Get one config by name, hydrated. */
    get(name) {
      const raw = store.get(name);
      return raw ? hydrateConfig(raw) : undefined;
    },

    /** Save a config — encrypt headers before persisting. */
    save(cfg) {
      store.save(dehydrateConfig(cfg));
    },

    /** Remove a config by name. */
    remove(name) {
      store.remove(name);
    },

    /** Force persist the underlying store. */
    persist() {
      store.persist();
    },
  };
}
