/**
 * agent-UI/transport/index.ts — Transport layer barrel
 *
 * Exports chat transport only. API transport has been replaced by the
 * super built-in plugin system (agent-UI/plugin/core/) — all API calls
 * now go through PluginApiClient (dual HTTP/IPC transport).
 *
 * The chat transport itself now delegates to the super built-in "chat"
 * plugin client — no direct fetch() or electronAPI calls.
 */

export { chatTransport } from './chatTransport';
export type { ChatTransport, ChatParams } from './chatTransport';
