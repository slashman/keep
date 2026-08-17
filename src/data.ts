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

/**
 * The people credited on one project, for that project's own room. Unlike a floor,
 * a room shows *only* its own collaborators — nobody wanders in from another project.
 */
export function collaboratorsForProject(p: Project, collab: Map<string, Collaborator>): Person[] {
  const people: Person[] = [];
  for (const key of new Set(p.collaborators ?? [])) {
    const c = collab.get(key);
    if (c) {
      people.push({ key, name: c.title ?? key, image: c.image, text: c.text, portraitLeftMargin: c.portraitLeftMargin });
      continue;
    }
    const custom = CUSTOM_PEOPLE.find((cp) => cp.key === key);
    if (custom) {
      const { since: _since, birthYear: _birthYear, babyImage: _babyImage, ...person } = custom;
      people.push(person);
    }
  }
  return people;
}

/**
 * Group projects into floors keyed by their `year` (descending: newest on top).
 * A project stands on exactly one floor — the year it began — however many years
 * it went on being worked on; those later years show up as effort on its placard
 * (see `devEffort`), not as a second gate on a second floor.
 */
export function buildFloors(data: ProjectsData): Floor[] {
  const byYear = new Map<number, Project[]>();
  for (const p of flattenProjects(data)) {
    if (typeof p.year !== 'number' || !Number.isFinite(p.year)) continue;
    let arr = byYear.get(p.year);
    if (!arr) byYear.set(p.year, (arr = []));
    arr.push(p);
  }
  return [...byYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => ({ year, projects: byYear.get(year)! }));
}

/** Days of work behind a project: the whole of it, and the part that fell in one year. */
export interface DevEffort {
  total: number;
  /** days logged in the year asked about, or null when the data isn't broken down by year */
  inYear: number | null;
}

/**
 * The effort behind a project, as its placard and gate report it.
 *
 * An `effortMeasures` entry of type `byYear` carries the breakdown in its own
 * `years` array and **supersedes** the other measures rather than adding to them —
 * a project holding both (Senatus has `byYear` and `blogDays`) is counting the same
 * work twice. Otherwise the measures are summed, and with no measures at all the
 * category stands in (games1 → 50, games2 → 20, games3 → 10). Null when there is
 * nothing to go on, and the figure is simply not shown.
 */
export function devEffort(p: Project, year?: number): DevEffort | null {
  const measures = p.effortMeasures ?? [];
  const byYear = measures.find((m) => m.type === 'byYear' && m.years?.length);
  if (byYear) {
    const entries = byYear.years!.filter((e) => typeof e.days === 'number');
    const here = year == null ? undefined : entries.find((e) => e.year === year);
    return {
      total: entries.reduce((sum, e) => sum + e.days!, 0),
      inYear: here?.days ?? null,
    };
  }
  if (measures.length) {
    return { total: measures.reduce((sum, m) => sum + (m.days ?? 0), 0), inYear: null };
  }
  switch (p.categoryId) {
    case 'games1': return { total: 50, inYear: null };
    case 'games2': return { total: 20, inYear: null };
    case 'games3': return { total: 10, inYear: null };
    default: return null;
  }
}
