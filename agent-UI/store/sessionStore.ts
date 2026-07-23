/**
 * agent-UI/store/sessionStore.ts — Session persistence via core plugin API
 *
 * PURE BUSINESS LOGIC — ZERO direct transport calls.
 * Delegated to the super built-in "sessions" plugin client.
 */

export { loadSessions, saveSessions } from '../plugin/core/sessions';
