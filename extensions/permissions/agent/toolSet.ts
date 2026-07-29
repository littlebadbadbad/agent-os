import type { ToolSet } from "@agent-type";

export function createPermissionsToolSet(
): ToolSet {
  return {
    name: "permissions",
    description: "Tool permission checking",
    tools: [],
  };
}
