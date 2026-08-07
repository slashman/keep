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
  + `crossOrigin` on loaders — `loadHTMLImage()` in `src/textures.ts` already sets
  `crossOrigin='anonymous'` so cross-origin images don't taint the tapestry canvas).
- **Dev-only bot-challenge cookie (fragile).** slashie.net guards every URL with a JS
  cookie challenge: the first hit returns `409` + an inline `<script>` that sets
  `humans_21909=1` and reloads. The dev proxy presents that solved cookie
  (`headers: { Cookie: 'humans_21909=1' }` in `vite.config.ts`) so proxied `fetch`/image
  requests don't loop on 409. **If the host rotates the cookie name/value, `npm run dev`
  409s again** — re-grab it with `curl -D - https://slashie.net/data/projects.json`. Prod
  is unaffected (the browser loads the site document and solves the challenge itself).

### 2. Snapshotted data — RESOLVED ✅ (client ships zero hardcoded content)
- **Year blurbs + images** come live from `data/years.json`
  (`{ years: { "YYYY": { text, imageURL } } }`), applied via `applyYearsData()` in
  `src/yearContent.ts`. The old scraped `YEAR_DESCRIPTIONS` map **and** the
  `yearImagePath()` snapshot map are gone — new years now flow in automatically.
- **Collaborators** come live from `data/friends.json` (`loadFriends()` in `src/data.ts`),
  replacing the old `projects.json` "collaborators" category lookup.
- **`public/projects.fallback.json` deleted.** `loadData()` fetches `projects.json` and
  **throws if unreachable** (boot shows "Could not reach slashie.net"). `years.json` /
  `friends.json` are best-effort — a missing one just drops year blurbs / collaborator
  NPCs; the app never serves stale bundled data.

### 3. Category-id coupling
- **Where:** `isBigProject()` in `src/floor.ts` and `devDays()` in `src/textures.ts`
  hardcode `games1` / `games2` / `games3` and the `> 20` day threshold.
- **Problem:** if the site renumbers categories, projects silently stop being classified
  as "big" (corridor placement) and dev-days derivation breaks — with no visible error.

### 4. Per-year activities and artifacts (hand-authored, and deliberately so)
- **Where:** `src/activities.ts` (one `ActivityDef` per year), `src/artifacts.ts` (one
  `Artifact` per year), and a builder module per activity (`src/obby.ts` for 2026).
- **Why it isn't data-driven:** an activity is a *level*, not a record. `projects.json`
  could never describe one, and each is meant to be different from the last. This is the
  same escape hatch as `roomModel.ts`'s title-keyed model table.
- **Adding next year's:** one entry in `ACTIVITIES`, one in `ARTIFACTS`, one builder that
  returns a `FloorBuild`. Nothing else changes — a year with no entry simply grows no gate
  on its front wall, which is what every year but 2026 does today.
- **The one thing that will drift:** `Artifact.id` is the localStorage key. Renaming one
  silently orphans everyone's collection. `Inventory` drops ids it no longer recognises on
  load, so a rename reads as "the player never had it" rather than as a crash.

### 5. The first persistent state
- **Where:** `src/inventory.ts`, key `slashie.keep.inventory.v1`.
- Everything else in the app is fetched live or rebuilt from scratch on mount; this is the
  only thing that survives a reload. Every storage call is wrapped, and a browser that
  refuses storage degrades to an inventory that lasts the session. **Nothing here may
  throw during boot** — bump the key suffix rather than changing the stored shape.

### 6. Hand-authored content
- **Custom NPCs** (Gaby, Adri) and their local images live in `src/data.ts`
  (`CUSTOM_PEOPLE`) + `public/people/`. Intentionally manual; low risk. These are the
  only client-side content left — not a snapshot (they aren't on the server). Gaby uses
  `birthYear` to appear as a baby-in-a-cradle on 2017 and grow taller each year after.
  To go fully data-driven, add them to `friends.json` (with `birthYear`) and drop
  `CUSTOM_PEOPLE`.

---

## 🎯 Highest-leverage fixes (require slashie.net changes — you own it)

- [ ] **Add CORS to slashie.net** (`Access-Control-Allow-Origin: *` on `/data/*` and
  `/img/*`). Eliminates the dev proxy (and its bot-challenge cookie hack) entirely, makes
  the app deployable from any origin. Single highest-value change still open.
- [x] **Publish per-year content + collaborators as real data** — `data/years.json` and
  `data/friends.json` now exist and are fetched live like `projects.json`, so new years'
  descriptions/images and new collaborators flow in automatically. Retired the year-bundle
  scrape and **all** snapshots.

---

## 🔧 Quick wins (no site changes needed)

- [ ] **Name the category-id / threshold constants** in one place with a comment, so the
  coupling is visible and easy to update.
- [ ] **Add a dev warning** logging projects skipped for missing `year` or unknown
  category, so drift is noticeable during development.
- [x] **Live year images + retire the scrape** — done via `years.json` (`imageURL` per
  year); the snapshot map and `scrape-year-content.mjs` are no longer needed.

---

## 📦 Production deployment checklist (slashie.net/keep)

- [x] Env-based bases wired (`src/config.ts`); prod is same-origin, no proxy/CORS.
- [ ] `npm run build`, then upload `dist/*` into `public_html/keep/` on slashie.net.
- [ ] Confirm slashie.net's root `.htaccess` SPA rewrite doesn't swallow `/keep/*`
      (static files with real extensions serve fine; add an exclude if needed).
- [ ] Load `https://slashie.net/keep/` and verify live data + project/year/collaborator
      images all render (they're same-origin, so no CORS/taint concerns).
- [ ] Verify `data/projects.json`, `data/years.json` and `data/friends.json` are reachable
      from the deploy — there is **no offline fallback**; if `projects.json` is unreachable
      the app shows an error instead of rendering.
