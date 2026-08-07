import { artifactById, type Artifact } from './artifacts';

// What the player has won, kept across visits.
//
// This is the only persistent state in the whole app — everything else is fetched
// live or rebuilt from scratch on mount. Storage is therefore treated as a nicety,
// never a dependency: every call is wrapped, and a browser that refuses it (private
// mode, third-party-storage blocking, quota) just gets an inventory that lasts the
// session. Nothing here may throw during boot.

/** Bump the suffix if the stored shape ever changes; old keys are then simply ignored. */
const KEY = 'slashie.keep.inventory.v1';

export class Inventory {
  private owned = new Set<string>();
  /** False once storage has proven unusable, so we stop trying every claim. */
  private persists = true;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const ids: unknown = JSON.parse(raw);
        // Only keep ids that still name a real artifact — a renamed or retired one
        // should disappear rather than sit in the panel as a blank row.
        if (Array.isArray(ids)) {
          for (const id of ids) if (typeof id === 'string' && artifactById(id)) this.owned.add(id);
        }
      }
    } catch (err) {
      this.persists = false;
      console.warn('[inventory] storage unavailable; artifacts will not survive a reload:', err);
    }
  }

  has(id: string): boolean {
    return this.owned.has(id);
  }

  /** Award an artifact. Returns false if it was already held, so the fanfare fires once. */
  grant(id: string): boolean {
    if (this.owned.has(id)) return false;
    this.owned.add(id);
    this.save();
    return true;
  }

  /** Everything held, in the artifact table's own order. */
  list(): Artifact[] {
    const out: Artifact[] = [];
    for (const id of this.owned) {
      const a = artifactById(id);
      if (a) out.push(a);
    }
    return out.sort((a, b) => a.year - b.year);
  }

  private save() {
    if (!this.persists) return;
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.owned]));
    } catch (err) {
      this.persists = false;
      console.warn('[inventory] could not save:', err);
    }
  }
}
