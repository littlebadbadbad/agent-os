/**
 * Persistent key encryption (AES-256-GCM) for at-rest API key storage.
 *
 * ── Security model ─────────────────────────────────────────────────────────
 *
 * On first use, generates a random 256-bit AES key and stores it in
 * `.agent/.key`.  This key file is the master secret — if an attacker has
 * read access to both `.agent/.key` and `.agent/api-keys.json`, they can
 * recover all stored API keys.  Therefore:
 *
 *   - The `.agent/` directory is fully gitignored (never committed).
 *   - File-system access control (OS-level user permissions) is the
 *     last line of defence — same as any credential file (`.env`, etc.).
 *
 * Each API key is encrypted with AES-256-GCM before being written to
 * `api-keys.json`.  The ciphertext includes a random 16-byte IV and a
 * 16-byte GCM authentication tag, which prevents both data exposure
 * and undetected tampering.
 *
 * This is "encryption at rest" — it prevents accidental exposure via
 * backups, screen sharing, or CI artifact inspection.  It does NOT
 * protect against a targeted attacker with filesystem access.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AGENT_DIR } from './paths.js';
import { createLogger } from './logger.js';

const log = createLogger('key-encryption');

const ALGORITHM = 'aes-256-gcm';
const KEY_FILE  = join(AGENT_DIR, '.key');
const KEY_BYTES = 32; // 256 bits
const IV_BYTES  = 16; // 128 bits GCM IV (standard recommendation)
const TAG_BYTES = 16; // GCM authentication tag length

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get or create the persistent AES-256 encryption key. */
function getOrCreateKey() {
  if (existsSync(KEY_FILE)) {
    return readFileSync(KEY_FILE);
  }
  const key = randomBytes(KEY_BYTES);
  writeFileSync(KEY_FILE, key, { mode: 0o600 });
  log.info('Generated new persistent encryption key at .agent/.key');
  return key;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * Output format (all base64-encoded): IV (16) + authTag (16) + ciphertext
 *
 * @param {string} plaintext
 * @returns {string} base64-encoded ciphertext
 */
export function encrypt(plaintext) {
  const key  = getOrCreateKey();
  const iv   = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  // Packed layout: iv || authTag || ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 *
 * Returns `null` on any failure (tampered data, wrong key, corrupt format).
 * Never throws — all callers must handle the null case gracefully.
 *
 * @param {string} encoded - base64 ciphertext produced by encrypt()
 * @returns {string|null} plaintext, or null if decryption failed
 */
export function decrypt(encoded) {
  try {
    const key = getOrCreateKey();
    const buf = Buffer.from(encoded, 'base64');

    const iv        = buf.subarray(0, IV_BYTES);
    const authTag   = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch (err) {
    log.warn('Failed to decrypt key data —', err.message);
    return null;
  }
}
