# Slashie's Keep 🏰

A first-person, WASD-explorable castle/museum of the projects on
[slashie.net](https://slashie.net). Every **floor is a year**, and every project
hangs on its wall as a **rippling portal**: walk up to the painting, **jump**, and
you are pulled through — Super Mario 64 style — into that project's own room, with
its artwork wall-sized, its museum placard, and a dais of levers that open the
project online or play its YouTube videos right inside the Keep.

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
| Jump (and enter a painting) | `Space` |
| Interact (levers / elevator) | `E` or click |
| Mute / unmute sound | `M` |
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
- **Floors = years.** Projects are grouped by their `year` field, and a project
  stands on that one floor however many years it went on being worked on. Those
  later years show as **effort** instead: where `effortMeasures` breaks the work
  down per year, a gate and its placard read *148 days of work this year · 400 in
  total*. The **magic orb** (press `E`) opens a floor directory to travel
  between years. Only one floor is built at a time and disposed on travel, keeping
  the scene light.
- **Floor plan (a plus/cross).** You arrive beside the **magic orb** in a short
  **corridor** with the year tapestry on the wall straight ahead. The corridor is
  reserved for **big projects** — those with more than **20 logged dev days** over
  the project's whole life (from `effortMeasures`, per-year breakdowns included),
  or, when a project has no `effortMeasures` data,
  those in the **Big Games** (`games1`) or **+1 Month Game Projects** (`games2`)
  categories. Everything else overflows into **two side halls** entered through
  **doors left and right of the orb**, split evenly between them. A year that began
  nothing big still shows its **largest work** in the corridor, so you never arrive
  to an empty one. Corridor and halls are each only built when they have projects
  to show. Collision is a union of
  walkable rectangles that overlap at the doorways.
- **The year wall** (opposite the elevator) hangs a grand **tapestry** — the real
  per-year image from `slashie.net/img/years/YYYY.jpg`, loaded live via the proxy
  (a project-image montage or woven pattern for years without one) — and a
  **chronicle panel** with that year's description plus its projects and dominant
  genres/tech/collaborators. The per-year *descriptions* live only inside
  slashie.net's hash-named JS bundle, so they're snapshotted into
  `src/yearContent.ts`; the *images* are loaded live.
- **Each project's wall slot** is a **gate**, not a frame:
  - a stone arch whose mouth holds a **living membrane** — the project's `image`
    (procedural fallback when missing) rendered through a shader that makes it
    breathe, shimmer at the rim, and burst into concentric rings when entered,
  - a **hanging banner** coloured by the project's primary genre, and a spare
    **plaque** on the lintel giving only the project's name and its dev days —
    everything else waits inside,
  - a glowing **rune on the floor** marking the run-up. The mouth starts at chin
    height, so walking into it just bumps the sill: **step onto the rune and jump**
    (or press `E` / tap the gate) and you go through.
- **The dive is shot in third person.** The camera drops out of your head, backs
  off to a shoulder view and holds still while **your own character** — the same
  blocky build as the NPCs, keeping its drawn smiley since it has no portrait —
  pitches head-first into the membrane, which bursts as it reaches it and swallows
  the body. On the far side you come back to a camera already trained on that
  room's gate, watching yourself tumble out and land, before it settles into your
  eyes and first person resumes. The arrival ripple runs **backwards**: the portal
  is blazing as the curtain lifts and its rings converge back to stillness.
- **Behind the gate is the project's room** — you land
  in a chamber holding the project's artwork **wall-sized**, the full museum
  **placard** (title, subtitle, description, status/activity/client/effort and
  colour-coded tag pills — 🟡 genre · 🔵 technologies · 🟣 collaborators · 🌸 art
  style), its genre banner, and a raised **dais** ringed with **levers**, one per
  button in the data, under a floating shard tinted by the project's genre. Only
  the people credited on *that* project stand in the room. The gate you came
  through is behind you: turn around and leap back to the year floor.
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
  floor.ts        builds one year's hall: shell, lighting, elevator, gates
  portal.ts       the gate itself: rippling-membrane shader, splash rings, trigger volume
  room.ts         builds the room behind a gate: mural, placard, dais of levers, way home
  avatar.ts       your own body, shown only for the third-person shots of a dive
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
