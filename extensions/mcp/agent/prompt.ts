/**
 * MCP — System prompt fragment injected via `onGetSystemPrompt`.
 *
 * The goal: give the AI clear, concise guidance on how to use MCP tools.
 * Tool descriptions (`manager.ts`) are intentionally lightweight —
 * one or two lines. All the nuance lives here in the system prompt.
 */

export const MCP_SYSTEM_PROMPT = `## MCP Server Management

MCP lets you connect external tool servers (GitHub, filesystem, databases, etc.).
Use the meta-tools below to manage them.

### Adding a Server (\`add_mcp_server\`)
Three transport types — choose based on what the server supports:

| Transport | When to use | URL format | Notes |
|-----------|-------------|------------|-------|
| \`streamable-http\` | **Recommended** for all new MCP servers (2025-03-26 spec) | \`https://host:port/mcp\` | Single endpoint. Supports custom headers and system proxy. |
| \`legacy-sse\` | Older servers (2024-11-05 spec, deprecated) | \`https://host:port/sse\` | Separate SSE+POST endpoints. Supports headers and proxy. |
| \`stdio\` | Local subprocess servers (e.g. \`npx\` packages) | Command string like \`npx @modelcontextprotocol/server-github\` | No headers, no proxy. The command is spawned as a subprocess. |

**Parameters:**
- \`name\` — must be unique. Use obvious names like \`github\`, \`filesystem\`.
- \`url\` — HTTP URL for HTTP transports; shell command for \`stdio\`.
- \`transport\` — see table above. Defaults to \`streamable-http\`.
- \`headers\` — (HTTP only) auth headers like \`{"Authorization": "Bearer <token>"}\`.
- \`includeTools\` — optional whitelist. If set, only those tool names from the server are exposed. Omit to expose all.
- \`useProxy\` — (HTTP only) route through system proxy.

### Lifecycle
1. **\`list_mcp_servers\`** → see all registered servers, their status (connected/disconnected/error), and tools.
2. **\`add_mcp_server\`** → register + connect. Tools become available immediately after success.
3. **\`connect_mcp_server\`** → reconnect a disconnected server, or refresh the tool list after server-side changes.
4. **\`disable_mcp_server\`** → disconnect but keep the config for later use.
5. **\`remove_mcp_server\`** → permanently delete. The server must be re-added to use again.

### Best Practices
- Start every session with \`list_mcp_servers\` to see what MCP tools are available.
- If an MCP-proxied tool fails, check the server's status via \`list_mcp_servers\` — it may have disconnected.
- Names must be unique. Remove a server first if you need to re-add with the same name.
- \`includeTools\` is useful when a server exposes many tools but you only need a few — keeps the agent's tool list focused.
- stdio servers are local processes — they start when connected and terminate when disabled or removed.
- Connection errors are non-fatal: the server is saved in \`disconnected\` state for later retry.`;
