/**
 * MCP Connection Lifecycle Manager
 *
 * Manages per-server MCP client connections: connect, disconnect, reconnect.
 * Delegates transport selection to the transport implementations.
 */

import { createStreamableHttpClient } from './transports/streamable-http.js';
import { createLegacySseClient } from './transports/legacy-sse.js';
import { createStdioClient } from './transports/stdio.js';

/**
 * @typedef {import('./config-store.js').ServerConfig} ServerConfig
 */

/**
 * @typedef {import('./transports/utils.js').ResourceDef} ResourceDef
 * @typedef {import('./transports/utils.js').ResourceTemplateDef} ResourceTemplateDef
 * @typedef {import('./transports/utils.js').ResourceReadResult} ResourceReadResult
 * @typedef {import('./transports/utils.js').PromptDef} PromptDef
 * @typedef {import('./transports/utils.js').PromptGetResult} PromptGetResult
 */

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {object} inputSchema
 */

/**
 * @typedef {object} ToolCallResult
 * @property {readonly {type:string,text?:string,data?:string,mimeType?:string,resource?:object}[]} content
 * @property {boolean} [isError]
 */

/**
 * @typedef {object} McpClient
 * @property {() => Promise<readonly ToolDef[]>} listTools
 * @property {(name:string, args:Record<string,unknown>) => Promise<ToolCallResult>} callTool
 * @property {() => Promise<readonly ResourceDef[]>} listResources
 * @property {() => Promise<readonly ResourceTemplateDef[]>} listResourceTemplates
 * @property {(uri:string) => Promise<ResourceReadResult>} readResource
 * @property {() => Promise<readonly PromptDef[]>} listPrompts
 * @property {(name:string, args?:Record<string,string>) => Promise<PromptGetResult>} getPrompt
 * @property {() => void} close
 */

/**
 * @typedef {object} ProxyConfig
 * @property {string} [host]
 * @property {number} [port]
 * @property {string} [protocol]
 * @property {string} [noProxy]
 * @property {number} [connectTimeout]
 */

/**
 * @typedef {object} ConnectionManager
 * @property {(cfg:ServerConfig) => Promise<readonly ToolDef[]>} connect
 * @property {(name:string) => void} disconnect
 * @property {(name:string) => readonly ToolDef[]} getTools
 * @property {(name:string) => boolean} isConnected
 * @property {(serverName:string, toolName:string, args:Record<string,unknown>) => Promise<ToolCallResult>} callTool
 * @property {(name:string) => Promise<readonly ResourceDef[]>} listResources
 * @property {(name:string) => Promise<readonly ResourceTemplateDef[]>} listResourceTemplates
 * @property {(name:string, uri:string) => Promise<ResourceReadResult>} readResource
 * @property {(name:string) => Promise<readonly PromptDef[]>} listPrompts
 * @property {(name:string, promptName:string, args?:Record<string,string>) => Promise<PromptGetResult>} getPrompt
 * @property {() => void} shutdown
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  Logger
// ═══════════════════════════════════════════════════════════════════════════════

const log = {
  info: (msg) => console.log(`[mcp] ${msg}`),
  error: (msg, detail) => console.error(`[mcp] ${msg}${detail ? ': ' + detail : ''}`),
  ok: (msg) => console.log(`[mcp] ${msg}`),
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Factory
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a connection manager that tracks MCP client instances keyed by server name.
 *
 * @param {ProxyConfig|null} proxyConfig - Global proxy configuration.
 * @param {() => (import('@agent-type/services').TerminalService | undefined)} [getTerminalService] - Lazy resolver for the terminal cross-plugin service.
 * @returns {ConnectionManager}
 */
export function createConnectionManager(proxyConfig = null, getTerminalService = undefined) {
  /** @type {Map<string, McpClient>} */
  const clients = new Map();

  /** @type {Map<string, readonly ToolDef[]>} */
  const toolsByServer = new Map();

  /**
   * Connect to an MCP server. Tears down any existing connection first.
   *
   * @param {ServerConfig} cfg
   * @returns {Promise<readonly ToolDef[]>}
   */
  async function connect(cfg) {
    const name = cfg.name;

    // Tear down existing connection
    if (clients.has(name)) {
      try { clients.get(name).close(); } catch { /* ignore */ }
      clients.delete(name);
      toolsByServer.delete(name);
    }

    log.info(`connecting to MCP server "${name}" (${cfg.transport}) \u2192 ${cfg.url}`);

    const transportOpts = {
      useProxy: cfg.useProxy === true,
      proxyConfig: /** @type {import('./transports/utils.js').ProxyConfig} */ (proxyConfig),
    };

    /** @type {McpClient} */
    let client;
    switch (cfg.transport) {
      case 'streamable-http':
        client = await createStreamableHttpClient(cfg.url, cfg.headers, transportOpts);
        break;
      case 'legacy-sse':
        client = await createLegacySseClient(cfg.url, cfg.headers, transportOpts);
        break;
      case 'stdio': {
        const terminalService = typeof getTerminalService === 'function' ? getTerminalService() : undefined;
        if (!terminalService) {
          throw new Error('stdio transport requires TerminalService — ensure the terminal plugin is enabled');
        }
        client = await createStdioClient(cfg.url, terminalService);
        break;
      }
      default:
        throw new Error(`Unknown transport: ${cfg.transport}`);
    }

    /** @type {readonly ToolDef[]} */
    let tools = await client.listTools();

    // Apply tool whitelist if configured
    if (cfg.includeTools && cfg.includeTools.length > 0) {
      const allow = new Set(cfg.includeTools);
      tools = tools.filter((t) => allow.has(t.name));
    }

    clients.set(name, client);
    toolsByServer.set(name, tools);
    log.ok(`"${name}" connected \u2014 ${tools.length} tool(s) available`);

    return tools;
  }

  /**
   * Disconnect a server by name.
   * @param {string} name
   */
  function disconnect(name) {
    if (clients.has(name)) {
      try { clients.get(name).close(); } catch { /* ignore */ }
      clients.delete(name);
      toolsByServer.delete(name);
      log.info(`"${name}" disconnected`);
    }
  }

  /**
   * Get cached tools for a server.
   * @param {string} name
   * @returns {readonly ToolDef[]}
   */
  function getTools(name) {
    return toolsByServer.get(name) ?? [];
  }

  /**
   * Check if a server is connected.
   * @param {string} name
   * @returns {boolean}
   */
  function isConnected(name) {
    return clients.has(name);
  }

  /**
   * Execute a tool call on a connected server.
   * @param {string} serverName
   * @param {string} toolName
   * @param {Record<string,unknown>} args
   * @returns {Promise<ToolCallResult>}
   */
  async function callTool(serverName, toolName, args) {
    const client = clients.get(serverName);
    if (!client) {
      throw new Error(
        `MCP server "${serverName}" is not connected. Use connect_mcp_server to connect first.`,
      );
    }
    return client.callTool(toolName, args);
  }

  /**
   * List all resources from a connected server.
   * @param {string} serverName
   * @returns {Promise<readonly ResourceDef[]>}
   */
  async function listResources(serverName) {
    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    return client.listResources();
  }

  /**
   * List all resource templates from a connected server.
   * @param {string} serverName
   * @returns {Promise<readonly ResourceTemplateDef[]>}
   */
  async function listResourceTemplates(serverName) {
    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    return client.listResourceTemplates();
  }

  /**
   * Read a resource by URI from a connected server.
   * @param {string} serverName
   * @param {string} uri
   * @returns {Promise<ResourceReadResult>}
   */
  async function readResource(serverName, uri) {
    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    return client.readResource(uri);
  }

  /**
   * List all prompts from a connected server.
   * @param {string} serverName
   * @returns {Promise<readonly PromptDef[]>}
   */
  async function listPrompts(serverName) {
    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    return client.listPrompts();
  }

  /**
   * Get a prompt by name with optional arguments from a connected server.
   * @param {string} serverName
   * @param {string} promptName
   * @param {Record<string,string>} [args]
   * @returns {Promise<PromptGetResult>}
   */
  async function getPrompt(serverName, promptName, args) {
    const client = clients.get(serverName);
    if (!client) throw new Error(`MCP server "${serverName}" is not connected.`);
    return client.getPrompt(promptName, args);
  }

  /**
   * Shut down all connections.
   */
  function shutdown() {
    for (const [name] of clients) {
      disconnect(name);
    }
    log.info('MCP connection manager shut down');
  }

  return {
    connect,
    disconnect,
    getTools,
    isConnected,
    callTool,
    listResources,
    listResourceTemplates,
    readResource,
    listPrompts,
    getPrompt,
    shutdown,
  };
}
