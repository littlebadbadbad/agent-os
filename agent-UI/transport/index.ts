/**
 * agent-UI/transport/index.ts — Transport layer barrel
 *
 * Exports all transport interfaces, implementations, and factory functions.
 * Components and handlers import from here instead of calling fetch() or
 * window.electronAPI directly, keeping communication fully separated from
 * business logic.
 */

export { apiTransport } from './apiTransport';
export type { ApiTransport, AdoProxyParams, AdoProxyUploadParams } from './apiTransport';

export { chatTransport } from './chatTransport';
export type { ChatTransport, ChatParams } from './chatTransport';
