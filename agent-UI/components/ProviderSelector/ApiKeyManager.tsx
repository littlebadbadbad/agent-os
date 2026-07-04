/**
 * ApiKeyManager.tsx — Self-contained API key management panel.
 *
 * Extracted from ProviderSelector to isolate the key-management concern:
 *   - Fetches RSA public key + masked key status on mount
 *   - Manages per-provider key save/clear with RSA-encrypted transport
 *   - Fully self-contained state; parent only passes provider names
 *
 * @module ApiKeyManager
 */

import { useState, useEffect } from 'react';
import { fetchPublicKey, fetchApiKeys, saveApiKey, deleteApiKey } from '../../api/backend';
import styles from './ProviderSelector.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

type KeyStatus = 'idle' | 'saving' | 'ok' | 'err';

export interface ApiKeyManagerProps {
  /** Ordered list of provider names to show key rows for. */
  providerNames: readonly string[];
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICONS = ['✦', '🔮', '☁️', '🧠', '🐋', '⚡', '🔌', '🌐', '⚙️', '📡'];

function providerIcon(index: number): string {
  return ICONS[index % ICONS.length];
}

// ── Web-Crypto helpers (RSA-OAEP encryption) ─────────────────────────────────

function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    pemToBuffer(pem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

async function encryptWithKey(publicKey: CryptoKey, plaintext: string): Promise<string> {
  const buf = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    new TextEncoder().encode(plaintext),
  );
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * API Key management panel for all providers.
 * Loads RSA public key + masked key status on mount, then allows per-provider
 * set/clear operations. Keys are RSA-encrypted before transport to the backend.
 */
export function ApiKeyManager({ providerNames }: ApiKeyManagerProps) {
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string | null>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus>>({});
  const [loaded, setLoaded] = useState(false);

  // ── Load public key + masked key status on first mount ──────────────────
  useEffect(() => {
    if (loaded || providerNames.length === 0) return;

    async function load() {
      try {
        const [pkData, keysData] = await Promise.all([
          fetchPublicKey(),
          fetchApiKeys(),
        ]);
        setCryptoKey(await importPublicKey(pkData.publicKey));

        const masked: Record<string, string | null> = {};
        const inputs: Record<string, string> = {};
        const status: Record<string, KeyStatus> = {};
        for (const name of providerNames) {
          masked[name] = keysData.keys[name] ?? null;
          inputs[name] = '';
          status[name] = 'idle';
        }
        setMaskedKeys(masked);
        setKeyInputs(inputs);
        setKeyStatus(status);
        setLoaded(true);
      } catch {
        // If server isn't reachable, show empty state — user can retry later
      }
    }

    load();
    // Intentionally runs only once when providerNames is first available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerNames.length]);

  // ── Save a key ─────────────────────────────────────────────────────────
  async function handleSave(name: string) {
    const plain = keyInputs[name]?.trim();
    if (!plain || !cryptoKey) return;

    setKeyStatus((s) => ({ ...s, [name]: 'saving' }));
    try {
      const encryptedKey = await encryptWithKey(cryptoKey, plain);
      const data = await saveApiKey(name, encryptedKey);
      setMaskedKeys((m) => ({ ...m, [name]: data.masked ?? '••••' }));
      setKeyInputs((i) => ({ ...i, [name]: '' }));
      setKeyStatus((s) => ({ ...s, [name]: 'ok' }));
      setTimeout(() => setKeyStatus((s) => ({ ...s, [name]: 'idle' })), 1500);
    } catch {
      setKeyStatus((s) => ({ ...s, [name]: 'err' }));
      setTimeout(() => setKeyStatus((s) => ({ ...s, [name]: 'idle' })), 2000);
    }
  }

  // ── Clear a key ───────────────────────────────────────────────────────
  async function handleClear(name: string) {
    await deleteApiKey(name).catch(() => {});
    setMaskedKeys((m) => ({ ...m, [name]: null }));
    setKeyInputs((i) => ({ ...i, [name]: '' }));
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className={styles.keysList}>
      <p className={styles.keysNote}>
        Key 经 RSA 加密传输，仅存内存，重启后清除。
      </p>

      {providerNames.length === 0 && (
        <div className={styles.providerEmpty}>暂无已配置提供商</div>
      )}

      {providerNames.map((name, idx) => (
        <div key={name} className={styles.keyRow}>
          <div className={styles.keyRowHeader}>
            <span className={styles.keyRowIcon}>{providerIcon(idx)}</span>
            <span className={styles.keyRowLabel}>{name}</span>
            {maskedKeys[name]
              ? <span className={styles.keySet}>{maskedKeys[name]}</span>
              : <span className={styles.keyUnset}>未设置</span>
            }
          </div>

          <div className={styles.keyRowInput}>
            <input
              type="password"
              className={styles.keyInput}
              placeholder="粘贴 API Key…"
              value={keyInputs[name] ?? ''}
              onChange={(e) => setKeyInputs((i) => ({ ...i, [name]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(name); }}
            />
            <button
              className={`${styles.keySaveBtn} ${
                keyStatus[name] === 'ok'  ? styles.keySaveBtnOk  :
                keyStatus[name] === 'err' ? styles.keySaveBtnErr : ''
              }`}
              disabled={!keyInputs[name]?.trim() || keyStatus[name] === 'saving'}
              onClick={() => handleSave(name)}
            >
              {keyStatus[name] === 'saving' ? '…' :
               keyStatus[name] === 'ok'     ? '✓' :
               keyStatus[name] === 'err'    ? '✕' : '保存'}
            </button>
            {maskedKeys[name] && (
              <button
                className={styles.keyClearBtn}
                onClick={() => handleClear(name)}
                title="清除密钥"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
