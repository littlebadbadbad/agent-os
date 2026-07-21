import { adoFetch } from './client';

// ── Raw ADO tag shape ─────────────────────────────────────────────────────────

interface RawTag {
  id: string;
  name: string;
  active?: boolean;
}

// ── Tag API ───────────────────────────────────────────────────────────────────

/**
 * List all tags defined in a project.
 * GET /{collection}/{project}/_apis/wit/tags
 *
 * Returns tag names sorted alphabetically; inactive tags are excluded.
 * Returns an empty array on any error so callers degrade gracefully.
 */
export async function fetchProjectTags(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<string[]> {
  const encodedProject = encodeURIComponent(project);
  try {
    const result = await adoFetch<{ value: RawTag[] }>(
      `${collectionUrl}/${encodedProject}/_apis/wit/tags`,
      pat,
      { apiVersion: '6.0-preview.1' },
    );
    return (result?.value ?? [])
      .filter((t) => t.active !== false)
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
