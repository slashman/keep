import * as THREE from 'three';
import type { Floor } from './types';
import type { ActivityDef, ActivityHandlers } from './activities';
import type { CollisionWorld, Platform, Rect } from './controls';
import { EYE_HEIGHT, JUMP_ARC } from './controls';
import { disposeObject, stoneTexture, type FloorBuild, type Interactable } from './floor';
import { buildPortalGate, type PortalGate } from './portal';
import { artifactById } from './artifacts';
import { decreeTexture, ruleBoardTexture, trialSigilTexture, titlePlaqueTexture } from './textures';

// The Trial of the Senate — 2026's activity, and the first thing in the Keep you
// can fail at. A hollow stone shaft with a spiral of ledges up its inside wall,
// a middle stretch of platforms that will not hold still, and a last run of tiles
// that blink out from under you. At the top, on a dais, the Decree.
//
// Nothing here is measured in metres by choice — every distance comes off the
// jump arc in `controls.ts`, so retuning the leap retunes the tower with it. The
// two fractions below are the whole difficulty knob: a rise is 62% of what you
// can clear, a stage 1 gap 55% of how far you can carry yourself. Both leave room
// for a mistimed jump, which is the difference between a trial and a chore.
const LEDGE_HALF = 1.4, TILE_HALF = 1.2, STATION_HALF = 1.5, FERRY_HALF = 1.3;
const RISE = JUMP_ARC.apex * 0.62;
const STAGE1_GAP = JUMP_ARC.reach * 0.55;

// ---- the shaft ----
// The spiral's radius is whatever puts consecutive ledges STAGE1_GAP apart, edge
// to edge, at the 42° they are spaced by: chord = 2·R·sin(21°).
const R = (STAGE1_GAP + LEDGE_HALF * 2) / (2 * Math.sin((21 * Math.PI) / 180));
const AXIS = { x: 0, z: 18 };   // the spiral turns about this
const SUMMIT_TOP = RISE * 15;   // fifteen platforms, one rise apart
const SUMMIT_HALF = 3.5;
// Wider and taller than the climb needs. The chase camera sits 4.6 m behind your
// head, and on a spiral you spend half your time facing the wall you are
// climbing — without the clearance the camera spends that half jammed against the
// stone. The antechamber at the near end is the same idea for the arrival shot.
const SHAFT = { hx: R + 7.5, z0: 0, z1: AXIS.z + R + 7.5, ceil: SUMMIT_TOP + 8 };
const MARGIN = 0.6;             // player standoff from the shaft wall

/**
 * How far you may drop before the trial restarts. One missed jump usually lands
 * you on the ledge below, a RISE fall — survivable, and the more interesting
 * outcome. Twice that is a fall, and a fall is the end of the run. Touching the
 * shaft floor after leaving it is always a fall, however short the drop.
 */
const FALL_TOLERANCE = 2 * RISE;

const GATE_W = 3.2, GATE_H = 2.6;
/** Centre of a gate's mouth above whatever you stand on to jump into it. */
const GATE_RISE = 3.15;

/** Point on the spiral at `deg` degrees clockwise from the entrance. */
function spiral(deg: number, r = R) {
  const a = (deg * Math.PI) / 180;
  return { x: AXIS.x + r * Math.sin(a), z: AXIS.z - r * Math.cos(a) };
}

/** A platform, its mesh, and (for movers and blinkers) what it does each frame. */
interface Block {
  plat: Platform;
  mesh: THREE.Object3D;
  glow: THREE.MeshBasicMaterial;
  /** Rewrites the platform's XZ bounds and velocity, and moves the mesh to match. */
  motion?: (t: number) => void;
  /** Toggles `plat.active`. */
  blink?: (t: number) => void;
}

export function buildObbyTrial(floor: Floor, def: ActivityDef, handlers: ActivityHandlers): FloorBuild {
  const group = new THREE.Group();
  const interactables: Interactable[] = [];
  const portals: PortalGate[] = [];
  const blocks: Block[] = [];
  const platforms: Platform[] = [];
  const updaters: ((t: number) => void)[] = [];

  // ---------- shell ----------
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#38314f', '#221d33'), roughness: 0.92 });
  const groundMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#231f33', '#12101c'), roughness: 1 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#171325', '#0b0913'), roughness: 1 });

  const W = SHAFT.hx * 2, D = SHAFT.z1 - SHAFT.z0, MZ = (SHAFT.z0 + SHAFT.z1) / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, MZ);
  group.add(ground);
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, SHAFT.ceil, MZ);
  group.add(cap);

  const wall = (w: number, x: number, z: number, yaw: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, SHAFT.ceil, 0.2), stoneMat);
    m.position.set(x, SHAFT.ceil / 2, z);
    m.rotation.y = yaw;
    group.add(m);
  };
  wall(W, 0, SHAFT.z0, 0);
  wall(W, 0, SHAFT.z1, 0);
  wall(D, -SHAFT.hx, MZ, Math.PI / 2);
  wall(D, SHAFT.hx, MZ, Math.PI / 2);

  // ---------- lighting ----------
  // A climb is only fair if you can see the next ledge, so the shaft is lit far
  // more evenly than a hall — and the lamps climb the spiral rather than hanging
  // on the walls, so every one of them is over the path you actually take. The
  // rest of the legibility comes from the unlit glowing lid on every platform: a
  // lit material twelve metres above the nearest lamp reads as a grey smudge.
  group.add(new THREE.HemisphereLight(0x9f8cff, 0x1a1408, 0.95));
  group.add(new THREE.AmbientLight(0xffffff, 0.5));
  const LAMPS = 11;
  for (let i = 0; i < LAMPS; i++) {
    const p = spiral(20 + i * 78, R + 2.6);
    const lamp = new THREE.PointLight(0xffcf8a, 150, 40, 2);
    lamp.position.set(p.x, 2.4 + (i * SUMMIT_TOP) / (LAMPS - 1), p.z);
    group.add(lamp);
  }
  const summitLight = new THREE.PointLight(0xffe6a8, 46, 18, 2);
  summitLight.position.set(AXIS.x, SUMMIT_TOP + 3.4, AXIS.z);
  group.add(summitLight);

  // ---------- platforms ----------
  const ledgeMat = new THREE.MeshStandardMaterial({ color: '#4b4166', roughness: 0.8, metalness: 0.1 });
  const moverMat = new THREE.MeshStandardMaterial({ color: '#2f5570', roughness: 0.6, metalness: 0.3 });
  const blinkMat = new THREE.MeshStandardMaterial({ color: '#5b3a63', roughness: 0.7, metalness: 0.2 });

  /**
   * One standable slab: a box hanging below its top surface, plus a thin unlit
   * lid so the surface itself is readable from anywhere in the shaft.
   */
  function slab(cx: number, cz: number, hx: number, hz: number, top: number, mat: THREE.Material, tint: number): Block {
    const holder = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.5, hz * 2), mat);
    body.position.y = -0.25;
    holder.add(body);
    const glow = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), glow);
    lid.rotation.x = -Math.PI / 2;
    lid.position.y = 0.012;
    holder.add(lid);
    holder.position.set(cx, top, cz);
    group.add(holder);

    const plat: Platform = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, top };
    platforms.push(plat);
    const b: Block = { plat, mesh: holder, glow };
    blocks.push(b);
    return b;
  }

  // --- stage 1: five static ledges spiralling up the wall ---
  // The first is a jump straight up from the shaft floor, taken from wherever you
  // like; after that every one is a real gap. This is where you learn the arc.
  for (let i = 0; i < 5; i++) {
    const p = spiral(42 + i * 42);
    slab(p.x, p.z, LEDGE_HALF, LEDGE_HALF, RISE * (i + 1), ledgeMat, 0xe0b256);
  }

  // --- stage 2: ferries, running between stations ---
  // The first cut of this had three independently moving platforms you had to line
  // up by eye. Two sine waves of different period beat against each other, and the
  // measured wait for an opening reached nineteen seconds — the trial's most
  // interesting stage was mostly standing still. A ferry runs between two *static*
  // stations instead: you are never waiting on more than its own period, and from
  // the deck you are standing on it is obvious what to do.
  //
  // It travels the arc rather than the chord, hugging the wall the spiral climbs,
  // and it *stops short of both its stations*: DOCK_INSET below is the angle that
  // leaves the same jump at each dock as every other gap in the trial. Without it
  // a ferry ends its swing sitting on top of the station, and boarding is a step
  // rather than a leap — which is the whole point of the thing.
  //
  // Its period falls out of the speed cap. 3 m/s sounds quick, but the motion is
  // sinusoidal: it only touches that at mid-arc and eases to a standstill at each
  // dock, which is where you get on and off. It stays under the 4.2 m/s walk, so a
  // rider can always out-adjust the thing carrying them.
  const MOVER_MAX = 3.0;
  // chord(I) = 2·R·sin(I/2), and we want that chord to span the gap plus both
  // half-widths — which comes out near 42°. STATION_SPAN then has to be comfortably
  // more than twice that or the two insets eat the whole arc; but not much more,
  // because the span sets the period and the period is what you stand around
  // waiting for. At 126° the ferry rides a third of the way round and comes back
  // inside six seconds.
  const DOCK_INSET =
    (2 * Math.asin((STAGE1_GAP + FERRY_HALF + STATION_HALF) / (2 * R)) * 180) / Math.PI;
  const STATION_SPAN = 126;
  const ferry = (fromDeg: number, toDeg: number, top: number) => {
    const degA = fromDeg + DOCK_INSET, degB = toDeg - DOCK_INSET;
    const mid = ((degA + degB) / 2) * (Math.PI / 180);
    const half = ((degB - degA) / 2) * (Math.PI / 180);
    const w = MOVER_MAX / (R * Math.abs(half));   // peak arc speed hits exactly MOVER_MAX
    const start = spiral(degA);
    const b = slab(start.x, start.z, FERRY_HALF, FERRY_HALF, top, moverMat, 0x7fd8ff);
    b.motion = (t) => {
      const a = mid + half * Math.sin(w * t - Math.PI / 2);   // starts docked at degA
      const da = half * w * Math.cos(w * t - Math.PI / 2);
      const x = AXIS.x + R * Math.sin(a), z = AXIS.z - R * Math.cos(a);
      b.plat.minX = x - FERRY_HALF; b.plat.maxX = x + FERRY_HALF;
      b.plat.minZ = z - FERRY_HALF; b.plat.maxZ = z + FERRY_HALF;
      b.plat.vx = R * Math.cos(a) * da;
      b.plat.vz = R * Math.sin(a) * da;
      b.mesh.position.set(x, top, z);
    };
  };
  const station = (deg: number, top: number) => {
    const p = spiral(deg);
    slab(p.x, p.z, STATION_HALF, STATION_HALF, top, ledgeMat, 0xe0b256);
  };
  const DOCK_A = 210 + STATION_SPAN, DOCK_B = DOCK_A + STATION_SPAN;
  ferry(210, DOCK_A, RISE * 6);   // out from the last of the static ledges…
  station(DOCK_A, RISE * 7);      // …to somewhere to stand and watch it go back
  ferry(DOCK_A, DOCK_B, RISE * 8);
  station(DOCK_B, RISE * 9);      // the last solid ground before the tiles

  // --- stage 3: five tiles that blink ---

  const BLINK_CYCLE = 3.0, BLINK_SOLID = 2.0;
  for (let i = 0; i < 5; i++) {
    const p = spiral(DOCK_B + 36 + i * 36);
    const b = slab(p.x, p.z, TILE_HALF, TILE_HALF, RISE * (10 + i), blinkMat, 0xff9de0);
    // Three phases a third of a cycle apart, not two a half apart. Two phases look
    // symmetric and are not: with a 2/3 duty cycle one direction of travel gets a
    // one-second window to jump and the other gets a third of that, because you
    // have to be standing on a solid tile *and* land on a solid tile. Three phases
    // give every hop the same one second, and read as a wave climbing the spiral
    // rather than as a strobe.
    const phase = (i % 3) * (BLINK_CYCLE / 3);
    const body = b.mesh.children[0] as THREE.Mesh;
    const bodyMat = (body.material as THREE.MeshStandardMaterial).clone();
    bodyMat.transparent = true;
    body.material = bodyMat;
    b.blink = (t) => {
      const k = (t + phase) % BLINK_CYCLE;
      const solid = k < BLINK_SOLID;
      b.plat.active = solid;
      // The last third of a solid phase flickers, so a tile always warns before
      // it goes. Standing on one that vanishes is meant to feel deserved.
      const warn = solid && k > BLINK_SOLID * 0.66 ? 0.5 + 0.5 * Math.sin(k * 26) : 1;
      bodyMat.opacity = solid ? 0.45 + 0.55 * warn : 0.1;
      b.glow.opacity = solid ? 0.24 + 0.4 * warn : 0.05;
    };
  }

  // --- the summit ---
  slab(AXIS.x, AXIS.z, SUMMIT_HALF, SUMMIT_HALF, SUMMIT_TOP, ledgeMat, 0xffe6a8);

  // ---------- gates ----------
  const sigil = () => trialSigilTexture(String(floor.year), 'the way back');

  const backGate = buildPortalGate(group, {
    key: 'back',
    x: 0, y: GATE_RISE, z: SHAFT.z0 + 0.1,
    yaw: 0, width: GATE_W, height: GATE_H,
    map: sigil(),
    tint: new THREE.Color(def.tint),
    rune: true,
    light: true,
    enter: () => handlers.onLeave(backGate),
  });
  portals.push(backGate);
  interactables.push({
    mesh: backGate.surface, label: 'Leave the Trial', kind: 'portal',
    action: () => handlers.onLeave(backGate),
  });

  // The way home from the top, so a winner never has to climb back down. No
  // `rune`: a gate draws its floor ring at world y = 0, and this one opens 12 m up.
  const topGate = buildPortalGate(group, {
    key: 'back-top',
    x: AXIS.x - SUMMIT_HALF + 0.1, y: SUMMIT_TOP + GATE_RISE, z: AXIS.z,
    yaw: Math.PI / 2, width: GATE_W, height: GATE_H,
    map: sigil(),
    tint: new THREE.Color(def.tint),
    light: true,
    enter: () => handlers.onLeave(topGate),
  });
  portals.push(topGate);
  interactables.push({
    mesh: topGate.surface, label: 'Leave the Trial', kind: 'portal',
    action: () => handlers.onLeave(topGate),
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.4, 40),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(def.tint), transparent: true, opacity: 0.24, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(AXIS.x - SUMMIT_HALF + 1.2, SUMMIT_TOP + 0.03, AXIS.z);
  group.add(ring);

  // ---------- signage ----------
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.3),
    new THREE.MeshBasicMaterial({
      map: ruleBoardTexture(def.title, [
        'Climb to the summit and take the Decree.',
        'Fall, and the trial begins again.',
        'Some stones move. Some do not stay.',
      ]),
      transparent: true,
    }),
  );
  board.position.set(5.2, 2.6, SHAFT.z0 + 0.15);
  group.add(board);

  // ---------- the prize ----------
  const artifact = artifactById(def.artifactId);
  const prizeName = artifact?.name ?? 'the Decree';
  updaters.push(buildPedestal(
    group, interactables, prizeName,
    handlers.hasArtifact(def.artifactId),
    () => handlers.onClaim(def.artifactId),
  ));

  // ---------- collision ----------
  // One rect covering the whole shaft floor: horizontal movement is never blocked
  // in here, so you can always walk off an edge — the platforms alone decide what
  // holds you up. The second is the run-up bay in front of the entry gate.
  const regions: Rect[] = [
    { minX: -SHAFT.hx + MARGIN, maxX: SHAFT.hx - MARGIN, minZ: SHAFT.z0 + MARGIN, maxZ: SHAFT.z1 - MARGIN },
    { minX: -GATE_W / 2 + 0.2, maxX: GATE_W / 2 - 0.2, minZ: SHAFT.z0 + 0.45, maxZ: SHAFT.z0 + MARGIN },
  ];
  const world: CollisionWorld = { regions, excluders: [], platforms };

  // ---------- failure ----------
  // A fall is judged against the highest surface actually stood on, not against
  // the floor: the spiral doubles back over itself, so a drop from stage 3 can
  // land on a stage 1 ledge and would otherwise never reach the bottom at all.
  let peak = 0;
  const judgeFall = (playerPos: THREE.Vector3) => {
    const feet = playerPos.y - EYE_HEIGHT;
    for (const p of platforms) {
      if (p.active === false || Math.abs(p.top - feet) > 0.06) continue;
      if (playerPos.x < p.minX || playerPos.x > p.maxX) continue;
      if (playerPos.z < p.minZ || playerPos.z > p.maxZ) continue;
      if (p.top > peak) peak = p.top;
    }
    if (peak <= 0) return;                       // still on the floor: nothing to fall from
    if (feet > 0.05 && feet >= peak - FALL_TOLERANCE) return;
    // Zeroing `peak` is what disarms this until the next climb — no extra guard
    // is needed while the reset's fade plays out.
    peak = 0;
    handlers.onReset();
  };

  return {
    group,
    interactables,
    portals,
    world,
    // In the antechamber: far enough off the entry wall that the chase camera
    // isn't pinned against it for the one shot that has to sell the climb, and
    // clear of the spiral overhead so you arrive under open air.
    spawn: { x: 0, z: 6.0, yaw: Math.PI },
    // You cannot judge a jump you cannot see yourself take.
    thirdPerson: true,
    // Standing at the bottom, the summit is the full height of the shaft away —
    // under the hall default it sat behind a wall of haze, which is no way to
    // present the thing you are climbing towards.
    fog: { near: SHAFT.ceil, far: SHAFT.ceil * 4.5 },
    update: (t, playerPos) => {
      for (const b of blocks) { b.motion?.(t); b.blink?.(t); }
      for (const u of updaters) u(t);
      for (const g of portals) g.update(t);
      judgeFall(playerPos);
    },
    dispose: () => disposeObject(group),
  };
}

// ---------------------------------------------------------------------------

/**
 * The pedestal at the summit. Holds the Decree until it is taken — after that
 * the holder stands empty for anyone who climbs it again, which is worth doing
 * purely because this is the only room in the Keep you can lose.
 */
function buildPedestal(
  group: THREE.Group, inter: Interactable[], name: string, claimed: boolean, onClaim: () => void,
): (t: number) => void {
  const holder = new THREE.Group();
  // Off the centre of the dais, so the landing you arrive on is clear and you
  // can walk round the thing rather than into it.
  holder.position.set(AXIS.x + 1.1, SUMMIT_TOP, AXIS.z);
  group.add(holder);

  const stone = new THREE.MeshStandardMaterial({ color: '#3a3222', roughness: 0.55, metalness: 0.35 });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.5, 24), stone);
  column.position.y = 0.75;
  holder.add(column);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.55, 0.22, 24), stone);
  cap.position.y = 1.6;
  holder.add(cap);

  // The ring is the `pulse` target: a torus with an emissive material, which is
  // what InteractionManager brightens while you are looking at the prize.
  const body = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.05, 10, 40),
    new THREE.MeshStandardMaterial({ color: '#6b5a2a', emissive: 0xe0b256, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.6 }),
  );
  body.rotation.x = -Math.PI / 2;
  body.position.y = 1.76;
  holder.add(body);

  /** The empty holder: what the summit looks like once the Decree is gone. */
  const addPlaque = () => {
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.375),
      new THREE.MeshBasicMaterial({ map: titlePlaqueTexture('Already claimed'), transparent: true }),
    );
    plaque.position.set(0, 2.2, 0);
    holder.add(plaque);
  };

  if (claimed) {
    addPlaque();
    return () => {};
  }

  // Two planes back to back rather than one double-sided one: the sheet turns, and
  // a DoubleSide plane shows you the *mirror* of its texture from behind — half a
  // revolution of a Decree whose title reads backwards.
  const sheet = new THREE.Group();
  const vellum = new THREE.MeshBasicMaterial({ map: decreeTexture(name), transparent: true });
  for (const face of [0, Math.PI]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.075), vellum);
    side.rotation.y = face;
    sheet.add(side);
  }
  sheet.position.y = 2.42;
  holder.add(sheet);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.position.y = 2.42;
  holder.add(halo);

  // The raycast target is a generous invisible box, not the sheet — the sheet
  // turns edge-on twice a revolution and would be unhittable there.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.7, 1.4), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 2.42;
  hit.userData.pulse = body;
  holder.add(hit);

  // Taking it empties the holder here and now. The entry is mutated in place
  // rather than removed: `InteractionManager` indexes the array it was handed at
  // mount, so a splice would leave a stale mesh pointing at a dead action.
  let taken = false;
  const item: Interactable = {
    mesh: hit,
    label: `Take the ${name}`,
    kind: 'prize',
    action: () => {
      if (taken) return;
      taken = true;
      sheet.visible = false;
      halo.visible = false;
      addPlaque();
      item.label = 'The holder stands empty';
      onClaim();
    },
  };
  inter.push(item);

  const bodyMat = body.material as THREE.MeshStandardMaterial;
  return (t: number) => {
    if (taken) return;
    sheet.rotation.y = t * 0.5;
    sheet.position.y = 2.42 + Math.sin(t * 1.3) * 0.07;
    halo.position.y = sheet.position.y;
    bodyMat.emissiveIntensity = 0.35 + Math.sin(t * 2.4) * 0.18;
  };
}
