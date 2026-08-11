/**
 * patEncryption.ts
 * ────────────────
 * Encrypts a PAT (Personal Access Token) with the backend's RSA public key
 * before it leaves the browser, so it never travels in plain text.
 *
 * Algorithm : RSA-OAEP / SHA-256  (matches backend Node.js crypto settings)
 * Encoding   : base64 ciphertext
 *
 * The public key PEM must be provided by the caller (fetched through
 * AppApiClient.call('getPublicKey')).  This eliminates circular
 * dependencies between client.ts and this module.
 */

import type { AppApiClient } from '@agent-type';

let cachedKey: CryptoKey | null = null;

/** Drop the cached public key (e.g. after a 400 "Failed to decrypt PAT" error). */
export function clearPublicKeyCache(): void {
  cachedKey = null;
}

function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    der.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

async function getPublicKey(apiClient: AppApiClient): Promise<CryptoKey> {
  if (!cachedKey) {
    const { key: pem } = await apiClient.call<{ key: string }>('getPublicKey');
    cachedKey = await pemToCryptoKey(pem);
  }
  return cachedKey;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Returns a base64-encoded RSA-OAEP ciphertext of `pat`.
 *
 * @param pat       Plaintext Personal Access Token.
 * @param apiClient AppApiClient for fetching the public key.
 */
export async function encryptPat(pat: string, apiClient: AppApiClient): Promise<string> {
  const key = await getPublicKey(apiClient);
  const encoded = new TextEncoder().encode(pat);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, encoded);
  return arrayBufferToBase64(encrypted);
}
