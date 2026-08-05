/**
 * internal-plugins/dynamic-tool/agent/types.ts — Dynamic tool types
 */

export type DynamicToolRuntime = 'backend' | 'frontend';

export type DynamicToolEntry = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  runtime: DynamicToolRuntime;
  implementation: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DynamicModuleEntry = {
  name: string;
  description: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
};

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

export type DynamicToolAdapter = {
  listTools(): Promise<DynamicToolEntry[]>;
  createTool(entry: Omit<DynamicToolEntry, 'createdAt' | 'updatedAt'>): Promise<DynamicToolEntry>;
  updateTool(name: string, patch: Partial<Omit<DynamicToolEntry, 'name' | 'createdAt' | 'updatedAt'>>): Promise<DynamicToolEntry>;
  deleteTool(name: string): Promise<void>;
  executeTool(name: string, args: Record<string, unknown>, ctx?: DynamicToolSerializableContext): Promise<unknown>;
  listModules(): Promise<DynamicModuleEntry[]>;
  getModule(name: string): Promise<DynamicModuleEntry & { content: string }>;
  createModule(entry: { name: string; description: string; content: string }): Promise<DynamicModuleEntry>;
  updateModule(name: string, patch: { description?: string; content?: string }): Promise<void>;
  deleteModule(name: string): Promise<void>;
  listDeps(): Promise<DependencyInfo>;
  installDeps(packages: string[]): Promise<InstallDepsResult>;
  removeDep(pkg: string): Promise<RemoveDepResult>;
};

export type DynamicToolSerializableContext = {
  readonly sessionId: string;
  readonly agentName: string;
  readonly conversationId: string;
};
