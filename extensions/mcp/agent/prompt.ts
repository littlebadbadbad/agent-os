/**
 * Enhanced prompt descriptions for the MCP ToolSet.
 *
 * Each description follows a uniform structure:
 *   1. **Summary** — one-line purpose statement.
 *   2. **When to use** — concrete scenarios where this tool is the right choice.
 *   3. **Behavior notes** — subtle details, defaults, edge cases, and gotchas.
 *
 * Import these constants from ToolSet implementations that compose the
 * system prompt via `ToolSet.onGetSystemPrompt`.
 *
 * @module
 */

import type { SectionId } from '@agent-type';

// ── Section identifier ────────────────────────────────────────────────────────

/**
 * Section ID for the MCP system-prompt section.
 * Registered in `SECTION_IDS` so that `SectionId` resolves to it.
 */
export const MCP_SECTION_ID: SectionId = 'mcp';

// ── Tool descriptions ─────────────────────────────────────────────────────────

/**
 * `list_mcp_servers` — list all registered MCP servers.
 *
 * **Summary**
 * Returns every MCP server known to the session, along with its connection
 * status, transport type, and the list of tools it exposes.
 *
 * **When to use**
 * - At the start of a session to discover which MCP-powered tools are
 *   already available.
 * - Before calling a tool from an MCP server — confirm the server is
 *   connected and the tool name is in its list.
 * - After adding, connecting, or disabling a server to verify the
 *   operation succeeded.
 * - To inspect error messages on servers that failed to connect.
 *
 * **Behavior notes**
 * - Results are refreshed from the backend on every call, so the returned
 *   state is always current.
 * - Servers that are `enabled: false` are registered but not connected.
 *   Call `connect_mcp_server` to activate them.
 * - The `toolCount` and `tools` fields reflect what is currently
 *   registered on the agent — only connected servers contribute tools.
 * - An `errorMsg` field is present when the server is in an error state
 *   (e.g. connection refused, invalid URL, auth failure).
 */
export const MCP_LIST_DESCRIPTION =
  'List all registered MCP servers with their connection status, transport type, and available tools. ' +
  'Use this first to see what MCP-powered tools are available before calling them. ' +
  'Refreshes from the backend on every call. ' +
  'Check `errorMsg` for servers in an error state and `status` to see if a server is connected.';

/**
 * `add_mcp_server` — register and connect a new MCP server.
 *
 * **Summary**
 * Adds a new MCP server configuration, connects to it, and registers its
 * tools on the agent — making them immediately available for use.
 *
 * **When to use**
 * - When you need to use a new MCP server that is not yet registered.
 * - When configuring the session with external tooling (GitHub MCP,
 *   filesystem MCP, database MCP, etc.).
 *
 * **Behavior notes**
 * - Supports two transport protocols:
 *   - **`http`** (recommended) — MCP 2025-03-26 Streamable HTTP. Simpler,
 *     single-persistent-connection model.
 *   - **`sse`** (legacy) — MCP 2024-11-05 Server-Sent Events. Older
 *     protocol, prefer `http` for new servers.
 * - The `headers` parameter allows passing authentication or custom
 *   headers, e.g. `{ "Authorization": "Bearer <token>" }`.
 * - The `includeTools` parameter acts as a whitelist: if set, only the
 *   named tools from that server are exposed. Omit to expose all tools.
 * - If the server fails to connect (wrong URL, auth error, network
 *   unreachable), the response includes `ok: false` and the error
 *   message — the server entry is still saved in a `disconnected` state
 *   so you can retry with `connect_mcp_server`.
 * - Server names must be unique — adding a duplicate name will fail.
 */
export const MCP_ADD_DESCRIPTION =
  'Register a new MCP server and connect to it so its tools are immediately available. ' +
  'Use transport "http" for MCP 2025-03-26 Streamable HTTP servers (recommended). ' +
  'Use "sse" for legacy 2024-11-05 SSE servers. ' +
  'Supports custom headers for authentication. ' +
  'Optional includeTools whitelist to expose only specific tools from the server. ' +
  'If connection fails, the server is saved in disconnected state for later retry.';

/**
 * `remove_mcp_server` — disconnect and permanently remove an MCP server.
 *
 * **Summary**
 * Removes the server configuration entirely: disconnects, unregisters
 * all its proxy tools from the agent, and deletes its entry.
 *
 * **When to use**
 * - When an MCP server is no longer needed and should be permanently
 *   cleaned up.
 * - Before adding a server with the same name but different configuration
 *   (add will fail on duplicate names — remove first).
 *
 * **Behavior notes**
 * - This is a destructive operation — the server configuration is gone
 *   and must be re-added with `add_mcp_server` to use it again.
 * - All proxy tools registered by this server are immediately removed
 *   from the agent. Calls to those tools will fail after removal.
 * - If the server is currently connected, it is disconnected gracefully
 *   before removal.
 * - Returns `ok: false` with an error if the server name is not found.
 */
export const MCP_REMOVE_DESCRIPTION =
  'Disconnect and permanently remove an MCP server. All its tools are removed from the agent. ' +
  'The server must be re-added with add_mcp_server to use it again. ' +
  'Use this for cleanup when a server is no longer needed, or before re-adding with different settings.';

/**
 * `connect_mcp_server` — connect (or reconnect) to a registered MCP server.
 *
 * **Summary**
 * Activates a registered but disconnected MCP server, registering its
 * tools on the agent. Also use this to reload tools after a server has
 * added or removed tools on its end.
 *
 * **When to use**
 * - To activate a server that was added but is in `disconnected` state.
 * - To re-enable a server that was disabled with `disable_mcp_server`.
 * - To refresh the tool list from a server that may have updated its
 *   capabilities since the last connection.
 *
 * **Behavior notes**
 * - The server must already be registered (use `add_mcp_server` first or
 *   check with `list_mcp_servers`).
 * - If the server is already connected, calling this will reconnect and
 *   refresh the tool list — useful after a server-side tool update.
 * - On success, the response includes the updated tool count from the
 *   server.
 * - If the connection fails (server offline, auth expired, etc.), the
 *   server stays in `disconnected` state and the error is returned.
 */
export const MCP_CONNECT_DESCRIPTION =
  'Connect (or reconnect) to a registered MCP server and activate its tools. ' +
  'Also use this to reload the tool list after the server adds or removes tools. ' +
  'The server must already be registered (use add_mcp_server first). ' +
  'If already connected, reconnects and refreshes the tool list.';

/**
 * `disable_mcp_server` — disconnect from an MCP server (keep registration).
 *
 * **Summary**
 * Disconnects from a server and removes its proxy tools from the agent,
 * but keeps the server registration so it can be reconnected later.
 *
 * **When to use**
 * - When you want to temporarily remove a server's tools from the agent
 *   without deleting the configuration.
 * - To free up tool-naming space or reduce agent confusion when many
 *   MCP servers are registered.
 *
 * **Behavior notes**
 * - Unlike `remove_mcp_server`, the server entry is preserved in
 *   `disconnected` state. Call `connect_mcp_server` to re-enable.
 * - All proxy tools from this server are immediately removed from the
 *   agent — they will not appear in tool lists or be callable.
 * - If the server is already disconnected, calling this is a no-op
 *   (returns success without action).
 * - Returns `ok: false` with an error if the server name is not found.
 */
export const MCP_DISABLE_DESCRIPTION =
  'Disconnect from an MCP server and remove its tools (keeps the server registered for later re-connection). ' +
  'Use connect_mcp_server to re-enable. ' +
  'Unlike remove_mcp_server, the server configuration is preserved. ' +
  'Use this to temporarily hide a server\'s tools without losing the setup.';
