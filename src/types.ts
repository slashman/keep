// Button types seen in the slashie.net data:
// website, devlog, steam, apple, android, play-online, download, info,
// source-code, video, jam
export type ButtonType =
  | 'website' | 'devlog' | 'steam' | 'apple' | 'android' | 'play-online'
  | 'download' | 'info' | 'source-code' | 'video' | 'jam';

export interface ProjectButton {
  title: string;
  url: string;
  type: ButtonType | string;
}

export interface EffortMeasure {
  type: string;
  period?: string;
  days?: number;
  ref?: string;
}

export interface Project {
  title: string;
  subtitle?: string;
  image?: string;
  text?: string;
  status?: string;
  activity?: string;
  buttons?: ProjectButton[];
  year?: number;
  years?: number[];
  lastUpdate?: number;
  genre?: string[];
  technologies?: string[];
  collaborators?: string[];
  artStyle?: string[];
  client?: string;
  weeksOfWork?: number;
  effortMeasures?: EffortMeasure[];
  origin?: string;
  category?: string;   // injected: parent category name
  categoryId?: string; // injected: parent category id (e.g. "games1")
  revisited?: boolean; // injected: on a floor for a year it was developed but not started
}

export interface Category {
  name: string;
  id: string;
  text?: string;
  projects?: Project[];
}

export interface ProjectsData {
  projects: Category[];
}

/** An entry in the "People I've worked with" category. */
export interface Collaborator {
  key: string;
  title: string;
  image?: string;
  country?: string;
  skills?: string[];
  text?: string;
  url?: string;
  portraitLeftMargin?: number; // 0..1: crop a full-height square from this x fraction instead of centring
}

/** A resolved person to represent as an NPC on a floor. */
export interface Person {
  key: string;
  name: string;
  image?: string;
  text?: string;
  scale?: number;     // body size multiplier (default 1)
  priority?: boolean; // always placed, never dropped by the NPC cap
  age?: number;       // for people born within the timeline: years since birth on this floor
  baby?: boolean;     // age 0 → shown static in a cradle, not a walking NPC
  portraitLeftMargin?: number; // 0..1: portrait x-crop offset (see squareImageTexture); undefined → centred
}

// A single explorable level of the Keep.
export interface Floor {
  year: number;
  projects: Project[];
}
