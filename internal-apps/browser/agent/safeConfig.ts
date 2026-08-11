/**
 * internal-apps/browser/agent/safeConfig.ts
 *
 * Type-safe helpers for converting between generic config records and
 * strongly-typed BrowserLaunchConfig / StreamConfig objects.
 *
 * Exists to eliminate `as` / `unknown` casts in tool parameter handling.
 * Every function validates at runtime and returns `undefined` for invalid input.
 */

import type { BrowserLaunchConfig } from './types';

// ── BrowserLaunchConfig ──────────────────────────────────────────────────────

/** Known writable keys of BrowserLaunchConfig (used to filter unknown fields). */
const LAUNCH_CONFIG_KEYS: Set<string> = new Set([
  'headless', 'userAgent', 'viewport', 'extraArgs', 'locale', 'timezoneId',
  'ignoreHTTPSErrors', 'colorScheme', 'deviceScaleFactor', 'hasTouch', 'isMobile',
  'geolocation', 'permissions', 'acceptDownloads', 'downloadsPath', 'bypassCSP',
  'javaScriptEnabled', 'offline', 'httpCredentials', 'storageState', 'slowMo',
  'devtools', 'channel',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickString(src: Record<string, unknown>, key: string): string | undefined {
  const v = src[key];
  return typeof v === 'string' ? v : undefined;
}

function pickBool(src: Record<string, unknown>, key: string): boolean | undefined {
  const v = src[key];
  return typeof v === 'boolean' ? v : undefined;
}

function pickNumber(src: Record<string, unknown>, key: string): number | undefined {
  const v = src[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Safely extract a BrowserLaunchConfig from an unknown input value.
 * Only known keys are copied; unknown keys are silently dropped.
 * Returns `undefined` when the input is not a valid object.
 *
 * Pure function, no side effects, no type assertions.
 */
export function safeLaunchConfig(value: unknown): BrowserLaunchConfig | undefined {
  if (!isRecord(value)) return undefined;

  const cfg: BrowserLaunchConfig = {};

  // Boolean fields.
  for (const key of ['headless', 'ignoreHTTPSErrors', 'bypassCSP', 'javaScriptEnabled',
    'acceptDownloads', 'offline', 'hasTouch', 'isMobile', 'devtools'] as const) {
    const v = pickBool(value, key);
    if (v !== undefined) cfg[key] = v;
  }

  // String fields.
  for (const key of ['userAgent', 'locale', 'timezoneId', 'channel',
    'downloadsPath', 'storageState'] as const) {
    const v = pickString(value, key);
    if (v !== undefined) cfg[key] = v;
  }

  // Number fields.
  for (const key of ['deviceScaleFactor', 'slowMo'] as const) {
    const v = pickNumber(value, key);
    if (v !== undefined) cfg[key] = v;
  }

  // Viewport.
  const vp = value['viewport'];
  if (isRecord(vp)) {
    const w = pickNumber(vp, 'width');
    const h = pickNumber(vp, 'height');
    if (w !== undefined && h !== undefined) {
      cfg.viewport = { width: w, height: h };
    }
  }

  // Geolocation.
  const gl = value['geolocation'];
  if (isRecord(gl)) {
    const lat = pickNumber(gl, 'latitude');
    const lng = pickNumber(gl, 'longitude');
    if (lat !== undefined && lng !== undefined) {
      cfg.geolocation = {
        latitude: lat,
        longitude: lng,
        ...(pickNumber(gl, 'accuracy') !== undefined
          ? { accuracy: pickNumber(gl, 'accuracy')! }
          : {}),
      };
    }
  }

  // HttpCredentials.
  const hc = value['httpCredentials'];
  if (isRecord(hc)) {
    const user = pickString(hc, 'username');
    const pass = pickString(hc, 'password');
    if (user !== undefined && pass !== undefined) {
      cfg.httpCredentials = { username: user, password: pass };
    }
  }

  // String arrays.
  const extra = value['extraArgs'];
  if (Array.isArray(extra)) {
    cfg.extraArgs = extra.filter((v): v is string => typeof v === 'string');
  }
  const perms = value['permissions'];
  if (Array.isArray(perms)) {
    cfg.permissions = perms.filter((v): v is string => typeof v === 'string');
  }

  return Object.keys(cfg).length > 0 ? cfg : undefined;
}

/**
 * Convert a typed object to a plain record for app API calls.
 * No `as` or `unknown` — uses explicit key-value copy.
 */
export function toRecord(input: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = value;
  }
  return result;
}
