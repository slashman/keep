import type { Project, ProjectsData, Floor, Collaborator, Person } from './types';
import { DATA_BASE, ASSET_BASE } from './config';

const LIVE_URL = `${DATA_BASE}data/projects.json`;
const FALLBACK_URL = `${ASSET_BASE}projects.fallback.json`;

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
      out.push({ ...p, category: cat.name, categoryId: cat.id });
    }
  }
  return out;
}

/** Build a key → collaborator lookup from the "People I've worked with" category. */
export function getCollaborators(data: ProjectsData): Map<string, Collaborator> {
  const map = new Map<string, Collaborator>();
  const cat = data.projects.find((c) => c.id === 'collaborators');
  for (const c of cat?.projects ?? []) {
    const col = c as unknown as Collaborator;
    if (col.key) map.set(col.key, col);
  }
  return map;
}

/** Hand-authored NPCs (not in the data) that appear from a given year onwards. */
const CUSTOM_PEOPLE: Array<Person & { since: number }> = [
  {
    key: 'adri', name: 'Adri', text: 'The Queen of Slashware',
    image: `${ASSET_BASE}people/adri.png`, priority: true, since: 2007,
  },
  {
    key: 'gaby', name: 'Gaby', text: "slashie's daughter and gameplay designer",
    image: `${ASSET_BASE}people/gaby.png`, scale: 0.72, priority: true, since: 2017,
  },
];

/**
 * The distinct people to show as NPCs on a floor: collaborators referenced by the
 * floor's projects that have an entry in the "collaborators" section (with a name,
 * picture and blurb), plus the hand-authored people active by that year.
 */
export function collaboratorsForFloor(floor: Floor, collab: Map<string, Collaborator>): Person[] {
  const keys = new Set<string>();
  for (const p of floor.projects) for (const k of p.collaborators ?? []) keys.add(k);
  const people: Person[] = [];
  for (const key of keys) {
    const c = collab.get(key);
    if (!c) continue; // skip refs with no collaborator entry
    people.push({ key, name: c.title ?? key, image: c.image, text: c.text });
  }
  for (const cp of CUSTOM_PEOPLE) {
    if (floor.year >= cp.since) {
      const { since: _since, ...person } = cp;
      people.push(person);
    }
  }
  return people;
}

/** Group projects into floors keyed by their start year (descending: newest on top). */
export function buildFloors(data: ProjectsData): Floor[] {
  const projects = flattenProjects(data);
  const byYear = new Map<number, Project[]>();
  const bucket = (y: number) => {
    let arr = byYear.get(y);
    if (!arr) byYear.set(y, (arr = []));
    return arr;
  };
  for (const p of projects) {
    if (typeof p.year !== 'number' || !Number.isFinite(p.year)) continue;
    bucket(p.year).push(p); // started this year
    // additional years the project saw development, from `years` (excluding the start year)
    const devYears = new Set(
      (p.years ?? []).filter((y) => typeof y === 'number' && Number.isFinite(y) && y !== p.year),
    );
    for (const y of devYears) bucket(y).push({ ...p, revisited: true });
  }
  return [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      // projects started this year first, then continued/revisited ones (stable sort keeps data order within each)
      projects: byYear.get(year)!.slice().sort((a, b) => Number(!!a.revisited) - Number(!!b.revisited)),
    }));
}
