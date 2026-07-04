import { adoFetch } from './client';

interface ClassificationNode {
  name: string;
  children?: ClassificationNode[];
}

/** Flatten a classification tree into sorted full-path strings, skipping the root node. */
function flattenTree(root: ClassificationNode | undefined): string[] {
  if (!root) return [];
  const paths: string[] = [];

  function walk(n: ClassificationNode, prefix: string) {
    const full = prefix ? `${prefix}\\${n.name}` : n.name;
    if (prefix) paths.push(full); // skip root level (== project name)
    for (const child of n.children ?? []) walk(child, full);
  }

  walk(root, '');
  return paths.sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch the iteration (sprint) tree for a project.
 * Returns flat sorted list of full paths (e.g. "Project\\Sprint 1").
 */
export async function fetchIterations(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<string[]> {
  const encodedProject = encodeURIComponent(project);
  const node = await adoFetch<ClassificationNode>(
    `${collectionUrl}/${encodedProject}/_apis/wit/classificationnodes/iterations?$depth=10`,
    pat,
  ).catch(() => null);
  return flattenTree(node ?? undefined);
}

/**
 * Fetch the area path tree for a project.
 * Returns flat sorted list of full paths.
 */
export async function fetchAreas(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<string[]> {
  const encodedProject = encodeURIComponent(project);
  const node = await adoFetch<ClassificationNode>(
    `${collectionUrl}/${encodedProject}/_apis/wit/classificationnodes/areas?$depth=10`,
    pat,
  ).catch(() => null);
  return flattenTree(node ?? undefined);
}
