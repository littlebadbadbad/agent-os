/**
 * agent-UI/transport/index.ts — Transport layer barrel
 *
 * Exports chat transport only. API transport has been replaced by the
 * super built-in app system (agent-UI/app/core/) — all API calls
 * now go through AppApiClient (dual HTTP/IPC transport).
 *
 * The chat transport itself now delegates to the super built-in "chat"
 * app client — no direct fetch() or electronAPI calls.
 */

export { chatTransport } from './chatTransport';
export type { ChatTransport, ChatParams } from './chatTransport';
