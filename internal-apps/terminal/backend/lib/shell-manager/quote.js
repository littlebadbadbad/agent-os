/**
 * shell-manager/quote.js — Shell argument quoting utilities
 *
 * Safely joins a command + args array into a single shell command line.
 * Every argument is quoted so that shell metacharacters (&, |, ;, $, etc.)
 * in file paths or commit messages are treated as literal text.
 */

/**
 * Quote a single argument for shell execution.
 *
 * On Windows the shell is cmd.exe, so we use double-quote wrapping with
 * caret-escaping for its special characters.  On Unix we use single quotes
 * with the standard '\'' escape pattern.
 *
 * @param {string} arg
 * @returns {string}
 */
export function quoteShellArg(arg) {
  if (arg === '') return "''";

  if (process.platform === 'win32') {
    // cmd.exe: wrap in double quotes, escape special chars with ^
    // Special chars: ^ & < > | ( ) % ! "
    const escaped = arg.replace(/[\^&<>|()%!"]/g, (ch) => `^${ch}`);
    return `"${escaped}"`;
  }

  // POSIX shells: single-quote everything, escape embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build a shell command line from a command and its arguments.
 *
 * @param {string} command
 * @param {readonly string[]} [args]
 * @returns {string}
 */
export function buildCommandLine(command, args) {
  if (!args || args.length === 0) return command;
  return [command, ...args].map(quoteShellArg).join(' ');
}
