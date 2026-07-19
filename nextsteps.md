# The Slashie Keep — Next Steps & Maintainability

Long-term maintainability notes as `projects.json` evolves and new years arrive.
Captures what already adapts on its own, the coupling points that will drift, and
prioritized future tasks.

---

## ✅ What already adapts automatically (no code change needed)

Adding a project — or a whole new year — to `projects.json` "just works":

- **Floors** are derived by `buildFloors()` grouping on `year` / `years`. No hardcoded
  year list; a new year mints a new floor and the orb directory lists it.
- **Geometry scales to content** — corridor rows, side-hall length, collision regions,
  and lighting are computed from project counts.
- **Corridor vs. hall split** is criteria-based (`isBigProject`), not positional.
- **Buttons, tags, collaborators, dev-days, NPCs** are field-driven with graceful
  fallbacks (unknown button type → generic style; missing image → drawn fallback;
  non-YouTube video → opens a tab; ref with no collaborator entry → no NPC).

---

## ⚠️ Coupling points (things outside `projects.json` that will drift)

### 1. The `/slashie` dev proxy — RESOLVED for the slashie.net/keep deploy ✅
- **Where:** `vite.config.ts`, `src/config.ts`.
- **Was:** proxy existed only in `vite dev`; a production build couldn't reach the data
  or images (slashie.net has no CORS).
- **Now:** env-based bases (`DATA_BASE` / `ASSET_BASE` in `src/config.ts`). Production is
  hosted **on slashie.net at `/keep`**, so data/images are **same-origin — no proxy, no
  CORS needed**. The proxy remains for `npm run dev` only. See README → "Deploying".
- **Still open only if you move off slashie.net:** hosting the app on a *different*
  origin would reintroduce the CORS requirement (the `deploy/slashie-net.htaccess` header
  + `crossOrigin` on loaders).

### 2. Snapshotted data that goes stale
- **`src/yearContent.ts` — year descriptions.** Scraped from slashie.net's *minified JS
  bundle* (they are **not** in `projects.json`). New years' blurbs won't appear until the
  file is re-scraped/regenerated. Most fragile piece — depends on the bundle's
  minification shape.
- **`yearImagePath()` snapshot map (in `src/yearContent.ts`).** A hardcoded map of which
  years have `img/years/YYYY.jpg`. A new year's tapestry image exists live but won't be
  used because the map doesn't list it (falls back to the project-image montage).
- **`public/projects.fallback.json`.** Frozen copy, used only when the live fetch fails —
  but then it silently serves old data.

### 3. Category-id coupling
- **Where:** `isBigProject()` in `src/floor.ts` and `devDays()` in `src/textures.ts`
  hardcode `games1` / `games2` / `games3` and the `> 20` day threshold.
- **Problem:** if the site renumbers categories, projects silently stop being classified
  as "big" (corridor placement) and dev-days derivation breaks — with no visible error.

### 4. Hand-authored content
- **Custom NPCs** (Gaby, Adri) and their local images live in `src/data.ts`
  (`CUSTOM_PEOPLE`) + `public/people/`. Intentionally manual; low risk.

---

## 🎯 Highest-leverage fixes (require slashie.net changes — you own it)

- [ ] **Add CORS to slashie.net** (`Access-Control-Allow-Origin: *` on `/data/*` and
  `/img/*`). Eliminates the dev proxy entirely, makes the app deployable and fully live.
  Single highest-value change.
- [ ] **Publish per-year content as real data** — e.g. `/data/years.json`
  (`{ year: { description, image } }`) instead of burying it in the JS bundle. The app
  then fetches it live like `projects.json`, so **new years' descriptions/images flow in
  automatically**, retiring the scrape and both snapshots.

---

## 🔧 Quick wins (no site changes needed)

- [ ] **Derive the year-image path from the year** — use `/slashie/img/years/${year}.jpg`
  directly and let a 404 fall back to the montage. Removes the snapshot map; new years'
  tapestries work automatically.
- [ ] **Name the category-id / threshold constants** in one place with a comment, so the
  coupling is visible and easy to update.
- [ ] **Add a dev warning** logging projects skipped for missing `year` or unknown
  category, so drift is noticeable during development.
- [ ] **Commit `scripts/scrape-year-content.mjs`** so regenerating `yearContent.ts` is one
  documented command (until `years.json` exists).

---

## 📦 Production deployment checklist (slashie.net/keep)

- [x] Env-based bases wired (`src/config.ts`); prod is same-origin, no proxy/CORS.
- [ ] `npm run build`, then upload `dist/*` into `public_html/keep/` on slashie.net.
- [ ] Confirm slashie.net's root `.htaccess` SPA rewrite doesn't swallow `/keep/*`
      (static files with real extensions serve fine; add an exclude if needed).
- [ ] Load `https://slashie.net/keep/` and verify live data + project/year/collaborator
      images all render (they're same-origin, so no CORS/taint concerns).
- [ ] Periodically refresh `public/projects.fallback.json` so the offline fallback isn't
      too stale.
