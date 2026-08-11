/**
 * Tests for agent-UI/app/appTypes.ts
 */

import { describe, it, expect } from 'vitest';
import { toAppDescriptor } from '../app/appTypes';
import type { AppInfo } from '../app/appTypes';

describe('toAppDescriptor', () => {
  it('converts AppInfo to AppDescriptor with empty symbols', () => {
    const info: AppInfo = {
      id: 'test-app',
      name: 'Test',
      version: '1.0',
      description: 'A test app',
      state: 'active',
      builtIn: true,
      canDisable: true,
      hasAgentEntry: true,
      agentEntryUrl: '/agent-apps/test/activate.js',
      hasUiEntry: false,
    };

    const desc = toAppDescriptor(info);

    expect(desc.id).toBe('test-app');
    expect(desc.name).toBe('Test');
    expect(desc.version).toBe('1.0');
    expect(desc.description).toBe('A test app');
    expect(desc.state).toBe('active');
    expect(desc.builtIn).toBe(true);
    expect(desc.canDisable).toBe(true);
    expect(desc.hasAgentEntry).toBe(true);
    expect(desc.agentEntryUrl).toBe('/agent-apps/test/activate.js');
    expect(desc.hasUiEntry).toBe(false);
    expect(desc.symbols).toEqual([]);
  });

  it('handles minimal descriptor (only required fields)', () => {
    const info: AppInfo = {
      id: 'minimal',
      name: 'Minimal',
      version: '0.1',
      state: 'disabled',
      hasAgentEntry: false,
      hasUiEntry: false,
    };

    const desc = toAppDescriptor(info);

    expect(desc.id).toBe('minimal');
    expect(desc.name).toBe('Minimal');
    expect(desc.symbols).toEqual([]);
    expect(desc.description).toBeUndefined();
    expect(desc.agentEntryUrl).toBeUndefined();
  });
});
