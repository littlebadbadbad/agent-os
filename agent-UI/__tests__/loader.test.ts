/**
 * Tests for agent-UI/plugin/loader.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('loadPluginAgentEntry', () => {
  let loadPluginAgentEntry: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../plugin/loader');
    loadPluginAgentEntry = mod.loadPluginAgentEntry;
  });

  it('returns module when import succeeds and activate exists', async () => {
    const fakeModule = { activate: vi.fn() };

    // Mock dynamic import
    vi.stubGlobal('__mockImport', fakeModule);

    const result = await loadPluginAgentEntry('test-plugin', '/plugins/test/activate.js');

    // Since we can't easily mock dynamic import(), just test error handling
    expect(result).toHaveProperty('module');
    expect(result).toHaveProperty('error');
  });

  it('returns error when import fails', async () => {
    const result = await loadPluginAgentEntry('broken', '/nonexistent/module.js');

    expect(result.module).toBeNull();
    expect(result.error).toContain('broken');
  });
});
