/**
 * backend/lib/plugin-installer.js — Plugin filesystem install/uninstall operations.
 *
 * Pure filesystem operations — NO lifecycle management.
 * The caller (plugin-scanner or route handler) handles state transitions.
 *
 * Responsibilities:
 *   1. Validate a plugin directory (check manifest.json has required fields)
 *   2. Extract ZIP archive into plugins/<id>/
 *   3. Copy a source directory into plugins/<id>/
 *   4. Remove a plugin directory from plugins/<id>/
 *
 * Usage:
 *   import { createPluginInstaller } from './plugin-installer.js';
 *   const installer = createPluginInstaller(pluginsDir);
 *   await installer.installFromZip(zipBuffer);
 *   await installer.installFromDirectory(sourcePath);
 *   await installer.remove(pluginId);
 */

import { existsSync, readFileSync, mkdirSync, cpSync, rmSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import AdmZip from 'adm-zip';
import { createLogger } from './logger.js';

const log = createLogger('plugin-installer');

// ── Required manifest fields ─────────────────────────────────────────────────

const REQUIRED_MANIFEST_FIELDS = ['id', 'name', 'version'];

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a plugin installer bound to a specific plugins directory.
 *
 * @param {string} pluginsDir  - Absolute path to the plugins/ directory.
 * @returns {{
 *   validatePluginDir: (dirPath: string) => { ok: true, manifest: object } | { ok: false, error: string },
 *   installFromZip: (zipBuffer: Buffer) => Promise<{ ok: true, pluginId: string } | { ok: false, error: string }>,
 *   installFromDirectory: (sourceDir: string) => Promise<{ ok: true, pluginId: string } | { ok: false, error: string }>,
 *   remove: (pluginId: string) => { ok: true } | { ok: false, error: string },
 * }}
 */
export function createPluginInstaller(pluginsDir) {
  // Ensure plugins directory exists.
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Validate that a directory contains a valid plugin manifest.
   *
   * @param {string} dirPath  - Absolute path to a plugin directory candidate.
   * @returns {{ ok: true, manifest: object } | { ok: false, error: string }}
   */
  function validatePluginDir(dirPath) {
    const manifestPath = join(dirPath, 'manifest.json');

    if (!existsSync(manifestPath)) {
      return { ok: false, error: 'manifest.json not found' };
    }

    let manifest;
    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `Invalid manifest.json: ${err.message}` };
    }

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (!manifest[field] || typeof manifest[field] !== 'string') {
        return { ok: false, error: `manifest.json missing or invalid required field: "${field}"` };
      }
    }

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(manifest.id)) {
      return { ok: false, error: `Plugin ID "${manifest.id}" must be kebab-case (lowercase letters, digits, hyphens only)` };
    }

    return { ok: true, manifest };
  }

  /**
   * Resolve the target directory for a plugin ID, ensuring no path traversal.
   *
   * @param {string} pluginId
   * @returns {string}
   */
  function resolvePluginDir(pluginId) {
    const resolved = resolve(pluginsDir, pluginId);
    // Guard against path traversal.
    if (!resolved.startsWith(resolve(pluginsDir))) {
      throw new Error(`Path traversal detected for plugin ID: ${pluginId}`);
    }
    return resolved;
  }

  // ── Helper: sync removal with retry ────────────────────────────────────────

  /**
   * Try to remove a directory synchronously with retry + backoff.
   * Returns true if the directory no longer exists after the attempt.
   *
   * @param {string} dirPath
   * @param {number} maxRetries
   * @param {number} delayMs
   * @returns {boolean}
   */
  function tryRemoveSync(dirPath, maxRetries, delayMs) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        rmSync(dirPath, { recursive: true, force: true });
        return !existsSync(dirPath);
      } catch (err) {
        if (attempt === maxRetries) {
          log.debug(`tryRemoveSync exhausted after ${maxRetries} attempts for "${dirPath}": ${err.code || err.message}`);
          return false;
        }
        // Spin-wait — acceptable because this is a synchronous retry loop
        // that runs infrequently (only during plugin uninstall).
        const deadline = Date.now() + delayMs;
        while (Date.now() < deadline) { /* spin */ }
      }
    }
    return false;
  }

  // ── Helper: async deferred cleanup ─────────────────────────────────────────

  /**
   * Asynchronously remove a directory (fire-and-forget).
   * Used as a fallback when sync removal fails due to file locks.
   * Retries internally with backoff, and logs the outcome.
   *
   * @param {string} dirPath
   */
  function removeAsync(dirPath) {
    const MAX_ATTEMPTS = 10;
    const BASE_DELAY = 500;

    (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          rmSync(dirPath, { recursive: true, force: true });
          log.info(`Deferred async cleanup succeeded for: ${dirPath}`);
          return;
        } catch (err) {
          if (attempt === MAX_ATTEMPTS) {
            log.warn(`Deferred async cleanup exhausted after ${MAX_ATTEMPTS} attempts for "${dirPath}": ${err.message}`);
            return;
          }
          await new Promise((r) => setTimeout(r, BASE_DELAY * attempt));
        }
      }
    })();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    validatePluginDir,

    /**
     * Install a plugin from a ZIP archive buffer.
     *
     * Steps:
     *   1. Extract ZIP to a temporary directory
     *   2. Validate manifest.json
     *   3. Move to plugins/<id>/
     *   4. Clean up temp directory
     *
     * @param {Buffer} zipBuffer  - Raw ZIP file data.
     * @returns {Promise<{ ok: true, pluginId: string, manifest: object } | { ok: false, error: string }>}
     */
    async installFromZip(zipBuffer) {
      let zip;
      try {
        zip = new AdmZip(zipBuffer);
      } catch (err) {
        return { ok: false, error: `Invalid ZIP file: ${err.message}` };
      }

      // List all entries to find manifest.json location.
      const entries = zip.getEntries();
      const manifestEntry = entries.find(
        (e) => !e.isDirectory && e.entryName.replace(/\\/g, '/') === 'manifest.json',
      );
      // Also check if manifest is in a subdirectory (e.g. "my-plugin/manifest.json").
      const manifestInSubdir = entries.find(
        (e) => !e.isDirectory && e.entryName.replace(/\\/g, '/').endsWith('/manifest.json'),
      );

      const targetEntry = manifestEntry || manifestInSubdir;

      if (!targetEntry) {
        return { ok: false, error: 'ZIP file does not contain manifest.json' };
      }

      // Determine the base directory inside the ZIP.
      const manifestPath = targetEntry.entryName.replace(/\\/g, '/');
      const baseDir = manifestPath === 'manifest.json'
        ? ''
        : manifestPath.slice(0, -'/manifest.json'.length);

      // Extract to a temp location to validate.
      const tempDir = join(pluginsDir, `.install-tmp-${Date.now()}`);
      try {
        zip.extractAllTo(tempDir, true);
      } catch (err) {
        // Cleanup on extraction failure.
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
        return { ok: false, error: `Failed to extract ZIP: ${err.message}` };
      }

      // The plugin content is either at tempDir or tempDir/baseDir.
      const pluginContentDir = baseDir ? join(tempDir, baseDir) : tempDir;

      // Validate the manifest.
      const validation = validatePluginDir(pluginContentDir);
      if (!validation.ok) {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
        return { ok: false, error: validation.error };
      }

      const { manifest } = validation;
      const pluginId = manifest.id;
      const targetDir = resolvePluginDir(pluginId);

      // Check if plugin already exists.
      if (existsSync(targetDir)) {
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
        return { ok: false, error: `Plugin "${pluginId}" already exists at ${targetDir}` };
      }

      // Move the plugin content to the target directory.
      try {
        // Ensure parent directory exists.
        mkdirSync(resolve(pluginsDir), { recursive: true });
        // Use rename for atomicity on same filesystem; fall back to copy+delete.
        try {
          cpSync(pluginContentDir, targetDir, { recursive: true });
        } catch (cpErr) {
          return { ok: false, error: `Failed to copy plugin: ${cpErr.message}` };
        }
      } finally {
        // Always clean up temp directory.
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
      }

      log.info(`Installed plugin from ZIP: ${pluginId} v${manifest.version}`);
      return { ok: true, pluginId, manifest };
    },

    /**
     * Install a plugin by copying a source directory.
     *
     * Steps:
     *   1. Validate the source directory has manifest.json
     *   2. Copy to plugins/<id>/
     *
     * @param {string} sourceDir  - Absolute path to the source plugin directory.
     * @returns {{ ok: true, pluginId: string, manifest: object } | { ok: false, error: string }}
     */
    async installFromDirectory(sourceDir) {
      // Validate source directory.
      if (!existsSync(sourceDir)) {
        return { ok: false, error: `Source directory does not exist: ${sourceDir}` };
      }

      const validation = validatePluginDir(sourceDir);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }

      const { manifest } = validation;
      const pluginId = manifest.id;
      const targetDir = resolvePluginDir(pluginId);

      // Check if plugin already exists.
      if (existsSync(targetDir)) {
        return { ok: false, error: `Plugin "${pluginId}" already exists at ${targetDir}` };
      }

      // Copy the source directory to the plugins directory.
      try {
        mkdirSync(resolve(pluginsDir), { recursive: true });
        cpSync(sourceDir, targetDir, { recursive: true });
      } catch (err) {
        return { ok: false, error: `Failed to copy plugin directory: ${err.message}` };
      }

      log.info(`Installed plugin from directory: ${pluginId} v${manifest.version}`);
      return { ok: true, pluginId, manifest };
    },

    /**
     * Remove a plugin's directory from the filesystem.
     *
     * Three-layer strategy (most robust first):
     *   1. Normal `rmSync` with retry — handles transient locks.
     *   2. Rename-and-defer-delete — Windows hack: locked files CAN be renamed
     *      even when they can't be deleted.  After rename the original path is
     *      freed immediately so reinstall can proceed; the renamed garbage is
     *      cleaned up asynchronously.
     *
     * @param {string} pluginId
     * @returns {{ ok: true } | { ok: false, error: string }}
     */
    remove(pluginId) {
      const targetDir = resolvePluginDir(pluginId);

      if (!existsSync(targetDir)) {
        return { ok: false, error: `Plugin directory not found: ${targetDir}` };
      }

      // ── Layer 1: Normal delete with retry ──────────────────────────────
      const ok = tryRemoveSync(targetDir, 5, 200);
      if (ok) {
        log.info(`Removed plugin directory: ${pluginId}`);
        return { ok: true };
      }

      // ── Layer 2: Rename-then-defer ─────────────────────────────────────
      // On Windows, locked files can't be deleted but CAN be renamed.
      // Rename frees the original path for reinstall immediately.
      const trashDir = targetDir + '.remove-' + Date.now();
      try {
        renameSync(targetDir, trashDir);
        log.info(`Renamed plugin directory to trash for deferred removal: ${pluginId} → ${trashDir}`);
      } catch (renameErr) {
        log.warn(`Failed to rename plugin directory for deferred removal: ${renameErr.message}`);
        return { ok: false, error: `Failed to remove plugin directory: all retries and rename exhausted` };
      }

      // Deferred async cleanup — fire and forget.
      removeAsync(trashDir);

      log.info(`Removed plugin directory (rename+defer): ${pluginId}`);
      return { ok: true };
    },
  };
}
