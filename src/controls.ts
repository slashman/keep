import * as THREE from 'three';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

/**
 * A standable raised surface. Ground level is still y = 0 everywhere inside
 * `regions`; a platform only ever raises the floor, never lowers it.
 *
 * Two things are deliberately missing, because an obby does not need them and
 * they would cost the per-axis slide its simplicity: a platform has no sides and
 * no underside. You can rise up through one from below, and you can never bonk
 * your head on one. Lay platforms out so that is not a shortcut.
 */
export interface Platform extends Rect {
  /** Walking height of the surface. */
  top: number;
  /** Surface velocity in the XZ plane, m/s. A rider is carried by it. Movers rewrite these each frame. */
  vx?: number; vz?: number;
  /** Blinking platforms: solid only while true. `undefined` counts as solid. */
  active?: boolean;
}

/** The walkable area is the union of `regions` (rectangles), minus the `excluders`. */
export interface CollisionWorld {
  regions: Rect[];
  excluders: { x: number; z: number; r: number }[];
  /**
   * Raised surfaces standing inside those regions. Omit it and the floor is flat
   * at y = 0, which is exactly how every place but the obby behaves.
   * A platform must sit inside a walkable region: `walkable()` still gates
   * horizontal movement, so a platform hanging over the void is unreachable.
   */
  platforms?: Platform[];
}

export const EYE_HEIGHT = 2.5;
const SPEED = 4.2;
const SPRINT = 8.4;
const GRAVITY = 22;      // m/s² pulling the player back down
// Initial upward velocity on jump. The player is a giant — EYE_HEIGHT 2.5 — and
// at the original 7 the leap barely cleared his own knee: enough to reach a
// painting from the floor in front of it, nowhere near enough to platform with.
const JUMP_SPEED = 12;
const SENS = 0.0022;
const TOUCH_SENS = 0.006; // radians per pixel of swipe
const PITCH_LIMIT = Math.PI / 2 - 0.08;
/** How high a lip you walk up without jumping. Only ever applied while standing. */
const STEP_UP = 0.35;

/**
 * The jump, as the player actually experiences it. Anything laying out ground to
 * jump across should derive its numbers from here rather than hardcoding metres,
 * so that retuning the leap retunes the levels built on it.
 *
 * `apex` is the *sampled* peak, not the analytic one: velocity is decremented
 * before the position integrates, so a 60 fps frame loses JUMP_SPEED/120 off the
 * top, and that lower figure is the one a level has to be jumpable at.
 */
export const JUMP_ARC = {
  apex: (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY) - JUMP_SPEED / 120,
  hang: (2 * JUMP_SPEED) / GRAVITY,
  reach: SPEED * ((2 * JUMP_SPEED) / GRAVITY),
};

/** Hand-rolled pointer-lock first-person controller (WASD + mouse look + collision). */
export class PlayerControls {
  readonly camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private keys = new Set<string>();
  private locked = false;
  enabled = true; // toggled off while a menu/video overlay is open
  touch = false;  // touch device: no pointer lock — joystick + swipe drive things instead
  private touchActive = false;
  private moveX = 0; // joystick strafe (−1..1)
  private moveY = 0; // joystick forward (−1..1)
  world: CollisionWorld = { regions: [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }], excluders: [] };
  onLockChange?: (locked: boolean) => void;
  // Movement read out for the audio engine (footstep cadence).
  movedDistance = 0; // world units actually travelled last frame
  sprinting = false;
  private velY = 0;           // vertical velocity (jump/gravity)
  private spaceWasDown = false; // edge-detect Space so holding it doesn't auto-bounce
  // The platform resolveGround() last landed on — its second return value, kept
  // in a field rather than an allocated pair because the ground is resolved
  // several times a frame. Only meaningful right after that call.
  private groundPlat: Platform | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChangeEvt);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // On touch there is no pointer lock; "locked" means the game is running.
  get isLocked() { return this.touch ? this.touchActive : this.locked; }

  /**
   * The surface under (x, z) holding up a player whose feet are at `feetY` — the
   * highest platform not above `maxTop`, else the y = 0 floor. Returns its height,
   * and leaves the platform itself in `groundPlat`.
   *
   * `maxTop` is the whole rule, and it must be the feet' own height nearly always.
   * Allowing it to reach *above* the feet is the step-up, and the step-up is only
   * ever legal while already standing: a mid-air player who is briefly within
   * reach of a ledge beside them would otherwise be yanked up onto it and have
   * their jump killed — which is exactly what "getting stuck on platforms" was.
   */
  private resolveGround(x: number, z: number, maxTop: number): number {
    let top = 0;
    let plat: Platform | null = null;
    for (const p of this.world.platforms ?? []) {
      if (p.active === false) continue;
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      if (p.top > maxTop || p.top <= top) continue;
      top = p.top;
      plat = p;
    }
    this.groundPlat = plat;
    return top;
  }

  /** What is holding the feet up right now — never anything above them. */
  private groundUnder(x: number, z: number, feetY: number): number {
    return this.resolveGround(x, z, feetY + 1e-3);
  }

  /** Height of the highest surface at (x, z) — what `setPose` would stand you on. */
  groundAt(x: number, z: number): number {
    return this.resolveGround(x, z, Infinity);
  }

  /** Mid-jump — the test a portal uses to decide you leapt into it. */
  get airborne() {
    const pos = this.camera.position;
    const feet = pos.y - EYE_HEIGHT;
    return feet > this.groundUnder(pos.x, pos.z, feet) + 0.15;
  }

  /** Leap, if standing on the floor (the on-screen touch button's entry point). */
  jump() {
    if (!this.isLocked || !this.enabled) return;
    const pos = this.camera.position;
    const feet = pos.y - EYE_HEIGHT;
    if (feet <= this.groundUnder(pos.x, pos.z, feet) + 1e-3) this.velY = JUMP_SPEED;
  }

  lock() {
    if (this.touch) {
      if (!this.touchActive) { this.touchActive = true; this.onLockChange?.(true); }
    } else {
      this.dom.requestPointerLock();
    }
  }
  unlock() {
    if (this.touch) {
      if (this.touchActive) { this.touchActive = false; this.moveX = this.moveY = 0; this.onLockChange?.(false); }
    } else if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  /** Joystick input from the touch UI: x = strafe, y = forward, each −1..1. */
  setMove(x: number, y: number) { this.moveX = x; this.moveY = y; }

  /** Apply a look delta (pixels) from a touch swipe. */
  applyLook(dx: number, dy: number) {
    if (!this.isLocked || !this.enabled) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= dx * TOUCH_SENS;
    this.euler.x -= dy * TOUCH_SENS;
    this.euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Place the player and aim along a yaw (radians), standing on whatever is highest there. */
  setPose(x: number, z: number, yaw: number) {
    this.camera.position.set(x, this.resolveGround(x, z, Infinity) + EYE_HEIGHT, z);
    this.velY = 0;
    this.euler.set(0, yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private onLockChangeEvt = () => {
    this.locked = document.pointerLockElement === this.dom;
    if (!this.locked) this.keys.clear();
    this.onLockChange?.(this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= e.movementX * SENS;
    this.euler.x -= e.movementY * SENS;
    this.euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  update(dt: number) {
    this.movedDistance = 0;
    if (!this.isLocked || !this.enabled) return;

    // ---- vertical: jump + gravity (runs even when standing still) ----
    // Order matters: carry, then gravity, then input, then the step-up snap.
    // Resolving the ground once up front and once again after the horizontal
    // move is what stops you sinking for a frame when you step onto a ledge.
    const pos = this.camera.position;
    const ground = this.groundUnder(pos.x, pos.z, pos.y - EYE_HEIGHT);
    const grounded = pos.y <= ground + EYE_HEIGHT + 1e-3;

    // A moving platform drags its rider along before they get a say.
    const ride = grounded ? this.groundPlat : null;
    if (ride && (ride.vx || ride.vz)) {
      const rx = pos.x + (ride.vx ?? 0) * dt;
      const rz = pos.z + (ride.vz ?? 0) * dt;
      if (this.walkable(rx, pos.z)) pos.x = rx;
      if (this.walkable(pos.x, rz)) pos.z = rz;
    }

    const spaceDown = this.keys.has('Space');
    if (spaceDown && !this.spaceWasDown && grounded) this.velY = JUMP_SPEED;
    this.spaceWasDown = spaceDown;
    if (grounded && this.velY <= 0) {
      pos.y = ground + EYE_HEIGHT;
      this.velY = 0;
    } else {
      this.velY -= GRAVITY * dt;
      pos.y += this.velY * dt;
      if (pos.y <= ground + EYE_HEIGHT) { pos.y = ground + EYE_HEIGHT; this.velY = 0; }
    }

    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    f += this.moveY; s += this.moveX; // analog joystick (touch)
    const mag = Math.min(1, Math.hypot(f, s));
    if (mag < 0.001) { this.sprinting = false; return; }

    this.sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = this.sprinting ? SPRINT : SPEED;
    // horizontal forward/right from current yaw
    this.euler.setFromQuaternion(this.camera.quaternion);
    const yaw = this.euler.y;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // forward = -Z in camera space
    let dx = (-sin * f + cos * s);
    let dz = (-cos * f - sin * s);
    const len = Math.hypot(dx, dz) || 1;
    const step = speed * mag * dt; // analog magnitude scales speed
    dx = (dx / len) * step;
    dz = (dz / len) * step;

    // Move each axis independently, accepting it only if the destination is
    // walkable. This lets the player slide along walls and pass through the
    // doorways where regions overlap.
    const x0 = pos.x, z0 = pos.z;
    const nx = pos.x + dx;
    if (this.walkable(nx, pos.z)) pos.x = nx;
    const nz = pos.z + dz;
    if (this.walkable(pos.x, nz)) pos.z = nz;
    this.movedDistance = Math.hypot(pos.x - x0, pos.z - z0);

    // Walking onto a low lip steps you up onto it; walking off an edge does
    // nothing here, and gravity turns it into a fall on the next frame. Only
    // while already standing — in mid-air this is what would snatch you sideways
    // onto a ledge you meant to jump past.
    if (grounded && this.velY <= 0) {
      const feet = pos.y - EYE_HEIGHT;
      const top = this.resolveGround(pos.x, pos.z, feet + STEP_UP);
      if (top > feet) { pos.y = top + EYE_HEIGHT; this.velY = 0; }
    }
  }

  private walkable(x: number, z: number): boolean {
    const w = this.world;
    for (const ex of w.excluders) {
      if ((x - ex.x) ** 2 + (z - ex.z) ** 2 < ex.r * ex.r) return false;
    }
    for (const r of w.regions) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
    }
    return false;
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChangeEvt);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
