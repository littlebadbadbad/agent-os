/**
 * System-prompt guidance for the default-off tool model.
 *
 * Emitted by the ToolState ToolSet's `onGetSystemPrompt` followed by the
 * catalogue of currently-disabled tools (see toolSet.ts).
 */

export const TOOL_STATE_GUIDANCE = `## Tool Access (all tools disabled by default)

To save tokens and keep you focused on the task at hand, **every tool in this session starts disabled** and is hidden from your tool list. Only \`manage_tools\` is always available.

How to work with this:
1. Review the disabled-tool catalogue below — each entry is \`name — description\`.
2. Enable exactly the tools the current step needs: \`manage_tools({ enable: ["read_file", "git_status"] })\`.
3. Enabled tools appear in your tool list (with full schemas) on the next turn — call them normally.
4. When a phase of work is done, disable tools you no longer need: \`manage_tools({ disable: [...] })\` to keep the context lean.
5. Prefer enabling a small set per step over enabling everything at once.`;

/** Maximum characters of a tool description shown in the disabled catalogue. */
export const DESCRIPTION_LIMIT = 120;

/** Truncate a description for compact prompt listing. */
export function truncateDescription(desc: string): string {
  const flat = desc.replace(/\s+/g, ' ').trim();
  return flat.length > DESCRIPTION_LIMIT ? `${flat.slice(0, DESCRIPTION_LIMIT - 1)}…` : flat;
}
