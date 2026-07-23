/**
 * Tests for backend/services/api-keys.js — API Key Management Service
 *
 * Covers: validation, decryption, masking, error paths, edge cases.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Mock dependencies ─────────────────────────────────────────────────────────

const mockDecryptPat = vi.fn();
const mockGetApiKey = vi.fn();
const mockSetApiKey = vi.fn();
const mockDeleteApiKey = vi.fn();
const mockListApiKeys = vi.fn();
const mockListMergedProviderNames = vi.fn();
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../lib/rsa.js', () => ({ decryptPat: mockDecryptPat }));
vi.mock('../lib/key-store.js', () => ({
  getApiKey: mockGetApiKey,
  setApiKey: mockSetApiKey,
  deleteApiKey: mockDeleteApiKey,
  listApiKeys: mockListApiKeys,
}));
vi.mock('../services/model-config.js', () => ({ listMergedProviderNames: mockListMergedProviderNames }));
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }));

// ── SUT ───────────────────────────────────────────────────────────────────────

let apiKeys;
beforeAll(async () => {
  apiKeys = await import('../services/api-keys.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  mockListMergedProviderNames.mockReturnValue(['openai', 'anthropic', 'deepseek']);
  mockListApiKeys.mockReturnValue({ openai: null, anthropic: '••••key1', deepseek: null });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('api-keys service', () => {
  describe('getKeyList', () => {
    it('returns the raw key list from key-store', () => {
      const result = apiKeys.getKeyList();
      expect(result).toEqual({ keys: { openai: null, anthropic: '••••key1', deepseek: null } });
      expect(mockListApiKeys).toHaveBeenCalledOnce();
    });
  });

describe('saveKey', () => {
    it('saves an encrypted key successfully', () => {
      mockDecryptPat.mockReturnValue('sk-my-plainkey');
      const result = apiKeys.saveKey('openai', 'encrypted_base64_data');

      expect(mockDecryptPat).toHaveBeenCalledWith('encrypted_base64_data');
      expect(mockSetApiKey).toHaveBeenCalledWith('openai', 'sk-my-plainkey');
      expect(result.ok).toBe(true);
      expect(result.masked).toEqual(expect.stringMatching(/^••••nkey$/));
    });

    it('rejects empty providerId', () => {
      expect(() => apiKeys.saveKey('', 'encrypted')).toThrow('Invalid providerId');
      expect(() => apiKeys.saveKey(null, 'encrypted')).toThrow('Invalid providerId');
      expect(() => apiKeys.saveKey(undefined, 'encrypted')).toThrow('Invalid providerId');
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it('rejects unknown providerId', () => {
      expect(() => apiKeys.saveKey('nonexistent', 'encrypted')).toThrow('Invalid providerId');
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it('rejects missing encryptedKey', () => {
      expect(() => apiKeys.saveKey('openai', null)).toThrow('encryptedKey is required');
      expect(() => apiKeys.saveKey('openai', undefined)).toThrow('encryptedKey is required');
      expect(() => apiKeys.saveKey('openai', '')).toThrow('encryptedKey is required');
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it('rejects non-string encryptedKey', () => {
      expect(() => apiKeys.saveKey('openai', 123)).toThrow('encryptedKey is required');
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it('wraps decryption failure with meaningful error', () => {
      mockDecryptPat.mockImplementation(() => { throw new Error('RSA error'); });
      expect(() => apiKeys.saveKey('openai', 'bad_encrypted')).toThrow(
        'Failed to decrypt key. Ensure it was encrypted with the current server public key.',
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('rejects decrypted key that is only whitespace', () => {
      mockDecryptPat.mockReturnValue('   ');
      expect(() => apiKeys.saveKey('openai', 'encrypted')).toThrow('Decrypted key is empty');
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });

    it('handles decrypted key with exactly 4 chars for masking', () => {
      mockDecryptPat.mockReturnValue('abcd');
      const result = apiKeys.saveKey('openai', 'enc');
      expect(result.masked).toBe('••••abcd');
    });

    it('handles decrypted key with 1 char for masking', () => {
      mockDecryptPat.mockReturnValue('a');
      const result = apiKeys.saveKey('openai', 'enc');
      expect(result.masked).toBe('••••a');
    });

    it('logs info on successful save', () => {
      mockDecryptPat.mockReturnValue('valid-key');
      apiKeys.saveKey('anthropic', 'enc_data');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('anthropic'),
      );
    });
  });

  describe('removeKey', () => {
    it('removes a valid provider key', () => {
      const result = apiKeys.removeKey('openai');

      expect(mockDeleteApiKey).toHaveBeenCalledWith('openai');
      expect(result).toEqual({ ok: true });
    });

    it('rejects invalid providerId', () => {
      expect(() => apiKeys.removeKey('invalid')).toThrow('Invalid providerId');
      expect(mockDeleteApiKey).not.toHaveBeenCalled();
    });

    it('rejects empty providerId', () => {
      expect(() => apiKeys.removeKey(null)).toThrow('Invalid providerId');
      expect(mockDeleteApiKey).not.toHaveBeenCalled();
    });

    it('logs info on successful removal', () => {
      apiKeys.removeKey('deepseek');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('deepseek'),
      );
    });
  });

  describe('provider list integration', () => {
    it('uses dynamic provider list from model-config', () => {
      mockListMergedProviderNames.mockReturnValue(['custom-provider']);
      mockDecryptPat.mockReturnValue('key');

      const result = apiKeys.saveKey('custom-provider', 'enc');
      expect(result.ok).toBe(true);

      expect(() => apiKeys.saveKey('openai', 'enc')).toThrow('Invalid providerId');
    });

    it('handles empty provider list', () => {
      mockListMergedProviderNames.mockReturnValue([]);

      expect(() => apiKeys.saveKey('anything', 'enc')).toThrow('Invalid providerId');
    });
  });
});
