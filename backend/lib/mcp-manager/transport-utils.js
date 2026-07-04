/**
 * Shared utilities for MCP transport implementations.
 */

/** MCP client identity advertised during the initialize handshake. */
export const CLIENT_INFO = { name: 'agent-sdk-backend', version: '0.1.0' };

/** Normalise an MCP tool-result payload to a plain string. */
export function serializeToolResult(result) {
  const text = (result.content ?? [])
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[image/${part.mimeType}]`;
      return JSON.stringify(part.resource);
    })
    .join('\n');
  return result.isError ? `[Tool error]\n${text}` : text;
}
