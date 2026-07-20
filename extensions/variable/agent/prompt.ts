/**
 * Prompt primitives for the Variable ToolSet.
 */

import type { SectionId } from '@agent-type';

export const VARIABLE_SECTION_ID: SectionId = 'variable';

export const VAR_EXPAND_DESCRIPTION =
  'Browse the JSON structure of a variable like a debugger.\n' +
  '\n' +
  'When to use:\n' +
  '- Inspecting the structure of a stored variable\n' +
  '- Navigating large objects or arrays with pagination\n' +
  '\n' +
  'Behavior:\n' +
  '- Expand the root or any dot/bracket path to see direct children\n' +
  '- Shows types (string, number, array, object, null) and value previews\n' +
  '- Use page/pageSize to navigate large structures\n' +
  '- Attachments show their type and size directly';

export const VAR_READ_PATH_DESCRIPTION =
  'Read the value at a specific JSON path within a variable.\n' +
  '\n' +
  'When to use:\n' +
  '- Getting the actual value of a nested field\n' +
  '- Retrieving attachment data for vision models\n' +
  '\n' +
  'Behavior:\n' +
  '- Primitives (number, boolean, null) returned directly\n' +
  '- Strings paginated by character offset/maxLength\n' +
  '- Objects/arrays show paginated key list for further drilling\n' +
  '- Attachments returned inline for vision model consumption';

export const VAR_WRITE_DESCRIPTION =
  'Store a JSON value as a variable and get back a handle.\n' +
  '\n' +
  'When to use:\n' +
  '- Saving computed values for later use by other tools\n' +
  '- Passing large data between tools without duplicating in context\n' +
  '\n' +
  'Behavior:\n' +
  '- The json parameter must be valid JSON string\n' +
  '- Returns a $var:xxxxxxxx handle for future reference\n' +
  '- Optionally specify a human-readable name for identification';

export const VAR_LIST_DESCRIPTION =
  'List all variables in the current session.\n' +
  '\n' +
  'When to use:\n' +
  '- Checking what variables are available\n' +
  '- Finding variable handles for use with other var_* tools\n' +
  '\n' +
  'Behavior:\n' +
  '- Returns metadata only — no content preview\n' +
  '- Optionally filter by kind (json | attachment)';

export const VAR_DELETE_DESCRIPTION =
  'Delete a variable by handle, freeing its memory.\n' +
  '\n' +
  'When to use:\n' +
  '- Cleaning up temporary variables after use\n' +
  '- Freeing memory for large attachments\n' +
  '\n' +
  'Behavior:\n' +
  '- Irreversible — the variable is permanently removed\n' +
  '- Returns an error if the handle does not exist';
