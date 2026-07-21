# The Slashie Keep 🏰

A first-person, WASD-explorable castle/museum of the projects on
[slashie.net](https://slashie.net). Every **floor is a year**, every **room is a
project** started that year, complete with a painting, a museum placard, colour-coded
tag banners, and levers that open the project online — or play its YouTube videos
right inside the Keep.

Built with **three.js + TypeScript + Vite**.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click **Enter the Keep**.

```bash
npm run build     # type-check + production bundle into dist/
npm run preview   # serve the production build
```

## Controls

| Action | Keys |
| --- | --- |
| Move | `W` `A` `S` `D` (or arrows) |
| Look | Mouse (click to lock the pointer) |
| Run | `Shift` |
| Interact (levers / elevator) | `E` or click |
| Release cursor / close a menu | `Esc` |

## How it works

- **Data** comes live from slashie.net — `data/projects.json` (projects),
  `data/years.json` (per-year blurbs + images) and `data/friends.json`
  (collaborators). Because that host sends no CORS headers, the Vite dev server
  proxies everything under `/slashie` → `https://slashie.net` so the JSON *and* the
  project images become same-origin (a browser can't otherwise use cross-origin
  images as WebGL textures). There is **no bundled snapshot** — the client ships no
  hardcoded content. `projects.json` is required (an unreachable host shows an error);
  a missing `years.json`/`friends.json` just drops year blurbs / collaborator NPCs.
- **Floors = years.** Projects are grouped by their `year` field. A floor also
  includes projects **developed but not started** that year — derived from each
  project's `years` array — shown after the started ones and marked *CONTINUED* on
  their placards. The **magic orb** (press `E`) opens a floor directory to travel
  between years. Only one floor is built at a time and disposed on travel, keeping
  the scene light.
- **Floor plan (a plus/cross).** You arrive beside the **magic orb** in a short
  **corridor** with the year tapestry on the wall straight ahead. The corridor is
  reserved for **big projects** — those with more than **20 logged dev days**
  (summed from `effortMeasures`), or, when a project has no `effortMeasures` data,
  those in the **Big Games** (`games1`) or **+1 Month Game Projects** (`games2`)
  categories. Everything else overflows into **two side halls** entered through
  **doors left and right of the orb**, split evenly between them. Corridor and halls
  are each only built when they have projects to show. Collision is a union of
  walkable rectangles that overlap at the doorways.
- **The year wall** (opposite the elevator) hangs a grand **tapestry** — the real
  per-year image from `slashie.net/img/years/YYYY.jpg`, loaded live via the proxy
  (a project-image montage or woven pattern for years without one) — and a
  **chronicle panel** with that year's description plus its projects and dominant
  genres/tech/collaborators. The per-year *descriptions* live only inside
  slashie.net's hash-named JS bundle, so they're snapshotted into
  `src/yearContent.ts`; the *images* are loaded live.
- **Each project room** shows:
  - a **painting** — the project's `image` (procedural fallback when missing),
  - a **placard** — title, subtitle, description, status/activity/client/effort,
  - a **hanging banner** coloured by the project's primary genre,
  - **colour-coded tag pills** — 🟡 genre · 🔵 technologies · 🟣 collaborators · 🌸 art style,
  - a **lectern of levers**, one per button in the data.
- **Collaborator NPCs.** The people worked with each year (from each project's
  `collaborators`, resolved against the *People I've worked with* category) appear as
  simple blocky, Roblox-style characters scattered around the floor. Each has a cube
  head showing that person's picture (loaded live from slashie.net; a drawn face when
  none exists) and a floating name tag, and turns to **stare at the player**. Capped
  per floor to avoid overcrowding.
- **Buttons** map to their type: `play-online` / `steam` / `download` / `source-code`
  / `devlog` / `website` open in a new tab; `video` YouTube links play in an in-app
  overlay (channels/playlists, which can't be embedded standalone, open in a tab).

## Project layout

```
src/
  main.ts         renderer, scene, loop, input wiring, floor lifecycle
  data.ts         fetch (live + fallback) and group projects into floors
  types.ts        data model
  controls.ts     hand-rolled pointer-lock FPS controller + collision
  interaction.ts  center-screen raycaster: focus, prompt, activation
  floor.ts        builds one year's hall: shell, lighting, elevator, displays
  textures.ts     canvas-drawn paintings, placards, banners, button labels
  tags.ts         tag family colours + YouTube id extraction
  ui.ts           all HTML overlays (start, loading, elevator, video, HUD)
vite.config.ts    the /slashie → slashie.net dev proxy
```

## Deploying (to https://slashie.net/keep)

The app is built to be hosted **on slashie.net itself**, so the data and images are
**same-origin — no CORS or proxy needed in production**. Two base paths handle this
(`src/config.ts`):

- `DATA_BASE` — slashie.net-root content (`projects.json`, `/img/...`): the `/slashie`
  **dev proxy** in development, and the site **root `/`** in the production build.
- `ASSET_BASE` — the app's own bundled assets (fallback snapshot, `public/people` photos):
  Vite's `base`, which is `/keep/` in the build and `/` in dev.

```bash
npm run build            # emits dist/ with asset URLs under /keep/
# upload the contents of dist/ into slashie.net's  public_html/keep/
```

Then it's live at `https://slashie.net/keep/` with live data and images, no server
changes. (`vite preview` runs the build locally but can't reach slashie.net's root, so
it shows the bundled snapshot with fallback art — that's expected; only a real
slashie.net deploy resolves the root `/data` and `/img` paths.)
```
