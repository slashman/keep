import * as THREE from 'three';
import {
  loadData, loadFriends, loadYearContent, buildFloors,
  collaboratorsForFloor, collaboratorsForProject,
} from './data';
import type { Floor, Project, ProjectButton, Collaborator } from './types';
import { PlayerControls, EYE_HEIGHT } from './controls';
import { PlayerAvatar } from './avatar';
import { InteractionManager } from './interaction';
import { TouchControls } from './touch';
import { buildFloor, type FloorBuild } from './floor';
import { buildProjectRoom } from './room';
import type { PortalGate } from './portal';
import { setAnisotropy } from './textures';
import { youtubeId } from './tags';
import { UI } from './ui';
import { AudioEngine } from './audio';

// ---------- renderer / scene ----------
const canvas = document.getElementById('app') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060b);
scene.fog = new THREE.Fog(0x07060b, 16, 78);

const BASE_FOV = 72;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 200);

// Your body, shown only during a portal dive (see avatar.ts). It lives on the
// scene rather than inside a floor, so it survives the swap mid-dive.
const avatar = new PlayerAvatar(scene);

const isTouch = window.matchMedia('(pointer: coarse)').matches;
const controls = new PlayerControls(camera, canvas);
controls.touch = isTouch;
const interaction = new InteractionManager(camera);
const ui = new UI();
const audio = new AudioEngine();
if (isTouch) document.body.classList.add('touch');

/** Wake the audio context and its ambient bed — call from user-gesture paths. */
function startAudio() {
  audio.resume();
  audio.startAmbient();
}

/** Shared interaction trigger (E key, click, on-screen button, or tap). */
function interact() {
  if (ui.dialogOpen) { ui.hideDialog(); return; }
  if (controls.isLocked && interaction.focused) interaction.activate();
}
const touchUI: TouchControls | null = isTouch ? new TouchControls(controls, canvas, interact) : null;

// ---------- state ----------
let floors: Floor[] = [];
let collab: Map<string, Collaborator> = new Map();
let currentYear = 0;
let currentFloor: Floor | null = null;
let current: FloorBuild | null = null;
/** Where to put the player back down on the floor when they leave a project room. */
let returnSpawn: { x: number; z: number; yaw: number; key: string } | null = null;
/** Set while a dive is playing out, so nothing else grabs the camera. */
let diving = false;
/** Per-frame camera animation owned by the dive (controls are off while it runs). */
let cinematic: ((dt: number) => void) | null = null;

// ---------- mounting places ----------
function mountBuild(build: FloorBuild, spawn = build.spawn) {
  if (current) {
    scene.remove(current.group);
    current.dispose();
  }
  scene.add(build.group);
  current = build;
  controls.world = build.world;
  controls.setPose(spawn.x, spawn.z, spawn.yaw);
  interaction.setItems(build.interactables);
  audio.resetSteps(); // teleport shouldn't count as travelled distance
}

// A dive's body sits with its hips near the membrane; at this height the pitched
// body's head lands on the middle of a gate's mouth. The two insets are measured
// along the gate's normal: sinking in leaves the head buried in the wall (so the
// opaque membrane swallows it), and an emergence starts with only head and arms
// through, the rest still hidden behind the surface.
const GATE_ENTRY_Y = 1.5;
const DIVE_SINK = 0.25;
const EMERGE_INSET = -0.8;

/** Where a dive lands: the pose to end in, and the gate to come out of. */
interface Arrival {
  spawn: { x: number; z: number; yaw: number };
  gate?: PortalGate;
}

function mountFloor(year: number, spawn?: { x: number; z: number; yaw: number }): FloorBuild {
  const floor = floors.find((f) => f.year === year) ?? floors[0];
  const build = buildFloor(floor, {
    onElevator: openElevator,
    onNpc: handleNpc,
    onEnterProject: (p, gate) => void dive(gate, p),
  }, collaboratorsForFloor(floor, collab));
  mountBuild(build, spawn);
  currentYear = floor.year;
  currentFloor = floor;
  returnSpawn = null;
  ui.setPlaceLabel(String(floor.year), `${floor.projects.length} project${floor.projects.length === 1 ? '' : 's'} · ${floors.length} floors`);
  return build;
}

/** Drop into a project's own room, remembering the gate we came through. */
function enterProject(p: Project, gate: PortalGate): Arrival {
  const floor = currentFloor ?? floors[0];
  returnSpawn = {
    x: gate.center.x + gate.normal.x * 2.6,
    z: gate.center.z + gate.normal.z * 2.6,
    yaw: Math.atan2(gate.normal.x, gate.normal.z), // face the gate you emerged from
    key: gate.key,
  };
  const build = buildProjectRoom(p, floor, {
    onButton: handleButton,
    onNpc: handleNpc,
    onLeave: (back) => void dive(back),
  }, collaboratorsForProject(p, collab));
  mountBuild(build);
  ui.setPlaceLabel(p.title, `${floor.year} · a room of the Keep`);
  return { spawn: build.spawn, gate: build.portals.find((g) => g.key === 'back') };
}

function leaveRoom(): Arrival {
  const back = returnSpawn;
  const spawn = back ? { x: back.x, z: back.z, yaw: back.yaw } : undefined;
  const build = mountFloor(currentYear, spawn);
  return {
    spawn: spawn ?? build.spawn,
    gate: back ? build.portals.find((g) => g.key === back.key) : undefined,
  };
}

/**
 * Mario-64 style, and shot like it: the camera drops out of your head and holds
 * still while you watch your own body leap into the rippling surface. Behind the
 * curtain the far side is built, and you come back to a camera already trained on
 * the gate there — watching yourself tumble out — before it settles into your eyes.
 */
async function dive(gate: PortalGate, project?: Project) {
  if (diving) return;
  diving = true;
  ui.hideDialog();
  ui.setPrompt(null);
  controls.enabled = false;

  await diveIn(gate);
  await ui.fade(true);

  const arrival = project ? enterProject(project, gate) : leaveRoom();
  if (arrival.gate) {
    stageEmergence(arrival.gate);
    void ui.fade(false);              // the curtain lifts on a portal already blooming
    arrival.gate.ripple(true);        // …and settling, rather than about to burst
    await emerge(arrival.gate, arrival.spawn);
    avatar.hide();
  } else {
    avatar.hide();                    // nothing to climb out of — put the body away first
    await ui.fade(false);
  }

  controls.setPose(arrival.spawn.x, arrival.spawn.z, arrival.spawn.yaw);
  controls.enabled = true;
  diving = false;
}

/**
 * The leap in. The camera pulls back out of your head to a shoulder view and
 * tracks the gate; your body pitches head-first into the membrane, which bursts
 * once you reach it.
 */
function diveIn(gate: PortalGate): Promise<void> {
  return new Promise((resolve) => {
    const DUR = 0.8;
    const { center: C, normal: N } = gate;

    // the body starts at your feet, wherever the jump has carried them…
    const from = new THREE.Vector3(camera.position.x, Math.max(0, camera.position.y - EYE_HEIGHT), camera.position.z);
    // …and ends with its hips at the surface and its head already swallowed
    const to = C.clone().addScaledVector(N, DIVE_SINK).setY(GATE_ENTRY_Y);
    avatar.place(from.x, from.y, from.z, Math.atan2(-N.x, -N.z)); // face the wall
    avatar.setDive(0);

    // The camera stays on this side, backing off to watch. Its end orientation is
    // computed from where it lands, not from where it starts: at t=0 it sits almost
    // on top of the look target, and aiming from there would swing it wildly.
    const camFrom = camera.position.clone();
    const camFromQ = camera.quaternion.clone();
    const camTo = camFrom.clone().addScaledVector(N, 2.8).setY(camFrom.y + 0.55);
    const target = C.clone().addScaledVector(N, 0.35).setY(C.y - 0.35);
    const camToQ = lookQuat(camTo, target).clone();

    let t = 0;
    let rippled = false;
    cinematic = (dt) => {
      t = Math.min(1, t + dt / DUR);
      const ec = 1 - (1 - t) ** 3;        // camera: get clear fast, then settle
      const eb = t * t * (3 - 2 * t);     // body: wind up, then commit
      camera.position.lerpVectors(camFrom, camTo, ec);
      camera.quaternion.slerpQuaternions(camFromQ, camToQ, ec);
      avatar.root.visible = t > 0.1;      // don't show the head we started inside of
      avatar.root.position.lerpVectors(from, to, eb);
      avatar.setDive(eb);
      if (!rippled && t > 0.5) { rippled = true; gate.ripple(); audio.portal(); }
      if (t >= 1) { cinematic = null; resolve(); }
    };
  });
}

/** Set the far side up before the curtain lifts: camera on the gate, body in its mouth. */
function stageEmergence(gate: PortalGate) {
  const { center: C, normal: N } = gate;
  const tangent = new THREE.Vector3(-N.z, 0, N.x);
  const eye = C.clone().addScaledVector(N, 4.6).addScaledVector(tangent, 1.4).setY(3.0);
  camera.position.copy(eye);
  camera.quaternion.copy(lookQuat(eye, C.clone().setY(C.y - 0.4)));
  avatar.place(C.x + N.x * EMERGE_INSET, GATE_ENTRY_Y, C.z + N.z * EMERGE_INSET, Math.atan2(N.x, N.z));
  avatar.setDive(1);
  avatar.show();
}

/** Tumble out of the gate, land on the spawn, then hand the camera back to your eyes. */
function emerge(gate: PortalGate, spawn: { x: number; z: number; yaw: number }): Promise<void> {
  return new Promise((resolve) => {
    const OUT = 0.7, SETTLE = 0.55;
    const { center: C, normal: N } = gate;
    const from = new THREE.Vector3(C.x + N.x * EMERGE_INSET, GATE_ENTRY_Y, C.z + N.z * EMERGE_INSET);
    const to = new THREE.Vector3(spawn.x, 0, spawn.z);

    const camFrom = camera.position.clone();
    const camTo = new THREE.Vector3(spawn.x, EYE_HEIGHT, spawn.z);
    const camDrift = camFrom.clone().lerp(camTo, 0.14); // a slow push-in while you land
    const eyesQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawn.yaw, 0, 'YXZ'));
    const aim = new THREE.Vector3();

    let t = 0;
    let settlePos: THREE.Vector3 | null = null;
    let settleQ: THREE.Quaternion | null = null;
    cinematic = (dt) => {
      t += dt;
      if (t < OUT) {
        const e = t / OUT;
        const eb = e * e * (3 - 2 * e);
        avatar.root.position.lerpVectors(from, to, eb);
        avatar.root.position.y = (1 - eb) * from.y + Math.sin(eb * Math.PI) * 0.35; // pop, then drop
        avatar.setDive(1 - eb);
        camera.position.lerpVectors(camFrom, camDrift, eb);
        camera.quaternion.slerp(lookQuat(camera.position, avatar.midpoint(aim)), Math.min(1, dt * 8));
        return;
      }
      if (!settleQ) { settleQ = camera.quaternion.clone(); settlePos = camera.position.clone(); }
      const e = Math.min(1, (t - OUT) / SETTLE);
      const es = e * e * (3 - 2 * e);
      camera.position.lerpVectors(settlePos!, camTo, es);
      camera.quaternion.slerpQuaternions(settleQ, eyesQ, es);
      avatar.root.position.copy(to);
      avatar.setDive(0);
      if (e >= 1) { cinematic = null; resolve(); }
    };
  });
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/**
 * Camera orientation looking from `eye` at `target`. Note this can't use
 * Object3D.lookAt on a helper object: that points a plain object's +Z at the
 * target, the exact opposite of a camera's −Z, and would aim us backwards.
 */
function lookQuat(eye: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  _m4.lookAt(eye, target, _up);
  return _q.setFromRotationMatrix(_m4);
}

async function travelTo(year: number) {
  if (year === currentYear && !returnSpawn) { closeOverlay(); return; }
  ui.hideElevator();
  // Re-lock the pointer NOW, while we still have the click's user activation —
  // requesting it after the awaited fade would be rejected by the browser.
  controls.enabled = true;
  controls.lock();
  audio.teleport();
  await ui.fade(true);
  mountFloor(year);
  await ui.fade(false);
}

// ---------- interaction actions ----------
function handleButton(btn: ProjectButton) {
  const vid = youtubeId(btn.url);
  if (vid && btn.type === 'video') {
    openVideo(vid, btn.title);
  } else {
    openWeb(btn.url, btn.title);
  }
}

function handleNpc(person: { name: string; text?: string }, projects: string[] = []) {
  ui.showDialog(person.name, person.text, projects);
}

function openElevator() {
  ui.hideDialog();
  ui.populateFloors(floors, currentYear);
  ui.showElevator();
  controls.enabled = false;
  controls.unlock();
}

function openVideo(id: string, title: string) {
  ui.hideDialog();
  ui.showVideo(id, title);
  controls.enabled = false;
  controls.unlock();
}

function openWeb(url: string, title: string) {
  ui.hideDialog();
  ui.showWeb(url, title);
  controls.enabled = false;
  controls.unlock();
}

function closeOverlay() {
  ui.hideElevator();
  ui.hideVideo();
  ui.hideWeb();
  resumeLock();
}

function resumeLock() {
  enableControls();
  ui.hideStart();
  controls.lock();
}

/**
 * Hand movement back to the player — unless a portal dive still owns the camera.
 * Escaping (or clicking) mid-dive puts the resume overlay up; taking the offer
 * must not let WASD fight the cinematic. The dive re-enables on its own way out.
 */
function enableControls() {
  if (!diving) controls.enabled = true;
}

// ---------- input ----------
ui.onStart = () => { ui.hideStart(); startAudio(); enableControls(); controls.lock(); };
ui.onPickFloor = (year) => travelTo(year);
ui.onCloseOverlay = () => closeOverlay();

canvas.addEventListener('pointerdown', () => {
  if (isTouch) return; // touch is handled by TouchControls
  startAudio();
  if (ui.anyOverlayOpen) return;
  if (ui.dialogOpen) { ui.hideDialog(); return; }
  if (!controls.isLocked) { enableControls(); controls.lock(); return; }
  if (interaction.focused) interaction.activate();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') {
    e.preventDefault();
    interact();
  } else if (e.code === 'KeyM') {
    ui.flash(audio.toggleMute() ? '🔇 Muted' : '🔊 Sound on');
  } else if (e.code === 'Escape') {
    if (ui.dialogOpen) ui.hideDialog();
    else if (ui.videoOpen) { ui.hideVideo(); resumeLock(); }
    else if (ui.webOpen) { ui.hideWeb(); resumeLock(); }
    else if (ui.elevatorOpen) { ui.hideElevator(); resumeLock(); }
  }
});

controls.onLockChange = (locked) => {
  document.body.classList.toggle('locked', locked);
  if (locked) {
    ui.hideStart();
    touchUI?.enable();
  } else {
    touchUI?.disable();
    if (!ui.anyOverlayOpen) {
      // released (Esc / link / menu) → offer to resume
      ui.setPrompt(null);
      ui.showStart(
        isTouch ? 'Paused. The Keep awaits your return.'
          : 'You have stepped out to the cursor. The Keep awaits your return.',
        'Resume exploring',
      );
    }
  }
};

interaction.onFocusChange = (item) => {
  ui.setPrompt(item ? item.label : null);
  if (ui.dialogOpen) ui.hideDialog(); // walking/looking away closes the blurb
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/** Mid-jump inside a gate's mouth? Then you're going through it. */
function checkPortals() {
  if (diving || !controls.enabled || !controls.airborne) return;
  for (const gate of current?.portals ?? []) {
    if (gate.contains(camera.position)) { void gate.enter(); return; }
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  controls.update(dt);
  cinematic?.(dt);
  current?.update?.(elapsed, camera.position);
  if (controls.isLocked && !ui.anyOverlayOpen && !diving) {
    audio.footsteps(controls.movedDistance, controls.sprinting);
    interaction.update();
    checkPortals();
  } else if (ui.anyOverlayOpen) {
    ui.setPrompt(null);
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
async function boot() {
  ui.setProgress(0.1, 'Fetching the chronicle from slashie.net…');
  // projects are required; collaborators (friends.json) and year content are best-effort
  let data: Awaited<ReturnType<typeof loadData>>;
  try {
    [data, collab] = await Promise.all([loadData(), loadFriends(), loadYearContent()]);
  } catch (err) {
    console.error('[boot] could not load projects.json:', err);
    ui.setProgress(1, 'Could not reach slashie.net — please try again later.');
    return;
  }
  ui.setProgress(0.5, 'Chronicle received.');
  floors = buildFloors(data);
  if (!floors.length) { ui.setProgress(1, 'No dated projects found.'); return; }
  ui.setProgress(0.8, `Raising ${floors.length} floors…`);
  document.body.classList.add('ready');
  mountFloor(floors[0].year); // newest year on top
  ui.setProgress(1, 'The Keep stands ready.');
  await new Promise((r) => setTimeout(r, 350));
  ui.hideLoading();
  ui.showStart();
  animate();
}

boot();
