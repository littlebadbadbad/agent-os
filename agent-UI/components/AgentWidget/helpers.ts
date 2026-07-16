/**
 * Backward-compatible re-export.
 *
 * These utilities were moved to `@agent-sdk/utils/shared` to eliminate the
 * SDK-core → UI-layer dependency.  This file now delegates there so existing
 * imports from `../helpers` continue to work without changes.
 */

export { createId, assistantMsg, toolMsg } from '@agent-sdk/utils/shared';
export type { Message, ToolCallInfo } from '@agent-sdk/utils/shared';
