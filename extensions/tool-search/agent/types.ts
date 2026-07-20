/**
 * ToolSearch types.
 *
 * @module
 */

/** A tool entry returned by the tool_search tool. */
export type ToolSearchResult = {
  /** The tool's registered name. */
  readonly name: string;
  /** A one-line summary of what the tool does. */
  readonly summary: string;
};
