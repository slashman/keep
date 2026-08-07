// The prizes. One artifact per year, won by completing that year's activity.
//
// Hand-authored, like `roomModel.ts`'s model table and `data.ts`'s CUSTOM_PEOPLE:
// there is nothing in projects.json that could derive these, and a year without
// an entry here simply has no activity and no prize (see `activities.ts`).

export interface Artifact {
  /** Stable id — this is what goes in localStorage, so never renumber one. */
  id: string;
  year: number;
  name: string;
  /** One line, shown when you claim it and in the inventory panel. */
  blurb: string;
  /** The face it shows in the HUD. An emoji: the HUD is DOM, not canvas. */
  glyph: string;
}

const ARTIFACTS: Artifact[] = [
  {
    id: 'decree-2026',
    year: 2026,
    name: 'Senatorial Decree of Power',
    blurb: 'Sealed at the summit of the Trial. Grants its bearer no power whatsoever, ' +
      'but says so in a very impressive hand.',
    glyph: '📜',
  },
];

const BY_ID = new Map(ARTIFACTS.map((a) => [a.id, a]));

export function artifactById(id: string): Artifact | null {
  return BY_ID.get(id) ?? null;
}

export function artifactForYear(year: number): Artifact | null {
  return ARTIFACTS.find((a) => a.year === year) ?? null;
}

/** Every artifact that exists, oldest year first — the inventory panel's running order. */
export function allArtifacts(): Artifact[] {
  return ARTIFACTS.slice().sort((a, b) => a.year - b.year);
}
