/**
 * agent-UI/app/index.ts — App runtime barrel export
 *
 * Re-exports all public types and factories from the app runtime.
 * Consumers import from this module, never from individual files.
 *
 * Usage:
 *   import { createAppSystem } from '../app';
 *   const system = createAppSystem();
 *   await system.init(agentContext);
 */

export { createAppApiClient } from './apiClient';
export type { AppApiClientOptions, AppApiError } from './apiClient';

export { createAppConfigClient } from './configClient';
export type { AppConfigClient } from './configClient';

export { loadAppAgentEntry } from './loader';
export type { AppAgentModule, AppLoadResult } from './loader';

export { createAgentAppHost } from './host';
export type { AgentAppContext, AgentAppHostParams } from './host';

export { createAppSystem } from './appSystem';
export type { AppSystem, AppDescriptor, ActivatedAppInfo, AppLoadError } from './appTypes';

export { createUiAppHost } from './uiHost';
export type { UiAppHostParams } from './uiHost';
