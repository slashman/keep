import type { Project, ProjectsData, Floor } from './types';

const LIVE_URL = '/slashie/data/projects.json';
const FALLBACK_URL = '/projects.fallback.json';

/** Fetch the live data via the dev proxy, falling back to the bundled snapshot. */
export async function loadData(): Promise<{ data: ProjectsData; source: 'live' | 'fallback' }> {
  try {
    const res = await fetch(LIVE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ProjectsData;
    if (!data?.projects?.length) throw new Error('empty');
    return { data, source: 'live' };
  } catch (err) {
    console.warn('[data] live fetch failed, using bundled snapshot:', err);
    const res = await fetch(FALLBACK_URL);
    const data = (await res.json()) as ProjectsData;
    return { data, source: 'fallback' };
  }
}

/** Flatten every category into a single project list, tagging each with its category name. */
export function flattenProjects(data: ProjectsData): Project[] {
  const out: Project[] = [];
  for (const cat of data.projects) {
    // The "People I've worked with" category holds collaborators, not projects.
    if (cat.id === 'collaborators') continue;
    for (const p of cat.projects ?? []) {
      out.push({ ...p, category: cat.name });
    }
  }
  return out;
}

/** Group projects into floors keyed by their start year (descending: newest on top). */
export function buildFloors(data: ProjectsData): Floor[] {
  const projects = flattenProjects(data);
  const byYear = new Map<number, Project[]>();
  for (const p of projects) {
    if (typeof p.year !== 'number' || !Number.isFinite(p.year)) continue;
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year)!.push(p);
  }
  return [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => ({ year, projects: byYear.get(year)! }));
}
