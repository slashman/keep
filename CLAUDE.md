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
room. A year may also hold an **activity** — a gate on the front wall leading to a place you
complete for an **artifact**, kept in an inventory that survives a reload (2026 only so far). Vanilla TypeScript + three.js + Vite — no framework, no state library, and almost no
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

**Ground height is a third list, and it is opt-in.** A `CollisionWorld` may also carry
`platforms: Platform[]` — walkable rects with a `top`, an optional XZ velocity (a rider is
carried), and an optional `active` flag (blinking). `resolveGround(x, z, maxTop)` picks the
highest one not above `maxTop`; everything vertical — gravity's floor, `airborne`, `jump()`,
`setPose()` — is measured from that instead of from 0. **Omit `platforms` and the behaviour is
exactly what it was**, which is why floors and rooms needed no changes.

`maxTop` is the whole rule, and it must be the feet's own height nearly always. Letting it
reach *above* the feet is the step-up, and **the step-up is only ever legal while already
standing**: a mid-air player briefly within `STEP_UP` of a ledge would otherwise be snapped up
onto it with their velocity zeroed — jump up under a platform and you'd stick to its underside
instead of clearing it. Two things a platform still deliberately does not have: sides and an
underside. You rise up through one from below and never bonk your head, so lay them out where
that isn't a shortcut. The frame order matters and is commented in `update()`: carry, then
gravity, then input, then a re-resolve that steps you up onto a low lip (walking *off* an edge
needs no code — the ground drops and gravity does the rest). Because `main.ts` runs
`controls.update` before the build's `update`, a mover's pose and velocity are both one frame
stale, which is consistent; a measured full ride drifts 3 cm.

`JUMP_ARC` (exported from `controls.ts`) is the derived apex/hang/reach of the leap, and its
`apex` is the **sampled** peak, not the analytic one — velocity is decremented before the
position integrates, so a 60 fps frame loses `JUMP_SPEED/120` off the top, and that lower figure
is what a level has to be jumpable at. Anything laying out ground to jump across should build
its distances from `JUMP_ARC` rather than hardcoding metres.

**A year can hold an activity** — a place you dive into, complete, and come out of holding an
artifact. `activities.ts` maps a year to an `ActivityDef` whose `build()` returns a plain
`FloorBuild`, so `mountBuild` knows nothing about it; `main.ts` looks the def up and hands it
to `buildFloor`, which grows one extra gate on the otherwise blank front wall behind the orb.
Years with no entry grow no gate. 2026's is `obby.ts`, a jumping puzzle up a stone shaft, and
**not one distance in it is written in metres** — the rise between its fifteen platforms, the
spiral's radius, the shaft's size and the fall tolerance all come off `JUMP_ARC`, so retuning
the leap retunes the tower with it. Two fractions are the whole difficulty knob: a rise is 62%
of what you can clear, a stage 1 gap 55% of how far you can carry yourself. Failure is judged
against the highest surface you actually *stood* on, not against the pit — the spiral doubles
back over itself, so a fall from the top can land on a stage 1 ledge and would otherwise never
reach the bottom. `inventory.ts` is the app's only persistent state (localStorage, wrapped so a
refusal degrades to session-only).

**A place can ask for a chase camera** by returning `thirdPerson: true` (`V` toggles it
anywhere). A gallery is best seen through your own eyes; a jumping puzzle is unplayable that
way, because you cannot see the ledge you are standing on. `applyChase()` in `main.ts` is
ordered carefully: `controls` moves the camera as the player's *eye*, all game logic reads that
position, and the chase offset is applied only for the render and undone the same frame — so
`playerEye`, not `camera.position`, is what portals and the fall judgement see. The offset is
in **camera space**, not world space: a world-up offset looks fine staring ahead and then
swings the body up over the crosshair the moment you pitch down, which is exactly when you are
lining up a jump. The three offsets are one compromise and none moves alone: `CHASE_UP` is
deliberately *low* (0.45) because a camera even a metre above the eye puts your own feet below
the bottom edge when you look level, and platforming is mostly a question of where your feet
are; `CHASE_SIDE` exists only because `CHASE_UP` is low, since looking over your own head from
just above it parks the head on the crosshair. `interaction.standOff` gives the player their
reach back, since the ray now starts 5 m behind them. The Trial's shaft is wider and deeper than the climb
needs, so the camera has room behind you instead of being pinned against the wall you are
climbing; a build can also override the scene fog (`FloorBuild.fog`), which a tower needs
because the default is tuned for halls you look *along*, not shafts you look *up*.

Note the dive is measured **relative to a gate**, not to the world floor: `GATE_ENTRY_DROP`
hangs the diving body below the mouth's centre, and `emerge()` lands you on
`controls.groundAt(spawn)`. An absolute entry height worked only while every gate stood on the
ground, and sent the body swooping to the pit to dive into the Trial's summit exit.

**Interaction is opt-in per mesh.** `InteractionManager` raycasts from screen center over
exactly the meshes registered in `interactables`; a build that forgets to push an entry makes an
object unclickable no matter how it looks. Setting `mesh.userData.pulse = someMesh` makes the
manager brighten that mesh's `emissiveIntensity` while focused.

**Layout is derived from the data**, never hardcoded. `buildFloors()` groups projects by `year`
alone — a project stands on the floor of the year it *began*, once, however long it went on.
`isBigProject()` sends >20-dev-day projects to the corridor and everything else to two side
halls; corridor length, hall length, lighting and collision rects all scale from those counts.
A floor where nothing qualifies promotes its largest work rather than sitting you down in an
empty corridor with the year's whole output behind the side doors — and on a floor with no
effort data at all (2017's fourteen projects log none) every candidate ties, so that comes down
to whichever `projects.json` lists first.

**How long a project took is one function**, `devEffort()` in `data.ts` (`isBigProject()` and
both placard textures read it). It returns a lifetime `total` and the share `inYear`, and the
per-year half is the reason a floor can afford to show each project once: a `byYear`
`effortMeasures` entry carries its own `years` breakdown, so the 2021 floor can say NovaMundi
took 148 days *that year* out of 400. A `byYear` entry **supersedes** the other measures rather
than adding to them — Senatus carries both `byYear` and `blogDays`, which are the same work
counted twice. `isBigProject()` deliberately reads the lifetime `total` and not `inYear`, even
though the placards show both: a long project's later years are each small, and judging by the
year empties the corridor of a quiet one. Note the category-id coupling: with no
`effortMeasures` at all, `games1`/`games2`/`games3` are hardcoded as the fallback in both
`devEffort()` and `isBigProject()` — and the two do not agree by accident, since `devEffort`'s
20 days for games2 does not *exceed* 20, so `isBigProject` keeps its own category test.

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
wires. The `#elevator`/`#video`/`#web`/`#inventoryPanel` element ids matter — the CSS in
`styles.css` keys off them. `styles.css` is loaded straight from `index.html`, not imported by
TS. A *blocking* overlay must be registered in three places or the pointer lock desyncs:
`anyOverlayOpen` (`ui.ts`), `closeOverlay()` and the Escape chain (`main.ts`). `#artifactGet`
sidesteps all three by being non-blocking, like `#dialog`.

Touch is a parallel input path: `PlayerControls.touch` swaps pointer-lock for a `touchActive`
flag, and `touch.ts` supplies an on-screen joystick plus a single jump button — there is no
interact button, because a tap on the thing itself already interacts (a quick tap that barely
moved, in `onEnd`, calls the same `interact()` the `E` key does). There is no Shift to sprint
with, so the stick's travel is the throttle: full walk at `RUN_THRESHOLD` of the radius, ramping
to `SPRINT` at the rim (the thumb lights up past the threshold). The ramp measures the stick
alone, not the summed move vector — a key press is already a unit vector and would read as
permanently at the rim.

**Both orientations are supported, and landscape is the one to design for** — the castle is
wide, and a fixed 72° *vertical* FOV opens up horizontally as the aspect widens. Sideways a
phone is only ~390px tall, so `styles.css` carries a `@media (max-height: 500px)` block (keyed
on height alone, so a short desktop window gets it too) that shrinks the HUD corners and the
touch controls and narrows the bottom-centre cards — `#dialog` and `#artifactGet` can no longer
sit *above* the joystick and jump button, so they sit between them. `index.html` asks for
`viewport-fit=cover`, which is the only reason `env(safe-area-inset-*)` is ever non-zero:
landscape puts the cut-out on a long edge, so every fixed corner **adds** the inset to its own
margin rather than `max()`-ing against it, and overlay panels size to `100%` of the padded
overlay instead of to `vw` so that padding is their margin. A rotation is just a resize, but
mobile Safari announces it while still reporting the old dimensions — hence the delayed
re-measures in `main.ts`'s `resize()`, which reads `window.inner*` (not the visual viewport, or
a pinch-zoom would restretch the world) and no-ops when nothing changed. `goFullscreen()` rides
the "Enter the Keep" gesture to win back the toolbar's fifth of a sideways screen; it takes the
**document** element (the overlays are siblings of the canvas), runs on touch only (on desktop
one Esc would drop fullscreen *and* pointer lock while the Escape chain thinks it is closing an
overlay), and never locks the orientation. A refusal is the expected path on iPhone, which has
no element fullscreen — the layout doesn't depend on getting it. A manifest for an installed,
genuinely fullscreen iOS home-screen app is the unwritten other half of this.

## Notes

- The in-app link popup can't detect a refused iframe from JS, so `public/embeddable.php` checks
  `X-Frame-Options`/CSP `frame-ancestors` server-side and answers `{embeddable}`; ambiguity
  always answers `true` and the "Open in new tab" link is the fallback.
- `deploy/slashie-net.htaccess` is only needed if the app is ever hosted off slashie.net (that
  would reintroduce the CORS requirement the current same-origin deploy avoids).
- `nextsteps.md` tracks known coupling points and open maintainability tasks; `README.md`
  describes the intended player experience in detail — read it before changing world layout.
