/**
 * Tests for backend/lib/key-encryption.js — AES-256-GCM API key encryption.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_AGENT_DIR = join(tmpdir(), `uap-test-keyenc-${Date.now()}`);

vi.mock('../lib/paths.js', () => ({
  AGENT_DIR: TEST_AGENT_DIR,
}));

describe('key-encryption', () => {
  let encrypt, decrypt;

  beforeAll(async () => {
    mkdirSync(TEST_AGENT_DIR, { recursive: true });
    const mod = await import('../lib/key-encryption.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  afterAll(() => {
    try { rmSync(TEST_AGENT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('encrypt and decrypt round-trip', () => {
    const plaintext = 'sk-ant-my-api-key-12345';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypt produces different ciphertexts for same input (different IV)', () => {
    const c1 = encrypt('same-key');
    const c2 = encrypt('same-key');
    expect(c1).not.toBe(c2);
  });

  it('decrypt returns null for tampered ciphertext', () => {
    expect(decrypt('v1:invaliddata')).toBeNull();
  });

  it('decrypt returns null for completely invalid format', () => {
    expect(decrypt('garbage')).toBeNull();
  });

  it('encrypt handles empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('encrypt handles special characters', () => {
    const plaintext = 'key with spaces & special! @#$%';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('creates the .agent directory with key file on first call', () => {
    expect(existsSync(TEST_AGENT_DIR)).toBe(true);
  });
});
