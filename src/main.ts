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
import { activityForYear, type ActivityDef } from './activities';
import { Inventory } from './inventory';
import { artifactById } from './artifacts';
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
// Near plane pushed back to suit the hall's size: fog that started at 16 units
// hazed the far wall of a room you are standing in the middle of. A build may
// override this while it is mounted (see `FloorBuild.fog`).
const DEFAULT_FOG = { near: 26, far: 92 };
const fog = new THREE.Fog(0x07060b, DEFAULT_FOG.near, DEFAULT_FOG.far);
scene.fog = fog;

const BASE_FOV = 72;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 200);

// Your body: shown during a portal dive, and for the whole of a third-person
// place (see avatar.ts). It lives on the scene rather than inside a floor, so it
// survives the swap mid-dive.
const avatar = new PlayerAvatar(scene);

const isTouch = window.matchMedia('(pointer: coarse)').matches;
const controls = new PlayerControls(camera, canvas);
controls.touch = isTouch;
const interaction = new InteractionManager(camera);
const ui = new UI();
const audio = new AudioEngine();
// Credit whatever starts playing. The score is fetched lazily, so this lands a
// moment after "Enter the Keep" rather than on the click itself.
audio.onTrackStart = (track) => ui.flash(`♪ Now playing: “${track.title}” by ${track.artist}`, 15000);
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
/** Set while a failed activity is being wound back to its start pose. */
let resetting = false;
/** Per-frame camera animation owned by the dive (controls are off while it runs). */
let cinematic: ((dt: number) => void) | null = null;
/** Camera behind the body rather than inside the head — see `applyChase`. */
let thirdPerson = false;
let chasing = false;
/** The one piece of state that outlives a reload. */
const inventory = new Inventory();

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
  thirdPerson = build.thirdPerson ?? false;
  const f = build.fog ?? DEFAULT_FOG;
  fog.near = f.near;
  fog.far = f.far;
}

// ---------- chase camera ----------
// `controls` moves the camera as if it were the player's eye, and every piece of
// game logic — portals, the fall judgement, footsteps — reads that position. So
// the chase is applied *after* all of it and undone right after the render: the
// camera is the eye for the whole frame except the moment it is drawn from.
//
// The offset is in camera space, not world space. A world-up offset looks fine
// staring straight ahead and then swings the body up over the crosshair the
// moment you pitch down — which is exactly when you are lining up a jump.
//
// The three numbers are a single compromise, and none of them moves alone:
//  - UP is low, because a camera even a metre above the eye puts your own feet
//    below the bottom edge when you look level, and platforming is mostly a
//    question of where your feet are. At 0.45 the frame reaches 0.7 m *below*
//    the floor you are standing on.
//  - SIDE exists only because UP is low. Looking over your own head from just
//    above it parks the head on the crosshair; stepping 1.4 m to the shoulder
//    moves it a quarter of the way to the screen edge and leaves the middle
//    clear to aim with.
//  - BACK is then whatever frames the body at that height.
const CHASE_BACK = 5.0;
const CHASE_UP = 0.45;
const CHASE_SIDE = 1.4;
const CHASE_MIN = 1.2;   // never jam the camera right inside your own head
const playerEye = new THREE.Vector3();
const chaseFwd = new THREE.Vector3();
const chaseUp = new THREE.Vector3();
const chaseRight = new THREE.Vector3();
const chaseOff = new THREE.Vector3();
const chaseRay = new THREE.Raycaster();

/** Push the camera out behind the body. Returns true if it moved (so it can be put back). */
function applyChase(): boolean {
  if (diving) return false;   // the dive owns the camera and the body both
  if (!thirdPerson) {
    if (chasing) { avatar.hide(); chasing = false; interaction.standOff = 0; }
    return false;
  }
  // Read the heading off the quaternion rather than the world matrix, which is
  // still last frame's until something renders.
  chaseFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  avatar.place(playerEye.x, playerEye.y - EYE_HEIGHT, playerEye.z, Math.atan2(chaseFwd.x, chaseFwd.z));
  avatar.stride(controls.movedDistance, controls.airborne);
  avatar.show();
  chasing = true;

  chaseUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  chaseRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  chaseOff.copy(chaseFwd).multiplyScalar(-CHASE_BACK)
    .addScaledVector(chaseUp, CHASE_UP)
    .addScaledVector(chaseRight, CHASE_SIDE);
  let dist = chaseOff.length();
  chaseOff.divideScalar(dist);
  // Walls are cosmetic to the *player*, but not to the camera: without this it
  // sails straight out of the shaft and you watch the trial from outside it.
  if (current) {
    chaseRay.set(playerEye, chaseOff);
    chaseRay.far = dist;
    const hit = chaseRay.intersectObject(current.group, true)[0];
    if (hit) dist = Math.max(CHASE_MIN, hit.distance - 0.35);
  }
  camera.position.copy(playerEye).addScaledVector(chaseOff, dist);
  camera.updateMatrixWorld(true);
  interaction.standOff = dist;
  return true;
}

function setThirdPerson(on: boolean) {
  thirdPerson = on;
  ui.flash(on ? 'Third person' : 'First person');
}

// A dive's body sits with its hips near the membrane; at this height the pitched
// body's head lands on the middle of a gate's mouth. The two insets are measured
// along the gate's normal: sinking in leaves the head buried in the wall (so the
// opaque membrane swallows it), and an emergence starts with only head and arms
// through, the rest still hidden behind the surface.
// Measured *down from the mouth's centre*, not from the world floor: a gate can
// now open onto a platform twelve metres up (the Trial's summit exit), and an
// absolute entry height sent the body swooping down to the pit to dive into it.
const GATE_ENTRY_DROP = 1.8;
const DIVE_SINK = 0.25;
const EMERGE_INSET = -0.8;
/** Where a diving body's feet belong when its hips reach a gate's surface. */
const entryY = (gate: PortalGate) => gate.center.y - GATE_ENTRY_DROP;

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
    onEnterProject: (p, gate) => void dive(gate, () => enterProject(p, gate)),
    activity: activityForYear(floor.year),
    onEnterActivity: (def, gate) => void dive(gate, () => enterActivity(def, gate)),
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
    // Face out of the gate, into the hall — the camera's forward is (−sin yaw,
    // −cos yaw), so pointing it along the gate's outward normal takes the negated
    // normal. The avatar's own yaw convention is the opposite one (0 looks down
    // +Z, see avatar.place), which is why stageEmergence spells this the other way
    // round for the body; both must come out facing the same direction, or the
    // handoff from the third-person shot spins the world 180° for no reason.
    yaw: Math.atan2(-gate.normal.x, -gate.normal.z),
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

/** Drop into the year's activity, which is a place like any other. */
function enterActivity(def: ActivityDef, gate: PortalGate): Arrival {
  const floor = currentFloor ?? floors[0];
  returnSpawn = {
    x: gate.center.x + gate.normal.x * 2.6,
    z: gate.center.z + gate.normal.z * 2.6,
    yaw: Math.atan2(-gate.normal.x, -gate.normal.z),
    key: gate.key,
  };
  const build = def.build(floor, def, {
    onLeave: (back) => void dive(back),
    onReset: () => void restartActivity(),
    onClaim: (id) => claimArtifact(id),
    hasArtifact: (id) => inventory.has(id),
  });
  mountBuild(build);
  ui.setPlaceLabel(def.title, def.subtitle);
  return { spawn: build.spawn, gate: build.portals.find((g) => g.key === 'back') };
}

/** Leave whatever place we're in, back to the floor and the gate we came through. */
function leavePlace(): Arrival {
  const back = returnSpawn;
  const spawn = back ? { x: back.x, z: back.z, yaw: back.yaw } : undefined;
  const build = mountFloor(currentYear, spawn);
  return {
    spawn: spawn ?? build.spawn,
    gate: back ? build.portals.find((g) => g.key === back.key) : undefined,
  };
}

/**
 * Failed the activity: wind the player back to its start. Short and hard rather
 * than a long fall — the run is the point, not the plummet. `resetting` keeps
 * anything else off the camera the way `diving` does.
 */
async function restartActivity() {
  if (resetting || diving || !current) return;
  resetting = true;
  controls.enabled = false;
  ui.setPrompt(null);
  audio.stumble();
  await ui.fade(true, 220);
  const { x, z, yaw } = current.spawn;
  controls.setPose(x, z, yaw);
  ui.flash('You fall. The trial begins again.');
  await ui.fade(false, 260);
  resetting = false;
  enableControls();
}

/** Take an artifact. Silent if it was already held, so the fanfare fires once. */
function claimArtifact(id: string) {
  const artifact = artifactById(id);
  if (!artifact || !inventory.grant(id)) return;
  audio.artifact();
  ui.setInventory(inventory.list());
  ui.showArtifactGet(artifact);
  // The prize's own entry rewrote its label as it was taken; re-seating the list
  // clears the stale prompt so it re-reads on the next frame.
  if (current) interaction.setItems(current.interactables);
}

/**
 * Mario-64 style, and shot like it: the camera drops out of your head and holds
 * still while you watch your own body leap into the rippling surface. Behind the
 * curtain the far side is built, and you come back to a camera already trained on
 * the gate there — watching yourself tumble out — before it settles into your eyes.
 */
async function dive(gate: PortalGate, arrive?: () => Arrival) {
  if (diving || resetting) return;
  diving = true;
  ui.hideDialog();
  ui.setPrompt(null);
  controls.enabled = false;

  await diveIn(gate);
  await ui.fade(true);

  const arrival = arrive ? arrive() : leavePlace();
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
    const to = C.clone().addScaledVector(N, DIVE_SINK).setY(entryY(gate));
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
  const eye = C.clone().addScaledVector(N, 4.6).addScaledVector(tangent, 1.4).setY(C.y - 0.25);
  camera.position.copy(eye);
  camera.quaternion.copy(lookQuat(eye, C.clone().setY(C.y - 0.4)));
  avatar.place(C.x + N.x * EMERGE_INSET, entryY(gate), C.z + N.z * EMERGE_INSET, Math.atan2(N.x, N.z));
  avatar.setDive(1);
  avatar.show();
}

/** Tumble out of the gate, land on the spawn, then hand the camera back to your eyes. */
function emerge(gate: PortalGate, spawn: { x: number; z: number; yaw: number }): Promise<void> {
  return new Promise((resolve) => {
    const OUT = 0.7, SETTLE = 0.85;
    const { center: C, normal: N } = gate;
    // You land on whatever stands at the spawn, which is not always the floor.
    const groundY = controls.groundAt(spawn.x, spawn.z);
    const from = new THREE.Vector3(C.x + N.x * EMERGE_INSET, entryY(gate), C.z + N.z * EMERGE_INSET);
    const to = new THREE.Vector3(spawn.x, groundY, spawn.z);

    const camFrom = camera.position.clone();
    const camTo = new THREE.Vector3(spawn.x, groundY + EYE_HEIGHT, spawn.z);
    const camDrift = camFrom.clone().lerp(camTo, 0.14); // a slow push-in while you land
    const eyesQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawn.yaw, 0, 'YXZ'));
    const aim = new THREE.Vector3();

    let t = 0;
    let settleQ: THREE.Quaternion | null = null;
    /** Polar frame for the settle, around the spot you land on. */
    let orbit: { r: number; a0: number; da: number; y: number } | null = null;
    cinematic = (dt) => {
      t += dt;
      if (t < OUT) {
        const e = t / OUT;
        const eb = e * e * (3 - 2 * e);
        avatar.root.position.lerpVectors(from, to, eb);
        avatar.root.position.y = (1 - eb) * from.y + eb * to.y + Math.sin(eb * Math.PI) * 0.35; // pop, then drop
        avatar.setDive(1 - eb);
        camera.position.lerpVectors(camFrom, camDrift, eb);
        camera.quaternion.slerp(lookQuat(camera.position, avatar.midpoint(aim)), Math.min(1, dt * 8));
        return;
      }
      // The camera has been watching your face from out in front of the gate, and it
      // has to end up inside your head looking the way you are looking — most of a
      // half-turn away. So it *orbits* into place rather than sliding: it swings
      // around your shoulder while it turns, on a radius that shrinks to nothing.
      // A straight lerp would pass through your own body mid-spin.
      if (!settleQ) {
        settleQ = camera.quaternion.clone();
        const rx = camera.position.x - camTo.x, rz = camera.position.z - camTo.z;
        const a0 = Math.atan2(rx, rz);
        let da = Math.atan2(-N.x, -N.z) - a0; // end behind the eyes, gate-ward
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        orbit = { r: Math.hypot(rx, rz), a0, da, y: camera.position.y };
      }
      const e = Math.min(1, (t - OUT) / SETTLE);
      const es = e * e * (3 - 2 * e);
      const a = orbit!.a0 + orbit!.da * es;
      const r = orbit!.r * (1 - es);
      camera.position.set(
        camTo.x + Math.sin(a) * r,
        orbit!.y + (camTo.y - orbit!.y) * es,
        camTo.z + Math.cos(a) * r,
      );
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

function openInventory() {
  ui.hideDialog();
  ui.showInventory(inventory.list());
  controls.enabled = false;
  controls.unlock();
}

function closeOverlay() {
  ui.hideElevator();
  ui.hideVideo();
  ui.hideWeb();
  ui.hideInventory();
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
  if (!diving && !resetting) controls.enabled = true;
}

// ---------- input ----------
/**
 * Reclaim the browser's own chrome, where it costs the most: a phone held
 * sideways is ~390px tall and the toolbar is a fifth of that. Must be called
 * from a user gesture, so it rides along with the other two gesture-bound jobs
 * on "Enter the Keep" — waking the audio context and taking the lock.
 *
 * Three things it is deliberately not:
 *  - not the canvas, the *document* element. Every overlay is a sibling of the
 *    canvas, so fullscreening the canvas alone would put the whole UI offscreen.
 *  - not on desktop, where one Esc would drop fullscreen and pointer lock while
 *    the Escape chain below still thinks it is closing an overlay.
 *  - not paired with a screen.orientation.lock(). That is the usual companion
 *    call and it would *force* landscape; both ways up are meant to work.
 * A refusal is the expected path, not an error — iPhone Safari has no element
 * fullscreen at all (only video), and the dvh layout is correct either way.
 */
function goFullscreen() {
  if (!isTouch || document.fullscreenElement) return;
  void document.documentElement.requestFullscreen?.().catch(() => { /* unsupported or refused */ });
}

ui.onStart = () => { ui.hideStart(); goFullscreen(); startAudio(); enableControls(); controls.lock(); };
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
  } else if (e.code === 'KeyV') {
    setThirdPerson(!thirdPerson);
  } else if (e.code === 'KeyI') {
    if (ui.inventoryOpen) { ui.hideInventory(); resumeLock(); }
    else if (!ui.anyOverlayOpen) openInventory();
  } else if (e.code === 'Escape') {
    if (ui.dialogOpen) ui.hideDialog();
    else if (ui.videoOpen) { ui.hideVideo(); resumeLock(); }
    else if (ui.webOpen) { ui.hideWeb(); resumeLock(); }
    else if (ui.elevatorOpen) { ui.hideElevator(); resumeLock(); }
    else if (ui.inventoryOpen) { ui.hideInventory(); resumeLock(); }
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

// A rotation into landscape is just a resize, but not one the browser always
// measures correctly at the moment it announces it: mobile Safari fires
// `orientationchange` (and occasionally the first `resize` after it) while still
// reporting the pre-rotation dimensions, which would leave the canvas letterboxed
// with a stale aspect until something else nudged it. So: re-measure on a delay
// too, and take the visual viewport's own resizes (the toolbar collapsing as you
// play) as another cue. Reading `window.inner*` rather than the visual viewport
// keeps a pinch-zoom from restretching the world — those calls then no-op here.
let lastW = 0, lastH = 0;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  resize();
  setTimeout(resize, 120);
  setTimeout(resize, 400); // iOS settles the viewport a beat after the rotation
});
window.visualViewport?.addEventListener('resize', resize);

/** Mid-jump inside a gate's mouth? Then you're going through it. */
function checkPortals() {
  if (diving || resetting || !controls.enabled || !controls.airborne) return;
  for (const gate of current?.portals ?? []) {
    if (gate.contains(playerEye)) { void gate.enter(); return; }
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
  playerEye.copy(camera.position);    // where the player actually is, all frame
  const chased = applyChase();
  current?.update?.(elapsed, playerEye);
  if (controls.isLocked && !ui.anyOverlayOpen && !diving && !resetting) {
    audio.footsteps(controls.movedDistance, controls.sprinting);
    interaction.update();             // rays from the camera, so the crosshair is honest
    checkPortals();
  } else if (ui.anyOverlayOpen) {
    ui.setPrompt(null);
  }
  renderer.render(scene, camera);
  if (chased) camera.position.copy(playerEye);   // hand it straight back to the controller
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
  ui.setInventory(inventory.list()); // whatever survived from a previous visit
  mountFloor(floors[0].year); // newest year on top
  ui.setProgress(1, 'The Keep stands ready.');
  await new Promise((r) => setTimeout(r, 350));
  ui.hideLoading();
  ui.showStart();
  animate();
}

boot();
