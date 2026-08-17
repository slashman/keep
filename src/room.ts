import * as THREE from 'three';
import type { Floor, Person, Project, ProjectButton } from './types';
import type { CollisionWorld, Rect } from './controls';
import { buttonStyle, genreColor } from './tags';
import { placeNpcs, type NpcUpdater } from './npc';
import { buildPortalGate, type PortalGate } from './portal';
import { disposeObject, stoneTexture, type FloorBuild, type Interactable } from './floor';
import { modelFor, loadRoomModel, type LoadedModel } from './roomModel';
import {
  placardTexture, titlePlaqueTexture, bannerTexture, buttonLabelTexture,
  fallbackPaintingTexture, attachProjectArt, yearTapestryTexture,
} from './textures';

// The room behind a project's gate: a shrine to one project. The artwork fills
// the far wall, the museum placard and banner take the flanks, and the project's
// links stand as levers on a dais in the middle. The way home is the gate you
// came through — turn around and leap back into it.

const RX = 9;          // half-width  (x ∈ [−RX, RX])
const RD = 16;         // depth       (z ∈ [0, RD])
const RC = 7.6;        // ceiling height
const MARGIN = 1.1;    // player standoff from the walls
const DAIS = { z: 8.6, r: 2.9, h: 0.6 };
const LEVER_R = 2.45;  // radius of the ring of levers standing on the dais
const GATE_W = 3.2;
const GATE_H = 2.6;
const GATE_Y = 3.15;

export interface RoomHandlers {
  onButton: (btn: ProjectButton) => void;
  onNpc: (person: Person, projects: string[]) => void;
  /** Leap back out to the year floor. */
  onLeave: (gate: PortalGate) => void;
}

export function buildProjectRoom(
  p: Project, floor: Floor, handlers: RoomHandlers, people: Person[] = [],
): FloorBuild {
  const group = new THREE.Group();
  const interactables: Interactable[] = [];
  const portals: PortalGate[] = [];
  const updaters: NpcUpdater[] = [];
  const accent = new THREE.Color(genreColor(p.genre?.[0]));

  // ---------- shell ----------
  const floorMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#332b48', '#1d1a2b'), roughness: 0.85, metalness: 0.05 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: '#0b0912', roughness: 1 });
  const wallMat = new THREE.MeshStandardMaterial({ map: stoneTexture('#3d3355', '#272038'), roughness: 0.9 });

  const fl = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RD), floorMat);
  fl.rotation.x = -Math.PI / 2;
  fl.position.set(0, 0, RD / 2);
  group.add(fl);
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RD), ceilMat);
  ce.rotation.x = Math.PI / 2;
  ce.position.set(0, RC, RD / 2);
  group.add(ce);

  const wall = (w: number, x: number, z: number, yaw: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, RC, 0.2), wallMat);
    m.position.set(x, RC / 2, z);
    m.rotation.y = yaw;
    group.add(m);
  };
  wall(RX * 2, 0, 0, 0);                    // gate wall (behind you on arrival)
  wall(RX * 2, 0, RD, 0);                   // mural wall
  wall(RD, -RX, RD / 2, Math.PI / 2);       // placard wall
  wall(RD, RX, RD / 2, Math.PI / 2);        // banner wall

  // gold trim skirting the room
  const trimMat = new THREE.MeshStandardMaterial({ color: '#3a2f14', roughness: 0.6, metalness: 0.4 });
  for (const [w, x, z, yaw] of [[RX * 2, 0, 0.1, 0], [RX * 2, 0, RD - 0.1, 0], [RD, -RX + 0.1, RD / 2, Math.PI / 2], [RD, RX - 0.1, RD / 2, Math.PI / 2]] as const) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, 0.12), trimMat);
    t.position.set(x, 0.16, z);
    t.rotation.y = yaw;
    group.add(t);
  }

  // ---------- lighting ----------
  group.add(new THREE.HemisphereLight(accent.getHex(), 0x191326, 0.45));
  group.add(new THREE.AmbientLight(0xffffff, 0.22));
  const key = new THREE.DirectionalLight(0xfff1d6, 0.3);
  key.position.set(2, 9, 4);
  group.add(key);
  for (const x of [-3.4, 3.4]) {
    const l = new THREE.PointLight(0xffd9a0, 24, 16, 2);
    l.position.set(x, RC - 1.4, RD - 3.2);
    group.add(l);
  }
  const daisLight = new THREE.PointLight(accent, 20, 14, 2);
  daisLight.position.set(0, 4.2, DAIS.z);
  group.add(daisLight);

  // ---------- the mural: the project's own artwork, wall-sized ----------
  // Depths, from the wall inward: wall face at RD−0.1, frame box RD−0.19…RD−0.01,
  // and the artwork itself just proud of the frame at RD−0.21.
  const muralMat = new THREE.MeshBasicMaterial({ map: fallbackPaintingTexture(p.title) });
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 5.2), muralMat);
  mural.position.set(0, 4.15, RD - 0.21);
  mural.rotation.y = Math.PI;
  group.add(mural);
  attachProjectArt(p, (tex) => {
    const old = muralMat.map;
    muralMat.map = tex;
    muralMat.needsUpdate = true;
    old?.dispose();
  });
  const muralFrame = new THREE.Mesh(
    new THREE.BoxGeometry(8.5, 5.7, 0.18),
    new THREE.MeshStandardMaterial({ color: '#2a2110', metalness: 0.5, roughness: 0.35 }),
  );
  muralFrame.position.set(0, 4.15, RD - 0.1);
  group.add(muralFrame);

  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.85),
    new THREE.MeshBasicMaterial({ map: titlePlaqueTexture(p.title), transparent: true }),
  );
  plaque.position.set(0, 0.85, RD - 0.21); // clear of the frame's bottom edge at 1.3
  plaque.rotation.y = Math.PI;
  group.add(plaque);

  // ---------- flanks: the museum placard, and the genre banner ----------
  const placardBack = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 4.1, 0.1),
    new THREE.MeshStandardMaterial({ color: '#0c0a14', roughness: 0.9 }),
  );
  placardBack.position.set(-RX + 0.15, 3.1, RD / 2);
  placardBack.rotation.y = Math.PI / 2;
  group.add(placardBack);
  const placard = new THREE.Mesh(
    new THREE.PlaneGeometry(2.85, 3.89),
    new THREE.MeshBasicMaterial({ map: placardTexture(p, floor.year) }),
  );
  placard.position.set(-RX + 0.22, 3.1, RD / 2);
  placard.rotation.y = Math.PI / 2;
  group.add(placard);
  const placardLight = new THREE.PointLight(0xffe6b0, 14, 9, 2);
  placardLight.position.set(-RX + 2.2, 5.2, RD / 2);
  group.add(placardLight);

  const genre = p.genre?.[0];
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 3.8),
    new THREE.MeshBasicMaterial({ map: bannerTexture(genre, genreColor(genre)), transparent: true }),
  );
  banner.position.set(RX - 0.18, 4.1, RD / 2 + 1.6);
  banner.rotation.y = -Math.PI / 2;
  group.add(banner);
  const rodMat = new THREE.MeshStandardMaterial({ color: '#4a3d18', metalness: 0.7, roughness: 0.3 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 10), rodMat);
  rod.rotation.x = Math.PI / 2;
  rod.position.set(RX - 0.18, 6.05, RD / 2 + 1.6);
  group.add(rod);

  const yearPlaque = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 0.69),
    new THREE.MeshBasicMaterial({ map: titlePlaqueTexture(yearLine(p, floor)), transparent: true }),
  );
  yearPlaque.position.set(RX - 0.18, 2.5, RD / 2 - 2.2);
  yearPlaque.rotation.y = -Math.PI / 2;
  group.add(yearPlaque);

  // ---------- the dais and its ring of levers ----------
  // A project with a 3D centrepiece stands it where the shard would float, so the
  // shard steps aside — the two occupy the same air above the dais.
  const spec = modelFor(p);
  const daisUpdate = buildDais(group, p, accent, handlers, interactables, !spec);

  // The model arrives whenever it arrives (megabytes, fetched on demand). If the
  // player has already left by then there is nothing to add it to, so drop it.
  let model: LoadedModel | null = null;
  let gone = false;
  if (spec) {
    void loadRoomModel(spec).then((m) => {
      if (!m) return;
      if (gone) { m.dispose(); return; }
      m.root.position.set(0, DAIS.h, DAIS.z);
      group.add(m.root);
      model = m;
    });
  }

  // ---------- the way home ----------
  const backGate = buildPortalGate(group, {
    key: 'back',
    x: 0, y: GATE_Y, z: 0.1, yaw: 0,
    width: GATE_W, height: GATE_H,
    map: yearTapestryTexture(floor),
    tint: new THREE.Color('#8fd8ff'),
    rune: true,
    light: true,
    enter: () => handlers.onLeave(backGate),
  });
  portals.push(backGate);
  interactables.push({
    mesh: backGate.surface,
    label: `Leap back to ${floor.year}`,
    kind: 'portal',
    action: () => handlers.onLeave(backGate),
  });

  // ---------- drifting motes, so the air feels charged ----------
  const motes = buildMotes(group, accent);

  // ---------- collision: the room, minus the dais, plus the gate's run-up bay ----------
  const regions: Rect[] = [
    { minX: -RX + MARGIN, maxX: RX - MARGIN, minZ: MARGIN, maxZ: RD - MARGIN },
    { minX: -GATE_W / 2 + 0.2, maxX: GATE_W / 2 - 0.2, minZ: 0.45, maxZ: MARGIN + 0.1 },
  ];
  const excluders = [{ x: 0, z: DAIS.z, r: DAIS.r + 0.35 }];

  // ---------- the people who built it ----------
  placeNpcs(group, regions, excluders, people, updaters, (mesh, person) => {
    interactables.push({
      mesh, label: `Talk with ${person.name}`, kind: 'npc',
      action: () => handlers.onNpc(person, [p.title]),
    });
  });

  const world: CollisionWorld = { regions, excluders };
  return {
    group,
    interactables,
    portals,
    world,
    spawn: { x: 0, z: 3.2, yaw: Math.PI }, // stepping out of the gate, artwork dead ahead
    update: (t, playerPos) => {
      for (const u of updaters) u(t, playerPos);
      for (const g of portals) g.update(t);
      daisUpdate(t);
      model?.update(t);
      motes(t);
      daisLight.intensity = 17 + Math.sin(t * 1.7) * 4;
    },
    dispose: () => {
      gone = true;                 // …so a model still in flight is dropped on arrival
      model?.dispose();
      disposeObject(group);
    },
  };
}

// ---------------------------------------------------------------------------

/** "2019–2021" — the project's place in the timeline (its span, not just its floor). */
function yearLine(p: Project, floor: Floor): string {
  const years = (p.years ?? []).filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  return years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : String(p.year ?? floor.year);
}

/**
 * The raised platform in the middle of the room: a floating shard of the project
 * over a ring of levers, one per link. Returns its per-frame animator.
 */
function buildDais(
  group: THREE.Group, p: Project, accent: THREE.Color,
  handlers: RoomHandlers, interactables: Interactable[], withShard = true,
): (t: number) => void {
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture('#4a3f66', '#2b2440'), roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(DAIS.r, DAIS.r + 0.15, DAIS.h, 40), stone);
  base.position.set(0, DAIS.h / 2, DAIS.z);
  group.add(base);

  const rune = new THREE.Mesh(
    new THREE.RingGeometry(DAIS.r - 0.8, DAIS.r - 0.25, 48),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(0, DAIS.h + 0.02, DAIS.z);
  group.add(rune);

  // the floating shard
  const shard = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: accent, emissiveIntensity: 1.6,
      roughness: 0.15, metalness: 0.3, flatShading: true,
    }),
  );
  shard.position.set(0, 3.1, DAIS.z);
  shard.visible = withShard;
  group.add(shard);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 24, 24),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  shard.add(halo);

  // ---- the levers ----
  const buttons = (p.buttons ?? []).filter((b) => b.url).slice(0, 7);
  const spread = Math.min(0.55, 2.9 / Math.max(1, buttons.length));
  const woodMat = new THREE.MeshStandardMaterial({ color: '#241b0e', roughness: 0.7, metalness: 0.2 });

  buttons.forEach((btn, i) => {
    // fan them around the dais, the first ones facing whoever walks in
    const a = (i - (buttons.length - 1) / 2) * spread;
    const px = Math.sin(a) * LEVER_R;
    const pz = DAIS.z - Math.cos(a) * LEVER_R;
    const yaw = Math.atan2(Math.sin(a), -Math.cos(a)); // plate faces away from the dais

    const post = new THREE.Group();
    post.position.set(px, DAIS.h, pz);
    post.rotation.y = yaw;
    group.add(post);

    // 0.96 keeps neighbouring posts from touching even with a full seven links
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.7, 0.34), woodMat);
    column.position.set(0, 0.85, 0);
    post.add(column);

    const style = buttonStyle(btn.type);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.28, 0.07),
      new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.4, metalness: 0.3, emissive: style.color, emissiveIntensity: 0.15 }),
    );
    body.position.set(0, 1.42, 0.18);
    post.add(body);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.265),
      new THREE.MeshBasicMaterial({ map: buttonLabelTexture(style.color, style.glyph, style.verb, btn.title), transparent: true }),
    );
    label.position.set(0, 1.42, 0.23);
    label.userData.pulse = body;
    post.add(label);

    interactables.push({
      mesh: label, label: `${style.verb}: ${btn.title}`, kind: 'button',
      action: () => handlers.onButton(btn),
    });
  });

  const shardMat = shard.material as THREE.MeshStandardMaterial;
  return (t: number) => {
    shard.rotation.y = t * 0.4;
    shard.rotation.x = Math.sin(t * 0.3) * 0.25;
    shard.position.y = 3.1 + Math.sin(t * 1.2) * 0.16;
    shardMat.emissiveIntensity = 1.4 + Math.sin(t * 2.4) * 0.5;
    rune.rotation.z = t * 0.12;
  };
}

/** A slow drift of glowing specks through the room. */
function buildMotes(group: THREE.Group, accent: THREE.Color): (t: number) => void {
  const COUNT = 150;
  const pos = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * (RX * 2 - 1.5);
    pos[i * 3 + 1] = 0.4 + Math.random() * (RC - 1.2);
    pos[i * 3 + 2] = 0.8 + Math.random() * (RD - 1.6);
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: accent, size: 0.09, map: dotTexture(), transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(points);

  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  const baseY = Float32Array.from(pos.filter((_, i) => i % 3 === 1));
  return (t: number) => {
    for (let i = 0; i < COUNT; i++) {
      attr.setY(i, baseY[i] + Math.sin(t * 0.35 + phase[i]) * 0.6);
    }
    attr.needsUpdate = true;
    points.rotation.y = Math.sin(t * 0.05) * 0.04;
  };
}

/** A soft round speck. Built per room — disposing the room disposes the texture. */
function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
