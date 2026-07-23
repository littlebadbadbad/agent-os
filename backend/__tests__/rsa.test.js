/**
 * Tests for backend/lib/rsa.js — RSA key-pair management.
 */
import { describe, it, expect } from 'vitest';
import { publicEncrypt, constants } from 'crypto';
import { getPublicKeyPem, decryptPat } from '../lib/rsa.js';

describe('RSA module', () => {
  it('getPublicKeyPem returns a valid SPKI PEM string', () => {
    const pem = getPublicKeyPem();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
  });

  it('decryptPat decrypts a public-key-encrypted payload', () => {
    const pem = getPublicKeyPem();
    const plaintext = 'my-secret-pat-token';
    const cipherBuf = publicEncrypt(
      { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(plaintext, 'utf8'),
    );
    const ciphertext = cipherBuf.toString('base64');
    const decrypted = decryptPat(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('decryptPat throws for invalid base64 input', () => {
    expect(() => decryptPat('!!!not-base64!!!')).toThrow();
  });

  it('decryptPat throws for tampered ciphertext', () => {
    const pem = getPublicKeyPem();
    const plaintext = 'test';
    const cipherBuf = publicEncrypt(
      { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(plaintext, 'utf8'),
    );
    const tampered = cipherBuf.toString('base64').slice(0, -5) + 'XXXXX';
    expect(() => decryptPat(tampered)).toThrow();
  });
});
