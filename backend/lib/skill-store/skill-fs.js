/**
 * Skill filesystem helpers.
 *
 * Low-level helpers for locating, reading and writing skill directories under
 * `SKILLS_DIR`.  All path operations stay within the skills directory.
 *
 * Exports:
 *   SKILLS_DIR          — absolute path to .agent/skills/
 *   skillDir(name)      — absolute path to a skill's folder
 *   readSkillDir(name)  — read one skill folder → internal SkillEntry | null
 *   toWireEntry(entry)  — strip internal-only fields for HTTP responses
 *   writeSkill(opts)    — create/overwrite a skill on disk
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { AGENT_DIR } from '../paths.js';
import { parseFrontmatter } from './frontmatter.js';

export const SKILLS_DIR = join(AGENT_DIR, 'skills');

mkdirSync(SKILLS_DIR, { recursive: true });

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Absolute path for a skill's directory. */
export function skillDir(name) {
  return join(SKILLS_DIR, name);
}

/**
 * Absolute path for a skill's main Markdown file.
 * Prefers uppercase SKILL.md (standard); falls back to skill.md (legacy).
 */
function skillMdPath(name) {
  const upper = join(skillDir(name), 'SKILL.md');
  if (existsSync(upper)) return upper;
  return join(skillDir(name), 'skill.md'); // legacy fallback
}

// ── Directory reader ──────────────────────────────────────────────────────────

/**
 * Read a single skill folder and return an internal SkillEntry, or null if
 * the folder is missing or malformed (no SKILL.md).
 * @param {string} name  — folder name inside SKILLS_DIR
 */
export function readSkillDir(name) {
  const mdPath = skillMdPath(name);
  if (!existsSync(mdPath)) return null;

  const raw  = readFileSync(mdPath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  const skillName   = meta.name        || name;
  const description = meta.description || `Skill: ${skillName}`;
  // Support top-level version/author (legacy) and standard metadata.version/metadata.author
  const metadata    = (meta.metadata && typeof meta.metadata === 'object') ? meta.metadata : {};
  const version     = meta.version  || metadata.version || undefined;
  const author      = meta.author   || metadata.author  || undefined;

  const scriptsDir = join(skillDir(name), 'scripts');
  const scripts = existsSync(scriptsDir)
    ? readdirSync(scriptsDir).filter(f => !f.startsWith('.'))
    : [];

  return {
    name:         skillName,
    folderName:   name,
    description,
    version,
    author,
    systemPrompt: body,
    scripts,
    updatedAt: new Date(statSync(mdPath).mtimeMs).toISOString(),
  };
}

// ── Wire serialisation ────────────────────────────────────────────────────────

/**
 * Strip internal-only fields (`folderName`) before sending over HTTP.
 */
export function toWireEntry(entry) {
  return {
    name:         entry.name,
    description:  entry.description,
    ...(entry.version && { version: entry.version }),
    ...(entry.author  && { author:  entry.author  }),
    systemPrompt: entry.systemPrompt,
    scripts:      entry.scripts,
    skillPath:    join(SKILLS_DIR, entry.folderName),
    updatedAt:    entry.updatedAt,
  };
}

// ── Disk write ────────────────────────────────────────────────────────────────

/**
 * Create or overwrite a skill on disk.
 * @param {{ folderName: string, name: string, description: string, version?: string, author?: string, systemPrompt: string }} opts
 * @returns the newly written skill via toWireEntry
 */
export function writeSkill({ folderName, name, description, version, author, systemPrompt }) {
  const dir = join(SKILLS_DIR, folderName);
  mkdirSync(dir, { recursive: true });

  let fm = `---\nname: ${name}\ndescription: "${description.replace(/"/g, '\\"')}"`;
  if (version || author) {
    fm += '\nmetadata:';
    if (author)  fm += `\n  author: ${author}`;
    if (version) fm += `\n  version: "${version}"`;
  }
  fm += '\n---\n\n';
  writeFileSync(join(dir, 'SKILL.md'), fm + systemPrompt, 'utf8');

  // Re-read to return canonical entry
  const entry = readSkillDir(folderName);
  return entry ? toWireEntry(entry) : undefined;
}
