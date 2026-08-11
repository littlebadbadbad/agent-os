/**
 * Tests for backend/lib/paths.js — filesystem path resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('paths (dev mode)', () => {
  let paths;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.UAP_EXE_DIR;
    delete process.env.UAP_IS_PACKAGED;
    delete process.env.UAP_NATIVE_ROOT;
    delete process.env.WORKSPACE_ROOT;
    paths = await import('../lib/paths.js');
  });

  it('IS_PKG is false in dev mode', () => {
    expect(paths.IS_PKG).toBe(false);
  });

  it('EXE_DIR is resolved in dev mode', () => {
    expect(paths.EXE_DIR).toBeTruthy();
    expect(typeof paths.EXE_DIR).toBe('string');
  });

  it('PROJECT_ROOT equals EXE_DIR in dev mode', () => {
    expect(paths.PROJECT_ROOT).toBe(paths.EXE_DIR);
  });

  it('DATA_ROOT is derived from PROJECT_ROOT', () => {
    expect(paths.DATA_ROOT).toContain('data');
  });

  it('AGENT_DIR is derived from PROJECT_ROOT', () => {
    expect(paths.AGENT_DIR).toContain('.agent');
  });

  it('RELEASE_APPS_DIR is defined in dev mode', () => {
    expect(paths.RELEASE_APPS_DIR).toBeTruthy();
    expect(paths.RELEASE_APPS_DIR).toContain('release');
  });

  it('WORKSPACE_ROOT falls back to default', () => {
    expect(paths.WORKSPACE_ROOT).toContain('workspace');
  });

  it('WORKSPACE_TMP contains tmp', () => {
    expect(paths.WORKSPACE_TMP).toContain('tmp');
  });

  it('STATIC_DIR contains dist-demo', () => {
    expect(paths.STATIC_DIR).toContain('dist-demo');
  });
});

describe('paths (env var overrides)', () => {
  let paths;
  const testRoot = process.cwd() + '\\backend\\__tests__\\fixtures\\workspace';

  beforeEach(async () => {
    vi.resetModules();
    process.env.WORKSPACE_ROOT = testRoot;
    delete process.env.UAP_EXE_DIR;
    delete process.env.UAP_IS_PACKAGED;
    delete process.env.UAP_NATIVE_ROOT;
    paths = await import('../lib/paths.js');
  });

  it('respects WORKSPACE_ROOT env var', () => {
    expect(paths.WORKSPACE_ROOT).toBe(testRoot);
  });
});
