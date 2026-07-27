/**
 * Skill store — public API.
 *
 * Filesystem-backed, reads from .agent/skills/<name>/
 *
 * Public API (all bound to an agent directory):
 *   listSkills()                          → SkillEntry[]
 *   getSkill(name)                        → SkillEntry | undefined
 *   readSkillFile(skillName, filePath)    → { content, path }
 *   removeSkill(name)                     → boolean
 *   installSkillFromText(opts)            → SkillEntry
 *   fetchAndInstallSkill(url)             → Promise<SkillEntry>
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { parseFrontmatter } from './frontmatter.js';

export { parseFrontmatter };

/**
 * Create a skill store bound to the given agent directory.
 *
 * @param {string} agentDir  — absolute path to the agent working directory
 * @param {object} deps      — injected dependencies (from createSkillFs)
 * @returns {{
 *   listSkills: () => Array,
 *   getSkill: (name: string) => object|undefined,
 *   readSkillFile: (skillName: string, filePath: string) => { content: string, path: string },
 *   removeSkill: (name: string) => boolean,
 *   writeSkill: (opts: object) => object|undefined,
 *   installSkillFromText: (opts: object) => object,
 *   fetchAndInstallSkill: (url: string) => Promise<object>,
 * }}
 */
export function createSkillStore(agentDir, { SKILLS_DIR, readSkillDir, toWireEntry, writeSkill, skillDir: _skillDir }, proxyConfig = null) {
  /** Convert an arbitrary name to a safe directory name. */
  function safeFolderName(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  }

  // ── Public read API ───────────────────────────────────────────────────────────

  /** List all skills in .agent/skills/. */
  function listSkills() {
    if (!existsSync(SKILLS_DIR)) return [];
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => readSkillDir(d.name))
      .filter(Boolean)
      .map(toWireEntry);
  }

  /** Look up a skill by its directory name or its meta.name. */
  function getSkill(name) {
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
  function readSkillFile(skillName, filePath) {
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
  function removeSkill(name) {
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
  function installSkillFromText({ name, description, content }) {
    const { meta, body } = parseFrontmatter(content);
    const skillName  = meta.name        || name;
    const skillDesc  = meta.description || description || `Custom skill: ${skillName}`;
    const folderName = safeFolderName(skillName);
    return writeSkill({ folderName, name: skillName, description: skillDesc, systemPrompt: body });
  }

  /**
   * Fetch and install a remote skill.
   * Supports:
   *   - GitHub folder URL (tree/:ref/:path) — uses GitHub Contents API
   *   - Any direct URL to a SKILL.md file
   * @param {string} url
   * @param {{ useProxy?: boolean }} [options]
   * @returns {Promise<object>} SkillEntry
   */
  async function fetchAndInstallSkill(url, { useProxy = true } = {}) {
    const parsed = new URL(url);

    // Select fetch function:
    //   useProxy=true  → proxy-aware fetch via undici ProxyAgent
    //   useProxy=false → default Node.js fetch (direct)
    const resolveFetch = useProxy && proxyConfig
      ? async () => {
          const { fetch: uf, ProxyAgent } = await import('undici');
          const proxyUri = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
          const agent = new ProxyAgent({ uri: proxyUri, connectTimeout: proxyConfig.connectTimeout ?? 10_000 });
          return (input, init) => uf(input, { ...init, dispatcher: agent });
        }
      : () => globalThis.fetch.bind(globalThis);

    const requestFetch = await resolveFetch();

    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/tree/')) {
      return fetchGithubFolderSkill(url, parsed, requestFetch);
    }

    const resp = await requestFetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch skill from ${url}: HTTP ${resp.status}`);
    const raw = await resp.text();
    const { meta, body } = parseFrontmatter(raw);

    const folderName  = safeFolderName(meta.name || url.split('/').filter(Boolean).at(-2) || 'unnamed-skill');
    const name        = meta.name        || folderName;
    const description = meta.description || `Skill loaded from ${url}`;

    return writeSkill({ folderName, name, description, systemPrompt: body });
  }

  /**
   * @param {string} url
   * @param {URL} parsed
   * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} requestFetch
   * @returns {Promise<object>}
   */
  async function fetchGithubFolderSkill(url, parsed, requestFetch) {
    const parts  = parsed.pathname.split('/').filter(Boolean);
    const owner  = parts[0];
    const repo   = parts[1];
    const ref    = parts[3];
    const path   = parts.slice(4).join('/');

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;

    async function fetchContents(dirPath) {
      const apiUrl = `${apiBase}/${dirPath}?ref=${encodeURIComponent(ref)}`;
      const r = await requestFetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(`GitHub API error for ${apiUrl}: HTTP ${r.status}`);
      return r.json();
    }

    async function downloadRaw(downloadUrl) {
      const r = await requestFetch(downloadUrl);
      if (!r.ok) throw new Error(`Failed to download ${downloadUrl}: HTTP ${r.status}`);
      return r.text();
    }

    const rootContents = await fetchContents(path);
    const skillMdEntry = rootContents.find(f => /^SKILL\.md$/i.test(f.name) && f.type === 'file');
    if (!skillMdEntry) throw new Error(`No SKILL.md found in ${url}`);

    const skillMdRaw = await downloadRaw(skillMdEntry.download_url);
    const { meta }   = parseFrontmatter(skillMdRaw);

    const folderName = safeFolderName(meta.name || path.split('/').at(-1) || 'unnamed-skill');
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

  return {
    listSkills,
    getSkill,
    readSkillFile,
    removeSkill,
    writeSkill,
    installSkillFromText,
    fetchAndInstallSkill,
  };
}
