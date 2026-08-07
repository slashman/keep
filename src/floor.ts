import * as THREE from 'three';
import type { Floor, Project, Person } from './types';
import type { ActivityDef } from './activities';
import type { CollisionWorld, Rect } from './controls';
import { genreColor } from './tags';
import { placeNpcs, type NpcUpdater } from './npc';
import { buildPortalGate, setGateMap, type PortalGate } from './portal';
import {
  gatePlaqueTexture, bannerTexture,
  fallbackPaintingTexture, doorSignTexture, attachProjectArt,
  yearTapestryTexture, yearInfoTexture, trialSigilTexture,
} from './textures';

export interface Interactable {
  mesh: THREE.Object3D;
  label: string;
  kind: 'button' | 'elevator' | 'npc' | 'portal' | 'prize';
  action: () => void;
}

export interface FloorHandlers {
  onElevator: () => void;
  onNpc: (person: Person, projects: string[]) => void;
  /** Dive through a project's gate into its own room. */
  onEnterProject: (p: Project, gate: PortalGate) => void;
  /**
   * The year's activity, if it has one. Looked up by `main.ts` and passed in
   * rather than imported here: the activity registry has to reach the builders,
   * and a builder reaches back to this module for `FloorBuild`.
   */
  activity?: ActivityDef | null;
  onEnterActivity?: (def: ActivityDef, gate: PortalGate) => void;
}

/** One mounted place — a year's floor, or a single project's room. */
export interface FloorBuild {
  group: THREE.Group;
  interactables: Interactable[];
  portals: PortalGate[];
  world: CollisionWorld;
  spawn: { x: number; z: number; yaw: number };
  /**
   * Put the camera behind the player's body on arrival. A gallery is best seen
   * through your own eyes; a jumping puzzle is unplayable that way, because you
   * cannot see the ledge you are standing on. The player can still toggle.
   */
  thirdPerson?: boolean;
  /**
   * Override the scene fog while mounted. The default is tuned for halls you look
   * along; a tower you look *up* is deeper than it is wide, and the same fog puts
   * the thing you are climbing toward behind a haze.
   */
  fog?: { near: number; far: number };
  update?: (t: number, playerPos: THREE.Vector3) => void; // orb animation + NPCs staring
  dispose: () => void;
}

/**
 * A wall slot a gate is mounted on: the anchor point on the wall surface (ax,az)
 * and the inward normal (nx,nz) pointing into the room.
 */
interface Slot { ax: number; az: number; nx: number; nz: number; }

// ---- layout constants ----
// Every room here should read as a hall, not a passage: the two facing display
// walls stand far enough apart that a crowd of wandering NPCs can never box the
// player in, the walk between two facing gates is a walk across a room, and the
// ceiling is high enough to feel vaulted from the middle of the floor. Note the
// player is a giant by these numbers — EYE_HEIGHT is 2.5 — so a hall has to be
// half again as wide as a human-scale one to read as roomy.
// The one thing that must NOT scale with the room is the *bottom* of a gate's
// mouth: GATE_Y − GATE_H/2 ≈ 2.0 keeps it at chin height, which is what makes a
// leap the only way in (see portal.ts). The gate grew with the halls here, but it
// grew upward from that same sill.
const CEIL = 11.0;
const GATE_Y = 3.4;            // height of the centre of a project gate
const GATE_W = 3.4;
const GATE_H = 2.7;            // mouth bottom sits at chin height — you must jump in
const CW = 11.5;               // main hall half-width (walls at ±CW)
const CORRIDOR_FIRST_Z = 12.0; // z of the first main-hall row
const ROW_SPACING = 7.5;       // spacing between main-hall rows
const BACK_PAD = 7.0;          // gap between last row and the tapestry wall
const MARGIN = 1.05;           // player standoff from display walls
const ALCOVE_HALF = 1.6;       // half-width of the run-up notch (the mouth's own half-width is 1.7)
const ALCOVE_NEAR = 0.45;      // how close to the wall that notch lets you stand
// Lamps hang well below the vault: from the ceiling of a hall this high a point
// light reaches the floor too weakly to pool, and the dark span above the lamps
// is much of what sells the height.
const LAMP_Y = CEIL - 3.6;
const DOOR = { z0: 1.6, z1: 6.8, height: 5.4 }; // the archway into a side hall, beside the orb
const ELEV = { x: 0, z: 4.2, r: 0.9 }; // the orb's spot (small excluder so you can walk right up)
const ORB_Y = 2.0;
// side halls
const HALL_DEPTH = 16;         // z-extent of a side hall — the gap between its two display walls
const HALL_FIRST = 6.5;        // x-distance of the first hall row from the main hall's wall
const HALL_SPACING = 8.0;
const HALL_END_PAD = 5.0;      // clears the back-most gate and leaves it room to be looked at

/**
 * "Big" projects get the main corridor. A project is big if its logged dev effort
 * exceeds 20 days; when no effortMeasures data exists, fall back to membership of
 * the Big Games (games1) or +1 Month Game Projects (games2) categories.
 */
function isBigProject(p: Project): boolean {
  const em = p.effortMeasures;
  if (em && em.length) {
    const days = em.reduce((sum, m) => sum + (m.days ?? 0), 0);
    return days > 20;
  }
  return p.categoryId === 'games1' || p.categoryId === 'games2';
}

export function buildFloor(floor: Floor, handlers: FloorHandlers, people: Person[] = []): FloorBuild {
  const group = new THREE.Group();
  const interactables: Interactable[] = [];
  const portals: PortalGate[] = [];
  const regions: Rect[] = [];
  const updaters: NpcUpdater[] = [];

  // The main corridor is reserved for big projects; everything else overflows to
  // the two side halls, split evenly between them.
  const corridorPs = floor.projects.filter(isBigProject);
  const rest = floor.projects.filter((p) => !isBigProject(p));
  const half = Math.ceil(rest.length / 2);
  const leftPs = rest.slice(0, half);
  const rightPs = rest.slice(half);

  // the hall's length is fixed by its contents — long enough to hold them, never longer
  const cRows = Math.max(1, Math.ceil(corridorPs.length / 2));
  const CL = CORRIDOR_FIRST_Z + (cRows - 1) * ROW_SPACING + BACK_PAD; // z of the back (tapestry) wall

  // ---- shared materials ----
  const floorMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#2c2740', '#211d31'), roughness: 0.95, metalness: 0.02 });
  // Stone, but barely lighter than the void it replaces: at CEIL the vault is far
  // enough above the lamps to stay in shadow, and a near-black albedo is what keeps
  // the lamp pools from blowing out up there and flattening the height back out.
  const ceilMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#1a1626', '#0d0b16'), roughness: 1 });
  const wallMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#38314f', '#252036'), roughness: 0.9 });

  const addFloorCeil = (r: Rect) => {
    const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    fl.rotation.x = -Math.PI / 2; fl.position.set(cx, 0, cz); group.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ce.rotation.x = Math.PI / 2; ce.position.set(cx, CEIL, cz); group.add(ce);
  };
  // a straight solid wall segment between two XZ points
  const addWall = (ax: number, az: number, bx: number, bz: number, height = CEIL, y0 = 0) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, height, 0.2), wallMat);
    wall.position.set((ax + bx) / 2, y0 + height / 2, (az + bz) / 2);
    wall.rotation.y = Math.atan2(-dz, dx);
    group.add(wall);
  };
  // a wall running along z at fixed x, optionally with a doorway gap
  const sideWall = (x: number, z0: number, z1: number, door: boolean) => {
    if (!door) { addWall(x, z0, x, z1, CEIL); return; }
    addWall(x, z0, x, DOOR.z0, CEIL);
    addWall(x, DOOR.z1, x, z1, CEIL);
    addWall(x, DOOR.z0, x, DOOR.z1, CEIL - DOOR.height, DOOR.height); // lintel above the door
    // "Smaller Projects" sign, hung just above the arch rather than centred in the
    // lintel — the lintel of a door this tall reaches most of the way to the vault,
    // and a sign floating in the middle of it reads as unmoored from the doorway.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.5, 1.29),
      new THREE.MeshBasicMaterial({ map: doorSignTexture('Smaller Projects'), transparent: true }),
    );
    sign.position.set(x - Math.sign(x) * 0.11, DOOR.height + 1.1, (DOOR.z0 + DOOR.z1) / 2);
    sign.rotation.y = Math.atan2(-Math.sign(x), 0);
    group.add(sign);
  };

  // ---------- corridor shell ----------
  addFloorCeil({ minX: -CW, maxX: CW, minZ: 0, maxZ: CL });
  addWall(-CW, 0, CW, 0, CEIL);      // front wall (behind the elevator)
  addWall(-CW, CL, CW, CL, CEIL);    // back wall (behind the tapestry)
  sideWall(-CW, 0, CL, leftPs.length > 0);
  sideWall(CW, 0, CL, rightPs.length > 0);
  // gold floor trim along the corridor
  const trimMat = new THREE.MeshStandardMaterial({ color: '#3a2f14', roughness: 0.6, metalness: 0.4 });
  for (const s of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, CL), trimMat);
    trim.position.set(s * (CW - 0.16), 0.15, CL / 2); // flush with the wall face at CW−0.1
    group.add(trim);
  }

  // ---------- lighting ----------
  group.add(new THREE.HemisphereLight(0xb9a7ff, 0x241d10, 0.55));
  group.add(new THREE.AmbientLight(0xffffff, 0.2));
  const key = new THREE.DirectionalLight(0xfff1d6, 0.35);
  key.position.set(3, 10, 2);
  group.add(key);
  // Paired lamps per row rather than one down the middle: with the display walls
  // 2·CW apart a single central light leaves both of them dim, and a double row of
  // lamps is much of what makes the space read as a lit hall instead of a tunnel.
  // They sit out near the walls (0.6·CW) so each one washes the gates it belongs to.
  for (let r = 0; r < cRows; r++) {
    for (const s of [-1, 1]) {
      const lamp = new THREE.PointLight(0xffcf8a, 60, 30, 2);
      lamp.position.set(s * CW * 0.6, LAMP_Y, CORRIDOR_FIRST_Z + r * ROW_SPACING);
      group.add(lamp);
    }
  }
  const elevGlow = new THREE.PointLight(0xffe6a8, 26, 16, 2);
  elevGlow.position.set(ELEV.x, 4.8, ELEV.z);
  group.add(elevGlow);

  // ---------- magic orb + corridor displays + tapestry ----------
  const orbUpdate = buildOrb(group, interactables, handlers);
  updaters.push((t) => orbUpdate(t));
  const ctx: RunCtx = { group, inter: interactables, portals, regions, handlers };
  placeRun(ctx, corridorPs, { ox: 0, oz: CORRIDOR_FIRST_Z, dirx: 0, dirz: 1, perpx: 1, perpz: 0, half: CW, spacing: ROW_SPACING });
  buildYearWall(group, floor, CL);

  regions.push({ minX: -CW + MARGIN, maxX: CW - MARGIN, minZ: 0.6, maxZ: CL - 0.6 });
  const excluders = [{ x: ELEV.x, z: ELEV.z, r: ELEV.r }];

  // ---------- the year's activity ----------
  if (handlers.activity && handlers.onEnterActivity) {
    buildActivityGate(group, interactables, portals, regions, handlers.activity, handlers.onEnterActivity);
  }

  // ---------- side halls (only if they hold projects) ----------
  if (leftPs.length) buildHall(ctx, leftPs, -1, addFloorCeil, addWall);
  if (rightPs.length) buildHall(ctx, rightPs, 1, addFloorCeil, addWall);

  // ---------- collaborator NPCs, scattered across the walkable rooms ----------
  placeNpcs(group, regions, excluders, people, updaters, (mesh, person) => {
    // projects this collaborator worked on during this year (floor)
    const projects = floor.projects
      .filter((p) => (p.collaborators ?? []).includes(person.key))
      .map((p) => p.title);
    interactables.push({ mesh, label: `Talk with ${person.name}`, kind: 'npc', action: () => handlers.onNpc(person, projects) });
  });

  const world: CollisionWorld = { regions, excluders };
  return {
    group,
    interactables,
    portals,
    world,
    spawn: { x: 0, z: 7.4, yaw: Math.PI }, // step in beside the orb, tapestry dead ahead
    update: (t, playerPos) => {
      for (const u of updaters) u(t, playerPos);
      for (const g of portals) g.update(t);
    },
    dispose: () => disposeObject(group),
  };
}

// ---------------------------------------------------------------------------

interface RunCfg { ox: number; oz: number; dirx: number; dirz: number; perpx: number; perpz: number; half: number; spacing: number; }

/** Everything a run of displays needs to register itself with the floor. */
interface RunCtx {
  group: THREE.Group;
  inter: Interactable[];
  portals: PortalGate[];
  regions: Rect[];
  handlers: FloorHandlers;
}

/** Place a set of projects as alternating gates on two facing walls of a run. */
function placeRun(ctx: RunCtx, ps: Project[], cfg: RunCfg) {
  ps.forEach((p, i) => {
    const s = i % 2 === 0 ? 1 : -1;          // which of the two walls
    const row = Math.floor(i / 2);
    const cx = cfg.ox + cfg.dirx * row * cfg.spacing;
    const cz = cfg.oz + cfg.dirz * row * cfg.spacing;
    const slot: Slot = {
      ax: cx + cfg.perpx * cfg.half * s,
      az: cz + cfg.perpz * cfg.half * s,
      nx: -cfg.perpx * s,
      nz: -cfg.perpz * s,
    };
    buildDisplayAt(ctx, p, slot);
  });
}

/** Build one side hall extending outward (sign −1 = left, +1 = right) from the elevator. */
function buildHall(
  ctx: RunCtx, ps: Project[], sign: number,
  addFloorCeil: (r: Rect) => void,
  addWall: (ax: number, az: number, bx: number, bz: number, h?: number, y0?: number) => void,
) {
  const { group, regions } = ctx;
  const rows = Math.ceil(ps.length / 2);
  const HL = HALL_FIRST + (rows - 1) * HALL_SPACING + HALL_END_PAD; // hall length in x
  const innerX = sign * CW;             // door side — shared wall with the corridor
  const farX = sign * (CW + HL);        // far wall carrying displays
  const minX = Math.min(innerX, farX), maxX = Math.max(innerX, farX);

  addFloorCeil({ minX, maxX, minZ: 0, maxZ: HALL_DEPTH });
  addWall(farX, 0, farX, HALL_DEPTH);                // far wall
  addWall(minX, 0, maxX, 0);                         // south wall (z = 0)
  addWall(minX, HALL_DEPTH, maxX, HALL_DEPTH);       // north wall (z = HALL_DEPTH)
  // the inner (shared) wall is the corridor side wall, already built with a door

  // displays run outward along x, alternating between the north (z=HALL_DEPTH) and south (z=0) walls
  placeRun(ctx, ps, {
    ox: sign * (CW + HALL_FIRST), oz: HALL_DEPTH / 2, dirx: sign, dirz: 0,
    perpx: 0, perpz: 1, half: HALL_DEPTH / 2, spacing: HALL_SPACING,
  });

  // A warm lamp over every row, so a long hall doesn't fade out at its far end.
  // One per row, not a pair like the main hall: a side hall's two display walls are
  // only HALL_DEPTH apart, so a lamp on the centre line reaches both — and gate art,
  // plaques and banners are all unlit materials, so these lamps are for the stone,
  // the people walking under them and the sense of scale, not for legibility.
  for (let r = 0; r < rows; r++) {
    const lamp = new THREE.PointLight(0xffcf8a, 58, 30, 2);
    lamp.position.set(sign * (CW + HALL_FIRST + r * HALL_SPACING), LAMP_Y, HALL_DEPTH / 2);
    group.add(lamp);
  }

  // Walkable region: no margin on the inner (door) side so the player can reach the
  // doorway, margin on the far display wall. Plus a small bridge rect through the door.
  const innerEdge = innerX;                       // reachable exactly (the door is here)
  const farEdge = farX - sign * MARGIN;           // pulled in by the standoff margin
  regions.push({
    minX: Math.min(innerEdge, farEdge), maxX: Math.max(innerEdge, farEdge),
    minZ: MARGIN, maxZ: HALL_DEPTH - MARGIN,
  });
  regions.push(sign < 0
    ? { minX: -CW - 0.1, maxX: -CW + MARGIN, minZ: DOOR.z0, maxZ: DOOR.z1 }
    : { minX: CW - MARGIN, maxX: CW + 0.1, minZ: DOOR.z0, maxZ: DOOR.z1 });
}

// ---------------------------------------------------------------------------

/** A floating magic orb that opens the floor directory. Returns its per-frame animator. */
function buildOrb(group: THREE.Group, interactables: Interactable[], handlers: FloorHandlers): (t: number) => void {
  const orb = new THREE.Group();
  orb.position.set(ELEV.x, ORB_Y, ELEV.z);

  const glowMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // nested translucent shells around a bright core
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), glowMat(0x7fe0ff, 0.18));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), glowMat(0x49b7ff, 0.35));
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 2, roughness: 0.2, metalness: 0 }),
  );
  orb.add(halo, shell, core);

  // two orbiting rings
  const ringMat = glowMat(0xffe6a8, 0.7);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 8, 64), ringMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.02, 8, 64), ringMat);
  ring2.rotation.x = Math.PI / 3;
  orb.add(ring1, ring2);

  // invisible hit sphere = the raycast/interaction target (larger, easy to aim at)
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.05, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  orb.add(hit);
  group.add(orb);

  // glowing rune circle on the floor beneath the orb
  const rune = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.5, 48),
    new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(ELEV.x, 0.03, ELEV.z);
  group.add(rune);

  const light = new THREE.PointLight(0x9fdcff, 16, 12, 2);
  light.position.set(ELEV.x, ORB_Y, ELEV.z);
  group.add(light);

  interactables.push({ mesh: hit, label: 'Consult the orb — travel the Keep', kind: 'elevator', action: handlers.onElevator });

  const coreMat = core.material as THREE.MeshStandardMaterial;
  return (t: number) => {
    orb.position.y = ORB_Y + Math.sin(t * 1.4) * 0.12;
    core.rotation.y = t * 0.5;
    ring1.rotation.x = t * 0.8;
    ring1.rotation.y = t * 0.6;
    ring2.rotation.y = -t * 0.7;
    ring2.rotation.z = t * 0.5;
    const pulse = 1.7 + Math.sin(t * 3) * 0.6;
    coreMat.emissiveIntensity = pulse;
    light.intensity = 13 + Math.sin(t * 3) * 6;
  };
}

// ---------------------------------------------------------------------------

/** The wall opposite the elevator: a grand year tapestry + the year's chronicle. */
function buildYearWall(group: THREE.Group, floor: Floor, backZ: number) {
  const wz = backZ - 0.35; // clear of the back wall's front face (at backZ − 0.1) to avoid z-fighting

  // Both panels are sized off the hall rather than hardcoded: on a wall 2·CW wide
  // and CEIL high, art scaled for the old narrow corridor reads as postage stamps.
  // Their proportions must stay put though — the tapestry canvas is 1.6:1 and the
  // chronicle 3.5:1 (see textures.ts), and any other plane aspect stretches the art
  // — so each takes its width from the wall and lets the other dimension follow.
  // Stacked bottom-up: chronicle just above the floor trim, then the tapestry filling
  // the band up to the hanging rod, which stays clear of the ceiling.
  const chronW = Math.min(CW, 12);
  const chronH = chronW / 3.5;
  const chronY = 0.45 + chronH / 2;
  const tapBottom = chronY + chronH / 2 + 0.6;
  const tapH = Math.min(CEIL - 0.55 - tapBottom, (CW * 0.85) / 1.6);
  const tapW = tapH * 1.6;
  const tapY = tapBottom + tapH / 2;

  const tapestry = new THREE.Mesh(
    new THREE.PlaneGeometry(tapW, tapH),
    new THREE.MeshBasicMaterial({ map: yearTapestryTexture(floor) }),
  );
  tapestry.position.set(0, tapY, wz);
  tapestry.rotation.y = Math.PI;
  group.add(tapestry);

  const rodMat = new THREE.MeshStandardMaterial({ color: '#4a3d18', metalness: 0.7, roughness: 0.3 });
  const rodY = tapY + tapH / 2 + 0.28;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, tapW + 0.5, 10), rodMat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, rodY, wz - 0.03);
  group.add(rod);
  for (const ex of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), rodMat);
    cap.position.set(ex * (tapW + 0.5) / 2, rodY, wz - 0.03);
    group.add(cap);
  }

  const chron = new THREE.Mesh(
    new THREE.PlaneGeometry(chronW, chronH),
    new THREE.MeshBasicMaterial({ map: yearInfoTexture(floor) }),
  );
  chron.position.set(0, chronY, wz);
  chron.rotation.y = Math.PI;
  group.add(chron);

  // Stood off the wall far enough to graze the whole tapestry rather than blow out
  // its middle — this is the one light the player walks toward down the hall.
  const glow = new THREE.PointLight(0xffe6b0, 58, 34, 2);
  glow.position.set(0, tapY - 0.8, backZ - 4.6);
  group.add(glow);
}

// ---------------------------------------------------------------------------

/**
 * Build one project's wall display: the gate itself (a portal into the project's
 * own room), its banner, title plaque and museum placard — plus the notch in the
 * collision map that lets the player walk right up and leap in.
 */
function buildDisplayAt(ctx: RunCtx, p: Project, slot: Slot) {
  const { group, inter, portals, regions, handlers } = ctx;
  const yaw = Math.atan2(slot.nx, slot.nz);      // plane normal → slot inward normal
  const alx = -slot.nz, alz = slot.nx;           // unit vector along the wall
  // the wall is 0.2 thick and centred on the slot: its inner face is 0.1 in
  const face = 0.1;

  const place = (mesh: THREE.Object3D, out: number, side: number, y: number) => {
    mesh.position.set(
      slot.ax + slot.nx * out + alx * side,
      y,
      slot.az + slot.nz * out + alz * side,
    );
    mesh.rotation.y = yaw;
  };

  // ---- the gate ----
  const primaryGenre = p.genre?.[0];
  const gate = buildPortalGate(group, {
    key: p.title,
    x: slot.ax + slot.nx * face,
    y: GATE_Y,
    z: slot.az + slot.nz * face,
    yaw,
    width: GATE_W,
    height: GATE_H,
    map: fallbackPaintingTexture(p.title),
    tint: new THREE.Color(genreColor(primaryGenre)),
    rune: true,
    enter: () => handlers.onEnterProject(p, gate),
  });
  attachProjectArt(p, (tex) => setGateMap(gate, tex));
  portals.push(gate);
  inter.push({
    mesh: gate.surface,
    label: `Leap into “${p.title}”`,
    kind: 'portal',
    action: () => handlers.onEnterProject(p, gate),
  });

  // The run-up notch: a shallow bay in front of the gate that overlaps the room's
  // own walkable rect, so the player can step in, leap, and step back out. Slots
  // are axis-aligned, so two opposite corners describe the whole rectangle.
  const cx = (out: number, sd: number) => slot.ax + slot.nx * out + alx * sd;
  const cz = (out: number, sd: number) => slot.az + slot.nz * out + alz * sd;
  const [n, f, h] = [ALCOVE_NEAR, MARGIN + 0.1, ALCOVE_HALF];
  regions.push({
    minX: Math.min(cx(n, -h), cx(f, h)), maxX: Math.max(cx(n, -h), cx(f, h)),
    minZ: Math.min(cz(n, -h), cz(f, h)), maxZ: Math.max(cz(n, -h), cz(f, h)),
  });

  // Genre banner + rod. It hangs in the bare wall *above* the arch rather than over
  // it: on a CEIL-high wall that band is empty anyway, and clearing the arch means
  // the banner no longer has to thread the 0.07 of depth between it and the keystone.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 2.9),
    new THREE.MeshBasicMaterial({ map: bannerTexture(primaryGenre, genreColor(primaryGenre)), transparent: true }),
  );
  place(banner, 0.3, 0, 6.73);   // hangs 5.28…8.18: clear of the arch's top at 5.14
  group.add(banner);
  const rodMat = new THREE.MeshStandardMaterial({ color: '#4a3d18', metalness: 0.7, roughness: 0.3 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), rodMat);
  rod.rotation.z = Math.PI / 2;
  place(rod, 0.3, 0, 8.2);
  group.add(rod);

  // Name and dev days, on the lintel below the mouth. That's all a gate says —
  // the full placard lives inside the project's room.
  // 0.13 clears the wall's inner face (the wall is a 0.2-thick box centred on the
  // slot, so anything at out < 0.1 is buried inside it); 1.28 clears the low rail,
  // whose underside is at 1.79 — the plaque's top edge lands at 1.787.
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(2.95, 1.014),
    new THREE.MeshBasicMaterial({ map: gatePlaqueTexture(p), transparent: true }),
  );
  place(plaque, 0.13, 0, 1.28);
  group.add(plaque);
}

/**
 * The year's activity gate, set into the front wall behind the orb — the one
 * blank wall on a floor, and the one you turn round to see when you arrive.
 *
 * It is built exactly like a project gate, down to the sill height (the bottom
 * of the mouth at GATE_Y − GATE_H/2 ≈ 2.0 is what makes a leap the only way in),
 * and differs only in dress: a sigil instead of project art, a gold tint instead
 * of a genre colour, and a real point light, which is affordable because there is
 * never more than one of these on a floor.
 */
function buildActivityGate(
  group: THREE.Group, inter: Interactable[], portals: PortalGate[], regions: Rect[],
  def: ActivityDef, onEnter: (def: ActivityDef, gate: PortalGate) => void,
) {
  const gate = buildPortalGate(group, {
    key: def.key,
    x: 0, y: GATE_Y, z: 0.1,
    yaw: 0,
    width: GATE_W,
    height: GATE_H,
    map: trialSigilTexture(def.title, def.tagline),
    tint: new THREE.Color(def.tint),
    rune: true,
    light: true,
    enter: () => onEnter(def, gate),
  });
  portals.push(gate);
  inter.push({
    mesh: gate.surface,
    label: `Leap into “${def.title}”`,
    kind: 'portal',
    action: () => onEnter(def, gate),
  });

  // the run-up notch, same shape as a project gate's
  regions.push({ minX: -ALCOVE_HALF, maxX: ALCOVE_HALF, minZ: ALCOVE_NEAR, maxZ: MARGIN + 0.1 });

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.0, 1.43),
    new THREE.MeshBasicMaterial({ map: doorSignTexture(def.title), transparent: true }),
  );
  sign.position.set(0, 6.2, 0.12);
  group.add(sign);
}

// ---- procedural stone texture ----
const _stoneCache = new Map<string, THREE.Texture>();
export function stoneTexture(a: string, b: string): THREE.Texture {
  const src = _stoneCache.get(a + b) ?? makeStone(a, b);
  _stoneCache.set(a + b, src);
  const t = src.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}
function makeStone(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, 256, 256);
  const bh = 42, bw = 84;
  for (let row = 0, y = 0; y < 256; y += bh, row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 256; x += bw) {
      const shadeV = 0.85 + Math.abs(Math.sin((x + y) * 12.9898) * 43758.5) % 1 * 0.3;
      ctx.fillStyle = mix(a, b, shadeV * 0.5);
      ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mix(a: string, b: string, t: number): string {
  const pa = toRgb(a), pb = toRgb(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
}
function toRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

// ---- disposal ----
export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as any).material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const anyM = m as any;
        for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
          if (anyM[k]) anyM[k].dispose();
        }
        // portal membranes carry their art in a uniform instead of `.map`
        for (const u of Object.values(anyM.uniforms ?? {}) as { value?: unknown }[]) {
          if (u?.value instanceof THREE.Texture) u.value.dispose();
        }
        m.dispose();
      }
    }
  });
}
