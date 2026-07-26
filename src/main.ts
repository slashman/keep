import * as THREE from 'three';
import {
  loadData, loadFriends, loadYearContent, buildFloors,
  collaboratorsForFloor, collaboratorsForProject,
} from './data';
import type { Floor, Project, ProjectButton, Collaborator } from './types';
import { PlayerControls } from './controls';
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

function mountFloor(year: number, spawn?: { x: number; z: number; yaw: number }, rippleKey?: string) {
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
  // the gate you just stepped back out of settles behind you
  if (rippleKey) build.portals.find((g) => g.key === rippleKey)?.ripple();
}

/** Drop into a project's own room, remembering the gate we came through. */
function enterProject(p: Project, gate: PortalGate) {
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
}

function leaveRoom() {
  const back = returnSpawn;
  mountFloor(currentYear, back ? { x: back.x, z: back.z, yaw: back.yaw } : undefined, back?.key);
}

/**
 * Mario-64 style: the surface bursts into rings, the camera is sucked through,
 * and the world on the far side is built behind the curtain.
 */
async function dive(gate: PortalGate, project?: Project) {
  if (diving) return;
  diving = true;
  ui.hideDialog();
  ui.setPrompt(null);
  controls.enabled = false;
  gate.ripple();
  audio.portal();
  await pullThrough(gate);
  await ui.fade(true);
  if (project) enterProject(project, gate);
  else leaveRoom();
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  await ui.fade(false);
  controls.enabled = true;
  diving = false;
}

/**
 * Glide the camera into the membrane over half a second, widening the lens.
 * It stops a hair short of the surface, so the flooding portal — not the wall
 * behind it — is what fills the screen when the curtain comes down.
 */
function pullThrough(gate: PortalGate): Promise<void> {
  return new Promise((resolve) => {
    const DUR = 0.55;
    const from = camera.position.clone();
    const fromQ = camera.quaternion.clone();
    const to = gate.center.clone().addScaledVector(gate.normal, 0.14);
    const aim = new THREE.Object3D();
    aim.position.copy(from);
    aim.lookAt(gate.center);
    const toQ = aim.quaternion.clone();
    let t = 0;
    cinematic = (dt) => {
      t = Math.min(1, t + dt / DUR);
      const e = t * t * (3 - 2 * t); // smoothstep
      camera.position.lerpVectors(from, to, e);
      camera.quaternion.slerpQuaternions(fromQ, toQ, Math.min(1, e * 1.5));
      camera.fov = BASE_FOV + 26 * e * e;
      camera.updateProjectionMatrix();
      if (t >= 1) { cinematic = null; resolve(); }
    };
  });
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
  controls.enabled = true;
  ui.hideStart();
  controls.lock();
}

// ---------- input ----------
ui.onStart = () => { ui.hideStart(); startAudio(); controls.enabled = true; controls.lock(); };
ui.onPickFloor = (year) => travelTo(year);
ui.onCloseOverlay = () => closeOverlay();

canvas.addEventListener('pointerdown', () => {
  if (isTouch) return; // touch is handled by TouchControls
  startAudio();
  if (ui.anyOverlayOpen) return;
  if (ui.dialogOpen) { ui.hideDialog(); return; }
  if (!controls.isLocked) { controls.enabled = true; controls.lock(); return; }
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
