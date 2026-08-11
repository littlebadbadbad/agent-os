/**
 * agent-UI/store/sessionStore.ts — Session persistence via core app API
 *
 * PURE BUSINESS LOGIC — ZERO direct transport calls.
 * Delegated to the super built-in "sessions" app client.
 */

export { loadSessions, saveSessions } from '../app/core/sessions';
