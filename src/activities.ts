import type { Floor } from './types';
import type { FloorBuild } from './floor';
import type { PortalGate } from './portal';
import { buildObbyTrial } from './obby';

// A year's *activity*: a place you dive into from that year's floor, complete,
// and come out of holding an artifact.
//
// An activity is just another `FloorBuild` — same contract as a year floor or a
// project room — so `mountBuild` needs to know nothing about it. Adding next
// year's activity is one entry in ACTIVITIES plus one builder module; a year with
// no entry has no gate on its floor and nothing else changes.

export interface ActivityHandlers {
  /** Dive back out through a gate, to the floor we came from. */
  onLeave: (gate: PortalGate) => void;
  /** Failed — put the player back at the start. */
  onReset: () => void;
  /** Claimed the prize. Safe to call more than once; only the first counts. */
  onClaim: (artifactId: string) => void;
  /** Is the prize already held? Decides whether the pedestal is full or empty. */
  hasArtifact: (id: string) => boolean;
}

export interface ActivityDef {
  year: number;
  /** Portal key on the year floor. Must be unique across that floor's gates. */
  key: string;
  /** Name on the gate's sigil, the door sign, and the HUD place label. */
  title: string;
  /** Second line of the HUD place label. */
  subtitle: string;
  /** Teaser on the floor, under the sign. */
  tagline: string;
  artifactId: string;
  /** Gate tint. Gold sets an activity apart from the genre-coloured project gates. */
  tint: string;
  /** Its own def is handed back so a builder reads title/tint/artifactId from one place. */
  build: (floor: Floor, def: ActivityDef, handlers: ActivityHandlers) => FloorBuild;
}

const ACTIVITIES: ActivityDef[] = [
  {
    year: 2026,
    key: 'activity:2026',
    title: 'The Trial of the Senate',
    subtitle: '2026 · climb, and the Decree is yours',
    tagline: 'Fall once and it starts again',
    artifactId: 'decree-2026',
    tint: '#e0b256',
    build: buildObbyTrial,
  },
];

export function activityForYear(year: number): ActivityDef | null {
  return ACTIVITIES.find((a) => a.year === year) ?? null;
}
