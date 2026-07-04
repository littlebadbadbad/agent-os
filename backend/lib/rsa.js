/**
 * RSA key-pair management for PAT encryption.
 *
 * A fresh 2048-bit key pair is generated once when the server process starts.
 * The public key is exposed via GET /api/public-key so the browser can encrypt
 * the PAT before transmission.  The private key never leaves the process.
 */

import { generateKeyPairSync, privateDecrypt, constants } from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('rsa');

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

log.info('RSA key pair generated');

/** Returns the server public key in SPKI PEM format. */
export function getPublicKeyPem() {
  return publicKey;
}

/**
 * Decrypts a base64-encoded RSA-OAEP (SHA-256) ciphertext.
 * Throws if decryption fails (wrong key, tampered data, etc.).
 *
 * @param {string} encryptedBase64
 * @returns {string} plaintext PAT
 */
export function decryptPat(encryptedBase64) {
  const cipherBuf = Buffer.from(encryptedBase64, 'base64');
  const plainBuf  = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    cipherBuf,
  );
  return plainBuf.toString('utf8');
}
