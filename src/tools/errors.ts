/**
 * Typed error factories for the tool execution pipeline.
 *
 * All errors are plain Error instances extended with a discriminant code and
 * an optional toolName.  Factory functions are used instead of a class hierarchy
 * so that this module never emits the `class` keyword.
 */

export type AgentErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_VALIDATION'
  | 'TOOL_PERMISSION'
  | 'TOOL_EXECUTION';

export type AgentError = Error & {
  readonly _agentError: true;
  readonly code: AgentErrorCode;
  readonly toolName?: string;
};

function makeAgentError(
  code: AgentErrorCode,
  message: string,
  toolName?: string,
): AgentError {
  const err = new Error(message) as AgentError;
  // Object.defineProperty keeps the tag non-enumerable so JSON.stringify
  // doesn't accidentally leak it.
  Object.defineProperty(err, '_agentError', { value: true, enumerable: false });
  Object.defineProperty(err, 'code', { value: code, enumerable: true });
  if (toolName !== undefined) {
    Object.defineProperty(err, 'toolName', { value: toolName, enumerable: true });
  }
  return err;
}

export const isAgentError = (err: unknown): err is AgentError =>
  err instanceof Error && '_agentError' in err;

/** The tool name was not found in the registry. */
export const toolNotFoundError = (name: string): AgentError =>
  makeAgentError('TOOL_NOT_FOUND', `Tool "${name}" is not registered`, name);

/** The arguments supplied to the tool failed Zod validation. */
export const toolValidationError = (name: string, detail: string): AgentError =>
  makeAgentError('TOOL_VALIDATION', detail, name);

/** A ToolSet hook denied execution of this tool. */
export const toolPermissionError = (name: string, reason: string): AgentError =>
  makeAgentError('TOOL_PERMISSION', reason, name);

/** The tool's execute function threw an unexpected error. */
export const toolExecutionError = (name: string, cause: unknown): AgentError =>
  makeAgentError(
    'TOOL_EXECUTION',
    cause instanceof Error ? cause.message : String(cause),
    name,
  );
