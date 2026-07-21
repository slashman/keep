// Per-year descriptions + images come live from slashie.net/data/years.json
// (see `loadYearContent` in data.ts, which calls `applyYearsData`). No bundled copy.
import { DATA_BASE } from './config';

/** One year's entry as it arrives in years.json (`imageURL` may be "", null, or absolute). */
export interface YearEntry { text?: string; imageURL?: string | null; }

// Live data from years.json once loaded; null until then (or if the fetch failed).
let LIVE: Record<string, YearEntry> | null = null;

/** Adopt the live years.json payload ({ years: { "YYYY": { text, imageURL } } }). */
export function applyYearsData(json: { years?: Record<string, YearEntry> } | null | undefined): void {
  if (json?.years && typeof json.years === 'object') LIVE = json.years;
}

/** The blurb for a year, or undefined if years.json has none (or wasn't loaded). */
export function yearText(year: number): string | undefined {
  const text = LIVE?.[String(year)]?.text;
  return text && text.trim() ? text : undefined;
}

/** Resolved (proxy/same-origin) URL of a year's image, or null if it has none. */
export function yearImagePath(year: number): string | null {
  const u = (LIVE?.[String(year)]?.imageURL ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : DATA_BASE + u.replace(/^\//, '');
}
