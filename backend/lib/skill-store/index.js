/**
 * Skill store — public API.
 *
 * Filesystem-backed, reads from .agent/skills/<name>/
 *
 * Public API:
 *   listSkills()                          → SkillEntry[]
 *   getSkill(name)                        → SkillEntry | undefined
 *   readSkillFile(skillName, filePath)    → { content, path }
 *   removeSkill(name)                     → boolean
 *   writeSkill(opts)                      → SkillEntry
 *   installSkillFromText(opts)            → SkillEntry
 *   installSkillFromZip(zipBuffer)        → SkillEntry
 *   fetchAndInstallSkill(url)             → Promise<SkillEntry>
 *   parseFrontmatter(raw)                 → { meta, body }  (re-exported)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import AdmZip from 'adm-zip';
import { parseFrontmatter } from './frontmatter.js';
import { SKILLS_DIR, skillDir, readSkillDir, toWireEntry, writeSkill } from './skill-fs.js';

export { parseFrontmatter, writeSkill };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert an arbitrary name to a safe directory name. */
function _safeFolderName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

// ── Public read API ───────────────────────────────────────────────────────────

/** List all skills in .agent/skills/. */
export function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readSkillDir(d.name))
    .filter(Boolean)
    .map(toWireEntry);
}

/** Look up a skill by its directory name or its meta.name. */
export function getSkill(name) {
  const byDir = readSkillDir(name);
  if (byDir) return toWireEntry(byDir);

  if (!existsSync(SKILLS_DIR)) return undefined;
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readSkillDir(d.name))
    .filter(Boolean);
  const found = dirs.find(e => e.name === name);
  return found ? toWireEntry(found) : undefined;
}

/**
 * Read a file from inside a skill's directory (e.g. references/guide.md).
 * @param {string} skillName  — skill name or folder name
 * @param {string} filePath   — relative path within the skill dir
 * @returns {{ content: string, path: string }}
 */
export function readSkillFile(skillName, filePath) {
  let dir = join(SKILLS_DIR, skillName);
  if (!existsSync(dir)) {
    if (existsSync(SKILLS_DIR)) {
      const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of dirs) {
        const entry = readSkillDir(d.name);
        if (entry?.name === skillName) { dir = join(SKILLS_DIR, d.name); break; }
      }
    }
  }
  if (!existsSync(dir)) throw new Error(`Skill "${skillName}" not found`);

  const resolved = join(dir, filePath);
  if (!resolved.startsWith(dir + '/') && !resolved.startsWith(dir + '\\') && resolved !== dir) {
    throw new Error(`path escapes skill directory`);
  }
  if (!existsSync(resolved)) throw new Error(`File not found in skill "${skillName}": ${filePath}`);

  const stat = statSync(resolved);
  if (stat.isDirectory()) throw new Error(`"${filePath}" is a directory, not a file`);
  if (stat.size > 512_000) throw new Error(`File too large (max 512 KB): ${filePath}`);

  return { content: readFileSync(resolved, 'utf8'), path: filePath };
}

// ── Public write / delete API ─────────────────────────────────────────────────

/** Remove a skill folder from disk. Returns true if it existed. */
export function removeSkill(name) {
  let target = join(SKILLS_DIR, name);
  if (!existsSync(target)) {
    if (existsSync(SKILLS_DIR)) {
      const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of dirs) {
        const entry = readSkillDir(d.name);
        if (entry?.name === name) { target = join(SKILLS_DIR, d.name); break; }
      }
    }
  }
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/** Install a skill from raw text content (name + markdown body). */
export function installSkillFromText({ name, description, content }) {
  const { meta, body } = parseFrontmatter(content);
  const skillName  = meta.name        || name;
  const skillDesc  = meta.description || description || `Custom skill: ${skillName}`;
  const folderName = _safeFolderName(skillName);
  return writeSkill({ folderName, name: skillName, description: skillDesc, systemPrompt: body });
}

/**
 * Install a skill from the raw bytes of a .zip archive.
 * @param {Buffer} zipBuffer
 * @returns {object} SkillEntry
 */
export function installSkillFromZip(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const normName = (e) => e.entryName.replace(/\\/g, '/');

  const mdEntries = entries
    .filter(e => !e.isDirectory && /(?:^|\/)SKILL\.md$/i.test(normName(e)))
    .sort((a, b) => normName(a).split('/').length - normName(b).split('/').length);

  const skillMdEntry = mdEntries[0];
  if (!skillMdEntry) {
    const names = entries.slice(0, 20).map(e => normName(e)).join(', ');
    throw new Error(`SKILL.md not found in zip. Files found: ${names || '(empty archive)'}`);
  }

  const entryName = normName(skillMdEntry);
  const prefix = entryName.toLowerCase() === 'skill.md'
    ? ''
    : entryName.slice(0, entryName.toLowerCase().lastIndexOf('skill.md'));

  const rawMd = skillMdEntry.getData().toString('utf8');
  const { meta } = parseFrontmatter(rawMd);

  const skillName  = meta.name || (prefix ? prefix.replace(/\/$/, '') : 'unnamed-skill');
  const folderName = _safeFolderName(skillName);
  const dir = join(SKILLS_DIR, folderName);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), rawMd, 'utf8');

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const n = normName(entry);
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel || /^SKILL\.md$/i.test(rel)) continue;

    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.getData());
  }

  return getSkill(skillName);
}

/**
 * Fetch and install a remote skill.
 * Supports:
 *   - GitHub folder URL (tree/:ref/:path) — uses GitHub Contents API
 *   - Any direct URL to a SKILL.md file
 * @param {string} url
 * @returns {Promise<object>} SkillEntry
 */
export async function fetchAndInstallSkill(url) {
  const parsed = new URL(url);

  if (parsed.hostname === 'github.com' && parsed.pathname.includes('/tree/')) {
    return _fetchGithubFolderSkill(url, parsed);
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch skill from ${url}: HTTP ${resp.status}`);
  const raw = await resp.text();
  const { meta, body } = parseFrontmatter(raw);

  const folderName  = _safeFolderName(meta.name || url.split('/').filter(Boolean).at(-2) || 'unnamed-skill');
  const name        = meta.name        || folderName;
  const description = meta.description || `Skill loaded from ${url}`;

  return writeSkill({ folderName, name, description, systemPrompt: body });
}

async function _fetchGithubFolderSkill(url, parsed) {
  const parts  = parsed.pathname.split('/').filter(Boolean);
  const owner  = parts[0];
  const repo   = parts[1];
  const ref    = parts[3];
  const path   = parts.slice(4).join('/');

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;

  async function fetchContents(dirPath) {
    const apiUrl = `${apiBase}/${dirPath}?ref=${encodeURIComponent(ref)}`;
    const r = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub API error for ${apiUrl}: HTTP ${r.status}`);
    return r.json();
  }

  async function downloadRaw(downloadUrl) {
    const r = await fetch(downloadUrl);
    if (!r.ok) throw new Error(`Failed to download ${downloadUrl}: HTTP ${r.status}`);
    return r.text();
  }

  const rootContents = await fetchContents(path);
  const skillMdEntry = rootContents.find(f => /^SKILL\.md$/i.test(f.name) && f.type === 'file');
  if (!skillMdEntry) throw new Error(`No SKILL.md found in ${url}`);

  const skillMdRaw = await downloadRaw(skillMdEntry.download_url);
  const { meta }   = parseFrontmatter(skillMdRaw);

  const folderName = _safeFolderName(meta.name || path.split('/').at(-1) || 'unnamed-skill');
  const name       = meta.name || folderName;

  const dir = join(SKILLS_DIR, folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMdRaw, 'utf8');

  for (const subdir of ['scripts', 'references', 'assets']) {
    const subdirEntry = rootContents.find(f => f.name === subdir && f.type === 'dir');
    if (!subdirEntry) continue;
    const subdirContents = await fetchContents(`${path}/${subdir}`);
    mkdirSync(join(dir, subdir), { recursive: true });
    for (const f of subdirContents.filter(f => f.type === 'file')) {
      try {
        const content = await downloadRaw(f.download_url);
        writeFileSync(join(dir, subdir, f.name), content, 'utf8');
      } catch { /* skip files that fail to download */ }
    }
  }

  return getSkill(name) ?? getSkill(folderName);
}

// ── Boot log ──────────────────────────────────────────────────────────────────

const skillCount = listSkills().length;
console.log(`[skill-store] filesystem ready — ${skillCount} skill(s)  (${SKILLS_DIR})`);
