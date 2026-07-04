// ── Dynamic tool entry (what the backend stores) ──────────────────────────────

export type DynamicToolRuntime = 'backend' | 'frontend';

export type DynamicToolEntry = {
  name: string;
  description: string;
  /** JSON Schema object with `"type":"object"` */
  parameters: Record<string, unknown>;
  runtime: DynamicToolRuntime;
  implementation: string;
  createdAt?: string;
  updatedAt?: string;
};

// ── Shared module entry ───────────────────────────────────────────────────────

/**
 * A reusable ESM module that backend tool scripts can import via
 * `import { x } from '#modules/<name>'`.
 */
export type DynamicModuleEntry = {
  name: string;
  description: string;
  /** Full `.mjs` source content — only present in single-item GET responses. */
  content?: string;
  createdAt?: string;
  updatedAt?: string;
};

// ── npm dependency info ───────────────────────────────────────────────────────

export type DependencyInfo = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export type InstallDepsResult = {
  success: boolean;
  packages: string[];
  output: string;
};

export type RemoveDepResult = {
  success: boolean;
  output: string;
};

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Plug-in contract for the dynamic-tool backend.
 *
 * The default HTTP implementation talks to the Agent SDK backend's REST API.
 * Swap it for a test double or alternative persistence layer without touching
 * the toolset logic.
 */
export type DynamicToolAdapter = {
  // ── Tool CRUD ──────────────────────────────────────────────────────────────

  /** Return all persisted dynamic-tool definitions. */
  listTools(): Promise<DynamicToolEntry[]>;

  /** Persist a new tool definition. Throws if a tool with that name exists. */
  createTool(entry: Omit<DynamicToolEntry, 'createdAt' | 'updatedAt'>): Promise<DynamicToolEntry>;

  /** Apply a partial update to an existing tool. Returns the full updated definition. */
  updateTool(
    name: string,
    patch: Partial<Omit<DynamicToolEntry, 'name' | 'createdAt' | 'updatedAt'>>,
  ): Promise<DynamicToolEntry>;

  /** Permanently delete a persisted tool. */
  deleteTool(name: string): Promise<void>;

  /**
   * Execute a backend tool by name with the provided arguments.
   * Only called for tools with `runtime === 'backend'`.
   */
  executeTool(name: string, args: Record<string, unknown>, ctx?: DynamicToolSerializableContext): Promise<unknown>;

  // ── Module CRUD ────────────────────────────────────────────────────────────

  /** Return all shared module entries (without content). */
  listModules(): Promise<DynamicModuleEntry[]>;

  /** Return a single module with its source content. */
  getModule(name: string): Promise<DynamicModuleEntry & { content: string }>;

  /** Create or fully replace a shared module. */
  createModule(entry: { name: string; description: string; content: string }): Promise<DynamicModuleEntry>;

  /** Partially update a shared module. */
  updateModule(name: string, patch: { description?: string; content?: string }): Promise<void>;

  /** Permanently delete a shared module. */
  deleteModule(name: string): Promise<void>;

  // ── npm dependency management ──────────────────────────────────────────────

  /** Return installed dependencies in the tool-scripts package scope. */
  listDeps(): Promise<DependencyInfo>;

  /** Install one or more npm packages into the tool-scripts scope. */
  installDeps(packages: string[]): Promise<InstallDepsResult>;

  /** Remove a single npm package from the tool-scripts scope. */
  removeDep(pkg: string): Promise<RemoveDepResult>;
};

// ── Serialisable context passed to backend tool implementations ───────────────

/**
 * The subset of `ToolExecutionContext` that can be serialised over HTTP and
 * forwarded to backend (`runtime='backend'`) tool implementations.
 *
 * Available as the second argument of `run`: `export async function run(args, context) { … }`
 */
export type DynamicToolSerializableContext = {
  readonly sessionId: string;
  readonly agentName: string;
  readonly conversationId: string;
};

// ── HTTP adapter config ───────────────────────────────────────────────────────

export type HttpDynamicToolAdapterConfig = {
  /** Base URL of the Agent SDK backend. Defaults to `/api`. */
  baseUrl?: string;
};
