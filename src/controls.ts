import * as THREE from 'three';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

/** The walkable area is the union of `regions` (rectangles), minus the `excluders`. */
export interface CollisionWorld {
  regions: Rect[];
  excluders: { x: number; z: number; r: number }[];
}

const EYE_HEIGHT = 2.5;
const SPEED = 4.2;
const SPRINT = 8.4;
const GRAVITY = 22;      // m/s² pulling the player back down
const JUMP_SPEED = 7;    // initial upward velocity on jump (≈1.1 m peak)
const SENS = 0.0022;
const TOUCH_SENS = 0.006; // radians per pixel of swipe
const PITCH_LIMIT = Math.PI / 2 - 0.08;

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

  /** Mid-jump — the test a portal uses to decide you leapt into it. */
  get airborne() { return this.camera.position.y > EYE_HEIGHT + 0.15; }

  /** Leap, if standing on the floor (the on-screen touch button's entry point). */
  jump() {
    if (this.isLocked && this.enabled && this.camera.position.y <= EYE_HEIGHT + 1e-3) {
      this.velY = JUMP_SPEED;
    }
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

  /** Place the player and aim along a yaw (radians). */
  setPose(x: number, z: number, yaw: number) {
    this.camera.position.set(x, EYE_HEIGHT, z);
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
    const pos = this.camera.position;
    const grounded = pos.y <= EYE_HEIGHT + 1e-3;
    const spaceDown = this.keys.has('Space');
    if (spaceDown && !this.spaceWasDown && grounded) this.velY = JUMP_SPEED;
    this.spaceWasDown = spaceDown;
    if (grounded && this.velY <= 0) {
      pos.y = EYE_HEIGHT;
      this.velY = 0;
    } else {
      this.velY -= GRAVITY * dt;
      pos.y += this.velY * dt;
      if (pos.y <= EYE_HEIGHT) { pos.y = EYE_HEIGHT; this.velY = 0; }
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
