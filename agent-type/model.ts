/**
 * agent-type/model.ts — Model metadata type
 *
 * Shared between the UI layer (providerStore) and the plugin layer
 * (AgentPluginHost) so that plugins can access the current model's
 * context window without depending on agent-UI internals.
 */

/**
 * Metadata describing the currently selected model.
 *
 * Used by ToolSets to configure their behaviour based on the active
 * model's context window.
 */
export type ModelMeta = {
  /** Model identifier (e.g. "gpt-4o"). */
  readonly id: string;
  /** Human-readable label for display. */
  readonly label: string;
  /** Maximum input token budget for this model (0 if unknown). */
  readonly contextWindow: number;
  /** Optional human-readable description. */
  readonly description: string;
};
