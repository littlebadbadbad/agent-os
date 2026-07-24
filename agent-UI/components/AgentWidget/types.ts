/**
 * Backward-compatible re-export.
 *
 * `Message` was moved to `@agent-sdk/utils/shared` to eliminate the
 * SDK-core → UI-layer dependency.  This file now re-exports from there
 * so existing imports from `../types` continue to work without changes.
 */

export type { Attachment } from '@agent-type';
export type { ToolCallStatus, ToolCallInfo } from '@agent-type';
export type { Message } from '@agent-sdk/utils/shared';
