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
  origin?: string;
  category?: string; // injected: parent category name
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

// A single explorable level of the Keep.
export interface Floor {
  year: number;
  projects: Project[];
}
