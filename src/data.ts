import type { Project, ProjectsData, Floor, Collaborator, Person } from './types';
import { DATA_BASE, ASSET_BASE } from './config';
import { applyYearsData } from './yearContent';

const PROJECTS_URL = `${DATA_BASE}data/projects.json`;
const YEARS_URL = `${DATA_BASE}data/years.json`;
const FRIENDS_URL = `${DATA_BASE}data/friends.json`;

/** Fetch the live projects from slashie.net. Throws if unreachable — there is no bundled copy. */
export async function loadData(): Promise<ProjectsData> {
  const res = await fetch(PROJECTS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as ProjectsData;
  if (!data?.projects?.length) throw new Error('empty projects.json');
  return data;
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

/**
 * Fetch live per-year descriptions/images from years.json. Non-fatal: on failure the
 * year panels simply render without a blurb or photo (no bundled snapshot to fall back to).
 */
export async function loadYearContent(): Promise<void> {
  try {
    const res = await fetch(YEARS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyYearsData(await res.json());
  } catch (err) {
    console.warn('[data] years.json unavailable; year panels will show no blurb/image:', err);
  }
}

/**
 * Live collaborator lookup from friends.json. Non-fatal: on failure the floors just show
 * no collaborator NPCs (the hand-authored people below still appear).
 */
export async function loadFriends(): Promise<Map<string, Collaborator>> {
  const map = new Map<string, Collaborator>();
  try {
    const res = await fetch(FRIENDS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { groups?: Array<{ id?: string; projects?: Collaborator[] }> };
    const group = json.groups?.find((g) => g.id === 'collaborators') ?? json.groups?.[0];
    for (const c of group?.projects ?? []) if (c?.key) map.set(c.key, c);
  } catch (err) {
    console.warn('[data] friends.json unavailable; no collaborator NPCs this session:', err);
  }
  return map;
}

/**
 * Hand-authored NPCs (not in the data) that appear from a given year onwards.
 * `birthYear` marks someone born within the timeline: on their birth-year floor
 * they appear as a baby in a cradle, then grow a little taller each year after.
 */
const CUSTOM_PEOPLE: Array<
  Person & { since: number; birthYear?: number; babyImage?: string }
> = [
  {
    key: 'adri', name: 'Adri', text: 'The Queen of Slashware',
    image: `${ASSET_BASE}people/adri.png`, priority: true, since: 2007,
  },
  {
    key: 'gaby', name: 'Gaby', text: "slashie's daughter and gameplay designer",
    image: `${ASSET_BASE}people/gaby.png`, babyImage: `${ASSET_BASE}people/gaby-baby.png`,
    priority: true, since: 2017, birthYear: 2017,
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
    people.push({ key, name: c.title ?? key, image: c.image, text: c.text, portraitLeftMargin: c.portraitLeftMargin });
  }
  for (const cp of CUSTOM_PEOPLE) {
    if (floor.year < cp.since) continue;
    const { since: _since, birthYear, babyImage, ...person } = cp;
    if (birthYear != null) {
      const age = floor.year - birthYear;
      person.age = age;
      if (age <= 0) {
        // birth year: a baby in a cradle, with the baby photo and a fitting blurb
        person.baby = true;
        if (babyImage) person.image = babyImage;
        person.text = "slashie's newborn daughter";
      } else {
        // grows from toddler toward full height over roughly a decade
        person.scale = Math.min(1, 0.55 + age * 0.045);
      }
    }
    people.push(person);
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
