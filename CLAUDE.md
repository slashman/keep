# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on :5173 (needs the /slashie proxy — see below)
npm run build    # tsc --noEmit && vite build → dist/ with asset URLs under /keep/
npm run preview  # serves the build locally; data/images will NOT resolve (see Deployment)
```

There is no test suite and no linter. `npm run build` is the only gate: `tsconfig.json` has
`strict`, `noUnusedLocals` and `noUnusedParameters`, so unused imports/params fail the build.

Deploy = upload the contents of `dist/` into `public_html/keep/` on slashie.net (Bluehost).

## What this is

A first-person three.js "castle" of the projects on slashie.net. Each **year is a floor**;
each **project is a portal gate** on a wall that you jump into to reach that project's own
room. Vanilla TypeScript + three.js + Vite — no framework, no state library, and almost no
asset files: every texture is drawn on a `<canvas>`, and every sound *effect* is synthesized in
`audio.ts`. Two exceptions live in `src/assets`, both fetched on demand rather than at boot —
the looping museum score (`audio/mx_museum.ogg`; the old synthesized drone is still there as a
fallback, since Ogg Vorbis does not decode everywhere) and the optional 3D centrepiece a project
room can hold (`*.glb`, loaded by `roomModel.ts`).

## Data and base paths (the fragile part)

All content is fetched **live** from slashie.net at boot; the client ships **zero** bundled
content. `data/projects.json` is required (failure shows an error screen); `data/years.json`
and `data/friends.json` are best-effort (failure just drops year blurbs / collaborator NPCs).

`src/config.ts` defines two different roots, and they are not interchangeable:

- `DATA_BASE` — slashie.net content (`data/*.json`, `img/...`). In dev this is the Vite
  `/slashie` proxy; in prod it is `ASSET_BASE` (`/keep/`), **not** `/`.
- `ASSET_BASE` — this app's own `public/` assets (`people/*.png`, `embeddable.php`).

Why prod `DATA_BASE` is `/keep/` and not `/`: slashie.net wraps the whole site in a JS
bot-challenge (a cold request returns 409/406 with an inline script that sets `humans_21909=1`
and reloads). A browser navigating to `/keep/` solves it, but the cookie is `path=/keep`, so
`fetch`/`TextureLoader` against root `/data` or `/img` would loop on the challenge. The fix is
server-side symlinks **not tracked in this repo** — `public_html/keep/data → ../data` and
`public_html/keep/img → ../img` (recreate with `deploy/mklinks.php` if `/keep` is ever wiped).
Do not "simplify" `DATA_BASE` back to `'/'`.

In dev there are no symlinks and no browser to solve the challenge, so `vite.config.ts` proxies
`/slashie → slashie.net` and injects `Cookie: humans_21909=1` server-side. **If that cookie
name/value is rotated by the host, `npm run dev` starts 409ing** — re-grab it with
`curl -D - https://slashie.net/data/projects.json`. A second proxy, `/keep-api → /keep`, reaches
the deployed `embeddable.php` because Vite can't execute PHP locally.

`vite preview` can't reach either, so the build shows fallback art locally — that's expected.

## Architecture

`src/main.ts` owns the renderer, camera, scene, the frame loop and all cross-cutting state. It
is the only module that knows about both floors and rooms; everything else is a builder or a
subsystem it wires together.

**One "place" is mounted at a time.** A year floor (`floor.ts:buildFloor`) and a project room
(`room.ts:buildProjectRoom`) both return the same `FloorBuild` contract (`floor.ts`): a
`THREE.Group`, its `interactables`, its `portals`, a `CollisionWorld`, a `spawn` pose, an
optional per-frame `update`, and `dispose`. `mountBuild()` in `main.ts` swaps them — removing
and disposing the old group — so scene size stays constant regardless of how many years exist.
Adding a new kind of place means returning a `FloorBuild`, nothing more.

**Collision is data, not geometry.** `CollisionWorld` (`controls.ts`) is a union of walkable
XZ rectangles minus circular `excluders`. Walls are cosmetic. Movement resolves each axis
independently against `walkable()`, which is what lets the player slide along walls and pass
through doorways where rectangles overlap. Every portal gate pushes a small "alcove" rect in
front of itself so you can step up to it and leap in; the orb is an excluder.

**Interaction is opt-in per mesh.** `InteractionManager` raycasts from screen center over
exactly the meshes registered in `interactables`; a build that forgets to push an entry makes an
object unclickable no matter how it looks. Setting `mesh.userData.pulse = someMesh` makes the
manager brighten that mesh's `emissiveIntensity` while focused.

**Layout is derived from the data**, never hardcoded. `buildFloors()` groups projects by `year`
plus each project's `years` array (extra years get a `revisited: true` copy). `isBigProject()`
sends >20-dev-day projects to the corridor and everything else to two side halls; corridor
length, hall length, lighting and collision rects all scale from those counts. Note the
category-id coupling: `isBigProject()` (`floor.ts`) and `devDays()` (`textures.ts`) hardcode
`games1`/`games2`/`games3` as the fallback when a project has no `effortMeasures`.

**The portal dive is a three-way collaboration** and the trickiest flow to change: `main.ts`
(`dive` → `diveIn` → `stageEmergence` → `emerge`) drives a `cinematic` per-frame callback while
`controls.enabled = false`; `portal.ts` owns the membrane shader and its ripple (forward for an
entry, `ripple(true)` reverse for an emergence); `avatar.ts` is your body, which lives on the
scene rather than in a build so it survives the mid-dive swap. `diving` guards the camera —
anything that re-enables controls must go through `enableControls()`, which respects it. Entry
is triggered by `checkPortals()` when the eye is inside a gate's mouth while `airborne`.

**Textures are canvas-drawn on demand** in `textures.ts` (placards, plaques, banners, tapestries,
name tags, fallback art). Real project images load asynchronously via `attachProjectArt()` and
swap in when ready — for a gate through `setGateMap()`, since the membrane carries its art in a
shader uniform rather than `material.map`. `disposeObject()` (`floor.ts`) knows about that and
disposes textures held in uniforms; keep new materials disposable through it.

**A project room can hold a 3D centrepiece**, and that is the one piece of content this repo
owns rather than fetches. `roomModel.ts` maps a project to an optional `.glb` — keyed by
**title**, because projects.json entries have no id yet; give them one and `modelFor()` is the
only thing that changes — and `room.ts` stands it on the dais in place of the floating shard.
Both halves are on-demand: the `GLTFLoader` through a dynamic `import()` so it stays out of the
startup chunk, the model through a `?url` import that is only a string until something loads it
(the Miku file alone is 5 MB — ten times the JS bundle). Two traps worth knowing: a room can be
disposed while its model is still in flight, so a late arrival is dropped and disposed; and not
every glTF "animation" is one — that file ships four **zero-duration poses** among its clips,
and playing one looks exactly like a mixer that never ticks, so only clips with a duration are
eligible.

**UI is imperative DOM.** `ui.ts` builds every overlay in its constructor and exposes
`show*`/`hide*` methods plus `onStart`/`onPickFloor`/`onCloseOverlay` callbacks that `main.ts`
wires. The `#elevator`/`#video`/`#web` element ids matter — the CSS in `styles.css` keys off
them. `styles.css` is loaded straight from `index.html`, not imported by TS.

Touch is a parallel input path: `PlayerControls.touch` swaps pointer-lock for a `touchActive`
flag, and `touch.ts` supplies an on-screen joystick/jump/interact.

## Notes

- The in-app link popup can't detect a refused iframe from JS, so `public/embeddable.php` checks
  `X-Frame-Options`/CSP `frame-ancestors` server-side and answers `{embeddable}`; ambiguity
  always answers `true` and the "Open in new tab" link is the fallback.
- `deploy/slashie-net.htaccess` is only needed if the app is ever hosted off slashie.net (that
  would reintroduce the CORS requirement the current same-origin deploy avoids).
- `nextsteps.md` tracks known coupling points and open maintainability tasks; `README.md`
  describes the intended player experience in detail — read it before changing world layout.
