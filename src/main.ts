import * as THREE from 'three';
import { loadData, buildFloors, getCollaborators, collaboratorsForFloor } from './data';
import type { Floor, ProjectButton, Collaborator } from './types';
import { PlayerControls } from './controls';
import { InteractionManager } from './interaction';
import { TouchControls } from './touch';
import { buildFloor, type FloorBuild } from './floor';
import { setAnisotropy } from './textures';
import { youtubeId } from './tags';
import { UI } from './ui';

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

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);

const isTouch = window.matchMedia('(pointer: coarse)').matches;
const controls = new PlayerControls(camera, canvas);
controls.touch = isTouch;
const interaction = new InteractionManager(camera);
const ui = new UI();
if (isTouch) document.body.classList.add('touch');

/** Shared interaction trigger (E key, click, on-screen button, or tap). */
function interact() {
  if (ui.dialogOpen) { ui.hideDialog(); return; }
  if (controls.isLocked && interaction.focused) interaction.activate();
}
const touchUI: TouchControls | null = isTouch ? new TouchControls(controls, canvas, interact) : null;

// ---------- state ----------
let floors: Floor[] = [];
let collab: Map<string, Collaborator> = new Map();
let dataSource = 'live';
let currentYear = 0;
let current: FloorBuild | null = null;

// ---------- floor management ----------
function mountFloor(year: number) {
  const floor = floors.find((f) => f.year === year) ?? floors[0];
  if (current) {
    scene.remove(current.group);
    current.dispose();
    current = null;
  }
  const build = buildFloor(floor, {
    onButton: handleButton,
    onElevator: openElevator,
    onNpc: handleNpc,
  }, collaboratorsForFloor(floor, collab));
  scene.add(build.group);
  current = build;
  currentYear = floor.year;
  controls.world = build.world;
  controls.setPose(build.spawn.x, build.spawn.z, build.spawn.yaw);
  interaction.setItems(build.interactables);
  ui.setFloorLabel(floor.year, floor.projects.length, floors.length, dataSource);
}

async function travelTo(year: number) {
  if (year === currentYear) { closeOverlay(); return; }
  ui.hideElevator();
  // Re-lock the pointer NOW, while we still have the click's user activation —
  // requesting it after the awaited fade would be rejected by the browser.
  controls.enabled = true;
  controls.lock();
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
    window.open(btn.url, '_blank', 'noopener,noreferrer');
    // opening a tab drops pointer lock; the resume prompt will appear
  }
}

function handleNpc(person: { name: string; text?: string }) {
  ui.showDialog(person.name, person.text);
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

function closeOverlay() {
  ui.hideElevator();
  ui.hideVideo();
  resumeLock();
}

function resumeLock() {
  controls.enabled = true;
  ui.hideStart();
  controls.lock();
}

// ---------- input ----------
ui.onStart = () => { ui.hideStart(); controls.enabled = true; controls.lock(); };
ui.onPickFloor = (year) => travelTo(year);
ui.onCloseOverlay = () => closeOverlay();

canvas.addEventListener('pointerdown', () => {
  if (isTouch) return; // touch is handled by TouchControls
  if (ui.anyOverlayOpen) return;
  if (ui.dialogOpen) { ui.hideDialog(); return; }
  if (!controls.isLocked) { controls.enabled = true; controls.lock(); return; }
  if (interaction.focused) interaction.activate();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') {
    e.preventDefault();
    interact();
  } else if (e.code === 'Escape') {
    if (ui.dialogOpen) ui.hideDialog();
    else if (ui.videoOpen) { ui.hideVideo(); resumeLock(); }
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

// ---------- loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  controls.update(dt);
  current?.update?.(elapsed, camera.position);
  if (controls.isLocked && !ui.anyOverlayOpen) {
    interaction.update();
  } else if (ui.anyOverlayOpen) {
    ui.setPrompt(null);
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
async function boot() {
  ui.setProgress(0.1, 'Fetching the chronicle from slashie.net…');
  const { data, source } = await loadData();
  dataSource = source;
  ui.setProgress(0.5, source === 'live' ? 'Chronicle received.' : 'Using bundled snapshot.');
  collab = getCollaborators(data);
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
