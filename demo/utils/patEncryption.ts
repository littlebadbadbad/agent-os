/**
 * patEncryption.ts
 * ────────────────
 * Encrypts a PAT (Personal Access Token) with the backend's RSA public key
 * before it leaves the browser, so it never travels in plain text.
 *
 * Algorithm : RSA-OAEP / SHA-256  (matches backend Node.js crypto settings)
 * Key source : GET /api/public-key  (returns PEM, cached for the page lifetime)
 * Encoding   : base64 ciphertext
 *
 * On server restart the cached key becomes stale.  Call clearPublicKeyCache()
 * (or reload the page) to pick up the new key.
 */

import { fetchPublicKey as fetchPublicKeyApi } from '../../agent-UI/api/backend';

let cachedKey: CryptoKey | null = null;

/** Drop the cached public key (e.g. after a 400 "Failed to decrypt PAT" error). */
export function clearPublicKeyCache(): void {
  cachedKey = null;
}

async function fetchPublicKey(): Promise<CryptoKey> {
  const { publicKey: pem } = await fetchPublicKeyApi();

  // Strip PEM headers/footers and decode base64 → DER bytes
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

async function getPublicKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = await fetchPublicKey();
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
 * Automatically fetches (and caches) the server public key on first call.
 */
export async function encryptPat(pat: string): Promise<string> {
  const key = await getPublicKey();
  const encoded = new TextEncoder().encode(pat);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, encoded);
  return arrayBufferToBase64(encrypted);
}
