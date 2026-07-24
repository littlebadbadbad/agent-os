/**
 * Tests for agent-UI/plugin/pluginTypes.ts
 */

import { describe, it, expect } from 'vitest';
import { toPluginDescriptor } from '../plugin/pluginTypes';
import type { PluginInfo } from '../plugin/pluginTypes';

describe('toPluginDescriptor', () => {
  it('converts PluginInfo to PluginDescriptor with empty symbols', () => {
    const info: PluginInfo = {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0',
      description: 'A test plugin',
      state: 'active',
      builtIn: true,
      canDisable: true,
      hasAgentEntry: true,
      agentEntryUrl: '/plugins/test/activate.js',
      hasUiEntry: false,
    };

    const desc = toPluginDescriptor(info);

    expect(desc.id).toBe('test-plugin');
    expect(desc.name).toBe('Test');
    expect(desc.version).toBe('1.0');
    expect(desc.description).toBe('A test plugin');
    expect(desc.state).toBe('active');
    expect(desc.builtIn).toBe(true);
    expect(desc.canDisable).toBe(true);
    expect(desc.hasAgentEntry).toBe(true);
    expect(desc.agentEntryUrl).toBe('/plugins/test/activate.js');
    expect(desc.hasUiEntry).toBe(false);
    expect(desc.symbols).toEqual([]);
  });

  it('handles minimal descriptor (only required fields)', () => {
    const info: PluginInfo = {
      id: 'minimal',
      name: 'Minimal',
      version: '0.1',
      state: 'disabled',
      hasAgentEntry: false,
      hasUiEntry: false,
    };

    const desc = toPluginDescriptor(info);

    expect(desc.id).toBe('minimal');
    expect(desc.name).toBe('Minimal');
    expect(desc.symbols).toEqual([]);
    expect(desc.description).toBeUndefined();
    expect(desc.agentEntryUrl).toBeUndefined();
  });
});
