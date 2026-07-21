import { adoFetch } from './client';
import type { RawProject, Project } from './types';

/**
 * GET {collectionUrl}/_apis/projects
 * Lists all projects within a specific collection.
 */
export async function fetchProjects(
  collectionUrl: string,
  pat: string,
  collectionId: string,
): Promise<Project[]> {
  const data = await adoFetch<{ value: RawProject[] }>(
    `${collectionUrl}/_apis/projects`,
    pat,
  );

  return (data?.value ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    state: p.state ?? 'unknown',
    description: p.description,
    collectionId,
    visibility: p.visibility,
  }));
}

/**
 * Fetch all team members for all teams in a project.
 * Returns display names de-duped and sorted.
 */
export async function fetchProjectMembers(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<string[]> {
  const encodedProject = encodeURIComponent(project);

  const teamsData = await adoFetch<{ value: { id: string; name: string }[] }>(
    `${collectionUrl}/_apis/projects/${encodedProject}/teams`,
    pat,
  ).catch(() => null);

  const teams = teamsData?.value ?? [];
  if (teams.length === 0) return [];

  const seen = new Set<string>();
  const displayNames: string[] = [];

  const BATCH = 5;
  for (let i = 0; i < teams.length; i += BATCH) {
    const slice = teams.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((t) =>
        adoFetch<{ value: { identity: { displayName: string; uniqueName: string } }[] }>(
          `${collectionUrl}/_apis/projects/${encodedProject}/teams/${t.id}/members`,
          pat,
        ).catch(() => null),
      ),
    );
    for (const r of results) {
      for (const m of r?.value ?? []) {
        const name = m?.identity?.displayName;
        if (name && !seen.has(name)) {
          seen.add(name);
          displayNames.push(name);
        }
      }
    }
  }

  return displayNames.sort((a, b) => a.localeCompare(b));
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export interface ProjectTeam {
  id: string;
  name: string;
  description?: string;
  url?: string;
}

/**
 * GET {collectionUrl}/_apis/projects/{project}/teams
 * Lists all teams in a project.
 */
export async function fetchTeams(
  collectionUrl: string,
  project: string,
  pat: string,
): Promise<ProjectTeam[]> {
  const encodedProject = encodeURIComponent(project);
  const data = await adoFetch<{ value: ProjectTeam[] }>(
    `${collectionUrl}/_apis/projects/${encodedProject}/teams?$expandIdentity=false`,
    pat,
  ).catch(() => null);
  return data?.value ?? [];
}
