// Azure DevOps Agile/Sprints/Boards APIs

import { adoFetch } from './client';

export interface TeamSprint {
  id: string;
  name: string;
  path?: string;
  attributes?: {
    startDate?: string;
    finishDate?: string;
    timeFrame?: string;   // 'current' | 'past' | 'future'
  };
  url?: string;
}

export async function fetchTeamSprints(
  collectionUrl: string,
  project: string,
  pat: string,
  team: string,
  timeFrame?: string,  // 'current' | 'past' | 'future' | omit for all
): Promise<TeamSprint[]> {
  const qs = timeFrame ? `?$timeframe=${encodeURIComponent(timeFrame)}` : '';
  const url = `${collectionUrl}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations${qs}`;
  const res = await adoFetch<{ value: TeamSprint[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

export interface SprintWorkItemRelation {
  rel?: string;
  source?: { id: number; url?: string } | null;
  target: { id: number; url?: string };
}

export interface SprintWorkItems {
  workItemRelations: SprintWorkItemRelation[];
  url?: string;
}

export async function fetchSprintWorkItems(
  collectionUrl: string,
  project: string,
  pat: string,
  team: string,
  iterationId: string,
): Promise<SprintWorkItems> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/workitems`;
  return await adoFetch<SprintWorkItems>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
}

export interface TeamBoard {
  id: string;
  name: string;
  url?: string;
}

export async function fetchTeamBoards(
  collectionUrl: string,
  project: string,
  pat: string,
  team: string,
): Promise<TeamBoard[]> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/boards`;
  const res = await adoFetch<{ value: TeamBoard[] }>(url, pat, {
    apiVersion: '6.1-preview.1',
  });
  return res.value ?? [];
}

export interface TeamMemberCapacity {
  teamMember: { id?: string; displayName?: string; uniqueName?: string };
  activities: Array<{
    capacityPerDay: number;
    name?: string;
  }>;
  daysOff: Array<{
    start: string;
    end: string;
  }>;
}

export interface SprintCapacity {
  teamMembers: TeamMemberCapacity[];
  totalDaysOff?: number;
  url?: string;
}

export async function fetchSprintCapacity(
  collectionUrl: string,
  project: string,
  pat: string,
  team: string,
  iterationId: string,
): Promise<SprintCapacity> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/capacities`;
  const raw = await adoFetch<{ value: TeamMemberCapacity[]; totalDaysOff?: number; url?: string }>(url, pat, {
    apiVersion: '6.1-preview.2',
  });
  return {
    teamMembers: raw.value ?? [],
    totalDaysOff: raw.totalDaysOff,
    url: raw.url,
  };
}

export interface TeamSettings {
  bugsBehavior?: string;
  workingDays?: string[];
  backlogIteration?: { id: string; name?: string; path?: string };
  defaultIteration?: { id: string; name?: string; path?: string };
  defaultIterationMacro?: string;
}

export async function fetchTeamSettings(
  collectionUrl: string,
  project: string,
  pat: string,
  team: string,
): Promise<TeamSettings> {
  const url = `${collectionUrl}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings`;
  return await adoFetch<TeamSettings>(url, pat, {
    apiVersion: '6.1-preview.2',
  });
}
