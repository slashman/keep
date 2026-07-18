import * as THREE from 'three';
import type { Floor, Project, ProjectButton } from './types';
import type { CollisionWorld, Rect } from './controls';
import { buttonStyle, genreColor } from './tags';
import {
  placardTexture, titlePlaqueTexture, bannerTexture, buttonLabelTexture,
  fallbackPaintingTexture, loadImageTexture,
  yearTapestryTexture, yearInfoTexture,
} from './textures';

export interface Interactable {
  mesh: THREE.Object3D;
  label: string;
  kind: 'button' | 'elevator';
  action: () => void;
}

export interface FloorHandlers {
  onButton: (btn: ProjectButton) => void;
  onElevator: () => void;
}

export interface FloorBuild {
  group: THREE.Group;
  interactables: Interactable[];
  world: CollisionWorld;
  spawn: { x: number; z: number; yaw: number };
  update?: (t: number) => void; // per-frame animation (the magic orb)
  dispose: () => void;
}

/**
 * A wall slot a display is mounted on: the anchor point on the wall surface (ax,az),
 * the inward normal (nx,nz) pointing into the room, and the run direction (dirx,dirz)
 * used to decide which way to fan the placard.
 */
interface Slot { ax: number; az: number; nx: number; nz: number; dirx: number; dirz: number; }

// ---- layout constants ----
const CEIL = 6.2;
const PAINT_Y = 3.25;
const CW = 4.5;                // corridor half-width (walls at ±CW)
const CORRIDOR_FIRST_Z = 8.5;  // z of the first corridor row
const ROW_SPACING = 5.2;       // spacing between corridor rows
const BACK_PAD = 3.8;          // gap between last corridor row and the tapestry wall
const CORRIDOR_MAX = 6;        // projects the corridor holds before overflowing to halls
const MARGIN = 1.05;           // player standoff from display walls
const PLACARD_SIDE = 2.2;      // placard offset along the wall
const DOOR = { z0: 2.0, z1: 4.4, height: 3.6 };
const ELEV = { x: 0, z: 3.2, r: 0.9 }; // the orb's spot (small excluder so you can walk right up)
const ORB_Y = 2.0;
// side halls
const HALL_DEPTH = 8;          // z-extent of a side hall
const HALL_FIRST = 3.0;        // x-distance of the first hall row from the corridor wall
const HALL_SPACING = 5.0;
const HALL_END_PAD = 4.0;      // clears the back-most placard (fans out PLACARD_SIDE + half-width ≈ 3.2)

export function buildFloor(floor: Floor, handlers: FloorHandlers): FloorBuild {
  const group = new THREE.Group();
  const interactables: Interactable[] = [];
  const regions: Rect[] = [];

  // split projects: corridor first, remainder divided between the two halls
  const corridorPs = floor.projects.slice(0, CORRIDOR_MAX);
  const rest = floor.projects.slice(CORRIDOR_MAX);
  const half = Math.ceil(rest.length / 2);
  const leftPs = rest.slice(0, half);
  const rightPs = rest.slice(half);

  // corridor length is fixed by its (≤6) contents — always short and reachable
  const cRows = Math.max(1, Math.ceil(corridorPs.length / 2));
  const CL = CORRIDOR_FIRST_Z + (cRows - 1) * ROW_SPACING + BACK_PAD; // z of the back (tapestry) wall

  // ---- shared materials ----
  const floorMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#2c2740', '#211d31'), roughness: 0.95, metalness: 0.02 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: '#0d0b16', roughness: 1 });
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
    trim.position.set(s * (CW - 0.06), 0.15, CL / 2);
    group.add(trim);
  }

  // ---------- lighting ----------
  group.add(new THREE.HemisphereLight(0xb9a7ff, 0x241d10, 0.55));
  group.add(new THREE.AmbientLight(0xffffff, 0.2));
  const key = new THREE.DirectionalLight(0xfff1d6, 0.35);
  key.position.set(3, 10, 2);
  group.add(key);
  for (let r = 0; r < cRows; r++) {
    const lamp = new THREE.PointLight(0xffcf8a, 22, 15, 2);
    lamp.position.set(0, CEIL - 0.6, CORRIDOR_FIRST_Z + r * ROW_SPACING);
    group.add(lamp);
  }
  const elevGlow = new THREE.PointLight(0xffe6a8, 16, 9, 2);
  elevGlow.position.set(ELEV.x, 3.6, ELEV.z);
  group.add(elevGlow);

  // ---------- magic orb + corridor displays + tapestry ----------
  const orbUpdate = buildOrb(group, interactables, handlers);
  placeRun(group, interactables, corridorPs, { ox: 0, oz: CORRIDOR_FIRST_Z, dirx: 0, dirz: 1, perpx: 1, perpz: 0, half: CW, spacing: ROW_SPACING }, handlers);
  buildYearWall(group, floor, CL);

  regions.push({ minX: -CW + MARGIN, maxX: CW - MARGIN, minZ: 0.6, maxZ: CL - 0.6 });
  const excluders = [{ x: ELEV.x, z: ELEV.z, r: ELEV.r }];

  // ---------- side halls (only if they hold projects) ----------
  if (leftPs.length) buildHall(group, interactables, leftPs, -1, handlers, regions, addFloorCeil, addWall);
  if (rightPs.length) buildHall(group, interactables, rightPs, 1, handlers, regions, addFloorCeil, addWall);

  const world: CollisionWorld = { regions, excluders };
  return {
    group,
    interactables,
    world,
    spawn: { x: 0, z: 5.6, yaw: Math.PI }, // step in beside the orb, tapestry dead ahead
    update: orbUpdate,
    dispose: () => disposeObject(group),
  };
}

// ---------------------------------------------------------------------------

interface RunCfg { ox: number; oz: number; dirx: number; dirz: number; perpx: number; perpz: number; half: number; spacing: number; }

/** Place a set of projects as alternating displays on two facing walls of a run. */
function placeRun(
  group: THREE.Group, inter: Interactable[], ps: Project[], cfg: RunCfg, handlers: FloorHandlers,
) {
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
      dirx: cfg.dirx,
      dirz: cfg.dirz,
    };
    buildDisplayAt(group, inter, p, slot, handlers);
  });
}

/** Build one side hall extending outward (sign −1 = left, +1 = right) from the elevator. */
function buildHall(
  group: THREE.Group, inter: Interactable[], ps: Project[], sign: number, handlers: FloorHandlers,
  regions: Rect[],
  addFloorCeil: (r: Rect) => void,
  addWall: (ax: number, az: number, bx: number, bz: number, h?: number, y0?: number) => void,
) {
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
  placeRun(group, inter, ps, {
    ox: sign * (CW + HALL_FIRST), oz: HALL_DEPTH / 2, dirx: sign, dirz: 0,
    perpx: 0, perpz: 1, half: HALL_DEPTH / 2, spacing: HALL_SPACING,
  }, handlers);

  // warm lamp
  const lamp = new THREE.PointLight(0xffcf8a, 22, 16, 2);
  lamp.position.set(sign * (CW + HL / 2), CEIL - 0.6, HALL_DEPTH / 2);
  group.add(lamp);

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

  const tapestry = new THREE.Mesh(
    new THREE.PlaneGeometry(6.1, 3.8),
    new THREE.MeshBasicMaterial({ map: yearTapestryTexture(floor) }),
  );
  tapestry.position.set(0, 4.2, wz);
  tapestry.rotation.y = Math.PI;
  group.add(tapestry);

  const rodMat = new THREE.MeshStandardMaterial({ color: '#4a3d18', metalness: 0.7, roughness: 0.3 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.5, 10), rodMat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, 6.12, wz - 0.03);
  group.add(rod);
  for (const ex of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), rodMat);
    cap.position.set(ex * 3.25, 6.12, wz - 0.03);
    group.add(cap);
  }

  const chron = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 2.0),
    new THREE.MeshBasicMaterial({ map: yearInfoTexture(floor) }),
  );
  chron.position.set(0, 1.15, wz);
  chron.rotation.y = Math.PI;
  group.add(chron);

  const glow = new THREE.PointLight(0xffe6b0, 26, 20, 2);
  glow.position.set(0, 4.3, backZ - 2.2);
  group.add(glow);
}

// ---------------------------------------------------------------------------

/** Build a full project display (frame, painting, banner, plaque, placard, lectern) at a slot. */
function buildDisplayAt(group: THREE.Group, interactables: Interactable[], p: Project, slot: Slot, handlers: FloorHandlers) {
  const yaw = Math.atan2(slot.nx, slot.nz);      // plane normal → slot inward normal
  const alx = -slot.nz, alz = slot.nx;           // unit vector along the wall
  // which way along the wall to fan the placard (toward the run direction / into the room)
  const sgn = Math.sign(alx * slot.dirx + alz * slot.dirz) || 1;

  const place = (mesh: THREE.Object3D, out: number, side: number, y: number) => {
    mesh.position.set(
      slot.ax + slot.nx * out + alx * side,
      y,
      slot.az + slot.nz * out + alz * side,
    );
    mesh.rotation.y = yaw;
  };

  // frame + painting
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.15, 2.45, 0.12),
    new THREE.MeshStandardMaterial({ color: '#2a2110', metalness: 0.5, roughness: 0.35 }),
  );
  place(frame, 0.02, 0, PAINT_Y);
  group.add(frame);

  const paintMat = new THREE.MeshBasicMaterial({ map: fallbackPaintingTexture(p.title) });
  const painting = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.1), paintMat);
  place(painting, 0.16, 0, PAINT_Y);
  group.add(painting);
  attachProjectImage(p, paintMat);

  // genre banner + rod
  const primaryGenre = p.genre?.[0];
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.9),
    new THREE.MeshBasicMaterial({ map: bannerTexture(primaryGenre, genreColor(primaryGenre)), transparent: true }),
  );
  place(banner, 0.06, 0, 5.15);
  group.add(banner);
  const rodMat = new THREE.MeshStandardMaterial({ color: '#4a3d18', metalness: 0.7, roughness: 0.3 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.05, 8), rodMat);
  rod.rotation.z = Math.PI / 2;
  place(rod, 0.06, 0, 6.08);
  group.add(rod);

  // title plaque
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.52),
    new THREE.MeshBasicMaterial({ map: titlePlaqueTexture(p.title), transparent: true }),
  );
  place(plaque, 0.05, 0, 1.95);
  group.add(plaque);

  // info placard (fanned to the side) + backboard
  const side = PLACARD_SIDE * sgn;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.93, 0.08),
    new THREE.MeshStandardMaterial({ color: '#0c0a14', roughness: 0.9 }),
  );
  place(back, 0.39, side, 2.35);
  group.add(back);
  const placard = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 2.73),
    new THREE.MeshBasicMaterial({ map: placardTexture(p) }),
  );
  place(placard, 0.45, side, 2.35);
  group.add(placard);

  // lectern of buttons
  const buttons = (p.buttons ?? []).filter((b) => b.url).slice(0, 6);
  if (!buttons.length) return;

  const woodMat = new THREE.MeshStandardMaterial({ color: '#241b0e', roughness: 0.7, metalness: 0.2 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.5), woodMat);
  place(base, 0.55, 0, 0.25);
  group.add(base);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.12), woodMat);
  place(board, 0.68, 0, 1.15);
  group.add(board);

  buttons.forEach((btn, k) => {
    const col = k % 2;
    const rowIdx = Math.floor(k / 2);
    const bside = col === 0 ? -0.5 : 0.5;
    const by = 1.55 - rowIdx * 0.4;
    const style = buttonStyle(btn.type);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.3, 0.07),
      new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.4, metalness: 0.3, emissive: style.color, emissiveIntensity: 0.15 }),
    );
    place(body, 0.78, bside, by);
    group.add(body);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.28),
      new THREE.MeshBasicMaterial({ map: buttonLabelTexture(style.color, style.glyph, style.verb, btn.title), transparent: true }),
    );
    place(label, 0.82, bside, by);
    label.userData.pulse = body;
    group.add(label);

    interactables.push({ mesh: label, label: `${style.verb}: ${btn.title}`, kind: 'button', action: () => handlers.onButton(btn) });
  });
}

// ---------------------------------------------------------------------------

function attachProjectImage(p: Project, mat: THREE.MeshBasicMaterial) {
  const url = resolveImageUrl(p.image);
  if (!url) return;
  loadImageTexture(url).then((tex) => {
    if (tex) {
      const old = mat.map;
      mat.map = tex;
      mat.needsUpdate = true;
      old?.dispose();
    }
  });
}

function resolveImageUrl(image?: string): string | null {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  return '/slashie/' + image.replace(/^\//, '');
}

// ---- procedural stone texture ----
const _stoneCache = new Map<string, THREE.Texture>();
function stoneTexture(a: string, b: string): THREE.Texture {
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
        m.dispose();
      }
    }
  });
}
