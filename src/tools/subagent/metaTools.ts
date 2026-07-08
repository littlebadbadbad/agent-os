/**
 * Re-export shim for backward compatibility.
 *
 * The sub-agent ToolSet has been refactored into multiple smaller modules:
 *   - subAgentToolset.ts   — main factory
 *   - subAgentCrudTools.ts — CRUD tool definitions
 *   - subAgentConvTools.ts — conversation I/O tool definitions
 *   - subAgentHelpers.ts   — shared utility functions
 *
 * All public API is exported from `./subAgentToolset`.
 *
 * @deprecated Import from `./subAgentToolset` or `@agent-sdk` directly.
 */

export { createSubAgentToolset } from './subAgentToolset';
