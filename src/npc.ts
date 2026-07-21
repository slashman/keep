import * as THREE from 'three';
import type { Person } from './types';
import type { Rect } from './controls';
import { faceTexture, squareImageTexture, nameTagTexture } from './textures';
import { DATA_BASE } from './config';

const MAX_NPCS = 16;          // cap so busy years don't overcrowd the map
const NPC_SPACING = 1.5;      // minimum distance between NPCs
const STARE_DIST = 4.0;       // within this range an NPC stops and faces the player
const WALK_SPEED = 0.55;      // metres/second while wandering
const TURN_RATE = 7;          // how quickly an NPC swings to face its target heading

export type NpcUpdater = (t: number, playerPos: THREE.Vector3) => void;

interface NpcState {
  x: number; z: number;
  heading: number;   // radians; the direction it walks / faces
  retarget: number;  // seconds until it picks a new heading
  phase: number;     // walk-cycle phase for the bob
  lastT: number;
}

/**
 * Scatter blocky, Roblox-style NPCs (one per collaborator) across the floor's
 * walkable rooms. Each has a cube head showing the person's picture and turns to
 * stare at the player. Returns updater callbacks the floor loop drives each frame.
 */
export function placeNpcs(
  group: THREE.Group,
  regions: Rect[],
  excluders: { x: number; z: number; r: number }[],
  people: Person[],
  updaters: NpcUpdater[],
  registerNpc: (mesh: THREE.Object3D, person: Person) => void,
) {
  // only spawn in roomy areas (skip the thin door-bridge rects)
  const rooms = regions.filter((r) => r.maxX - r.minX >= 2 && r.maxZ - r.minZ >= 2);
  if (!rooms.length || !people.length) return;

  // priority people (hand-authored) are always kept; the rest fill remaining slots
  const priority = people.filter((p) => p.priority);
  const others = shuffle(people.filter((p) => !p.priority));
  const chosen = [...priority, ...others].slice(0, Math.max(MAX_NPCS, priority.length));
  // place babies (cradles) first so they claim a quiet corner before the walkers spread out
  chosen.sort((a, b) => (b.baby ? 1 : 0) - (a.baby ? 1 : 0));
  const placed: { x: number; z: number }[] = [];
  // NPCs may wander anywhere walkable (including through doorways), not just their spawn room
  const walkable = (x: number, z: number) =>
    !excluders.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + 0.35) ** 2)
    && regions.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

  for (const person of chosen) {
    // a baby is static, tucked into a cradle in a corner — no wandering updater
    if (person.baby) {
      const spot = sampleCorner(rooms, excluders, placed);
      if (!spot) continue;
      placed.push(spot);
      const cradle = buildCradle(person);
      cradle.position.set(spot.x, 0, spot.z);
      cradle.rotation.y = Math.atan2(-spot.x, -spot.z); // open side faces the room
      group.add(cradle);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.85;
      cradle.add(hit);
      registerNpc(hit, person);
      continue;
    }

    const pos = samplePosition(rooms, excluders, placed);
    if (!pos) continue;
    placed.push(pos);

    const npc = buildNpc(person);
    npc.position.set(pos.x, 0, pos.z);
    group.add(npc);

    // invisible hit box for raycast-based interaction (moves with the NPC)
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.8, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.4;
    npc.add(hit);
    registerNpc(hit, person);

    const s: NpcState = {
      x: pos.x, z: pos.z,
      heading: Math.random() * Math.PI * 2,
      retarget: Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
      lastT: 0,
    };
    updaters.push((t, playerPos) => updateNpc(npc, s, t, playerPos, walkable));
  }
}

function updateNpc(
  npc: THREE.Group, s: NpcState, t: number, playerPos: THREE.Vector3,
  walkable: (x: number, z: number) => boolean,
) {
  const dt = Math.min(0.05, Math.max(0, t - s.lastT));
  s.lastT = t;

  const dx = playerPos.x - s.x, dz = playerPos.z - s.z;
  const distSq = dx * dx + dz * dz;

  let targetYaw: number;
  let moving = false;
  if (distSq < STARE_DIST * STARE_DIST) {
    // player is close → stop and stare
    targetYaw = Math.atan2(dx, dz);
  } else {
    // wander: pick a new heading now and then, step forward if the way is clear
    s.retarget -= dt;
    if (s.retarget <= 0) { s.heading = Math.random() * Math.PI * 2; s.retarget = 2 + Math.random() * 3; }
    const nx = s.x + Math.sin(s.heading) * WALK_SPEED * dt;
    const nz = s.z + Math.cos(s.heading) * WALK_SPEED * dt;
    if (walkable(nx, nz)) {
      s.x = nx; s.z = nz;
      npc.position.x = nx; npc.position.z = nz;
      moving = true;
    } else {
      // hit a wall — turn away and retry soon
      s.heading += Math.PI * 0.6 + Math.random() * Math.PI * 0.8;
      s.retarget = 0.2;
    }
    targetYaw = s.heading;
  }

  // smooth turn toward the target heading, and a gentle walk bob
  npc.rotation.y = approachAngle(npc.rotation.y, targetYaw, dt * TURN_RATE);
  if (moving) { s.phase += dt * 9; npc.position.y = Math.abs(Math.sin(s.phase)) * 0.05; }
  else if (npc.position.y !== 0) { npc.position.y = Math.max(0, npc.position.y - dt * 0.3); }

  // swing the arms in opposition while walking, easing back to rest when stopped
  const arms = (npc.userData as { arms?: { left: THREE.Object3D; right: THREE.Object3D } }).arms;
  if (arms) {
    const swing = moving ? Math.sin(s.phase) * 0.5 : 0;
    arms.left.rotation.x = approachAngle(arms.left.rotation.x, swing, dt * 10);
    arms.right.rotation.x = approachAngle(arms.right.rotation.x, -swing, dt * 10);
  }
}

function approachAngle(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, k);
}

function samplePosition(
  rooms: Rect[],
  excluders: { x: number; z: number; r: number }[],
  placed: { x: number; z: number }[],
): { x: number; z: number } | null {
  for (let i = 0; i < 40; i++) {
    const r = rooms[Math.floor(Math.random() * rooms.length)];
    const x = r.minX + 0.6 + Math.random() * Math.max(0.01, r.maxX - r.minX - 1.2);
    const z = r.minZ + 0.6 + Math.random() * Math.max(0.01, r.maxZ - r.minZ - 1.2);
    if (excluders.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + 0.8) ** 2)) continue;
    if (placed.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < NPC_SPACING ** 2)) continue;
    return { x, z };
  }
  return null;
}

/** A quiet corner of the biggest room for a static prop (e.g. a cradle). */
function sampleCorner(
  rooms: Rect[],
  excluders: { x: number; z: number; r: number }[],
  placed: { x: number; z: number }[],
): { x: number; z: number } | null {
  const room = rooms.reduce((a, b) =>
    (b.maxX - b.minX) * (b.maxZ - b.minZ) > (a.maxX - a.minX) * (a.maxZ - a.minZ) ? b : a);
  const inset = 1.1;
  const corners = [
    { x: room.minX + inset, z: room.minZ + inset },
    { x: room.maxX - inset, z: room.minZ + inset },
    { x: room.minX + inset, z: room.maxZ - inset },
    { x: room.maxX - inset, z: room.maxZ - inset },
  ];
  for (const c of corners) {
    if (excluders.some((e) => (c.x - e.x) ** 2 + (c.z - e.z) ** 2 < (e.r + 0.9) ** 2)) continue;
    if (placed.some((p) => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < NPC_SPACING ** 2)) continue;
    return c;
  }
  return null;
}

/** A wooden rocking cradle with a swaddled baby (used for a person on their birth year). */
function buildCradle(person: Person): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(person.scale ?? 1);
  const wood = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05 });
  const woodC = '#6b4a2b', woodD = '#553a22';

  // A big, tall cradle. Furniture dimensions are scaled up; the baby below is kept
  // small so she looks tiny inside it. Bed height (top of the bedding) ≈ 1.28.
  // two tall curved rockers the cradle rests on
  for (const sz of [-0.36, 0.36]) {
    const rocker = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 8, 24, Math.PI), wood(woodD));
    rocker.rotation.z = Math.PI; // flip the arc into a rocker (bowl) shape
    rocker.position.set(0, 0.62, sz);
    g.add(rocker);
  }
  // legs lifting the basket high off the rockers
  const railMat = wood(woodC);
  for (const sx of [-0.78, 0.78]) for (const sz of [-0.36, 0.36]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1), railMat);
    leg.position.set(sx, 0.86, sz);
    g.add(leg);
  }
  // basket floor
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.84), wood(woodC));
  basket.position.set(0, 1.14, 0);
  g.add(basket);
  // rails — the head-end rail is lower so the baby's face peeks over
  for (const sz of [-0.42, 0.42]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.08), railMat);
    rail.position.set(0, 1.4, sz);
    g.add(rail);
  }
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.84), railMat);
  foot.position.set(-0.85, 1.44, 0); g.add(foot);
  const headRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.84), railMat);
  headRail.position.set(0.85, 1.31, 0); g.add(headRail);

  // bedding + pillow
  const bedding = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.14, 0.74),
    new THREE.MeshStandardMaterial({ color: '#f4e6ea', roughness: 0.95 }));
  bedding.position.set(0, 1.24, 0); g.add(bedding);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.46),
    new THREE.MeshStandardMaterial({ color: '#ffd7e6', roughness: 0.95 }));
  pillow.position.set(0.5, 1.32, 0); g.add(pillow);

  // swaddled bundle — kept small, resting on the bedding
  const swaddle = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.34),
    new THREE.MeshStandardMaterial({ color: '#ffb6cf', roughness: 0.9 }));
  swaddle.position.set(0.06, 1.36, 0); g.add(swaddle);

  // head — the baby lies on its back, so the photo shows on the top and sides (skin underneath)
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(person.key) });
  const skinMat = new THREE.MeshStandardMaterial({ color: '#e6b98f', roughness: 0.85 });
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
    [faceMat, faceMat, faceMat, skinMat, faceMat, faceMat]);
  head.position.set(0.42, 1.42, 0);
  head.rotation.z = -0.45; // tilt back against the pillow so the face reads to a standing viewer
  g.add(head);

  // swap in the real baby photo when it loads
  const url = resolvePersonImage(person.image);
  if (url) {
    squareImageTexture(url, person.portraitLeftMargin).then((tex) => {
      if (tex) { faceMat.map = tex; faceMat.needsUpdate = true; }
    });
  }

  // floating name tag
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.3),
    new THREE.MeshBasicMaterial({ map: nameTagTexture(person.name), transparent: true }),
  );
  tag.position.set(0, 1.95, 0);
  g.add(tag);

  return g;
}

function buildNpc(person: Person): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(person.scale ?? 1); // smaller/larger characters (feet stay on the floor)
  const shirt = colorFromKey(person.key, 55, 50);
  const pants = colorFromKey(person.key + '·legs', 35, 32);
  const mk = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 });

  // legs
  for (const sx of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.32), mk(pants));
    leg.position.set(sx, 0.45, 0);
    g.add(leg);
  }
  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 0.42), mk(shirt));
  torso.position.set(0, 1.4, 0);
  g.add(torso);
  // arms on shoulder pivots (so they swing from the shoulder, not the middle)
  const arms: { left: THREE.Group; right: THREE.Group } = { left: new THREE.Group(), right: new THREE.Group() };
  for (const side of ['left', 'right'] as const) {
    const pivot = arms[side];
    pivot.position.set(side === 'left' ? -0.55 : 0.55, 1.86, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.92, 0.28), mk(shirt));
    arm.position.set(0, -0.46, 0); // hang below the pivot
    pivot.add(arm);
    g.add(pivot);
  }
  g.userData.arms = arms;

  // cube head — picture on the four sides, skin on top/bottom
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(person.key) });
  const skinMat = new THREE.MeshStandardMaterial({ color: '#caa47c', roughness: 0.85 });
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.78, 0.78),
    [faceMat, faceMat, skinMat, skinMat, faceMat, faceMat],
  );
  head.position.set(0, 2.3, 0);
  g.add(head);

  // swap in the real picture when it loads
  const url = resolvePersonImage(person.image);
  if (url) {
    squareImageTexture(url, person.portraitLeftMargin).then((tex) => {
      if (tex) { faceMat.map = tex; faceMat.needsUpdate = true; }
    });
  }

  // floating name tag (faces the player, since the whole NPC turns to face them)
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.35),
    new THREE.MeshBasicMaterial({ map: nameTagTexture(person.name), transparent: true }),
  );
  tag.position.set(0, 3.05, 0);
  g.add(tag);

  return g;
}

function resolvePersonImage(image?: string): string | null {
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('/')) return image; // already-resolved local/public asset (e.g. /keep/people/x.png)
  return DATA_BASE + image; // slashie.net collaborator image (img/buttons/...)
}

function colorFromKey(key: string, sat: number, light: number): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, ${sat}%, ${light}%)`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
