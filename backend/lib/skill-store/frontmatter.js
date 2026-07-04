/**
 * YAML frontmatter parser for skill Markdown files.
 *
 * Parses the `---` fence block at the top (or bottom) of a Markdown file
 * and returns `{ meta, body }` where `meta` is a plain key→value object.
 *
 * Supports:
 *   - Quoted strings: 'value' and "value"
 *   - Block scalars:  | (literal) and > (folded)
 *   - Nested mappings (one level deep) for the `metadata:` block
 */

/**
 * Parse YAML frontmatter from a raw Markdown string.
 * @param {string} raw
 * @returns {{ meta: Record<string, any>, body: string }}
 */
export function parseFrontmatter(raw) {
  const trimmed = raw.trim();
  const meta = {};

  if (trimmed.startsWith('---')) {
    const endIdx = trimmed.indexOf('---', 3);
    if (endIdx !== -1) {
      const yamlBlock = trimmed.slice(3, endIdx).trim();
      _parseYamlLines(yamlBlock, meta);
      const body = trimmed.slice(endIdx + 3).trim();
      if (meta.name) return { meta, body };
    }
  }

  const lastFenceIdx = trimmed.lastIndexOf('\n---');
  if (lastFenceIdx !== -1) {
    const candidate = trimmed.slice(lastFenceIdx + 1);
    const fenceMatch = candidate.match(/^---\s*\n([\s\S]*?)\n---\s*$/);
    if (fenceMatch) {
      _parseYamlLines(fenceMatch[1], meta);
      const body = trimmed.slice(0, lastFenceIdx).trim();
      if (meta.name) return { meta, body };
    }
  }

  return { meta, body: trimmed };
}

function _parseYamlLines(block, meta) {
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();

      // YAML block scalar: | (literal) or > (folded)
      if (val === '|' || val === '>') {
        const fold = val === '>';
        const bodyLines = [];
        i++;
        while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t') || lines[i] === '')) {
          bodyLines.push(lines[i].replace(/^  /, '')); // strip 2-space indent
          i++;
        }
        while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
        val = fold
          ? bodyLines.join(' ').trim()
          : bodyLines.join('\n').trim();
        meta[key] = val;
        continue;
      }

      // Nested mapping (empty value followed by indented lines) — e.g. metadata: block
      if (val === '') {
        const nested = {};
        i++;
        while (i < lines.length && /^[ \t]/.test(lines[i])) {
          const nm = lines[i].match(/^[ \t]+(\w[\w-]*):\s*(.*)/);
          if (nm) {
            let nv = nm[2].trim();
            if ((nv.startsWith('"') && nv.endsWith('"')) || (nv.startsWith("'") && nv.endsWith("'"))) {
              nv = nv.slice(1, -1);
            }
            nested[nm[1].trim()] = nv;
          }
          i++;
        }
        meta[key] = nested;
        continue;
      }

      // Quoted strings
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
    i++;
  }
}
