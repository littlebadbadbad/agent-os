/**
 * extensions/file/agent/tools.ts — File tool definitions
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DataAttachment } from '@agent-type';
import type { FileAdapter } from './types';
import { REPLACE_ALL_DESCRIPTION } from './prompt';

export function createFileTools(adapter: FileAdapter) {
  const DEFAULT_READ_LINES = 250;

  const getWorkspaceRootTool = defineTool({
    name: 'get_workspace_root',
    group: 'File Management',
    description:
      'Return the current workspace root directory. ' +
      'All relative paths used by other file tools are resolved relative to this root.',
    parameters: z.object({}),
    execute: async (_, ctx) => adapter.getWorkspaceRoot({ sessionId: ctx.sessionId! }),
  });

  const setWorkspaceRootTool = defineTool({
    name: 'set_workspace_root',
    group: 'File Management',
    description:
      'Set the active workspace root directory for all file operations. ' +
      'If the directory does not exist it will be created automatically. ' +
      'All subsequent read_file / write_file / list_dir calls resolve paths relative to this new root. ' +
      'Use get_workspace_root first if you want to inspect the current root before changing it.',
    parameters: z.object({
      path: z.string().describe(
        'Absolute path to use as the workspace root, ' +
        'e.g. "/home/user/project" or "C:\\Users\\user\\project". ' +
        'Will be created if it does not exist.',
      ),
    }),
    execute: async ({ path }, ctx) => adapter.setWorkspaceRoot({ path, sessionId: ctx.sessionId! }),
  });

  const readFileTool = defineTool({
    name: 'read_file',
    group: 'File Management',
    description:
      'Read the contents of a file in the workspace. ' +
      `When no range is specified, only the first ${DEFAULT_READ_LINES} lines are returned. ` +
      'Check has_more and totalLines in the response — if has_more is true, ' +
      'call read_file again with startLine/endLine to read the next section. ' +
      'Use startLine/endLine to read a specific range (1-based, inclusive).',
    parameters: z.object({
      path: z.string().describe('Workspace-relative path, e.g. "src/index.ts".'),
      startLine: z.number().int().positive().optional()
        .describe('First line to return (1-based, inclusive). Omit to start from line 1.'),
      endLine: z.number().int().positive().optional()
        .describe('Last line to return (1-based, inclusive). Omit to use the default page limit.'),
    }),
    execute: async ({ path, startLine, endLine }, ctx) => {
      const noRangeGiven = startLine == null && endLine == null;
      const effectiveEnd = noRangeGiven ? DEFAULT_READ_LINES : endLine;
      const result = await adapter.readFile({ path, startLine, endLine: effectiveEnd, sessionId: ctx.sessionId! });
      if (noRangeGiven && result.totalLines != null && result.totalLines > DEFAULT_READ_LINES) {
        return {
          ...result,
          has_more: true,
          note: `Showing lines 1\u2013${DEFAULT_READ_LINES} of ${result.totalLines}. ` +
            `Call read_file with startLine=${DEFAULT_READ_LINES + 1} to read the next section.`,
        };
      }
      return result;
    },
  });

  const writeFileTool = defineTool({
    name: 'write_file',
    group: 'File Management',
    description:
      'Create a new file or completely overwrite an existing file. ' +
      'Parent directories are created automatically. ' +
      'For targeted edits to existing files prefer str_replace to avoid overwriting unrelated content.',
    parameters: z.object({
      path: z.string().describe('Workspace-relative path. Directories in the path are created if missing.'),
      content: z.union([z.string(), z.record(z.string(), z.unknown())]).describe(
        'Full text content to write (use \\n for line breaks), ' +
        'OR a $var:xxxxxxxx handle pointing to an attachment variable \u2014 ' +
        'the binary data will be decoded and written directly.',
      ),
    }),
    execute: async ({ path, content }, ctx) => {
      const resolvedContent = content as string | DataAttachment;
      if (typeof resolvedContent === 'object') {
        if (resolvedContent.source !== 'data') {
          throw new Error(
            'write_file: only data attachments (base64-encoded) can be written to disk. ' +
            'URL attachments are not supported.',
          );
        }
        return adapter.writeFile({ path, content: resolvedContent, sessionId: ctx.sessionId! });
      }
      return adapter.writeFile({ path, content: resolvedContent, sessionId: ctx.sessionId! });
    },
  });

  const strReplaceTool = defineTool({
    name: 'str_replace',
    group: 'File Management',
    description:
      'Replace a unique substring in a file with new text. ' +
      'oldStr must appear EXACTLY ONCE \u2014 include surrounding lines as context to ensure uniqueness. ' +
      'Use read_file first to get the exact whitespace and indentation. ' +
      'Prefer this over write_file for targeted edits.',
    parameters: z.object({
      path: z.string().describe('Workspace-relative path to the file to edit.'),
      oldStr: z.string().describe(
        'The exact literal text to replace, including all whitespace and indentation. ' +
        'Must appear exactly once in the file.',
      ),
      newStr: z.string().describe('The new text to substitute in place of oldStr.'),
    }),
    execute: async ({ path, oldStr, newStr }, ctx) =>
      adapter.strReplace({ path, oldStr, newStr, sessionId: ctx.sessionId! }),
  });

  const replaceAllTool = defineTool({
    name: 'replace_all',
    group: 'File Management',
    description: REPLACE_ALL_DESCRIPTION,
    parameters: z.object({
      path: z.string().describe('Workspace-relative path to the file to edit.'),
      oldStr: z.string().describe('The exact text to find and replace everywhere in the file.'),
      newStr: z.string().describe('The replacement text.'),
    }),
    execute: async ({ path, oldStr, newStr }, ctx) =>
      adapter.replaceAll({ path, oldStr, newStr, sessionId: ctx.sessionId! }),
  });

  const deleteFileTool = defineTool({
    name: 'delete_file',
    group: 'File Management',
    description: 'Permanently delete a file from the workspace. This action cannot be undone.',
    parameters: z.object({
      path: z.string().describe('Workspace-relative path of the file to delete.'),
    }),
    execute: async ({ path }, ctx) => adapter.deleteFile({ path, sessionId: ctx.sessionId! }),
  });

  const moveFileTool = defineTool({
    name: 'move_file',
    group: 'File Management',
    description:
      'Move or rename a file within the workspace. ' +
      'The destination directories are created if they do not exist.',
    parameters: z.object({
      from: z.string().describe('Current workspace-relative path.'),
      to:   z.string().describe('Target workspace-relative path.'),
    }),
    execute: async ({ from, to }, ctx) => adapter.moveFile({ from, to, sessionId: ctx.sessionId! }),
  });

  const listDirTool = defineTool({
    name: 'list_dir',
    group: 'File Management',
    description:
      'List the contents of a directory in the workspace. ' +
      'Returns a tree of files and subdirectories. ' +
      'Use depth > 1 to see nested structure (max 5). ' +
      'Pass an empty path to list the workspace root.',
    parameters: z.object({
      path: z.string().optional()
        .describe('Workspace-relative directory path. Omit or pass "" for the root.'),
      depth: z.number().int().min(1).max(5).optional()
        .describe('How many directory levels to expand (1 = immediate children, max 5). Default 1.'),
    }),
    execute: async ({ path, depth }, ctx) =>
      adapter.listDir({ path, depth, sessionId: ctx.sessionId! }),
  });

  const searchFilesTool = defineTool({
    name: 'search_files',
    group: 'File Management',
    description:
      'Search for files in the workspace by name pattern and/or content. ' +
      'pattern uses glob syntax: * (within a path segment), ** (across segments). ' +
      'content is a regex run against file contents. ' +
      'Use outputMode="files" (default) for a list of matching paths, ' +
      '"content" to get matching lines with surrounding context, or ' +
      '"count" to get just the number of matches.',
    parameters: z.object({
      pattern: z.string().describe(
        'Glob pattern to match file paths, e.g. "**/*.ts", "src/**", "notes/*.md". ' +
        'Use "**" to search all files.',
      ),
      content: z.string().optional().describe(
        'Optional regex to filter by file content. ' +
        'Required when outputMode is "content".',
      ),
      maxResults: z.number().int().min(1).max(200).optional()
        .describe('Maximum number of results to return (default 50, max 200).'),
      outputMode: z.enum(['files', 'content', 'count']).optional()
        .describe(
          '"files" (default) \u2014 returns list of matching file paths; ' +
          '"content" \u2014 returns matching lines with surrounding context lines; ' +
          '"count" \u2014 returns just the total match count.',
        ),
      caseSensitive: z.boolean().optional()
        .describe('Whether the content regex is case-sensitive (default false).'),
      contextLines: z.number().int().min(0).max(10).optional()
        .describe('(outputMode="content" only) Lines before and after each match to include (default 0, max 10).'),
    }),
    execute: async ({ pattern, content, maxResults, outputMode, caseSensitive, contextLines }, ctx) =>
      adapter.searchFiles({ pattern, content, maxResults, outputMode, caseSensitive, contextLines, sessionId: ctx.sessionId! }),
  });

  return [
    getWorkspaceRootTool,
    setWorkspaceRootTool,
    readFileTool,
    writeFileTool,
    strReplaceTool,
    replaceAllTool,
    deleteFileTool,
    moveFileTool,
    listDirTool,
    searchFilesTool,
  ] as const;
}
