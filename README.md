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

- **Data** comes live from `https://slashie.net/data/projects.json`, the same source
  slashie.net uses. Because that host sends no CORS headers, the Vite dev server
  proxies everything under `/slashie` → `https://slashie.net` so the JSON *and* the
  project images become same-origin (a browser can't otherwise use cross-origin
  images as WebGL textures). A bundled snapshot in `public/projects.fallback.json`
  is used automatically if the live fetch fails.
- **Floors = years.** Projects are grouped by their `year` field; the central
  **elevator** (press `E`) opens a floor directory to travel between them. Only one
  floor is built at a time and disposed on travel, keeping the scene light.
- **Floor plan (a plus/cross).** You step out of the elevator into a short
  **corridor** with the year tapestry on the wall straight ahead. The corridor holds
  the first **6** projects; any remainder overflows into **two side halls** entered
  through **doors left and right of the elevator**, split evenly between them. The
  halls are only built when they have projects to show. Collision is a union of
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

> **Note on production:** the `/slashie` proxy only exists in the Vite dev server.
> To deploy the built `dist/`, put an equivalent reverse-proxy (or a CORS-enabled
> mirror of the data + images) in front of it, or point the URLs in `src/data.ts`
> and `src/floor.ts` at a CORS-friendly origin.
```
