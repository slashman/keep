// Each tag family gets a signature colour, used for the pills on the placards
// and the accent lighting of a display.
export const TAG_FAMILY = {
  genre: { label: 'Genre', color: '#e0b256' }, // gold
  technologies: { label: 'Tech', color: '#4fc7d8' }, // cyan
  collaborators: { label: 'With', color: '#b98bff' }, // violet
  artStyle: { label: 'Art', color: '#f07a9c' }, // rose
} as const;

export type TagFamily = keyof typeof TAG_FAMILY;

/** Deterministic pleasant hue from any string (used for the genre banner cloth). */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function genreColor(genre: string | undefined): string {
  if (!genre) return '#6a5a8a';
  const h = hueFromString(genre);
  return `hsl(${h}, 55%, 52%)`;
}

// Physical button styling on the lecterns.
interface BtnStyle { color: string; glyph: string; verb: string; }

const BTN_STYLES: Record<string, BtnStyle> = {
  'play-online': { color: '#57c66a', glyph: '▶', verb: 'Play online' },
  video:         { color: '#e5484d', glyph: '🎬', verb: 'Watch video' },
  steam:         { color: '#7aa7d8', glyph: '🎮', verb: 'Steam page' },
  download:      { color: '#3fb8a0', glyph: '⬇', verb: 'Download' },
  'source-code': { color: '#b98bff', glyph: '❮❯', verb: 'Source code' },
  devlog:        { color: '#e0b256', glyph: '✎', verb: 'Read devlog' },
  website:       { color: '#5aa9ff', glyph: '🌐', verb: 'Visit site' },
  info:          { color: '#9aa0b4', glyph: 'ℹ', verb: 'More info' },
  jam:           { color: '#f07a9c', glyph: '★', verb: 'Game jam' },
  apple:         { color: '#d6d6d6', glyph: '', verb: 'App Store' },
  android:       { color: '#8bc34a', glyph: '🤖', verb: 'Google Play' },
};

export function buttonStyle(type: string): BtnStyle {
  return BTN_STYLES[type] ?? { color: '#c9b98a', glyph: '↗', verb: 'Open' };
}

/**
 * Return a YouTube video id if the url points at a single embeddable video,
 * otherwise null (channels / playlists / users can't be embedded standalone).
 */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1) || null;
    if (host.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|v)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch {
    /* not a url */
  }
  return null;
}
