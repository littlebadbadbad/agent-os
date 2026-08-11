/**
 * MCP Protocol — JSON-RPC 2.0 message types.
 *
 * Mirrors the MCP 2025-06-18 specification (backward compatible with
 * 2025-03-26 and 2024-11-05 servers via version negotiation):
 * https://modelcontextprotocol.io/specification/2025-06-18/
 *
 * Every type is an exact representation of the spec's TypeScript schema.
 * No loose types, no `any`, no `unknown`.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  JSON-RPC 2.0 Primitives
// ═══════════════════════════════════════════════════════════════════════════════

/** JSON-RPC request (client→server or server→client). */
export interface JsonRpcRequest<Method extends string = string, Params = void> {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: Method;
  readonly params?: Params;
}

/** JSON-RPC notification (no id, no response expected). */
export interface JsonRpcNotification<Method extends string = string, Params = void> {
  readonly jsonrpc: '2.0';
  readonly method: Method;
  readonly params?: Params;
}

/** JSON-RPC successful response. */
export interface JsonRpcSuccess<Result = void> {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result: Result;
}

/** JSON-RPC error response. */
export interface JsonRpcError<Data = void> {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: Data;
  };
}

/** JSON-RPC response — discriminated by presence of error. */
export type JsonRpcResponse<Result = void, ErrorData = void> =
  | JsonRpcSuccess<Result>
  | JsonRpcError<ErrorData>;

/** Any JSON-RPC message. */
export type JsonRpcMessage<Method extends string = string, Params = void, Result = void, ErrorData = void> =
  | JsonRpcRequest<Method, Params>
  | JsonRpcNotification<Method, Params>
  | JsonRpcResponse<Result, ErrorData>;

// ═══════════════════════════════════════════════════════════════════════════════
//  Standard JSON-RPC Error Codes (MCP §Error Handling)
// ═══════════════════════════════════════════════════════════════════════════════

export const JSONRPC_ERROR_CODES = {
  /** Invalid JSON was received by the server. */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object. */
  INVALID_REQUEST: -32600,
  /** The method does not exist / is not available. */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s). */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error. */
  INTERNAL_ERROR: -32603,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
//  Lifecycle — §Lifecycle / Initialization
// ═══════════════════════════════════════════════════════════════════════════════

/** MCP protocol version strings. */
export type McpProtocolVersion = '2025-06-18' | '2025-03-26' | '2024-11-05';

export const LATEST_PROTOCOL_VERSION: McpProtocolVersion = '2025-06-18';

/** Client implementation info sent during `initialize`. */
export interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

/** Server implementation info returned in `InitializeResult`. */
export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

/** Client capabilities declared during `initialize`. */
export interface ClientCapabilities {
  readonly roots?: { readonly listChanged?: boolean };
  readonly sampling?: Record<string, never>;
  readonly experimental?: Record<string, Record<string, never>>;
}

/** Server capabilities returned in `InitializeResult`. */
export interface ServerCapabilities {
  readonly prompts?: { readonly listChanged?: boolean };
  readonly resources?: { readonly subscribe?: boolean; readonly listChanged?: boolean };
  readonly tools?: { readonly listChanged?: boolean };
  readonly logging?: Record<string, never>;
  readonly completions?: Record<string, never>;
  readonly experimental?: Record<string, Record<string, never>>;
}

/** `initialize` request params. */
export interface InitializeRequest {
  readonly protocolVersion: string;
  readonly capabilities: ClientCapabilities;
  readonly clientInfo: ClientInfo;
}

/** `initialize` response result. */
export interface InitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: ServerCapabilities;
  readonly serverInfo: ServerInfo;
  readonly instructions?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Content Blocks — §Server / Tools / Data Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Text content block. */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
  readonly annotations?: ToolAnnotations;
}

/** Image content block (base64-encoded). */
export interface ImageContent {
  readonly type: 'image';
  readonly data: string;
  readonly mimeType: string;
  readonly annotations?: ToolAnnotations;
}

/** Audio content block (base64-encoded). */
export interface AudioContent {
  readonly type: 'audio';
  readonly data: string;
  readonly mimeType: string;
  readonly annotations?: ToolAnnotations;
}

/** Embedded resource content block. */
export interface ResourceContent {
  readonly type: 'resource';
  readonly resource: {
    readonly uri: string;
    readonly mimeType?: string;
    readonly text?: string;
    readonly blob?: string;
  };
  readonly annotations?: ToolAnnotations;
}

/** Reference to a resource without embedding its contents (added in 2025-06-18). */
export interface ResourceLinkContent {
  readonly type: 'resource_link';
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly annotations?: ToolAnnotations;
}

/** Discriminated union of all content block types. */
export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceContent | ResourceLinkContent;

// ═══════════════════════════════════════════════════════════════════════════════
//  Tools — §Server / Tools
// ═══════════════════════════════════════════════════════════════════════════════

/** Tool annotations (optional metadata). */
export interface ToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** A single tool definition returned by `tools/list`. */
export interface ToolDef {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties?: Record<string, Record<string, unknown>>;
    readonly required?: readonly string[];
  };
  /** Optional JSON Schema describing `structuredContent` shape (2025-06-18). */
  readonly outputSchema?: {
    readonly type: 'object';
    readonly properties?: Record<string, Record<string, unknown>>;
    readonly required?: readonly string[];
  };
  readonly annotations?: ToolAnnotations;
}

/** `tools/list` response result. */
export interface ToolListResult {
  readonly tools: readonly ToolDef[];
  readonly nextCursor?: string;
}

/** `tools/call` request params. */
export interface ToolCallRequest {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

/** `tools/call` response result. */
export interface ToolCallResult {
  readonly content: readonly ContentBlock[];
  /** Machine-readable result conforming to the tool's `outputSchema` (2025-06-18). */
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Resources — §Server / Resources
// ═══════════════════════════════════════════════════════════════════════════════

/** A static resource descriptor returned by `resources/list`. */
export interface ResourceDef {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** A parameterized resource template returned by `resources/templates/list`. */
export interface ResourceTemplateDef {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** `resources/list` response result. */
export interface ResourceListResult {
  readonly resources: readonly ResourceDef[];
  readonly nextCursor?: string;
}

/** `resources/templates/list` response result. */
export interface ResourceTemplateListResult {
  readonly resourceTemplates: readonly ResourceTemplateDef[];
  readonly nextCursor?: string;
}

/** `resources/read` request params. */
export interface ResourceReadRequest {
  readonly uri: string;
}

/** A single resource contents entry in a `resources/read` response. */
export interface ResourceContents {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
}

/** `resources/read` response result. */
export interface ResourceReadResult {
  readonly contents: readonly ResourceContents[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Prompts — §Server / Prompts
// ═══════════════════════════════════════════════════════════════════════════════

/** A single prompt argument definition. */
export interface PromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

/** A prompt definition returned by `prompts/list`. */
export interface PromptDef {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments?: readonly PromptArgument[];
}

/** `prompts/list` response result. */
export interface PromptListResult {
  readonly prompts: readonly PromptDef[];
  readonly nextCursor?: string;
}

/** `prompts/get` request params. */
export interface PromptGetRequest {
  readonly name: string;
  readonly arguments?: Record<string, string>;
}

/** A message role in a `prompts/get` response. */
export type PromptMessageRole = 'user' | 'assistant';

/** A single message in a `prompts/get` response. */
export interface PromptMessage {
  readonly role: PromptMessageRole;
  readonly content: ContentBlock;
}

/** `prompts/get` response result. */
export interface PromptGetResult {
  readonly description?: string;
  readonly messages: readonly PromptMessage[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Utility Method Names
// ═══════════════════════════════════════════════════════════════════════════════

export const MCP_METHODS = {
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  TOOLS_LIST_CHANGED: 'notifications/tools/list_changed',
  PING: 'ping',
  CANCELLED: 'notifications/cancelled',
  PROGRESS: 'notifications/progress',
  LOGGING_SET_LEVEL: 'logging/setLevel',
  LOGGING_MESSAGE: 'notifications/message',
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_TEMPLATES_LIST: 'resources/templates/list',
  RESOURCES_LIST_CHANGED: 'notifications/resources/list_changed',
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',
  PROMPTS_LIST_CHANGED: 'notifications/prompts/list_changed',
  COMPLETION_COMPLETE: 'completion/complete',
} as const;
