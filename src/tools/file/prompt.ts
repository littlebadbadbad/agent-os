/**
 * Prompt primitives for the File ToolSet.
 *
 * All descriptions are plain strings — no template literals, no special
 * quoting needed. Backticks in markdown are written as actual characters.
 */

import type { SectionId } from '@agent-type';

export const FILE_SECTION_ID: SectionId = 'file';

export const GET_WORKSPACE_ROOT_DESCRIPTION =
  'Return the current workspace root directory.\n' +
  'All relative paths used by other file tools are resolved relative to this root.\n' +
  '\n' +
  'When to use:\n' +
  '- At the start of a session to confirm the active directory\n' +
  '- After set_workspace_root to verify the change\n' +
  '\n' +
  'Behavior:\n' +
  '- Returns the absolute path of the current workspace root';

export const SET_WORKSPACE_ROOT_DESCRIPTION =
  'Set the active workspace root directory for all file operations.\n' +
  'If the directory does not exist it will be created automatically.\n' +
  'Use get_workspace_root first to inspect the current root before changing it.\n' +
  '\n' +
  'When to use:\n' +
  '- Pointing the workspace to a different project directory\n' +
  '- Initializing a workspace in a new directory\n' +
  '\n' +
  'Behavior:\n' +
  '- The directory is created if it does not exist\n' +
  '- All subsequent file operations resolve relative to this new root';

export const READ_FILE_DESCRIPTION =
  'Read the contents of a file in the workspace.\n' +
  'When no range is specified, only the first 250 lines are returned.\n' +
  'Check has_more and totalLines in the response.\n' +
  'Use startLine/endLine to read a specific range (1-based, inclusive).\n' +
  '\n' +
  'When to use:\n' +
  '- Inspecting a file to understand its contents\n' +
  '- Reading code before editing\n' +
  '- Viewing specific line ranges for targeted reads\n' +
  '\n' +
  'Behavior:\n' +
  '- By default returns first 250 lines\n' +
  '- has_more=true means more lines exist beyond the returned range\n' +
  '- Call again with startLine/endLine to read next sections\n' +
  '- Supports images (PNG, JPG), PDF files, and Jupyter notebooks\n' +
  '- Supports reading Jupyter notebooks (.ipynb) with all cell outputs';

export const WRITE_FILE_DESCRIPTION =
  'Create a new file or completely overwrite an existing file.\n' +
  'Parent directories are created automatically.\n' +
  'For targeted edits to existing files prefer str_replace.\n' +
  '\n' +
  'When to use:\n' +
  '- Creating a new file from scratch\n' +
  '- Completely replacing the content of an existing file\n' +
  '- Writing binary data from a variable handle\n' +
  '\n' +
  'When NOT to use:\n' +
  '- Making a small edit to an existing file — use str_replace instead\n' +
  '- Renaming or moving a file — use move_file instead\n' +
  '\n' +
  'Behavior:\n' +
  '- Parent directories are created if missing\n' +
  '- Accepts string content or a $var:xxxxxxxx handle for binary data\n' +
  '- Completely overwrites the file at the given path';

export const STR_REPLACE_DESCRIPTION =
  'Replace a unique substring in a file with new text.\n' +
  'oldStr must appear EXACTLY ONCE in the file.\n' +
  '\n' +
  'When to use:\n' +
  '- Making a precise, targeted edit in a file\n' +
  '- Renaming a symbol across a single file\n' +
  '\n' +
  'When NOT to use:\n' +
  '- Multiple occurrences of the same string — use replace_all or write_file\n' +
  '- Creating entirely new content — use write_file instead\n' +
  '\n' +
  'Behavior:\n' +
  '- oldStr must be unique in the file or the edit fails\n' +
  '- Include 2-4 lines of surrounding context to ensure uniqueness\n' +
  '- Indentation must match exactly, including tabs vs spaces\n' +
  '- Use read_file first to get the exact whitespace/indentation\n' +
  '- Use replace_all parameter for renaming across the file';

export const DELETE_FILE_DESCRIPTION =
  'Permanently delete a file from the workspace.\n' +
  'This action cannot be undone.\n' +
  '\n' +
  'When NOT to use (this is destructive):\n' +
  '- Only delete when explicitly asked or clearly necessary\n' +
  '- Prefer to move files instead of deleting\n' +
  '\n' +
  'Behavior:\n' +
  '- Irreversible — the file is permanently removed\n' +
  '- Returns an error if the file does not exist';

export const MOVE_FILE_DESCRIPTION =
  'Move or rename a file within the workspace.\n' +
  'The destination directories are created if they do not exist.\n' +
  '\n' +
  'When to use:\n' +
  '- Renaming a file or directory\n' +
  '- Moving files between directories\n' +
  '\n' +
  'Behavior:\n' +
  '- Destination directories are created automatically\n' +
  '- Works for both files and directories';

export const LIST_DIR_DESCRIPTION =
  'List the contents of a directory in the workspace.\n' +
  'Use depth > 1 to see nested structure (max 5).\n' +
  'Pass an empty path to list the workspace root.\n' +
  '\n' +
  'When to use:\n' +
  '- Exploring the project structure\n' +
  '- Finding files and subdirectories\n' +
  '- Checking what exists at the workspace root\n' +
  '\n' +
  'Behavior:\n' +
  '- depth=1 shows immediate children (default)\n' +
  '- depth up to 5 for nested view\n' +
  '- Returns a tree of files and directories\n' +
  '- Pass empty string for workspace root';

export const SEARCH_FILES_DESCRIPTION =
  'Search for files in the workspace by name pattern and/or content regex.\n' +
  'pattern uses glob syntax: * (within a path segment), ** (across segments).\n' +
  'content is a multiline regex run against file contents.\n' +
  '\n' +
  'When to use:\n' +
  '- Finding files by name pattern (e.g. all .ts test files)\n' +
  '- Searching for code containing specific function calls or imports\n' +
  '- Discovering which files reference a given identifier\n' +
  '\n' +
  'Behavior:\n' +
  '- pattern: glob syntax, * matches within one segment, ** across segments\n' +
  '- content: multiline regex matched against file text\n' +
  '- Only files matching BOTH pattern AND content (if both specified)\n' +
  '- maxResults caps the returned list (default 50, max 200)\n' +
  '\n' +
  'Examples:\n' +
  '- search_files(pattern="**/*.ts") — all TypeScript files\n' +
  '- search_files(content="function.*getUser") — files with getUser function\n' +
  '- search_files(pattern="src/**", content="import.*zod") — Zod imports in src/';

export const REPLACE_ALL_DESCRIPTION =
  'Replace ALL occurrences of oldStr with newStr in a file.\n' +
  'Unlike str_replace, this does NOT require oldStr to be unique in the file.\n' +
  '\n' +
  'When to use:\n' +
  '- Renaming a variable, function, or class name across a file\n' +
  '- Changing an import path everywhere it appears\n' +
  '- Replacing repetitive strings (e.g. a hardcoded URL or version number)\n' +
  '\n' +
  'When NOT to use:\n' +
  '- Only one occurrence exists — use str_replace (it validates uniqueness)\n' +
  '- Need to replace across multiple files — use search_files first, then apply per file\n' +
  '\n' +
  'Behavior:\n' +
  '- Replaces every occurrence of oldStr with newStr\n' +
  '- Returns the count of replacements made\n' +
  '- Matching is exact (including whitespace and line endings)\n' +
  '\n' +
  'Example:\n' +
  '- replace_all(path="src/utils.ts", oldStr="oldFunctionName", newStr="newFunctionName")';

export function getFileSystemPromptSection(
  _enabledTools: readonly string[],
): string {
  return '# File Management\n\n' +
    'Use read_file (with optional startLine/endLine) to read files. ' +
    'Prefer str_replace for targeted edits over write_file to avoid ' +
    'overwriting unrelated content. Use list_dir to explore project structure. ' +
    'Use search_files with glob patterns to find files by name or content.';
}
